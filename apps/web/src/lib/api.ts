export const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
let token = localStorage.getItem('sr_token') ?? '';
export const setToken = (t: string) => { token = t; localStorage.setItem('sr_token', t); };
export const authHeaders = () => ({ authorization: `Bearer ${token}` });
async function call<T>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  const ct = res.headers.get('content-type') ?? ''; return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}
export type BBox = string; // "w,s,e,n"
export const api = {
  storms: (bbox: BBox, from: string, to: string, minHail = 0.75) => call<GeoJSON.FeatureCollection>('GET', `/v1/storms?bbox=${bbox}&from=${from}&to=${to}&min_hail=${minHail}`),
  jobs: (bbox: BBox) => call<GeoJSON.FeatureCollection>('GET', `/v1/jobs?bbox=${bbox}`),
  knocks: (bbox: BBox) => call<GeoJSON.FeatureCollection>('GET', `/v1/knocks?bbox=${bbox}`),
  parcels: (bbox: BBox) => call<GeoJSON.FeatureCollection>('GET', `/v1/parcels?bbox=${bbox}`),
  parcelAt: (lng: number, lat: number) => call<any>('GET', `/v1/parcels/at?lng=${lng}&lat=${lat}`),
  parcel: (id: string) => call<any>('GET', `/v1/parcels/${id}`),
  within: (polygon: GeoJSON.Polygon, filters = {}, warm = true) => call<any[]>('POST', '/v1/parcels/within', { polygon, filters, warm }),
  parcelsByIds: (ids: string[]) => call<any[]>('POST', '/v1/parcels/by-ids', { ids }),
  optimize: (body: any) => call<{ order: number[]; distanceM: number; durationS: number; geometry?: GeoJSON.LineString; solver: string }>('POST', '/v1/routes/optimize', body),
  saveRoute: (body: any) => call<{ id: string }>('POST', '/v1/routes', body),
  mailQuote: (polygon: GeoJSON.Polygon, filters: any) => call<{ rowCount: number; unverified: number; swathCredits: number }>('POST', '/v1/mail-campaigns/quote', { polygon, filters }),
  mailCreate: (name: string, polygon: GeoJSON.Polygon, filters: any) => call<{ id: string; row_count: number }>('POST', '/v1/mail-campaigns', { name, polygon, filters }),
  mailCsv: (id: string) => call<string>('GET', `/v1/mail-campaigns/${id}/csv`),
  streets: (stormId: string) => call<any[]>('GET', `/v1/storms/${stormId}/streets`),
  autocomplete: (q: string, center?: [number, number], session?: string) => call<{ placeId: string; text: string; main?: string; secondary?: string }[]>('GET', `/v1/places/autocomplete?q=${encodeURIComponent(q)}${center ? `&lng=${center[0]}&lat=${center[1]}` : ''}${session ? `&session=${session}` : ''}`),
  place: (placeId: string, session?: string) => call<{ placeId: string; formatted: string; lngLat: [number, number]; bbox: [number, number, number, number] | null }>('GET', `/v1/places/${encodeURIComponent(placeId)}${session ? `?session=${session}` : ''}`),
  /** Street View is proxied by the API (needs auth header) → fetch as blob and hand back an object URL. */
  streetView: async (parcelId: string, size = '640x360') => { const r = await fetch(`${BASE}/v1/parcels/${parcelId}/streetview?size=${size}`, { headers: authHeaders() }); return r.ok ? URL.createObjectURL(await r.blob()) : null; },
};

