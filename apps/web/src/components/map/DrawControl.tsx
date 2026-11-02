import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { polygonToGeoJSON } from '../../lib/mapUtil';

/**
 * Polygon lasso. Google removed DrawingManager in Maps JS 3.65, so this is hand-rolled:
 * click to add vertices, double-click (or "Finish") to close. The finished polygon stays editable/draggable and re-emits on change.
 */
export function DrawControl({ onPolygon, onActiveChange, clearSignal }: { onPolygon: (p: GeoJSON.Polygon | null) => void; onActiveChange?: (active: boolean) => void; clearSignal: number }) {
  const map = useMap();
  const [active, setActiveState] = useState(false); const [n, setN] = useState(0); const [hasPoly, setHasPoly] = useState(false);
  const setActive = (a: boolean) => { setActiveState(a); onActiveChange?.(a); };
  const draft = useRef<google.maps.Polyline>(); const poly = useRef<google.maps.Polygon>(); const listeners = useRef<google.maps.MapsEventListener[]>([]);
  const onPolygonRef = useRef(onPolygon); onPolygonRef.current = onPolygon;

  const emit = () => poly.current && onPolygonRef.current(polygonToGeoJSON(poly.current));
  const clearPoly = () => { poly.current?.setMap(null); poly.current = undefined; setHasPoly(false); onPolygonRef.current(null); };
  const stop = () => { listeners.current.forEach(l => l.remove()); listeners.current = []; draft.current?.setMap(null); draft.current = undefined; map?.setOptions({ draggableCursor: undefined, disableDoubleClickZoom: false }); setActive(false); setN(0); };
  const finish = () => {
    const path = draft.current?.getPath().getArray() ?? []; stop();
    if (!map || path.length < 3) return;
    clearPoly();
    const p = new google.maps.Polygon({ map, paths: path, fillColor: '#1f5fd6', fillOpacity: 0.12, strokeColor: '#1f5fd6', strokeWeight: 2, editable: true, draggable: true, zIndex: 5 });
    poly.current = p; setHasPoly(true); emit();
    const ring = p.getPath(); ring.addListener('set_at', emit); ring.addListener('insert_at', emit); ring.addListener('remove_at', emit); p.addListener('dragend', emit);
  };
  const start = () => {
    if (!map) return; clearPoly();
    const line = new google.maps.Polyline({ map, strokeColor: '#1f5fd6', strokeWeight: 2, strokeOpacity: 0.9, zIndex: 6, icons: [{ icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4, fillColor: '#fff', fillOpacity: 1, strokeColor: '#1f5fd6', strokeWeight: 2 }, offset: '0', repeat: '0' }] });
    draft.current = line; setActive(true); setN(0);
    map.setOptions({ draggableCursor: 'crosshair', disableDoubleClickZoom: true });
    listeners.current.push(
      map.addListener('click', (e: google.maps.MapMouseEvent) => { if (e.latLng) { line.getPath().push(e.latLng); setN(line.getPath().getLength()); } }),
      map.addListener('dblclick', () => finish()),
    );
  };
  useEffect(() => { if (clearSignal) { stop(); clearPoly(); } }, [clearSignal]);
  useEffect(() => () => { stop(); poly.current?.setMap(null); }, [map]);
  useEffect(() => { if (!active) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); if (e.key === 'Enter') finish(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [active]);

  return <div className="draw-tools">
    {!active && <button className="chip" onClick={start} title="Click points around the houses you want; double-click to close">⬠ Draw area</button>}
    {active && <><span className="chip" aria-pressed="true">{n < 3 ? `Click to add points (${n}/3 min)` : `${n} points · double-click or Finish`}</span>
      <button className="chip" disabled={n < 3} onClick={finish}>Finish</button><button className="chip" onClick={stop}>Esc</button></>}
    {hasPoly && !active && <button className="chip" onClick={clearPoly}>✕ Clear area</button>}
  </div>;
}

