import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { api } from '../lib/api';
import { C } from '../lib/theme';
/** Rep-side lasso: route the pins already on screen (callbacks, not-homes, leads). Full parcel extraction is manager-only in the web app. */
export function LassoSheet({ selection, onRoute, onClose }: { selection: { polygon: GeoJSON.Polygon; jobs: GeoJSON.Feature[]; knocks: GeoJSON.Feature[] }; onRoute: (line: GeoJSON.LineString) => void; onClose: () => void }) {
  const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false);
  const stops = [...selection.knocks.filter(k => ['callback', 'not_home'].includes(k.properties!.disposition)), ...selection.jobs.filter(j => j.properties!.status === 'Lead')];
  const run = async () => { setBusy(true); try {
    const { status } = await Location.requestForegroundPermissionsAsync(); const loc = status === 'granted' ? await Location.getCurrentPositionAsync({}) : null;
    const start: [number, number] = loc ? [loc.coords.longitude, loc.coords.latitude] : (stops[0].geometry as GeoJSON.Point).coordinates as [number, number];
    const r = await api.optimize({ stops: stops.map(f => ({ lngLat: (f.geometry as GeoJSON.Point).coordinates, label: f.properties!.address ?? f.properties!.parcelId, parcelId: f.properties!.parcelId, jobJnid: f.properties!.jnid })), start, roundTrip: true, mode: 'walking' });
    setResult({ ...r, stops: r.order.map((i: number) => stops[i]) }); onRoute(r.geometry ?? { type: 'LineString', coordinates: [start, ...r.order.map((i: number) => (stops[i].geometry as GeoJSON.Point).coordinates), start] });
  } finally { setBusy(false); } };
  return <View style={s.sheet}><ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 32 }}>
    <Text style={s.h2}>{stops.length} stops selected</Text><Text style={s.sub}>{selection.knocks.length} knocked · {selection.jobs.length} JobNimbus jobs inside the area</Text>
    <Pressable style={s.go} onPress={run} disabled={busy || !stops.length}><Text style={s.goText}>{busy ? 'Optimizing…' : 'Optimize walking route'}</Text></Pressable>
    {result && <><Text style={s.sub}>{(result.distanceM / 1609).toFixed(1)} mi · {Math.round(result.durationS / 60)} min</Text>
      {result.stops.map((f: any, i: number) => <View key={i} style={s.stop}><View style={s.n}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{i + 1}</Text></View><Text>{f.properties.address ?? f.properties.disposition}</Text></View>)}</>}
    <Pressable style={s.quiet} onPress={onClose}><Text style={{ fontWeight: '700' }}>Close</Text></Pressable>
  </ScrollView></View>;
}
const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%', backgroundColor: C.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, elevation: 12 },
  h2: { fontSize: 22, fontWeight: '700' }, sub: { color: C.ink2, fontSize: 13 },
  go: { backgroundColor: C.accent, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 12 }, goText: { color: '#fff', fontWeight: '700' },
  quiet: { backgroundColor: C.surface2, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 },
  stop: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line }, n: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.route, alignItems: 'center', justifyContent: 'center' },
});
