import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { encrypt } from '../db/crypto';
import { requireRole } from '../auth';
import { JobNimbus } from '../integrations/jobnimbus';
export async function adminRoutes(app: FastifyInstance) {
  app.get('/usage', { preHandler: requireRole('admin') }, async (req) => q(`SELECT service, day, sum(units) units, sum(cost_cents) cost_cents FROM api_usage WHERE company_id=$1 AND day > current_date - 30 GROUP BY 1,2 ORDER BY 2 DESC`, [req.user.companyId]));
  app.post('/integrations/:service', { preHandler: requireRole('admin') }, async (req) => {
    const service = z.enum(['jobnimbus', 'swath', 'regrid']).parse((req.params as any).service);
    const { key } = z.object({ key: z.string().min(8) }).parse(req.body);
    if (service === 'jobnimbus') await new JobNimbus(key).listJobs(0, 1); // test connection
    const col = { jobnimbus: 'jobnimbus_api_key_enc', swath: 'swath_api_key_enc', regrid: 'regrid_token_enc' }[service];
    await q(`UPDATE companies SET ${col}=$2 WHERE id=$1`, [req.user.companyId, encrypt(key)]);
    return { ok: true };
  });
  app.patch('/settings', { preHandler: requireRole('admin') }, async (req) => {
    const s = z.object({ statusColors: z.record(z.string()).optional(), inspectionStatusId: z.number().optional(), inspectionRecordType: z.string().optional() }).parse(req.body);
    const [row] = await q(`UPDATE companies SET settings = settings || $2::jsonb WHERE id=$1 RETURNING settings`, [req.user.companyId, JSON.stringify(s)]); return row.settings;
  });
}
