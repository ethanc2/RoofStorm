import { q } from '../db/pool';
import { companyKeys } from '../db/keys';
import { JobNimbus } from '../integrations/jobnimbus';
import { upsertJob, upsertContact } from './jobnimbus-sync';
/** contact → job (Roof Inspection) → task; storm fields into custom fields; idempotent per inspection row. */
export async function processInspection(inspectionId: string) {
  const [row] = await q(`SELECT i.*, p.site_address, p.city, p.state, p.zip, u.jobnimbus_user_id, u.name rep_name FROM inspections i JOIN parcels p ON p.id=i.parcel_id JOIN users u ON u.id=i.user_id WHERE i.id=$1`, [inspectionId]);
  if (!row || row.status === 'created') return;
  const keys = await companyKeys(row.company_id);
  if (!keys.jobnimbus) { await q(`UPDATE inspections SET status='failed', error='JobNimbus not connected', updated_at=now() WHERE id=$1`, [inspectionId]); throw new Error('JobNimbus not connected'); }
  const jn = new JobNimbus(keys.jobnimbus); const p = row.payload;
  try {
    const [storm] = await q(`SELECT s.swath_storm_id, s.event_date, pse.hail_in FROM parcel_storm_events pse JOIN storms s ON s.id=pse.storm_id WHERE pse.parcel_id=$1 ORDER BY s.event_date DESC LIMIT 1`, [row.parcel_id]);
    let contactJnid: string = row.contact_jnid ?? p.attachToContactJnid;
    if (!contactJnid) {
      const dup = await jn.findContact(p.phone, row.site_address);
      if (dup) contactJnid = dup.jnid; else {
        const c = await jn.createContact({ first_name: p.firstName, last_name: p.lastName, mobile_phone: p.phone, email: p.email, address_line1: row.site_address, city: row.city, state_text: row.state, zip: row.zip, record_type_name: 'Customer', sales_rep: row.jobnimbus_user_id ?? undefined });
        contactJnid = c.jnid; await upsertContact(row.company_id, c);
      }
      await q(`UPDATE inspections SET contact_jnid=$2 WHERE id=$1`, [inspectionId, contactJnid]);
    }
    let jobJnid: string = row.job_jnid;
    if (!jobJnid) {
      const job = await jn.createJob({ name: `Roof Inspection – ${row.site_address}`, record_type_name: keys.settings.inspectionRecordType ?? 'Roof Inspection', status: keys.settings.inspectionStatusId, sales_rep: row.jobnimbus_user_id ?? undefined,
        address_line1: row.site_address, city: row.city, state_text: row.state, zip: row.zip, related: [{ id: contactJnid, type: 'contact' }],
        storm_date: storm?.event_date ?? null, hail_size_in: storm?.hail_in ?? null, swath_storm_id: storm?.swath_storm_id ?? null, description: p.notes ?? '' });
      jobJnid = job.jnid; await upsertJob(row.company_id, job); await q(`UPDATE inspections SET job_jnid=$2 WHERE id=$1`, [inspectionId, jobJnid]);
    }
    if (!row.task_jnid) {
      const start = Math.floor(new Date(p.scheduledAt).getTime() / 1000);
      const task = await jn.createTask({ title: `Inspection – ${row.site_address}`, date_start: start, date_end: start + 3600, record_type_name: 'Appointment', related: [{ id: jobJnid, type: 'job' }, { id: contactJnid, type: 'contact' }], owners: row.jobnimbus_user_id ? [{ id: row.jobnimbus_user_id }] : undefined });
      await q(`UPDATE inspections SET task_jnid=$2 WHERE id=$1`, [inspectionId, task.jnid]);
    }
    await q(`UPDATE inspections SET status='created', error=NULL, updated_at=now() WHERE id=$1`, [inspectionId]);
  } catch (e: any) { await q(`UPDATE inspections SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [inspectionId, String(e?.message ?? e)]); throw e; }
}
