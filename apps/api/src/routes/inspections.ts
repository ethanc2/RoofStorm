import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { requireAuth, assertParcelInCompany } from '../auth';
import { inspectionQueue } from '../workers/queues';
/** Door → JobNimbus. Writes an outbox row and returns 202; the worker does the three JobNimbus creates. */
export async function inspectionRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ parcelId: z.string().uuid(), clientId: z.string().uuid(), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), email: z.string().email().optional(), scheduledAt: z.string().datetime(), notes: z.string().optional(), attachToContactJnid: z.string().optional() }).parse(req.body);
    await assertParcelInCompany(b.parcelId, req.user.companyId);
    const [knock] = await q(`INSERT INTO knocks (company_id, parcel_id, user_id, disposition, note, client_id) VALUES ($1,$2,$3,'inspection_set',$4,$5) ON CONFLICT (client_id) DO UPDATE SET note=EXCLUDED.note RETURNING id`, [req.user.companyId, b.parcelId, req.user.id, b.notes ?? null, b.clientId]);
    const [row] = await q(`INSERT INTO inspections (company_id, knock_id, parcel_id, user_id, client_id, payload) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (client_id) DO UPDATE SET updated_at=now() RETURNING *`, [req.user.companyId, knock.id, b.parcelId, req.user.id, b.clientId, JSON.stringify(b)]);
    if (row.status === 'queued') await inspectionQueue.add('create', { inspectionId: row.id }, { jobId: row.id, attempts: 5, backoff: { type: 'exponential', delay: 5000 } });
    reply.code(202); return { id: row.id, status: row.status };
  });
  app.get('/:id', { preHandler: requireAuth }, async (req) => {
    const [row] = await q(`SELECT id, status, contact_jnid "contactJnid", job_jnid "jobJnid", task_jnid "taskJnid", error FROM inspections WHERE id=$1 AND company_id=$2`, [(req.params as any).id, req.user.companyId]);
    return row ?? null;
  });
}
