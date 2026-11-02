import { Worker } from 'bullmq';
import { connection, syncQueue, stormQueue } from './queues';
import { processInspection } from './inspection-outbox';
import { reconcileCompany } from './jobnimbus-sync';
import { refreshCompanyStorms } from './storm-refresh';
import { q } from '../db/pool';

new Worker('inspections', async job => processInspection(job.data.inspectionId), { connection, concurrency: 4 });
new Worker('jobnimbus-sync', async job => reconcileCompany(job.data.companyId), { connection, concurrency: 2 });
new Worker('storm-refresh', async job => refreshCompanyStorms(job.data.companyId), { connection, concurrency: 2 });

// Repeatable schedules per company (15-min JobNimbus reconcile, 6-h storm refresh)
for (const c of await q(`SELECT id FROM companies`)) {
  await syncQueue.add('reconcile', { companyId: c.id }, { repeat: { every: 15 * 60 * 1000 }, jobId: `sync-${c.id}` });
  await stormQueue.add('refresh', { companyId: c.id }, { repeat: { every: 6 * 60 * 60 * 1000 }, jobId: `storm-${c.id}` });
}
console.log('workers running');
