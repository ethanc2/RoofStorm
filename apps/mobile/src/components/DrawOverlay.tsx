import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type MapView from 'react-native-maps';
import { C } from '../lib/theme';
/**
 * Freehand lasso: captures screen points, converts to lng/lat through the map on release.
 * `offset` is the MapView's position in the window so pageX/pageY become view-relative (fixes status-bar drift on Android).
 */
export function DrawOverlay({ mapRef, offset, onDone, onCancel }: { mapRef: React.RefObject<MapView>; offset: { x: number; y: number }; onDone: (pts: [number, number][]) => void; onCancel: () => void }) {
  const pts = useRef<[number, number][]>([]); const [d, setD] = useState('');
  const toPath = () => 'M' + pts.current.map(p => p.join(' ')).join('L') + 'Z';
  const release = async () => {
    const sampled = pts.current.filter((_, i, a) => i % 3 === 0 || i === a.length - 1); // one bridge call per ~3 points is plenty for a lasso
    const coords: [number, number][] = [];
    for (const [x, y] of sampled) { const c = await mapRef.current?.coordinateForPoint({ x: x - offset.x, y: y - offset.y }); if (c) coords.push([c.longitude, c.latitude]); }
    onDone(coords);
  };
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={e => { pts.current = [[e.nativeEvent.pageX, e.nativeEvent.pageY]]; setD(toPath()); }}
      onResponderMove={e => { pts.current.push([e.nativeEvent.pageX, e.nativeEvent.pageY]); setD(toPath()); }}
      onResponderRelease={release}>
      <Svg style={StyleSheet.absoluteFill}><Path d={d} fill={C.accent} fillOpacity={0.12} stroke={C.accent} strokeWidth={2} strokeDasharray="6 4" /></Svg>
    </View>
    <View style={s.bar}><Text style={s.barText}>Draw around the houses you want.</Text><Pressable onPress={onCancel}><Text style={s.cancel}>Cancel</Text></Pressable></View>
  </View>;
}
const s = StyleSheet.create({ bar: { position: 'absolute', top: 100, left: 12, right: 12, backgroundColor: C.ink, borderRadius: 14, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, barText: { color: '#fff', fontWeight: '500' }, cancel: { color: '#fff', fontWeight: '700' } });

