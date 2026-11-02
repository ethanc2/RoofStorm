import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db/pool';
import { companyKeys } from '../db/keys';
import { Regrid, toParcelRow, type RegridFields } from '../integrations/regrid';
import { Swath } from '../integrations/swath';
import { GoogleMaps, bearingDeg } from '../integrations/google';
import { requireAuth, requireRole } from '../auth';

const STALE_DAYS = 90;
const WITHIN_WARM_LIMIT = 1500; // max Regrid parcels fetched to fill a lasso (1 unit each)
const polygonSchema = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]).rest(z.number()))).min(1) });
export const filterSchema = z.object({ ownerOccupiedOnly: z.boolean().optional(), minHailIn: z.number().optional(), excludeJnContacts: z.boolean().optional(), excludeDoNotKnock: z.boolean().default(true) });

export async function parcelRoutes(app: FastifyInstance) {
  // Parcel polygons for the map (outlines + roof-age heat). Clients only call this at zoom >= 16.
  app.get('/', { preHandler: requireAuth }, async (req) => {
    const p = z.object({ bbox: z.string() }).parse(req.query); const [w, s, e, n] = p.bbox.split(',').map(Number);
    const rows = await q(`SELECT id, site_address, year_built, owner_occupied, ST_AsGeoJSON(geom)::json geometry FROM parcels
       WHERE company_id=$1 AND geom IS NOT NULL AND geom && ST_MakeEnvelope($2,$3,$4,$5,4326) LIMIT 4000`, [req.user.companyId, w, s, e, n]);
    return { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: { id: r.id, address: r.site_address, yearBuilt: r.year_built, ownerOccupied: r.owner_occupied } })) };
  });

  // Owner card: parcel under a tap, with last storm event, roof, knock history and JobNimbus matches
  app.get('/at', { preHandler: requireAuth }, async (req) => {
    const { lat, lng } = z.object({ lat: z.coerce.number(), lng: z.coerce.number() }).parse(req.query);
    const { companyId } = req.user;
    let [parcel] = await q(`SELECT *, ST_AsGeoJSON(geom)::json AS geometry, ST_X(centroid) lng, ST_Y(centroid) lat FROM parcels
       WHERE company_id=$1 AND ST_Contains(geom, ST_SetSRID(ST_Point($2,$3),4326)) LIMIT 1`, [companyId, lng, lat]);
    if (!parcel) parcel = await fetchParcel(companyId, lng, lat);
    if (!parcel) return { parcel: null };
    await ensureStormHistory(companyId, parcel);
    return ownerCard(companyId, parcel.id);
  });
  app.get('/:id', { preHandler: requireAuth }, async (req) => ownerCard(req.user.companyId, (req.params as any).id));

  // Street View photo of the house, proxied so the Google key/signature never reaches the client. 404 when no imagery.
  app.get('/:id/streetview', { preHandler: requireAuth }, async (req, reply) => {
    const { size } = z.object({ size: z.string().regex(/^\d{2,3}x\d{2,3}$/).default('640x360') }).parse(req.query);
    const [p] = await q(`SELECT id, streetview_pano_id, streetview_checked_at, ST_X(centroid) lng, ST_Y(centroid) lat FROM parcels WHERE id=$1 AND company_id=$2`, [(req.params as any).id, req.user.companyId]);
    if (!p) return reply.code(404).send();
    const g = new GoogleMaps(req.user.companyId); const house: [number, number] = [p.lng, p.lat];
    let pano = p.streetview_pano_id as string | null, panoLoc: [number, number] | null = null;
    if (!p.streetview_checked_at) { const m = await g.streetViewAvailable(house); pano = m?.panoId ?? null; panoLoc = m?.location ?? null;
      await q(`UPDATE parcels SET streetview_pano_id=$2, streetview_checked_at=now() WHERE id=$1`, [p.id, pano]); }
    if (!pano) return reply.code(404).send();
    const img = await g.fetchStreetView(house, { size, heading: panoLoc ? bearingDeg(panoLoc, house) : undefined, fov: 80, pitch: 5 });
    if (!img) return reply.code(404).send();
    reply.header('content-type', img.contentType).header('cache-control', 'private, max-age=86400'); return reply.send(img.body);
  });

  // Specific parcels (Ride-the-Swath street → stops)
  app.post('/by-ids', { preHandler: requireAuth }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    return q(`SELECT id, site_address, city, state, zip, owner_name, owner_occupied, year_built, ST_X(centroid) lng, ST_Y(centroid) lat FROM parcels WHERE company_id=$1 AND id = ANY($2::uuid[]) ORDER BY site_address`, [req.user.companyId, ids]);
  });

  // Parcels inside a polygon (mail export, lasso). Warms the cache from Regrid when the area hasn't been fetched before.
  app.post('/within', { preHandler: requireRole('manager', 'admin') }, async (req) => {
    const body = z.object({ polygon: polygonSchema, filters: filterSchema.default({}), limit: z.number().max(5000).default(2000), offset: z.number().default(0), warm: z.boolean().default(true) }).parse(req.body);
    const f = body.filters;
    if (body.warm) await warmParcels(req.user.companyId, body.polygon as GeoJSON.Polygon);
    return q(`SELECT p.id, p.site_address, p.city, p.state, p.zip, p.owner_name, p.mailing_address, p.owner_occupied, p.year_built, p.assessed_value,
        ST_X(p.centroid) lng, ST_Y(p.centroid) lat, e.event_date, e.hail_in
      FROM parcels p
      LEFT JOIN LATERAL (SELECT s.event_date, pse.hail_in FROM parcel_storm_events pse JOIN storms s ON s.id=pse.storm_id WHERE pse.parcel_id=p.id ORDER BY s.event_date DESC LIMIT 1) e ON true
      WHERE p.company_id=$1 AND ST_Within(p.centroid, ST_SetSRID(ST_GeomFromGeoJSON($2),4326))
        AND ($3::boolean IS NOT TRUE OR p.owner_occupied)
        AND ($4::numeric IS NULL OR e.hail_in >= $4)
        AND ($5::boolean IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM jn_contacts c WHERE c.company_id=p.company_id AND c.geom IS NOT NULL AND ST_DWithin(c.geom::geography, p.centroid::geography, 15)))
        AND ($6::boolean IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM knocks k WHERE k.parcel_id=p.id AND k.disposition='do_not_knock'))
      ORDER BY p.site_address LIMIT $7 OFFSET $8`,
      [req.user.companyId, JSON.stringify(body.polygon), f.ownerOccupiedOnly ?? null, f.minHailIn ?? null, f.excludeJnContacts ?? null, f.excludeDoNotKnock, body.limit, body.offset]);
  });
}

const UPSERT_PARCEL = `INSERT INTO parcels (company_id, source, source_id, geom, centroid, site_address, city, state, zip, owner_name, mailing_address, owner_occupied, year_built, assessed_value)
     VALUES ($1,$2,$3, ST_SetSRID(ST_GeomFromGeoJSON($4),4326), ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)), $5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (company_id, source, source_id) DO UPDATE SET owner_name=EXCLUDED.owner_name, mailing_address=EXCLUDED.mailing_address, owner_occupied=COALESCE(EXCLUDED.owner_occupied, parcels.owner_occupied),
       year_built=COALESCE(parcels.year_built, EXCLUDED.year_built), assessed_value=COALESCE(EXCLUDED.assessed_value, parcels.assessed_value), fetched_at=now()
     RETURNING *, ST_AsGeoJSON(geom)::json AS geometry, ST_X(centroid) lng, ST_Y(centroid) lat`;
const upsertParcel = (companyId: string, f: GeoJSON.Feature<GeoJSON.Polygon, RegridFields>) => {
  const row = toParcelRow(f); if (!row.sourceId || !row.geom) return Promise.resolve(null);
  return q(UPSERT_PARCEL, [companyId, row.source, row.sourceId, JSON.stringify(row.geom), row.siteAddress, row.city, row.state, row.zip, row.ownerName, row.mailingAddress, row.ownerOccupied, row.yearBuilt, row.assessedValue]).then(r => r[0] ?? null);
};

async function fetchParcel(companyId: string, lng: number, lat: number) {
  const keys = await companyKeys(companyId); if (!keys.regrid) return null;
  const r = await new Regrid(keys.regrid, companyId).byPoint(lng, lat); const f = r.parcels.features[0]; if (!f) return null;
  return upsertParcel(companyId, f);
}

/**
 * Fill the parcel cache under a lasso from Regrid. Heuristic: if the polygon already holds a reasonable density of cached parcels
 * (>= ~1 per 1500 m², typical suburban lots) we assume it has been warmed and skip the paid call.
 */
async function warmParcels(companyId: string, polygon: GeoJSON.Polygon) {
  const keys = await companyKeys(companyId); if (!keys.regrid) return;
  const [m] = await q(`SELECT ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography) area_m2,
       (SELECT count(*) FROM parcels p WHERE p.company_id=$1 AND ST_Within(p.centroid, ST_SetSRID(ST_GeomFromGeoJSON($2),4326))) n`, [companyId, JSON.stringify(polygon)]);
  const expected = Number(m.area_m2) / 1500; if (Number(m.n) >= expected * 0.6) return;
  const r = await new Regrid(keys.regrid, companyId).byPolygon(polygon, WITHIN_WARM_LIMIT);
  for (const f of r.parcels.features) await upsertParcel(companyId, f);
}

/** Only pay for a Swath lookup when the parcel is under a stored swath and its history is stale or missing. */
async function ensureStormHistory(companyId: string, parcel: any) {
  const [under] = await q(`SELECT max(fetched_at) newest FROM storms s WHERE s.company_id=$1 AND ST_Intersects(s.geom, ST_SetSRID(ST_Point($2,$3),4326))`, [companyId, parcel.lng, parcel.lat]);
  if (!under?.newest) return;
  // Stamp-based staleness (swath_checked_at) so a lookup that returned no matching events doesn't get re-billed on every tap
  const checked = parcel.swath_checked_at ? new Date(parcel.swath_checked_at) : null;
  const stale = !checked || (Date.now() - checked.getTime()) / 864e5 > STALE_DAYS || new Date(under.newest) > checked;
  if (!stale) return;
  const keys = await companyKeys(companyId); if (!keys.swath) return;
  const prop = await new Swath(keys.swath, companyId).lookupProperty(`${parcel.site_address}, ${parcel.city}, ${parcel.state} ${parcel.zip}`);
  for (const ev of prop.events) {
    const [storm] = await q(`SELECT id FROM storms WHERE company_id=$1 AND swath_storm_id=$2`, [companyId, ev.storm_id]); if (!storm) continue;
    await q(`INSERT INTO parcel_storm_events (parcel_id, storm_id, hail_in, gust_mph, source) VALUES ($1,$2,$3,$4,'lookup') ON CONFLICT DO NOTHING`, [parcel.id, storm.id, ev.hail_in ?? null, ev.gust_mph ?? null]);
  }
  await q(`UPDATE parcels SET swath_checked_at=now(), year_built=COALESCE(year_built,$2), owner_occupied=COALESCE(owner_occupied,$3) WHERE id=$1`, [parcel.id, prop.year_built ?? null, prop.owner_occupied ?? null]);
}

/** Solar API roof facts, fetched once per parcel and cached (negative results included). */
async function ensureRoof(companyId: string, parcel: { id: string; lng: number; lat: number }) {
  const [hit] = await q(`SELECT * FROM parcel_roofs WHERE parcel_id=$1`, [parcel.id]);
  if (hit) return hit.found ? hit : null;
  let r = null;
  try { r = await new GoogleMaps(companyId).buildingInsights([parcel.lng, parcel.lat]); } catch (e) { console.warn('solar lookup failed', e); return null; }
  const [row] = await q(`INSERT INTO parcel_roofs (parcel_id, building_id, roof_area_m2, roof_area_sqft, segment_count, pitch_deg, dominant_azimuth_deg, imagery_date, imagery_quality, segments, raw, found)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (parcel_id) DO UPDATE SET fetched_at=now() RETURNING *`,
    [parcel.id, r?.buildingId ?? null, r?.roofAreaM2 ?? null, r?.roofAreaSqft ?? null, r?.segmentCount ?? null, r?.pitchDeg ?? null, r?.dominantAzimuthDeg ?? null, r?.imageryDate ?? null, r?.imageryQuality ?? null, JSON.stringify(r?.segments ?? []), r ? JSON.stringify(r.raw) : null, !!r]);
  return r ? row : null;
}

async function ownerCard(companyId: string, parcelId: string) {
  const [parcel] = await q(`SELECT *, ST_AsGeoJSON(geom)::json AS geometry, ST_X(centroid) lng, ST_Y(centroid) lat FROM parcels WHERE id=$1 AND company_id=$2`, [parcelId, companyId]);
  if (!parcel) return { parcel: null };
  const [[lastStorm], knocks, jobs, roof] = await Promise.all([
    q(`SELECT s.swath_storm_id "stormId", s.event_date "eventDate", s.kind, pse.hail_in "hailIn", pse.gust_mph "gustMph" FROM parcel_storm_events pse JOIN storms s ON s.id=pse.storm_id WHERE pse.parcel_id=$1 ORDER BY s.event_date DESC LIMIT 1`, [parcelId]),
    q(`SELECT k.*, u.name user_name FROM knocks k LEFT JOIN users u ON u.id=k.user_id WHERE k.parcel_id=$1 ORDER BY k.created_at DESC LIMIT 20`, [parcelId]),
    q(`SELECT jnid, name, status_name "statusName", sales_rep "salesRep", date_updated "dateUpdated" FROM jn_jobs WHERE company_id=$1 AND geom IS NOT NULL AND ST_DWithin(geom::geography, $2::geography, 15)`, [companyId, `SRID=4326;POINT(${parcel.lng} ${parcel.lat})`]),
    ensureRoof(companyId, parcel),
  ]);
  const num = (v: any) => (v == null ? null : Number(v));
  const roofOut = roof ? { roofAreaSqft: num(roof.roof_area_sqft), roofAreaM2: num(roof.roof_area_m2), pitchDeg: num(roof.pitch_deg), segmentCount: roof.segment_count, dominantAzimuthDeg: num(roof.dominant_azimuth_deg), imageryDate: roof.imagery_date, imageryQuality: roof.imagery_quality } : null;
  const streetViewUrl = parcel.streetview_checked_at && !parcel.streetview_pano_id ? null : `/v1/parcels/${parcel.id}/streetview`;
  return { parcel, lastStorm: lastStorm ?? null, knocks, jobs, roof: roofOut, streetViewUrl };
}
