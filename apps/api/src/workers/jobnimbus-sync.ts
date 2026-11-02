import { q } from '../db/pool';
import { companyKeys } from '../db/keys';
import { JobNimbus, type JnJobRaw, type JnContactRaw } from '../integrations/jobnimbus';
import { geocodeCached } from '../integrations/geocode';
const ts = (n?: number) => (n ? new Date(n * 1000).toISOString() : null);
const addr = (r: { address_line1?: string; city?: string; state_text?: string; zip?: string }) => [r.address_line1, r.city, r.state_text, r.zip].filter(Boolean).join(', ');

export async function upsertJob(companyId: string, j: JnJobRaw) {
  const [existing] = await q(`SELECT address_line1, geom IS NOT NULL has_geom FROM jn_jobs WHERE company_id=$1 AND jnid=$2`, [companyId, j.jnid]);
  const needGeo = !existing || !existing.has_geom || existing.address_line1 !== j.address_line1;
  const pt = needGeo && j.address_line1 ? await geocodeCached(companyId, addr(j)) : null;
  await q(`INSERT INTO jn_jobs (company_id, jnid, contact_jnid, name, record_type, status_id, status_name, sales_rep, address_line1, city, state, zip, geom, date_created, date_updated, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $13::float IS NULL THEN NULL ELSE ST_SetSRID(ST_Point($13,$14),4326) END, $15,$16,$17)
     ON CONFLICT (company_id, jnid) DO UPDATE SET contact_jnid=EXCLUDED.contact_jnid, name=EXCLUDED.name, record_type=EXCLUDED.record_type, status_id=EXCLUDED.status_id, status_name=EXCLUDED.status_name, sales_rep=EXCLUDED.sales_rep,
       address_line1=EXCLUDED.address_line1, city=EXCLUDED.city, state=EXCLUDED.state, zip=EXCLUDED.zip, geom=COALESCE(EXCLUDED.geom, jn_jobs.geom), date_updated=EXCLUDED.date_updated, raw=EXCLUDED.raw`,
    [companyId, j.jnid, j.primary?.id ?? null, j.name ?? null, j.record_type_name ?? null, j.status ?? null, j.status_name ?? null, j.sales_rep_name ?? j.sales_rep ?? null, j.address_line1 ?? null, j.city ?? null, j.state_text ?? null, j.zip ?? null, pt?.[0] ?? null, pt?.[1] ?? null, ts(j.date_created), ts(j.date_updated), JSON.stringify(j)]);
}
export async function upsertContact(companyId: string, c: JnContactRaw) {
  const [existing] = await q(`SELECT address_line1, geom IS NOT NULL has_geom FROM jn_contacts WHERE company_id=$1 AND jnid=$2`, [companyId, c.jnid]);
  const needGeo = !existing || !existing.has_geom || existing.address_line1 !== c.address_line1;
  const pt = needGeo && c.address_line1 ? await geocodeCached(companyId, addr(c)) : null;
  await q(`INSERT INTO jn_contacts (company_id, jnid, display_name, first_name, last_name, phone, email, address_line1, city, state, zip, geom, status_id, status_name, sales_rep, date_updated, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $12::float IS NULL THEN NULL ELSE ST_SetSRID(ST_Point($12,$13),4326) END, $14,$15,$16,$17,$18)
     ON CONFLICT (company_id, jnid) DO UPDATE SET display_name=EXCLUDED.display_name, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, phone=EXCLUDED.phone, email=EXCLUDED.email, address_line1=EXCLUDED.address_line1, city=EXCLUDED.city, state=EXCLUDED.state, zip=EXCLUDED.zip,
       geom=COALESCE(EXCLUDED.geom, jn_contacts.geom), status_id=EXCLUDED.status_id, status_name=EXCLUDED.status_name, sales_rep=EXCLUDED.sales_rep, date_updated=EXCLUDED.date_updated, raw=EXCLUDED.raw`,
    [companyId, c.jnid, c.display_name ?? null, c.first_name ?? null, c.last_name ?? null, c.mobile_phone ?? c.home_phone ?? null, c.email ?? null, c.address_line1 ?? null, c.city ?? null, c.state_text ?? null, c.zip ?? null, pt?.[0] ?? null, pt?.[1] ?? null, c.status ?? null, c.status_name ?? null, c.sales_rep_name ?? c.sales_rep ?? null, ts(c.date_updated), JSON.stringify(c)]);
}
/** Full reconcile: pages everything and diffs by date_updated client-side (no reliable server-side filter). Runs every 15 min per company. */
export async function reconcileCompany(companyId: string) {
  const keys = await companyKeys(companyId); if (!keys.jobnimbus) return;
  const jn = new JobNimbus(keys.jobnimbus);
  const known = new Map((await q(`SELECT jnid, date_updated FROM jn_jobs WHERE company_id=$1`, [companyId])).map(r => [r.jnid, r.date_updated?.toISOString?.() ?? null]));
  for await (const j of jn.allJobs()) if (known.get(j.jnid) !== ts(j.date_updated)) await upsertJob(companyId, j);
  const knownC = new Map((await q(`SELECT jnid, date_updated FROM jn_contacts WHERE company_id=$1`, [companyId])).map(r => [r.jnid, r.date_updated?.toISOString?.() ?? null]));
  for await (const c of jn.allContacts()) if (knownC.get(c.jnid) !== ts(c.date_updated)) await upsertContact(companyId, c);
}
