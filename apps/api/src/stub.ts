/**
 * Stub API for UI development without Postgres/Redis. Same routes, fake data around the default map centre.
 *   npm -w apps/api run stub
 * If GOOGLE_MAPS_SERVER_KEY is set, /routes/optimize and /places hit real Google; otherwise local fallbacks.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { solveRoute, haversineM, type LngLat } from '@stormroute/shared';

for (const f of ['.env', '../../.env']) { try { process.loadEnvFile(f); } catch { /* optional */ } }
const KEY = process.env.GOOGLE_MAPS_SERVER_KEY ?? '';
const C: LngLat = [-86.61, 33.62]; const DWELL = 240;
const rnd = (seed: number) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

// ---- fake world: a grid of parcels, a storm swath, some JN jobs and knocks ----
const STREETS = ['Oak St', 'Maple Ave', 'Pine Ridge Rd', 'Cedar Ln', 'Hillcrest Dr', 'Valley View Ct'];
const OWNERS = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
type P = { id: string; lng: number; lat: number; site_address: string; city: string; state: string; zip: string; owner_name: string; mailing_address: string | null; owner_occupied: boolean; year_built: number; assessed_value: number; geometry: GeoJSON.Polygon; hail_in: number | null; event_date: string | null };
const parcels: P[] = []; { const r = rnd(42); let n = 0;
  for (let row = 0; row < 14; row++) for (let col = 0; col < 18; col++) {
    const lng = C[0] - 0.009 + col * 0.001, lat = C[1] - 0.007 + row * 0.001, w = 0.00045, h = 0.00042;
    const occ = r() > 0.3, owner = `${OWNERS[Math.floor(r() * OWNERS.length)]}, ${['John', 'Mary', 'Robert', 'Linda', 'James'][Math.floor(r() * 5)]}`;
    const inSwath = Math.hypot((lng - C[0]) / 0.009, (lat - C[1] + 0.001) / 0.006) < 0.9;
    parcels.push({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, lng, lat, site_address: `${100 + col * 4 + row * 100} ${STREETS[row % STREETS.length]}`, city: 'Trussville', state: 'AL', zip: '35173',
      owner_name: owner, mailing_address: occ ? null : `PO Box ${Math.floor(r() * 9000)}, Birmingham, AL 35203`, owner_occupied: occ, year_built: 1975 + Math.floor(r() * 48), assessed_value: Math.round(180000 + r() * 250000),
      geometry: { type: 'Polygon', coordinates: [[[lng - w, lat - h], [lng + w, lat - h], [lng + w, lat + h], [lng - w, lat + h], [lng - w, lat - h]]] },
      hail_in: inSwath ? Math.round((0.75 + r() * 1.5) * 4) / 4 : null, event_date: inSwath ? '2026-10-14' : null });
  } }
const storm = { id: 'storm-1', properties: { id: 'storm-1', stormId: 'swath-2026-10-14-001', eventDate: '2026-10-14', kind: 'hail', maxHailIn: 1.75, meanHailIn: 1.1, maxGustMph: null },
  geometry: { type: 'MultiPolygon', coordinates: [[Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [C[0] + Math.cos(a) * 0.0085, C[1] - 0.001 + Math.sin(a) * 0.0055]; })]] } as GeoJSON.MultiPolygon };
const STATUSES = ['Lead', 'Inspection', 'Signed', 'Production', 'Complete']; const DISPS = ['not_home', 'not_interested', 'callback', 'do_not_knock', 'inspection_set'];
const r2 = rnd(7);
const jobs = parcels.filter(() => r2() < 0.12).map((p, i) => ({ jnid: `jn${1000 + i}`, name: `${p.owner_name.split(',')[0]} Roof`, status: STATUSES[Math.floor(r2() * 5)], rep: ['Alex', 'Jordan', 'Sam'][i % 3], address: p.site_address, lng: p.lng + 0.00005, lat: p.lat + 0.00004 }));
const knocks = parcels.filter(() => r2() < 0.18).map(p => ({ parcelId: p.id, disposition: DISPS[Math.floor(r2() * 5)], at: new Date(Date.now() - r2() * 10 * 864e5).toISOString(), lng: p.lng, lat: p.lat }));
const inBbox = (bbox: string) => { const [w, s, e, n] = bbox.split(',').map(Number); return (lng: number, lat: number) => lng >= w && lng <= e && lat >= s && lat <= n; };
const fc = (features: any[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const pip = (pt: LngLat, ring: number[][]) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
const card = (p: P) => ({ parcel: { ...p, streetview_checked_at: null, streetview_pano_id: null }, lastStorm: p.hail_in ? { stormId: storm.properties.stormId, eventDate: p.event_date, kind: 'hail', hailIn: p.hail_in, gustMph: null } : null,
  knocks: knocks.filter(k => k.parcelId === p.id).map((k, i) => ({ id: `k${i}`, disposition: k.disposition, created_at: k.at, user_name: 'Sam Rep', note: null })),
  jobs: jobs.filter(j => Math.hypot(j.lng - p.lng, j.lat - p.lat) < 0.0002).map(j => ({ jnid: j.jnid, name: j.name, statusName: j.status, salesRep: j.rep })),
  roof: { roofAreaSqft: 2200 + (p.year_built % 7) * 180, roofAreaM2: 220, pitchDeg: 22 + (p.year_built % 5) * 2, segmentCount: 4 + (p.year_built % 3), dominantAzimuthDeg: (p.year_built * 37) % 360, imageryDate: '2024-03-18', imageryQuality: 'HIGH' },
  streetViewUrl: KEY ? `/v1/parcels/${p.id}/streetview` : null });

// ---- server ----
const app = Fastify({ logger: { level: 'warn' } });
await app.register(cors, { origin: true });
app.get('/health', async () => ({ ok: true, stub: true }));
app.get('/v1/storms', async (req) => { const inb = inBbox((req.query as any).bbox); return fc(inb(C[0], C[1]) ? [{ type: 'Feature', geometry: storm.geometry, properties: storm.properties }] : []); });
app.get('/v1/storms/:id/streets', async () => {
  const by = new Map<string, P[]>(); for (const p of parcels) if (p.hail_in && !knocks.some(k => k.parcelId === p.id && k.disposition === 'do_not_knock')) { const s = p.site_address.replace(/^\d+\s+/, ''); by.set(s, [...(by.get(s) ?? []), p]); }
  const y = new Date().getFullYear();
  return [...by.entries()].map(([street, ps]) => ({ street, homes: ps.length, score: +(ps.reduce((a, p) => a + p.hail_in! * Math.min(1.5, Math.max(0.4, (y - p.year_built) / 25)) * (p.owner_occupied ? 1 : 0.5), 0) / ps.length).toFixed(2),
    max_hail_in: Math.max(...ps.map(p => p.hail_in!)), avg_roof_age: Math.round(ps.reduce((a, p) => a + y - p.year_built, 0) / ps.length), owner_occupied: ps.filter(p => p.owner_occupied).length, parcel_ids: ps.map(p => p.id) })).sort((a, b) => b.score - a.score);
});
app.get('/v1/jobs', async (req) => { const inb = inBbox((req.query as any).bbox); return fc(jobs.filter(j => inb(j.lng, j.lat)).map(j => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [j.lng, j.lat] }, properties: { jnid: j.jnid, name: j.name, status: j.status, rep: j.rep, address: j.address } }))); });
app.get('/v1/knocks', async (req) => { const inb = inBbox((req.query as any).bbox); return fc(knocks.filter(k => inb(k.lng, k.lat)).map(k => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [k.lng, k.lat] }, properties: { parcelId: k.parcelId, disposition: k.disposition, at: k.at } }))); });
app.post('/v1/knocks', async (req, reply) => { const b = req.body as any; const p = parcels.find(x => x.id === b.parcelId); if (p) knocks.push({ parcelId: p.id, disposition: b.disposition, at: new Date().toISOString(), lng: p.lng, lat: p.lat }); reply.code(201); return { ok: true }; });
app.post('/v1/inspections', async (_req, reply) => { reply.code(202); return { id: 'insp-stub', status: 'queued' }; });
app.get('/v1/parcels', async (req) => { const inb = inBbox((req.query as any).bbox); return fc(parcels.filter(p => inb(p.lng, p.lat)).map(p => ({ type: 'Feature', id: p.id, geometry: p.geometry, properties: { id: p.id, address: p.site_address, yearBuilt: p.year_built, ownerOccupied: p.owner_occupied } }))); });
app.get('/v1/parcels/at', async (req) => { const q = req.query as any; const p = parcels.find(x => pip([+q.lng, +q.lat], x.geometry.coordinates[0])); return p ? card(p) : { parcel: null }; });
app.get('/v1/parcels/:id', async (req) => { const p = parcels.find(x => x.id === (req.params as any).id); return p ? card(p) : { parcel: null }; });
app.get('/v1/parcels/:id/streetview', async (req, reply) => {
  const p = parcels.find(x => x.id === (req.params as any).id); if (!p || !KEY) return reply.code(404).send();
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=${(req.query as any).size ?? '640x360'}&location=${p.lat},${p.lng}&source=outdoor&return_error_code=true&key=${KEY}`);
  if (!res.ok) return reply.code(404).send();
  reply.header('content-type', res.headers.get('content-type') ?? 'image/jpeg').header('cache-control', 'private, max-age=86400'); return reply.send(Buffer.from(await res.arrayBuffer()));
});
const filt = (ring: number[][], f: any = {}) => parcels.filter(p => pip([p.lng, p.lat], ring) && (!f.ownerOccupiedOnly || p.owner_occupied) && (f.minHailIn == null || (p.hail_in ?? 0) >= f.minHailIn));
app.post('/v1/parcels/within', async (req) => { const b = req.body as any; return filt(b.polygon.coordinates[0], b.filters); });
app.post('/v1/parcels/by-ids', async (req) => { const ids = new Set((req.body as any).ids as string[]); return parcels.filter(p => ids.has(p.id)); });
app.post('/v1/routes/optimize', async (req) => {
  const b = req.body as any; const pts: LngLat[] = b.stops.map((s: any) => s.lngLat); const start: LngLat = b.start; const end: LngLat | null = b.roundTrip ? start : b.end ?? null;
  if (KEY && pts.length <= 25) {
    try {
      let destIdx = -1, dest = end, inter = pts;
      if (!dest) { destIdx = pts.map((p, i) => [haversineM(start, p), i] as const).sort((a, c) => c[0] - a[0])[0][1]; dest = pts[destIdx]; inter = pts.filter((_, i) => i !== destIdx); }
      const wp = (c: LngLat) => ({ location: { latLng: { latitude: c[1], longitude: c[0] } } });
      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY, 'x-goog-fieldmask': 'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring,routes.optimizedIntermediateWaypointIndex' },
        body: JSON.stringify({ origin: wp(start), destination: wp(dest), intermediates: inter.map(c => ({ ...wp(c), vehicleStopover: false })), travelMode: b.mode === 'driving' ? 'DRIVE' : 'WALK', polylineEncoding: 'GEO_JSON_LINESTRING', optimizeWaypointOrder: inter.length > 1 }) });
      const j: any = await res.json(); const r = j.routes?.[0]; if (!r) throw new Error(JSON.stringify(j).slice(0, 300));
      const interIdx = pts.map((_, i) => i).filter(i => i !== destIdx); const ord: number[] = (r.optimizedIntermediateWaypointIndex?.length ? r.optimizedIntermediateWaypointIndex : inter.map((_, i) => i)).map((i: number) => interIdx[i]); if (destIdx >= 0) ord.push(destIdx);
      return { order: ord, distanceM: Number(r.distanceMeters), durationS: parseInt(r.duration) + ord.length * DWELL, geometry: r.polyline?.geoJsonLinestring, solver: 'google' };
    } catch (e) { app.log.warn(`google routes failed: ${e}`); }
  }
  const order = solveRoute(pts, start, end); let d = 0, prev = start; for (const i of order) { d += haversineM(prev, pts[i]); prev = pts[i]; } if (end) d += haversineM(prev, end);
  return { order, distanceM: Math.round(d), durationS: Math.round(d / (b.mode === 'driving' ? 11 : 1.3) + order.length * DWELL), solver: 'local' };
});
app.post('/v1/routes', async (_req, reply) => { reply.code(201); return { id: 'route-stub' }; });
app.get('/v1/routes', async () => []);
let lastCsv = '';
app.post('/v1/mail-campaigns/quote', async (req) => { const b = req.body as any; const rows = filt(b.polygon.coordinates[0], b.filters); const unverified = rows.filter(p => !p.event_date).length; return { rowCount: rows.length, unverified, swathCredits: unverified }; });
app.post('/v1/mail-campaigns', async (req, reply) => { const b = req.body as any; const rows = filt(b.polygon.coordinates[0], b.filters);
  lastCsv = ['first_name,last_name,site_address,city,state,zip,mailing_address,owner_occupied,hail_date,hail_in', ...rows.map(p => { const [last, first] = p.owner_name.split(', '); return [first, last, p.site_address, p.city, p.state, p.zip, p.mailing_address ?? p.site_address, p.owner_occupied ? 'Y' : 'N', p.event_date ?? '', p.hail_in ?? ''].map(v => `"${v}"`).join(','); })].join('\n');
  reply.code(201); return { id: 'mail-stub', row_count: rows.length }; });
app.get('/v1/mail-campaigns/:id/csv', async (_req, reply) => { reply.header('content-type', 'text/csv'); return lastCsv; });
app.get('/v1/places/autocomplete', async (req) => {
  const q = req.query as any; if (!KEY) return [{ placeId: 'stub', text: `${q.q} (stub — set GOOGLE_MAPS_SERVER_KEY for real results)`, main: q.q, secondary: 'Trussville, AL' }];
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY, 'x-goog-fieldmask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat' },
    body: JSON.stringify({ input: q.q, includedRegionCodes: ['us'], ...(q.lng ? { locationBias: { circle: { center: { latitude: +q.lat, longitude: +q.lng }, radius: 30000 } } } : {}), ...(q.session ? { sessionToken: q.session } : {}) }) });
  const j: any = await res.json(); return (j.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean).map((p: any) => ({ placeId: p.placeId, text: p.text?.text, main: p.structuredFormat?.mainText?.text, secondary: p.structuredFormat?.secondaryText?.text }));
});
app.get('/v1/places/:placeId', async (req) => {
  const id = (req.params as any).placeId; if (!KEY || id === 'stub') return { placeId: id, formatted: 'Trussville, AL (stub)', lngLat: C, bbox: null };
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { headers: { 'x-goog-api-key': KEY, 'x-goog-fieldmask': 'id,formattedAddress,location,viewport' } });
  const j: any = await res.json(); const vp = j.viewport; return { placeId: j.id, formatted: j.formattedAddress, lngLat: [j.location?.longitude, j.location?.latitude], bbox: vp ? [vp.low.longitude, vp.low.latitude, vp.high.longitude, vp.high.latitude] : null };
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`\n  StormRoute STUB API  http://localhost:${port}\n  ${parcels.length} parcels · ${jobs.length} JobNimbus jobs · ${knocks.length} knocks · 1 storm around ${C.join(', ')}\n  Google server key: ${KEY ? 'set → real Routes / Places / Street View' : 'not set → local routing, no Street View'}\n`);
