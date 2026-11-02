import { q } from '../db/pool';
import { companyKeys } from '../db/keys';
import { Swath, type SwathStorm } from '../integrations/swath';
export async function storeStorm(companyId: string, s: SwathStorm) {
  const [row] = await q(`INSERT INTO storms (company_id, swath_storm_id, event_date, kind, max_hail_in, mean_hail_in, max_gust_mph, geom)
     VALUES ($1,$2,$3,$4,$5,$6,$7, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($8),4326)))
     ON CONFLICT (company_id, swath_storm_id) DO UPDATE SET max_hail_in=EXCLUDED.max_hail_in, mean_hail_in=EXCLUDED.mean_hail_in, geom=EXCLUDED.geom, fetched_at=now() RETURNING id`,
    [companyId, s.id, s.event_date, s.kind, s.max_hail_in ?? null, s.mean_hail_in ?? null, s.max_gust_mph ?? null, JSON.stringify(s.geometry)]);
  return row.id as string;
}
/** Every 6 h per territory: find_storms for the last 90 days over the territory bbox. */
export async function refreshCompanyStorms(companyId: string) {
  const keys = await companyKeys(companyId); if (!keys.swath) return;
  const swath = new Swath(keys.swath, companyId);
  const territories = await q(`SELECT id, ST_XMin(geom) w, ST_YMin(geom) s, ST_XMax(geom) e, ST_YMax(geom) n FROM territories WHERE company_id=$1`, [companyId]);
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  for (const t of territories) { const r = await swath.findStorms([t.w, t.s, t.e, t.n], from, to, 0.75); for (const s of r.storms) await storeStorm(companyId, s); }
}
