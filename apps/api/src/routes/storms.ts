import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { requireAuth } from '../auth';
export async function stormRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (req) => {
    const p = z.object({ bbox: z.string(), from: z.string(), to: z.string(), min_hail: z.coerce.number().default(0.75), kinds: z.string().default('hail,wind') }).parse(req.query);
    const [w, s, e, n] = p.bbox.split(',').map(Number);
    const rows = await q(`SELECT id, swath_storm_id, event_date, kind, max_hail_in, mean_hail_in, max_gust_mph, ST_AsGeoJSON(geom)::json geometry FROM storms
       WHERE company_id=$1 AND event_date BETWEEN $2 AND $3 AND kind = ANY($4) AND (kind='wind' OR max_hail_in >= $5) AND geom && ST_MakeEnvelope($6,$7,$8,$9,4326)`,
      [req.user.companyId, p.from, p.to, p.kinds.split(','), p.min_hail, w, s, e, n]);
    return { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', geometry: r.geometry, properties: { id: r.id, stormId: r.swath_storm_id, eventDate: r.event_date, kind: r.kind, maxHailIn: r.max_hail_in, meanHailIn: r.mean_hail_in, maxGustMph: r.max_gust_mph } })) };
  });
  app.get('/:id', { preHandler: requireAuth }, async (req) => {
    const [s] = await q(`SELECT s.*, (SELECT count(*) FROM parcels p WHERE p.company_id=s.company_id AND ST_Intersects(s.geom, p.centroid)) property_count FROM storms s WHERE s.id=$1 AND s.company_id=$2`, [(req.params as any).id, req.user.companyId]);
    return s ?? null;
  });
  // Ride the swath: streets under the newest storm ranked by hail × roof age × occupancy (spec F8.3)
  app.get('/:id/streets', { preHandler: requireAuth }, async (req) => {
    return q(`WITH under AS (
        SELECT p.*, pse.hail_in, regexp_replace(p.site_address, '^\\d+\\s+', '') street,
          (pse.hail_in * LEAST(1.5, GREATEST(0.4, (extract(year from now()) - COALESCE(p.year_built, extract(year from now())-25)) / 25.0)) * CASE WHEN p.owner_occupied IS FALSE THEN 0.5 ELSE 1 END) score
        FROM parcels p JOIN parcel_storm_events pse ON pse.parcel_id=p.id JOIN storms s ON s.id=pse.storm_id
        WHERE s.id=$1 AND p.company_id=$2 AND pse.hail_in >= 0.75
          AND NOT EXISTS (SELECT 1 FROM knocks k WHERE k.parcel_id=p.id AND (k.disposition='do_not_knock' OR k.created_at > now() - interval '48 hours'))
          AND NOT EXISTS (SELECT 1 FROM jn_jobs j WHERE j.company_id=p.company_id AND j.geom IS NOT NULL AND ST_DWithin(j.geom::geography, p.centroid::geography, 15) AND j.status_name <> 'Lead'))
      SELECT street, count(*) homes, round(avg(score)::numeric,2) score, max(hail_in) max_hail_in, round(avg(extract(year from now()) - year_built)) avg_roof_age,
             count(*) FILTER (WHERE owner_occupied) owner_occupied, array_agg(id) parcel_ids
      FROM under GROUP BY street ORDER BY score DESC`, [(req.params as any).id, req.user.companyId]);
  });
}
