import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { requireAuth, assertParcelInCompany } from '../auth';
export async function knockRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (req) => {
    const p = z.object({ bbox: z.string(), from: z.string().optional() }).parse(req.query);
    const [w, s, e, n] = p.bbox.split(',').map(Number);
    const rows = await q(`SELECT DISTINCT ON (k.parcel_id) k.id, k.parcel_id, k.disposition, k.callback_at, k.created_at, ST_X(p.centroid) lng, ST_Y(p.centroid) lat
       FROM knocks k JOIN parcels p ON p.id=k.parcel_id WHERE k.company_id=$1 AND p.centroid && ST_MakeEnvelope($2,$3,$4,$5,4326) AND ($6::timestamptz IS NULL OR k.created_at >= $6)
       ORDER BY k.parcel_id, k.created_at DESC`, [req.user.companyId, w, s, e, n, p.from ?? null]);
    return { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { parcelId: r.parcel_id, disposition: r.disposition, callbackAt: r.callback_at, at: r.created_at } })) };
  });
  // Idempotent on client_id so the offline queue can replay safely
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ parcelId: z.string().uuid(), clientId: z.string().uuid(), disposition: z.enum(['not_home', 'not_interested', 'callback', 'inspection_set', 'do_not_knock']), note: z.string().optional(), callbackAt: z.string().datetime().optional(), photoUrls: z.array(z.string()).default([]) }).parse(req.body);
    await assertParcelInCompany(b.parcelId, req.user.companyId);
    const [row] = await q(`INSERT INTO knocks (company_id, parcel_id, user_id, disposition, note, callback_at, photo_urls, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO UPDATE SET note=EXCLUDED.note RETURNING *`, [req.user.companyId, b.parcelId, req.user.id, b.disposition, b.note ?? null, b.callbackAt ?? null, b.photoUrls, b.clientId]);
    reply.code(201); return row;
  });
}
