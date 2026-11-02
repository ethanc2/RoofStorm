import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://x'; process.env.JWT_SECRET ??= 'test-secret-test-secret'; process.env.KEY_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
process.env.GOOGLE_MAPS_SERVER_KEY = 'TEST_KEY_1234567890abcdef'; process.env.GOOGLE_STREETVIEW_SIGNING_SECRET = 'vNIXE0xscrmjlyV-12Nj_BvUPaw=';

const calls: { url: string; init?: any }[] = []; let nextResponse: { status: number; body: any; headers?: Record<string, string> } = { status: 200, body: {} };
vi.mock('undici', () => ({ request: vi.fn(async (url: string, init?: any) => { calls.push({ url, init }); const r = nextResponse; const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  return { statusCode: r.status, headers: r.headers ?? { 'content-type': 'application/json' }, body: { json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer } }; }) }));
vi.mock('../db/usage', () => ({ logUsage: vi.fn(async () => []) }));
vi.mock('../db/pool', () => ({ q: vi.fn(async () => []), pool: {} }));

const { GoogleMaps, bearingDeg } = await import('./google');

beforeEach(() => { calls.length = 0; nextResponse = { status: 200, body: {} }; });

describe('computeRoute', () => {
  it('builds a Routes API request and maps optimized order', async () => {
    nextResponse = { status: 200, body: { routes: [{ distanceMeters: 1234, duration: '567s', optimizedIntermediateWaypointIndex: [2, 0, 1], polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }, legs: [] }] } };
    const r = await new GoogleMaps('c1').computeRoute([-86.6, 33.6], [[-86.61, 33.61], [-86.62, 33.62], [-86.63, 33.63]], [-86.6, 33.6], 'walking', true);
    expect(r).toMatchObject({ order: [2, 0, 1], distanceM: 1234, durationS: 567 }); expect(r!.geometry?.type).toBe('LineString');
    const { url, init } = calls[0]; expect(url).toContain('routes.googleapis.com/directions/v2:computeRoutes');
    expect(init.headers['x-goog-api-key']).toBe('TEST_KEY_1234567890abcdef'); expect(init.headers['x-goog-fieldmask']).toContain('optimizedIntermediateWaypointIndex');
    const body = JSON.parse(init.body); expect(body.travelMode).toBe('WALK'); expect(body.optimizeWaypointOrder).toBe(true); expect(body.intermediates).toHaveLength(3); expect(body.origin.location.latLng).toEqual({ latitude: 33.6, longitude: -86.6 });
  });
  it('refuses to optimize more than 25 intermediates', async () => {
    const stops = Array.from({ length: 26 }, (_, i) => [-86.6 + i * 0.001, 33.6] as [number, number]);
    await expect(new GoogleMaps('c1').computeRoute([-86.6, 33.6], stops, [-86.6, 33.6], 'walking', true)).rejects.toThrow(/25/);
  });
  it('falls back to input order when no optimization is returned', async () => {
    nextResponse = { status: 200, body: { routes: [{ distanceMeters: 10, duration: '5s' }] } };
    const r = await new GoogleMaps('c1').computeRoute([0, 0], [[1, 1], [2, 2]], [3, 3], 'driving', false); expect(r!.order).toEqual([0, 1]); expect(JSON.parse(calls[0].init.body).travelMode).toBe('DRIVE');
  });
});

describe('buildingInsights', () => {
  it('aggregates roof segments into area, weighted pitch and dominant facet', async () => {
    nextResponse = { status: 200, body: { name: 'buildings/abc', center: { latitude: 33.6, longitude: -86.6 }, imageryDate: { year: 2023, month: 4, day: 9 }, imageryQuality: 'HIGH',
      solarPotential: { roofSegmentStats: [{ pitchDegrees: 20, azimuthDegrees: 180, stats: { areaMeters2: 100 } }, { pitchDegrees: 30, azimuthDegrees: 0, stats: { areaMeters2: 50 } }] } } };
    const r = await new GoogleMaps('c1').buildingInsights([-86.6, 33.6]);
    expect(r).toMatchObject({ roofAreaM2: 150, segmentCount: 2, pitchDeg: 23.3, dominantAzimuthDeg: 180, imageryDate: '2023-04-09', imageryQuality: 'HIGH' }); expect(r!.roofAreaSqft).toBe(1615);
  });
  it('returns null on 404 (no coverage)', async () => { nextResponse = { status: 404, body: { error: 'not found' } }; expect(await new GoogleMaps('c1').buildingInsights([0, 0])).toBeNull(); });
});

describe('streetViewUrl', () => {
  it('signs the request with the URL-signing secret', () => {
    const u = new URL(new GoogleMaps().streetViewUrl([-86.6, 33.6], { size: '600x300', heading: 151.78 }));
    expect(u.hostname).toBe('maps.googleapis.com'); expect(u.searchParams.get('location')).toBe('33.6,-86.6'); expect(u.searchParams.get('heading')).toBe('152'); expect(u.searchParams.get('return_error_code')).toBe('true');
    expect(u.searchParams.get('signature')).toMatch(/^[A-Za-z0-9_-]{27}=?$/);
  });
});

describe('bearingDeg', () => {
  it('points north/east/south/west', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 5); expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 5); expect(bearingDeg([0, 1], [0, 0])).toBeCloseTo(180, 5); expect(bearingDeg([1, 0], [0, 0])).toBeCloseTo(270, 5);
  });
});
