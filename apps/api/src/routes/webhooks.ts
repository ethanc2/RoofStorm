import type { FastifyInstance } from 'fastify';
import { q } from '../db/pool';
import { upsertJob, upsertContact } from '../workers/jobnimbus-sync';
import { storeStorm } from '../workers/storm-refresh';
export async function webhookRoutes(app: FastifyInstance) {
  // JobNimbus: one endpoint per company, secret in the path; events are split by Jobs vs Contacts
  app.post('/jobnimbus/:companyId/:secret', async (req, reply) => {
    const { companyId, secret } = req.params as any;
    const [c] = await q(`SELECT 1 FROM companies WHERE id=$1 AND jobnimbus_webhook_secret=$2`, [companyId, secret]); if (!c) return reply.code(401).send();
    const body = req.body as any; const rec = body?.data ?? body;
    if (rec?.jnid) { if (body?.type?.toLowerCase?.().includes('contact') || rec.record_type_name === 'Contact') await upsertContact(companyId, rec); else await upsertJob(companyId, rec); }
    return { ok: true };
  });
  // Swath storm monitor: new verified storm → store, then notify reps in the territory (push fan-out lives in workers/notify.ts)
  app.post('/swath/:companyId/:secret', async (req, reply) => {
    const { companyId, secret } = req.params as any;
    const [c] = await q(`SELECT 1 FROM companies WHERE id=$1 AND jobnimbus_webhook_secret=$2`, [companyId, secret]); if (!c) return reply.code(401).send();
    const storm = (req.body as any)?.storm; if (storm) await storeStorm(companyId, storm);
    return { ok: true };
  });
}
