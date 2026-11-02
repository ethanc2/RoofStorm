export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
let token = '';
export const setToken = (t: string) => { token = t; };
export const authHeaders = () => ({ authorization: `Bearer ${token}` });
export async function call<T>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const err: any = new Error(`${method} ${path} → ${res.status}`); err.status = res.status; throw err; }
  return res.json();
}
export const api = {
  storms: (bbox: string, from: string, to: string) => call<GeoJSON.FeatureCollection>('GET', `/v1/storms?bbox=${bbox}&from=${from}&to=${to}`),
  jobs: (bbox: string) => call<GeoJSON.FeatureCollection>('GET', `/v1/jobs?bbox=${bbox}`),
  knocks: (bbox: string) => call<GeoJSON.FeatureCollection>('GET', `/v1/knocks?bbox=${bbox}`),
  parcels: (bbox: string) => call<GeoJSON.FeatureCollection>('GET', `/v1/parcels?bbox=${bbox}`),
  parcelAt: (lng: number, lat: number) => call<any>('GET', `/v1/parcels/at?lng=${lng}&lat=${lat}`),
  parcel: (id: string) => call<any>('GET', `/v1/parcels/${id}`),
  optimize: (body: any) => call<any>('POST', '/v1/routes/optimize', body),
  routes: () => call<any[]>('GET', '/v1/routes'),
  /** Street View image is proxied by the API; RN <Image> can send headers so we just hand back the source. */
  streetViewSource: (parcelId: string, size = '640x360') => ({ uri: `${BASE}/v1/parcels/${parcelId}/streetview?size=${size}`, headers: authHeaders() }),
};

