import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { requireRole } from '../auth';
import { filterSchema } from './parcels';
const MAX_ROWS = 10000;
async function rows(companyId: string, polygon: any, f: z.infer<typeof filterSchema>) {
  const all = await q(`SELECT p.*, e.event_date, e.hail_in FROM parcels p
     LEFT JOIN LATERAL (SELECT s.event_date, pse.hail_in FROM parcel_storm_events pse JOIN storms s ON s.id=pse.storm_id WHERE pse.parcel_id=p.id ORDER BY s.event_date DESC LIMIT 1) e ON true
     WHERE p.company_id=$1 AND ST_Within(p.centroid, ST_SetSRID(ST_GeomFromGeoJSON($2),4326))
       AND ($3::boolean IS NOT TRUE OR p.owner_occupied) AND ($4::numeric IS NULL OR e.hail_in >= $4)
       AND ($5::boolean IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM jn_contacts c WHERE c.company_id=p.company_id AND c.geom IS NOT NULL AND ST_DWithin(c.geom::geography, p.centroid::geography, 15)))
       AND ($6::boolean IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM knocks k WHERE k.parcel_id=p.id AND k.disposition='do_not_knock'))
     ORDER BY p.site_address LIMIT $7`,
    [companyId, JSON.stringify(polygon), f.ownerOccupiedOnly ?? null, f.minHailIn ?? null, f.excludeJnContacts ?? null, f.excludeDoNotKnock, MAX_ROWS]);
  const seen = new Set<string>(); // dedupe absentee owners sharing a mailing address
  return all.filter(p => { const k = (p.mailing_address ?? p.site_address ?? p.id).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
const csvEsc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export async function mailRoutes(app: FastifyInstance) {
  app.post('/quote', { preHandler: requireRole('manager', 'admin') }, async (req) => {
    const b = z.object({ polygon: z.any(), filters: filterSchema.default({}) }).parse(req.body);
    const r = await rows(req.user.companyId, b.polygon, b.filters);
    const unverified = r.filter(p => !p.event_date).length;
    return { rowCount: r.length, unverified, swathCredits: unverified }; // 1 credit per property lookup; confirm with get_report_quote for bulk
  });
  app.post('/', { preHandler: requireRole('manager', 'admin') }, async (req, reply) => {
    const b = z.object({ name: z.string(), polygon: z.any(), filters: filterSchema.default({}) }).parse(req.body);
    const r = await rows(req.user.companyId, b.polygon, b.filters);
    const header = 'first_name,last_name,site_address,city,state,zip,mailing_address,owner_occupied,hail_date,hail_in,year_built,assessed_value';
    const lines = r.map(p => { const [first, ...rest] = (p.owner_name ?? '').split(' & ')[0].split(' '); return [first, rest.join(' '), p.site_address, p.city, p.state, p.zip, p.mailing_address ?? p.site_address, p.owner_occupied ? 'Y' : 'N', p.event_date ?? '', p.hail_in ?? '', p.year_built ?? '', p.assessed_value ?? ''].map(csvEsc).join(','); });
    const csv = [header, ...lines].join('\n');
    const [row] = await q(`INSERT INTO mail_campaigns (company_id, user_id, name, polygon, filters, row_count, csv) VALUES ($1,$2,$3, ST_SetSRID(ST_GeomFromGeoJSON($4),4326), $5,$6,$7) RETURNING id, row_count`, [req.user.companyId, req.user.id, b.name, JSON.stringify(b.polygon), JSON.stringify(b.filters), r.length, csv]);
    reply.code(201); return row;
  });
  app.get('/', { preHandler: requireRole('manager', 'admin') }, async (req) => q(`SELECT id, name, row_count, created_at FROM mail_campaigns WHERE company_id=$1 ORDER BY created_at DESC`, [req.user.companyId]));
  app.get('/:id/csv', { preHandler: requireRole('manager', 'admin') }, async (req, reply) => {
    const [row] = await q(`SELECT name, csv FROM mail_campaigns WHERE id=$1 AND company_id=$2`, [(req.params as any).id, req.user.companyId]);
    if (!row) return reply.code(404).send();
    reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${row.name.replace(/[^a-z0-9]+/gi, '-')}.csv"`); return row.csv;
  });
}
