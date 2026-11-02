import { describe, it, expect } from 'vitest';
import { haversineM, pointInPolygon, solveRoute } from './geo';
import { parcelScore, roofFactor, yearBand } from './scoring';
import type { LngLat } from './types';

describe('haversineM', () => {
  it('is zero for identical points and symmetric', () => { const a: LngLat = [-86.61, 33.62], b: LngLat = [-86.60, 33.63]; expect(haversineM(a, a)).toBe(0); expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6); });
  it('measures ~1.11 km per 0.01° of latitude', () => { expect(haversineM([-86.61, 33.62], [-86.61, 33.63])).toBeCloseTo(1112, -1); });
});

describe('pointInPolygon', () => {
  const sq: LngLat[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  it('detects inside / outside', () => { expect(pointInPolygon([0.5, 0.5], sq)).toBe(true); expect(pointInPolygon([1.5, 0.5], sq)).toBe(false); });
});

describe('solveRoute', () => {
  const grid: LngLat[] = Array.from({ length: 12 }, (_, i) => [-86.61 + (i % 4) * 0.001, 33.62 + Math.floor(i / 4) * 0.001]);
  const len = (order: number[], start: LngLat, end: LngLat | null) => { let d = 0, p = start; for (const i of order) { d += haversineM(p, grid[i]); p = grid[i]; } return end ? d + haversineM(p, end) : d; };
  it('visits every stop exactly once', () => { const o = solveRoute(grid, [-86.612, 33.619]); expect([...o].sort((a, b) => a - b)).toEqual(grid.map((_, i) => i)); });
  it('is no worse than the naive input order', () => { const start: LngLat = [-86.612, 33.619]; const o = solveRoute(grid, start, start); expect(len(o, start, start)).toBeLessThanOrEqual(len(grid.map((_, i) => i), start, start) + 1e-6); });
  it('handles empty input', () => { expect(solveRoute([], [0, 0])).toEqual([]); });
});

describe('scoring', () => {
  it('roofFactor clamps to [0.4, 1.5] and treats unknown as 1', () => { const y = new Date().getFullYear(); expect(roofFactor(null)).toBe(1); expect(roofFactor(y - 1)).toBe(0.4); expect(roofFactor(y - 60)).toBe(1.5); expect(roofFactor(y - 25)).toBe(1); });
  it('parcelScore halves absentee owners', () => { const y = new Date().getFullYear() - 25; expect(parcelScore(1, y, true)).toBe(1); expect(parcelScore(1, y, false)).toBe(0.5); expect(parcelScore(null, y, true)).toBe(0); });
  it('yearBand buckets', () => { expect(yearBand(null)).toBe('unknown'); expect(yearBand(1990)).toBe('b1'); expect(yearBand(2000)).toBe('b2'); expect(yearBand(2010)).toBe('b3'); expect(yearBand(2015)).toBe('b4'); expect(yearBand(2023)).toBe('b5'); });
});
