import { request } from 'undici';
import { logUsage } from '../db/usage';
/** Regrid parcel API: point lookup and polygon query. Vector tiles are consumed directly by the map clients. */
export class Regrid {
  constructor(private token: string, private companyId: string) {}
  private async get<T>(path: string, endpoint: string, units = 1): Promise<T> {
    const res = await request(`https://app.regrid.com/api/v2${path}&token=${this.token}`);
    if (res.statusCode >= 400) throw new Error(`regrid ${res.statusCode}`);
    await logUsage(this.companyId, 'regrid', endpoint, units);
    return res.body.json() as Promise<T>;
  }
  byPoint(lng: number, lat: number) { return this.get<RegridResponse>(`/parcels/point?lat=${lat}&lon=${lng}&return_geometry=true`, 'point'); }
  byPolygon(polygon: GeoJSON.Polygon, limit = 1000) { return this.get<RegridResponse>(`/parcels/area?geojson=${encodeURIComponent(JSON.stringify(polygon))}&limit=${limit}&return_geometry=true`, 'area', limit); }
}
export interface RegridResponse { parcels: { type: 'FeatureCollection'; features: GeoJSON.Feature<GeoJSON.Polygon, RegridFields>[] } }
export interface RegridFields { ll_uuid: string; address?: string; scity?: string; state2?: string; szip?: string; owner?: string; mailadd?: string; mail_city?: string; mail_state2?: string; mail_zip?: string;
  yearbuilt?: number; parval?: number; lat?: string; lon?: string; }
export function toParcelRow(f: GeoJSON.Feature<GeoJSON.Polygon, RegridFields>) {
  const p = f.properties; const mailing = p.mailadd ? `${p.mailadd}, ${p.mail_city ?? ''}, ${p.mail_state2 ?? ''} ${p.mail_zip ?? ''}`.trim() : null;
  const site = p.address ?? '';
  const ownerOccupied = mailing && site ? mailing.toLowerCase().startsWith(site.toLowerCase().slice(0, 12)) : null;
  return { source: 'regrid', sourceId: p.ll_uuid, geom: f.geometry, siteAddress: site, city: p.scity ?? null, state: p.state2 ?? null, zip: p.szip ?? null,
    ownerName: p.owner ?? null, mailingAddress: mailing, ownerOccupied, yearBuilt: p.yearbuilt ?? null, assessedValue: p.parval ?? null };
}
