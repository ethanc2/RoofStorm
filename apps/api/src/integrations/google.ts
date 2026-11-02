import { request } from 'undici';
import { createHmac } from 'node:crypto';
import type { LngLat } from '@stormroute/shared';
import { env } from '../env';
import { logUsage } from '../db/usage';

/**
 * Google Maps Platform client. Everything paid goes through here so api_usage gets a row per call.
 *  - Geocoding API            geocode / reverseGeocode
 *  - Routes API               computeRoute (optimizeWaypointOrder, <= 25 intermediates)
 *  - Route Optimization API   optimizeTours (> 25 stops; OAuth via service account, optional)
 *  - Solar API                buildingInsights (roof segments, pitch, imagery date)
 *  - Street View Static       signed image URL + availability metadata
 *  - Places API (New)         autocomplete + details
 */
const KEY = env.GOOGLE_MAPS_SERVER_KEY;
export const ROUTES_MAX_INTERMEDIATES = 25; // Routes API limit when optimizeWaypointOrder=true
// Approximate list-price cents per call, for the admin usage view. Adjust to your contract.
const COST = { geocode: 0.5, routes_basic: 0.5, routes_advanced: 1, route_optimization: 2, solar: 1, streetview: 0.7, streetview_meta: 0, places_autocomplete: 0.3, places_details: 1.7 } as const;

export type GeocodeResult = { lngLat: LngLat; placeId: string; formatted: string; locationType: string } | null;

export class GoogleMaps {
  constructor(private companyId: string | null = null) {}
  private log(endpoint: keyof typeof COST, units = 1) { return this.companyId ? logUsage(this.companyId, 'google', endpoint, units, Math.round(COST[endpoint] * units)) : Promise.resolve([]); }

  private async getJson<T>(url: string): Promise<T> {
    const res = await request(url);
    if (res.statusCode >= 400) throw new Error(`google GET ${new URL(url).pathname} ${res.statusCode}: ${await res.body.text()}`);
    return res.body.json() as Promise<T>;
  }
  private async postJson<T>(url: string, body: unknown, fieldMask: string, bearer?: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-goog-fieldmask': fieldMask };
    if (bearer) headers.authorization = `Bearer ${bearer}`; else headers['x-goog-api-key'] = KEY;
    const res = await request(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.statusCode >= 400) throw new Error(`google POST ${new URL(url).pathname} ${res.statusCode}: ${await res.body.text()}`);
    return res.body.json() as Promise<T>;
  }

  // ---------- Geocoding ----------
  async geocode(address: string): Promise<GeocodeResult> {
    const j = await this.getJson<any>(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=us&components=country:US&key=${KEY}`);
    await this.log('geocode');
    const r = j.results?.[0]; if (!r || j.status !== 'OK') return null;
    return { lngLat: [r.geometry.location.lng, r.geometry.location.lat], placeId: r.place_id, formatted: r.formatted_address, locationType: r.geometry.location_type };
  }
  async reverseGeocode(lngLat: LngLat): Promise<GeocodeResult> {
    const j = await this.getJson<any>(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lngLat[1]},${lngLat[0]}&result_type=street_address|premise&key=${KEY}`);
    await this.log('geocode');
    const r = j.results?.[0]; if (!r || j.status !== 'OK') return null;
    return { lngLat: [r.geometry.location.lng, r.geometry.location.lat], placeId: r.place_id, formatted: r.formatted_address, locationType: r.geometry.location_type };
  }

  // ---------- Routes API ----------
  /**
   * Road-accurate route through `stops`. With `optimize` the API reorders intermediates (TSP) — only allowed for <= 25 stops.
   * `order` is indices into `stops` in visiting order. Geometry is a GeoJSON LineString.
   */
  async computeRoute(origin: LngLat, stops: LngLat[], destination: LngLat, mode: 'walking' | 'driving', optimize: boolean) {
    if (optimize && stops.length > ROUTES_MAX_INTERMEDIATES) throw new Error(`Routes API optimizes at most ${ROUTES_MAX_INTERMEDIATES} intermediates`);
    const wp = (c: LngLat) => ({ location: { latLng: { latitude: c[1], longitude: c[0] } } });
    const body = { origin: wp(origin), destination: wp(destination), intermediates: stops.map(c => ({ ...wp(c), vehicleStopover: false })),
      travelMode: mode === 'walking' ? 'WALK' : 'DRIVE', polylineEncoding: 'GEO_JSON_LINESTRING', optimizeWaypointOrder: optimize && stops.length > 1, units: 'IMPERIAL' };
    const j = await this.postJson<any>('https://routes.googleapis.com/directions/v2:computeRoutes', body,
      'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring,routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration');
    await this.log(optimize ? 'routes_advanced' : 'routes_basic');
    const r = j.routes?.[0]; if (!r) return null;
    const order: number[] = r.optimizedIntermediateWaypointIndex?.length ? r.optimizedIntermediateWaypointIndex : stops.map((_, i) => i);
    return { order, distanceM: Number(r.distanceMeters ?? 0), durationS: parseInt(String(r.duration ?? '0s'), 10), geometry: r.polyline?.geoJsonLinestring as GeoJSON.LineString | undefined,
      legs: (r.legs ?? []).map((l: any) => ({ distanceM: Number(l.distanceMeters ?? 0), durationS: parseInt(String(l.duration ?? '0s'), 10) })) };
  }

  // ---------- Route Optimization API (optional, OAuth) ----------
  /** True when a project + service-account credentials are configured. API keys are not accepted by this API. */
  static routeOptimizationEnabled() { return !!(env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_APPLICATION_CREDENTIALS); }
  /** Single-vehicle TSP for large stop sets. Returns visiting order as indices into `stops`. */
  async optimizeTours(origin: LngLat, stops: LngLat[], destination: LngLat | null, mode: 'walking' | 'driving', serviceSeconds = 240): Promise<number[] | null> {
    if (!GoogleMaps.routeOptimizationEnabled()) return null;
    const { GoogleAuth } = await import('google-auth-library');
    const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
    if (!token) throw new Error('google-auth: no access token');
    const ll = (c: LngLat) => ({ latLng: { latitude: c[1], longitude: c[0] } });
    const body = { model: {
      shipments: stops.map((c, i) => ({ label: String(i), deliveries: [{ arrivalLocation: ll(c).latLng, duration: `${serviceSeconds}s` }] })),
      vehicles: [{ label: 'rep', travelMode: mode === 'walking' ? 'WALKING' : 'DRIVING', startWaypoint: { location: ll(origin) }, ...(destination ? { endWaypoint: { location: ll(destination) } } : {}), costPerHour: 60, costPerKilometer: 1 }],
    }, searchMode: 'RETURN_FAST', considerRoadTraffic: false, populatePolylines: false };
    const j = await this.postJson<any>(`https://routeoptimization.googleapis.com/v1/projects/${env.GOOGLE_CLOUD_PROJECT}:optimizeTours`, body, '*', token);
    await this.log('route_optimization', stops.length);
    const visits: any[] = j.routes?.[0]?.visits ?? [];
    const order = visits.map(v => Number(v.shipmentIndex ?? 0));
    const skipped = (j.skippedShipments ?? []).map((s: any) => Number(s.index ?? 0));
    return [...order, ...skipped]; // skipped stops appended so every stop still appears
  }

  // ---------- Solar API ----------
  async buildingInsights(lngLat: LngLat): Promise<RoofInsights | null> {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lngLat[1]}&location.longitude=${lngLat[0]}&requiredQuality=LOW&key=${KEY}`;
    const res = await request(url); await this.log('solar');
    if (res.statusCode === 404) { await res.body.text(); return null; } // no building within range / no coverage
    if (res.statusCode >= 400) throw new Error(`google solar ${res.statusCode}: ${await res.body.text()}`);
    const j: any = await res.body.json();
    const segs: any[] = j.solarPotential?.roofSegmentStats ?? [];
    const area = (s: any) => Number(s.stats?.areaMeters2 ?? 0);
    const total = segs.reduce((a, s) => a + area(s), 0) || Number(j.solarPotential?.wholeRoofStats?.areaMeters2 ?? 0);
    const wavg = (k: string) => total ? segs.reduce((a, s) => a + Number(s[k] ?? 0) * area(s), 0) / total : null;
    const pitch = wavg('pitchDegrees');
    const d = j.imageryDate;
    return { buildingId: j.name, center: [j.center?.longitude, j.center?.latitude] as LngLat, roofAreaM2: Math.round(total), roofAreaSqft: Math.round(total * 10.7639), segmentCount: segs.length,
      pitchDeg: pitch == null ? null : Math.round(pitch * 10) / 10, dominantAzimuthDeg: segs.length ? Math.round(segs.reduce((a, s) => area(s) > area(a) ? s : a, segs[0]).azimuthDegrees ?? 0) : null,
      imageryDate: d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null, imageryQuality: j.imageryQuality ?? null,
      segments: segs.map(s => ({ pitchDeg: s.pitchDegrees, azimuthDeg: s.azimuthDegrees, areaM2: area(s), heightM: s.planeHeightAtCenterMeters })), raw: j };
  }

  // ---------- Street View Static ----------
  /** Is there outdoor imagery near this point? Free metadata call. */
  async streetViewAvailable(lngLat: LngLat, radiusM = 50): Promise<{ panoId: string; location: LngLat; date?: string } | null> {
    const j = await this.getJson<any>(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lngLat[1]},${lngLat[0]}&radius=${radiusM}&source=outdoor&key=${KEY}`);
    await this.log('streetview_meta');
    return j.status === 'OK' ? { panoId: j.pano_id, location: [j.location.lng, j.location.lat], date: j.date } : null;
  }
  /** Signed Street View image URL. Point the camera from the pano toward the house (heading), or let Google pick. */
  streetViewUrl(lngLat: LngLat, opts: { size?: string; heading?: number; pitch?: number; fov?: number } = {}) {
    const p = new URLSearchParams({ size: opts.size ?? '640x360', location: `${lngLat[1]},${lngLat[0]}`, source: 'outdoor', return_error_code: 'true', key: KEY });
    if (opts.heading != null) p.set('heading', String(Math.round(opts.heading)));
    if (opts.pitch != null) p.set('pitch', String(opts.pitch)); if (opts.fov != null) p.set('fov', String(opts.fov));
    return `https://maps.googleapis.com${sign(`/maps/api/streetview?${p}`)}`;
  }
  async fetchStreetView(lngLat: LngLat, opts: Parameters<GoogleMaps['streetViewUrl']>[1] = {}) {
    const res = await request(this.streetViewUrl(lngLat, opts));
    if (res.statusCode === 404) { await res.body.text(); return null; }
    if (res.statusCode >= 400) throw new Error(`google streetview ${res.statusCode}: ${await res.body.text()}`);
    await this.log('streetview');
    return { contentType: (res.headers['content-type'] as string | undefined) ?? 'image/jpeg', body: Buffer.from(await res.body.arrayBuffer()) };
  }

  // ---------- Places API (New) ----------
  async autocomplete(input: string, bias?: { center: LngLat; radiusM: number }, sessionToken?: string) {
    const body: any = { input, includedRegionCodes: ['us'] };
    if (bias) body.locationBias = { circle: { center: { latitude: bias.center[1], longitude: bias.center[0] }, radius: bias.radiusM } };
    if (sessionToken) body.sessionToken = sessionToken;
    const j = await this.postJson<any>('https://places.googleapis.com/v1/places:autocomplete', body, 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat');
    await this.log('places_autocomplete');
    return (j.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean)
      .map((p: any) => ({ placeId: p.placeId as string, text: p.text?.text as string, main: p.structuredFormat?.mainText?.text as string | undefined, secondary: p.structuredFormat?.secondaryText?.text as string | undefined }));
  }
  async placeDetails(placeId: string, sessionToken?: string) {
    const res = await request(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${sessionToken ? `?sessionToken=${sessionToken}` : ''}`,
      { headers: { 'x-goog-api-key': KEY, 'x-goog-fieldmask': 'id,formattedAddress,location,viewport' } });
    if (res.statusCode >= 400) throw new Error(`google places ${res.statusCode}: ${await res.body.text()}`);
    const j: any = await res.body.json(); await this.log('places_details');
    const vp = j.viewport;
    return { placeId: j.id as string, formatted: j.formattedAddress as string, lngLat: [j.location?.longitude, j.location?.latitude] as LngLat,
      bbox: vp ? [vp.low.longitude, vp.low.latitude, vp.high.longitude, vp.high.latitude] as [number, number, number, number] : null };
  }
}

export interface RoofInsights {
  buildingId: string; center: LngLat; roofAreaM2: number; roofAreaSqft: number; segmentCount: number; pitchDeg: number | null; dominantAzimuthDeg: number | null;
  imageryDate: string | null; imageryQuality: string | null; segments: { pitchDeg: number; azimuthDeg: number; areaM2: number; heightM?: number }[]; raw: unknown;
}

/** Street View URL signing (HMAC-SHA1 over path+query with the URL-safe base64 secret). No-op when the secret isn't configured. */
function sign(pathAndQuery: string) {
  const secret = env.GOOGLE_STREETVIEW_SIGNING_SECRET; if (!secret) return pathAndQuery;
  const key = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = createHmac('sha1', key).update(pathAndQuery).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return `${pathAndQuery}&signature=${sig}`;
}

/** Initial bearing in degrees from a → b (for pointing a Street View camera at a house). */
export function bearingDeg(a: LngLat, b: LngLat) {
  const toRad = (d: number) => (d * Math.PI) / 180, toDeg = (r: number) => (r * 180) / Math.PI;
  const p1 = toRad(a[1]), p2 = toRad(b[1]), dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
