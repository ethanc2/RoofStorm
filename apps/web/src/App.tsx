import { useCallback, useEffect, useMemo, useState } from 'react';
import { APIProvider, Map, useMap, type MapMouseEvent } from '@vis.gl/react-google-maps';
import { api } from './lib/api';
import { bboxOf, hailColor, yearColor, STATUS_COLORS, DISP_COLORS, PARCEL_MIN_ZOOM, debounce } from './lib/mapUtil';
import { DataLayer, RouteLine } from './components/map/DataLayer';
import { PointLayer } from './components/map/PointLayer';
import { DrawControl } from './components/map/DrawControl';
import { SearchBox } from './components/map/SearchBox';
import { LassoPanel } from './components/LassoPanel';
import { OwnerCard } from './components/OwnerCard';
import { RideSwath } from './components/RideSwath';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? '';
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID ?? 'DEMO_MAP_ID';

export default function App() {
  if (!KEY) return <div style={{ padding: 24 }}>Set <code>VITE_GOOGLE_MAPS_BROWSER_KEY</code> in <code>.env</code>.</div>;
  return <APIProvider apiKey={KEY} libraries={['marker', 'geometry']}><Workspace /></APIProvider>;
}

function Workspace() {
  const map = useMap();
  const [layers, setLayers] = useState({ storms: true, jobs: true, knocks: true, parcels: true, heat: false });
  const [storms, setStorms] = useState(EMPTY); const [jobs, setJobs] = useState(EMPTY); const [knocks, setKnocks] = useState(EMPTY); const [parcels, setParcels] = useState(EMPTY);
  const [polygon, setPolygon] = useState<GeoJSON.Polygon | null>(null); const [clearSignal, setClearSignal] = useState(0);
  const [card, setCard] = useState<any>(null);
  const [route, setRoute] = useState<GeoJSON.LineString | null>(null);
  const [mode, setMode] = useState<'lasso' | 'card' | 'swath'>('lasso');
  const [zoom, setZoom] = useState(13); const [drawing, setDrawing] = useState(false);

  // Viewport loads (debounced; parcels only when zoomed in)
  const load = useCallback(async () => {
    if (!map) return; const bbox = bboxOf(map); if (!bbox) return; const z = map.getZoom() ?? 0; setZoom(z);
    const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [s, j, k, p] = await Promise.all([api.storms(bbox, from, to), api.jobs(bbox), api.knocks(bbox), z >= PARCEL_MIN_ZOOM ? api.parcels(bbox) : Promise.resolve(EMPTY)]);
    setStorms(s); setJobs(j); setKnocks(k); setParcels(p);
  }, [map]);
  const loadDebounced = useMemo(() => debounce(() => { load().catch(console.error); }, 350), [load]);
  useEffect(() => { if (!map) return; const l = map.addListener('idle', loadDebounced); return () => l.remove(); }, [map, loadDebounced]);

  const openParcel = useCallback(async (id?: string, lngLat?: [number, number]) => {
    try { const c = id ? await api.parcel(id) : lngLat ? await api.parcelAt(lngLat[0], lngLat[1]) : null; if (c?.parcel) { setCard(c); setMode('card'); } } catch (e) { console.error(e); }
  }, []);
  // Click anywhere on the map → owner card for the house under the cursor. The API answers from the parcel cache first and only
  // calls Regrid when the spot is unknown, and we require a house-level zoom so a stray click on a neighbourhood doesn't bill anything.
  const onMapClick = useCallback((e: MapMouseEvent) => {
    if (drawing || !e.detail.latLng) return;
    if ((map?.getZoom() ?? 0) < PARCEL_MIN_ZOOM) { map?.setZoom(PARCEL_MIN_ZOOM + 1); map?.panTo(e.detail.latLng); return; } // zoom in toward the click instead of silently ignoring it
    openParcel(undefined, [e.detail.latLng.lng, e.detail.latLng.lat]);
  }, [drawing, map, openParcel]);

  const stormStyle = useCallback((f: google.maps.Data.Feature): google.maps.Data.StyleOptions => ({ fillColor: hailColor(f.getProperty('maxHailIn') as number), fillOpacity: 0.35, strokeColor: '#d7263d', strokeWeight: 1, strokeOpacity: 0.6, clickable: false }), []);
  // Note: Data layers need a visible fill to be hit-testable; 0.01 opacity only catches clicks on the stroke.
  const parcelStyle = useCallback((f: google.maps.Data.Feature): google.maps.Data.StyleOptions => ({ clickable: !drawing, cursor: 'pointer', ...(layers.heat
    ? { fillColor: yearColor(f.getProperty('yearBuilt') as number), fillOpacity: 0.55, strokeColor: '#8a847a', strokeWeight: 0.6 }
    : { fillColor: '#1f5fd6', fillOpacity: 0.06, strokeColor: '#8a847a', strokeWeight: 0.8 }) }), [layers.heat, drawing]);
  const onParcelClick = useCallback((f: google.maps.Data.Feature, latLng: google.maps.LatLng | null) => {
    const id = (f.getProperty('id') as string | undefined) ?? (f.getId() as string | undefined);
    if (id) openParcel(id); else if (latLng) openParcel(undefined, [latLng.lng(), latLng.lat()]);
  }, [openParcel]);
  const jobColor = useCallback((p: any) => STATUS_COLORS[p?.status] ?? '#1a9e5c', []); const knockColor = useCallback((p: any) => DISP_COLORS[p?.disposition] ?? '#9a958a', []);
  const jobTitle = useCallback((p: any) => `${p?.name ?? ''} · ${p?.status ?? ''}`, []);
  const onKnockClick = useCallback((p: any) => openParcel(p.parcelId), [openParcel]);
  const onPolygon = useCallback((p: GeoJSON.Polygon | null) => { setPolygon(p); if (p) setMode('lasso'); }, []);
  const clearAll = () => { setClearSignal(n => n + 1); setPolygon(null); setRoute(null); };

  return <div className="app">
    <aside className="side"><header>Storm<span>Route</span> · Manager</header>
      <div className="panel">
        {mode === 'card' && card && <OwnerCard card={card} onClose={() => setMode('lasso')} />}
        {mode === 'swath' && <RideSwath storms={storms.features} map={map} onRoute={setRoute} onClose={() => setMode('lasso')} />}
        {mode === 'lasso' && (polygon
          ? <LassoPanel polygon={polygon} map={map} onRoute={setRoute} onClear={clearAll} />
          : <><h2>Draw an area</h2><p className="sub">Use <b>Draw area</b> on the map to select houses, then build a knocking route or export a mail list. Click any house for its owner card{zoom < PARCEL_MIN_ZOOM ? ' (zoom in to see parcels)' : ''}.</p>
              {storms.features.length > 0 && <button className="btn" onClick={() => setMode('swath')}>Ride the swath · {storms.features.length} verified storm{storms.features.length > 1 ? 's' : ''} in view</button>}</>)}
      </div>
    </aside>
    <main className="map">
      <Map defaultCenter={{ lat: 33.62, lng: -86.61 }} defaultZoom={17} mapId={MAP_ID} gestureHandling="greedy" streetViewControl={false} mapTypeControl={false} fullscreenControl={false} clickableIcons={false} onClick={onMapClick} style={{ position: 'absolute', inset: 0 }}>
        <DataLayer data={storms} style={stormStyle} visible={layers.storms} zIndex={1} />
        <DataLayer data={parcels} style={parcelStyle} visible={layers.parcels || layers.heat} onClick={onParcelClick} zIndex={2} />
        <PointLayer data={jobs} color={jobColor} cluster visible={layers.jobs} title={jobTitle} />
        <PointLayer data={knocks} color={knockColor} size={9} visible={layers.knocks} onClick={onKnockClick} />
        <RouteLine geometry={route} />
      </Map>
      <div className="layers">
        <SearchBox />
        {(['storms', 'jobs', 'knocks', 'parcels', 'heat'] as const).map(k => <button key={k} className="chip" aria-pressed={layers[k]} onClick={() => setLayers(l => ({ ...l, [k]: !l[k] }))}>{{ storms: 'Storms', jobs: 'JobNimbus', knocks: 'Knocks', parcels: 'Parcels', heat: 'Roof age' }[k]}</button>)}
        <DrawControl onPolygon={onPolygon} onActiveChange={setDrawing} clearSignal={clearSignal} />
      </div>
    </main>
  </div>;
}
