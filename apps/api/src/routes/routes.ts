import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { requireAuth } from '../auth';
import { GoogleMaps, ROUTES_MAX_INTERMEDIATES } from '../integrations/google';
import { solveRoute, haversineM, type LngLat } from '@stormroute/shared';

const DWELL_S = 240; // time at each door, added to travel time

/**
 * Three tiers, all road-accurate when Google is reachable:
 *  1. <= 25 stops  → Routes API with optimizeWaypointOrder (TSP + geometry in one call)
 *  2. > 25 stops   → Route Optimization API for the order (if a service account is configured) else local 2-opt,
 *                    then Routes API without optimization in <= 25-stop chunks for geometry/distance/time
 *  3. Google down  → local 2-opt + haversine estimate
 */
export async function routeRoutes(app: FastifyInstance) {
  app.post('/optimize', { preHandler: requireAuth }, async (req) => {
    const b = z.object({ stops: z.array(z.object({ lngLat: z.tuple([z.number(), z.number()]), label: z.string(), parcelId: z.string().optional(), jobJnid: z.string().optional() })).min(1).max(150),
      start: z.tuple([z.number(), z.number()]), end: z.tuple([z.number(), z.number()]).nullable().optional(), roundTrip: z.boolean().default(false), mode: z.enum(['walking', 'driving']).default('walking') }).parse(req.body);
    const pts = b.stops.map(s => s.lngLat as LngLat), start = b.start as LngLat;
    const end: LngLat | null = b.roundTrip ? start : (b.end as LngLat | null | undefined) ?? null;
    const g = new GoogleMaps(req.user.companyId);

    const local = () => {
      const order = solveRoute(pts, start, end);
      let d = 0, prev = start; for (const i of order) { d += haversineM(prev, pts[i]); prev = pts[i]; } if (end) d += haversineM(prev, end);
      const speed = b.mode === 'walking' ? 1.3 : 11;
      return { order, distanceM: Math.round(d), durationS: Math.round(d / speed + order.length * DWELL_S), solver: 'local' as const };
    };

    try {
      // Tier 1
      if (pts.length <= ROUTES_MAX_INTERMEDIATES) {
        // Routes needs a destination. Without a fixed end we pin the stop farthest from start as the destination and let Google order the rest.
        let dest = end, inter = pts, destIdx = -1;
        if (!dest) { destIdx = pts.map((p, i) => [haversineM(start, p), i] as const).sort((a, b2) => b2[0] - a[0])[0][1]; dest = pts[destIdx]; inter = pts.filter((_, i) => i !== destIdx); }
        const r = await g.computeRoute(start, inter, dest, b.mode, true);
        if (r) {
          const interIdx = pts.map((_, i) => i).filter(i => i !== destIdx);
          const order = r.order.map(i => interIdx[i]); if (destIdx >= 0) order.push(destIdx);
          return { order, distanceM: r.distanceM, durationS: r.durationS + order.length * DWELL_S, geometry: r.geometry, solver: 'google' as const };
        }
      } else {
        // Tier 2: order
        let order: number[] | null = null, solver: 'google-ro' | 'google+local' = 'google+local';
        try { order = await g.optimizeTours(start, pts, end, b.mode, DWELL_S); if (order) solver = 'google-ro'; } catch (e) { req.log.warn({ err: e }, 'route optimization failed, using local order'); }
        if (!order) order = solveRoute(pts, start, end);
        // Geometry/time: chain Routes calls over the ordered stops, 25 intermediates per call
        const seq = order.map(i => pts[i]); const coords: number[][] = []; let distanceM = 0, durationS = 0, from = start;
        for (let i = 0; i < seq.length; i += ROUTES_MAX_INTERMEDIATES) {
          const chunk = seq.slice(i, i + ROUTES_MAX_INTERMEDIATES); const isLast = i + ROUTES_MAX_INTERMEDIATES >= seq.length;
          // Non-final chunks (and a final chunk without a fixed end) end at their last stop; a final chunk with a fixed end visits every stop then goes to `end`.
          const dest = isLast && end ? end : chunk[chunk.length - 1];
          const inter = isLast && end ? chunk : chunk.slice(0, -1);
          const r = await g.computeRoute(from, inter, dest, b.mode, false); if (!r) throw new Error('no route');
          distanceM += r.distanceM; durationS += r.durationS; if (r.geometry) coords.push(...r.geometry.coordinates.slice(coords.length ? 1 : 0)); from = dest;
        }
        return { order, distanceM, durationS: durationS + order.length * DWELL_S, geometry: coords.length ? { type: 'LineString', coordinates: coords } as GeoJSON.LineString : undefined, solver };
      }
    } catch (e) { req.log.warn({ err: e }, 'google routing failed, using local solver'); }
    return local(); // Tier 3
  });
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ name: z.string(), mode: z.string(), start: z.tuple([z.number(), z.number()]), end: z.tuple([z.number(), z.number()]).nullable(), totalM: z.number(), totalS: z.number(), stops: z.array(z.any()), polygon: z.any().optional() }).parse(req.body);
    const [row] = await q(`INSERT INTO routes (company_id, user_id, name, polygon, start_pt, end_pt, mode, total_m, total_s, stops) VALUES ($1,$2,$3, CASE WHEN $4::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($4),4326) END, ST_SetSRID(ST_Point($5,$6),4326), CASE WHEN $7::float IS NULL THEN NULL ELSE ST_SetSRID(ST_Point($7,$8),4326) END, $9,$10,$11,$12) RETURNING id`,
      [req.user.companyId, req.user.id, b.name, b.polygon ? JSON.stringify(b.polygon) : null, b.start[0], b.start[1], b.end?.[0] ?? null, b.end?.[1] ?? null, b.mode, b.totalM, b.totalS, JSON.stringify(b.stops)]);
    reply.code(201); return row;
  });
  app.get('/', { preHandler: requireAuth }, async (req) => q(`SELECT id, name, mode, total_m, total_s, stops, created_at FROM routes WHERE company_id=$1 AND (user_id=$2 OR $3 <> 'rep') ORDER BY created_at DESC`, [req.user.companyId, req.user.id, req.user.role]));
  app.patch('/:id/stops/:index', { preHandler: requireAuth }, async (req) => {
    const { id, index } = req.params as any; const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const [row] = await q(`UPDATE routes SET stops = jsonb_set(stops, ARRAY[$3::text,'done'], to_jsonb($4::boolean)) WHERE id=$1 AND company_id=$2 RETURNING stops`, [id, req.user.companyId, index, done]);
    return row;
  });
}
