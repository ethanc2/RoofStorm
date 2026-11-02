import type { LngLat } from '@stormroute/shared';
import { q } from '../db/pool';
import { GoogleMaps } from './google';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Geocode through the DB cache; a miss costs one Google Geocoding call. Negative results are cached too (lng/lat NULL). */
export async function geocodeCached(companyId: string, address: string): Promise<LngLat | null> {
  const key = norm(address); if (!key) return null;
  const [hit] = await q(`SELECT lng, lat FROM geocode_cache WHERE address_norm=$1`, [key]);
  if (hit) return hit.lng == null ? null : [hit.lng, hit.lat];
  const r = await new GoogleMaps(companyId).geocode(address);
  await q(`INSERT INTO geocode_cache (address_norm, lng, lat, place_id, formatted, location_type) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (address_norm) DO NOTHING`,
    [key, r?.lngLat[0] ?? null, r?.lngLat[1] ?? null, r?.placeId ?? null, r?.formatted ?? null, r?.locationType ?? null]);
  return r?.lngLat ?? null;
}
