import type { BBox } from './api';
export const bboxOf = (map: google.maps.Map): BBox | null => { const b = map.getBounds(); if (!b) return null; const sw = b.getSouthWest(), ne = b.getNorthEast(); return [sw.lng(), sw.lat(), ne.lng(), ne.lat()].join(','); };
export const toLatLng = (c: [number, number] | number[]) => ({ lat: c[1], lng: c[0] });
export const toLngLat = (p: google.maps.LatLng | google.maps.LatLngLiteral): [number, number] => typeof (p as google.maps.LatLng).lng === 'function' ? [(p as google.maps.LatLng).lng(), (p as google.maps.LatLng).lat()] : [(p as google.maps.LatLngLiteral).lng, (p as google.maps.LatLngLiteral).lat];
/** google.maps.Polygon → GeoJSON Polygon (outer ring, closed, lng/lat) */
export const polygonToGeoJSON = (poly: google.maps.Polygon): GeoJSON.Polygon => {
  const ring = poly.getPath().getArray().map(toLngLat); if (ring.length) ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
};
export const hailColor = (maxHailIn: number | null | undefined) => { const h = Number(maxHailIn ?? 0); return h >= 2.5 ? '#d7263d' : h >= 1.5 ? '#f4883c' : '#ffd166'; };
export const STATUS_COLORS: Record<string, string> = { Lead: '#8e6bd6', Inspection: '#1f5fd6', Signed: '#1a9e5c', Production: '#e08a1e', Complete: '#6b7280' };
export const DISP_COLORS: Record<string, string> = { not_home: '#9a958a', not_interested: '#6b665c', callback: '#e0a21e', do_not_knock: '#d7263d', inspection_set: '#1f5fd6' };
/** Roof-age bands (match yearBand() in @stormroute/shared) */
export const yearColor = (y: number | null | undefined) => !y ? '#cfc8b8' : y <= 1995 ? '#7a2e1e' : y <= 2005 ? '#b2522f' : y <= 2012 ? '#d98b5c' : y <= 2019 ? '#ecc49a' : '#f6e6d0';
export const PARCEL_MIN_ZOOM = 16;
export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => { let t: ReturnType<typeof setTimeout>; return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
