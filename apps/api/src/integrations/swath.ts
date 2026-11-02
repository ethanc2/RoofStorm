import { request } from 'undici';
import { logUsage } from '../db/usage';
import { env } from '../env';
const BASE = env.SWATH_API_URL;

/**
 * Swath API client. Endpoint paths mirror the tool names documented at swathapi.com/docs
 * (find_storms, lookup_property, get_swath_report, get_report_quote, create_monitor).
 * Confirm exact paths/params against the live docs before go-live; shapes below are the integration contract we code to.
 */
export class Swath {
  constructor(private apiKey: string, private companyId: string) {}
  private async call<T>(path: string, body: any, endpoint: string, units = 1): Promise<T> {
    const res = await request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(body) });
    if (res.statusCode >= 400) throw new Error(`swath ${path} ${res.statusCode}: ${await res.body.text()}`);
    await logUsage(this.companyId, 'swath', endpoint, units);
    return res.body.json() as Promise<T>;
  }
  findStorms(bbox: [number, number, number, number], from: string, to: string, minHailIn = 0.75) {
    return this.call<{ storms: SwathStorm[] }>('/v1/storms/find', { bbox, from, to, min_hail_in: minHailIn, kinds: ['hail', 'wind'] }, 'find_storms');
  }
  lookupProperty(address: string) {
    return this.call<SwathProperty>('/v1/property/lookup', { address }, 'lookup_property', 1);
  }
  reportQuote(stormId: string) { return this.call<{ credits: number; property_count: number }>('/v1/reports/quote', { storm_id: stormId }, 'get_report_quote', 0); }
  swathReport(stormId: string) { return this.call<{ report_id: string; properties: SwathProperty[] }>('/v1/reports', { storm_id: stormId }, 'get_swath_report'); }
  createMonitor(name: string, polygon: GeoJSON.Polygon, webhookUrl: string) {
    return this.call<{ monitor_id: string }>('/v1/monitors', { name, polygon, webhook_url: webhookUrl }, 'create_monitor', 0);
  }
}
export interface SwathStorm { id: string; event_date: string; kind: 'hail' | 'wind'; max_hail_in?: number; mean_hail_in?: number; max_gust_mph?: number; geometry: GeoJSON.MultiPolygon; }
export interface SwathProperty { address: string; lat: number; lng: number; owner_name?: string; owner_occupied?: boolean; roof_age_years?: number; year_built?: number; assessed_value?: number;
  events: { storm_id: string; event_date: string; kind: 'hail' | 'wind'; hail_in?: number; gust_mph?: number }[]; }
