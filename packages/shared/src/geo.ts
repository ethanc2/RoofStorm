import type { LngLat } from './types';

/** Ray-cast point in polygon (outer ring only; holes ignored for lasso use). */
export function pointInPolygon(pt: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const cross = (yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (cross) inside = !inside;
  }
  return inside;
}

export function haversineM(a: LngLat, b: LngLat): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Nearest-neighbour + 2-opt. Good enough for <= ~150 stops on device or as a
 * fallback when the Google Routes / Route Optimization APIs are unavailable. Returns stop indices.
 */
export function solveRoute(points: LngLat[], start: LngLat, end?: LngLat | null): number[] {
  const n = points.length; if (!n) return [];
  const D = (a: LngLat, b: LngLat) => haversineM(a, b);
  let remaining = points.map((_, i) => i), cur = start; const order: number[] = [];
  while (remaining.length) {
    let bi = 0, bd = Infinity;
    remaining.forEach((idx, k) => { const d = D(cur, points[idx]); if (d < bd) { bd = d; bi = k; } });
    const idx = remaining.splice(bi, 1)[0]; order.push(idx); cur = points[idx];
  }
  const len = (o: number[]) => { let s = 0, p = start; for (const i of o) { s += D(p, points[i]); p = points[i]; } return end ? s + D(p, end) : s; };
  let best = len(order), improved = true, guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const cand = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
      const l = len(cand); if (l + 1e-6 < best) { order.splice(0, n, ...cand); best = l; improved = true; }
    }
  }
  return order;
}
