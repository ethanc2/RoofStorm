import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polygon, Polyline, Marker, type Region, type MapPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as turf from '@turf/turf';
import { api } from '../lib/api';
import { flush } from '../lib/offlineQueue';
import { C } from '../lib/theme';
import { useClusters, regionToBbox, regionZoom } from '../lib/useClusters';
import { OwnerCard } from '../components/OwnerCard';
import { LassoSheet } from '../components/LassoSheet';
import { DrawOverlay } from '../components/DrawOverlay';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const PARCEL_MIN_ZOOM = 16;
const hailColor = (h: number) => h >= 2.5 ? C.hail3 : h >= 1.5 ? C.hail2 : C.hail1;
const withAlpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
const ring = (coords: number[][]) => coords.map(c => ({ latitude: c[1], longitude: c[0] }));
/** Flatten (Multi)Polygon → list of outer rings; holes dropped for rendering simplicity */
const rings = (g: GeoJSON.Geometry): { latitude: number; longitude: number }[][] => g.type === 'Polygon' ? [ring(g.coordinates[0])] : g.type === 'MultiPolygon' ? g.coordinates.map(p => ring(p[0])) : [];

export function MapScreen() {
  const insets = useSafeAreaInsets(); const mapRef = useRef<MapView>(null); const mapLayout = useRef({ x: 0, y: 0 });
  const [storms, setStorms] = useState(EMPTY); const [jobs, setJobs] = useState(EMPTY); const [knocks, setKnocks] = useState(EMPTY); const [parcels, setParcels] = useState(EMPTY);
  const [layers, setLayers] = useState({ storms: true, jobs: true, knocks: true, parcels: true });
  const [region, setRegion] = useState<Region | null>(null);
  const [card, setCard] = useState<any>(null); const [drawing, setDrawing] = useState(false);
  const [selection, setSelection] = useState<{ polygon: GeoJSON.Polygon; jobs: GeoJSON.Feature[]; knocks: GeoJSON.Feature[] } | null>(null);
  const [route, setRoute] = useState<GeoJSON.LineString | null>(null);

  const load = useCallback(async (r: Region) => {
    const bbox = regionToBbox(r); const z = regionZoom(r);
    const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    try {
      const [s, j, k, p] = await Promise.all([api.storms(bbox, from, to), api.jobs(bbox), api.knocks(bbox), z >= PARCEL_MIN_ZOOM ? api.parcels(bbox) : Promise.resolve(EMPTY)]);
      setStorms(s); setJobs(j); setKnocks(k); setParcels(p);
    } catch (e) { console.warn('load failed', e); }
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const onRegionChangeComplete = (r: Region) => { setRegion(r); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(r), 300); };
  useEffect(() => { flush(); }, []);
  const reload = useCallback(() => { if (region) load(region); }, [region, load]);

  const jobItems = useClusters(jobs, region); const zoom = region ? regionZoom(region) : 14;

  const openParcel = async (id?: string, lngLat?: [number, number]) => {
    try { const c = id ? await api.parcel(id) : lngLat ? await api.parcelAt(lngLat[0], lngLat[1]) : null; if (c?.parcel) setCard(c); } catch (err) { console.warn(err); }
  };
  const onPress = (e: MapPressEvent) => { if (drawing || zoom < PARCEL_MIN_ZOOM + 1) return; const { latitude, longitude } = e.nativeEvent.coordinate; openParcel(undefined, [longitude, latitude]); };
  const onLasso = (pts: [number, number][]) => { setDrawing(false); if (pts.length < 8) return; const polygon = turf.polygon([[...pts, pts[0]]]).geometry;
    const inside = (fc: GeoJSON.FeatureCollection) => fc.features.filter(f => turf.booleanPointInPolygon((f.geometry as GeoJSON.Point).coordinates, polygon));
    setSelection({ polygon, jobs: inside(jobs), knocks: inside(knocks) }); };

  const stormPolys = useMemo(() => storms.features.flatMap((f, i) => rings(f.geometry).map((r, j) => ({ key: `s${i}-${j}`, coords: r, color: hailColor(Number(f.properties?.maxHailIn ?? 0)) }))), [storms]);
  const parcelPolys = useMemo(() => parcels.features.flatMap((f, i) => rings(f.geometry).map((r, j) => ({ key: `p${f.properties?.id ?? i}-${j}`, id: f.properties?.id as string, coords: r }))), [parcels]);
  const zoomInto = (lngLat: [number, number]) => mapRef.current?.animateToRegion({ latitude: lngLat[1], longitude: lngLat[0], latitudeDelta: (region?.latitudeDelta ?? 0.02) / 3, longitudeDelta: (region?.longitudeDelta ?? 0.02) / 3 }, 250);

  return <View style={{ flex: 1 }}>
    <MapView ref={mapRef} provider={PROVIDER_GOOGLE} style={{ flex: 1 }} onLayout={e => { mapLayout.current = { x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y }; }}
      initialRegion={{ latitude: 33.62, longitude: -86.61, latitudeDelta: 0.02, longitudeDelta: 0.02 }} onRegionChangeComplete={onRegionChangeComplete} onPress={onPress}
      showsUserLocation showsMyLocationButton={false} showsCompass={false} toolbarEnabled={false} scrollEnabled={!drawing} zoomEnabled={!drawing} rotateEnabled={false} pitchEnabled={false}>
      {layers.storms && stormPolys.map(p => <Polygon key={p.key} coordinates={p.coords} fillColor={withAlpha(p.color, 0.35)} strokeColor={withAlpha(C.hail3, 0.6)} strokeWidth={1} tappable={false} />)}
      {layers.parcels && parcelPolys.map(p => <Polygon key={p.key} coordinates={p.coords} fillColor="rgba(0,0,0,0.01)" strokeColor="#8a847a" strokeWidth={0.7} tappable={!drawing} onPress={() => openParcel(p.id)} />)}
      {layers.jobs && jobItems.map(it => it.kind === 'cluster'
        ? <Marker key={`c${it.id}`} coordinate={{ latitude: it.lngLat[1], longitude: it.lngLat[0] }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={() => zoomInto(it.lngLat)}>
            <View style={s.cluster}><Text style={s.clusterText}>{it.count}</Text></View></Marker>
        : <Marker key={`j${it.feature.properties?.jnid}`} coordinate={{ latitude: it.lngLat[1], longitude: it.lngLat[0] }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={it.feature.properties?.name} description={it.feature.properties?.status}>
            <View style={[s.dot, { backgroundColor: C.status[it.feature.properties?.status] ?? C.status.Signed }]} /></Marker>)}
      {layers.knocks && knocks.features.map(f => { const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        return <Marker key={`k${f.properties?.parcelId}`} coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={() => openParcel(f.properties?.parcelId)}>
          <View style={[s.dot, s.dotSmall, { backgroundColor: C.disp[f.properties?.disposition] ?? C.disp.not_home }]} /></Marker>; })}
      {route && <Polyline coordinates={ring(route.coordinates)} strokeColor={C.route} strokeWidth={4} lineJoin="round" lineCap="round" />}
    </MapView>

    {drawing && <DrawOverlay mapRef={mapRef} offset={mapLayout.current} onDone={onLasso} onCancel={() => setDrawing(false)} />}

    <View style={[s.chips, { top: insets.top + 8 }]}>
      {(['storms', 'jobs', 'knocks', 'parcels'] as const).map(k => <Pressable key={k} onPress={() => setLayers(l => ({ ...l, [k]: !l[k] }))} style={[s.chip, !layers[k] && { opacity: .55 }]}><Text style={s.chipText}>{{ storms: 'Storms · 30d', jobs: 'JobNimbus', knocks: 'Knocks', parcels: 'Parcels' }[k]}</Text></Pressable>)}
    </View>
    <Pressable style={[s.fab, { bottom: insets.bottom + 24 }]} onPress={() => { setCard(null); setSelection(null); setDrawing(true); }}><Text style={s.fabText}>Draw</Text></Pressable>

    {card && <OwnerCard card={card} onClose={() => setCard(null)} onChanged={reload} />}
    {selection && <LassoSheet selection={selection} onRoute={setRoute} onClose={() => setSelection(null)} />}
  </View>;
}
const s = StyleSheet.create({
  chips: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.line },
  chipText: { fontWeight: '600', fontSize: 13, color: C.ink },
  fab: { position: 'absolute', right: 16, width: 64, height: 48, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { color: '#fff', fontWeight: '700' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: '#fff' }, dotSmall: { width: 10, height: 10, borderRadius: 5 },
  cluster: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.status.Signed, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }, clusterText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
