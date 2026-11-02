/** Ride-the-swath street priority (spec F8.3/F8.4). Weights are admin-tunable. */
export interface ScoreWeights { roofAgeYears: number; roofMin: number; roofMax: number; absenteeFactor: number; }
export const DEFAULT_WEIGHTS: ScoreWeights = { roofAgeYears: 25, roofMin: 0.4, roofMax: 1.5, absenteeFactor: 0.5 };

export function roofFactor(yearBuilt: number | null, now = new Date().getFullYear(), w = DEFAULT_WEIGHTS): number {
  if (!yearBuilt) return 1; // unknown: never scored as new
  return Math.min(w.roofMax, Math.max(w.roofMin, (now - yearBuilt) / w.roofAgeYears));
}
export function parcelScore(hailIn: number | null, yearBuilt: number | null, ownerOccupied: boolean | null, w = DEFAULT_WEIGHTS): number {
  const occ = ownerOccupied === false ? w.absenteeFactor : 1;
  return +((hailIn ?? 0) * roofFactor(yearBuilt, undefined, w) * occ).toFixed(3);
}
export function yearBand(yearBuilt: number | null): 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'unknown' {
  if (!yearBuilt) return 'unknown';
  return yearBuilt <= 1995 ? 'b1' : yearBuilt <= 2005 ? 'b2' : yearBuilt <= 2012 ? 'b3' : yearBuilt <= 2019 ? 'b4' : 'b5';
}
