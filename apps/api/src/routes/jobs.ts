import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { requireAuth } from '../auth';
export async function jobRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (req) => {
    const p = z.object({ bbox: z.string(), status: z.string().optional(), rep: z.string().optional() }).parse(req.query);
    const [w, s, e, n] = p.bbox.split(',').map(Number);
    const rows = await q(`SELECT jnid, name, status_name, sales_rep, address_line1, date_updated, ST_X(geom) lng, ST_Y(geom) lat FROM jn_jobs
       WHERE company_id=$1 AND geom && ST_MakeEnvelope($2,$3,$4,$5,4326) AND ($6::text IS NULL OR status_name = ANY(string_to_array($6, ','))) AND ($7::text IS NULL OR sales_rep=$7) LIMIT 5000`,
      [req.user.companyId, w, s, e, n, p.status ?? null, p.rep ?? null]);
    return { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { jnid: r.jnid, name: r.name, status: r.status_name, rep: r.sales_rep, address: r.address_line1, updated: r.date_updated } })) };
  });
}
