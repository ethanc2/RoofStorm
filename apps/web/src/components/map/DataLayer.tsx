import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

/** A google.maps.Data layer fed by a GeoJSON FeatureCollection. Re-styles when `style` changes, swaps features when `data` changes. */
export function DataLayer({ data, style, visible = true, onClick, zIndex = 1 }: {
  data: GeoJSON.FeatureCollection; style: (f: google.maps.Data.Feature) => google.maps.Data.StyleOptions; visible?: boolean;
  onClick?: (f: google.maps.Data.Feature, latLng: google.maps.LatLng | null) => void; zIndex?: number;
}) {
  const map = useMap(); const [layer, setLayer] = useState<google.maps.Data | null>(null);
  const onClickRef = useRef(onClick); onClickRef.current = onClick;
  // Create the layer once per map. Click handler reads through a ref so it never needs re-binding.
  useEffect(() => {
    if (!map) return;
    const l = new google.maps.Data({ map });
    const h = l.addListener('click', (e: google.maps.Data.MouseEvent) => { onClickRef.current?.(e.feature, e.latLng); });
    setLayer(l);
    return () => { h.remove(); l.setMap(null); setLayer(null); };
  }, [map]);
  useEffect(() => { if (!layer) return; layer.forEach(f => layer.remove(f)); layer.addGeoJson(data as any); }, [layer, data]);
  useEffect(() => { layer?.setStyle(f => ({ ...style(f), visible, zIndex })); }, [layer, style, visible, zIndex, data]);
  return null;
}

export function RouteLine({ geometry, color = '#0f766e' }: { geometry: GeoJSON.LineString | null; color?: string }) {
  const map = useMap(); const [line, setLine] = useState<google.maps.Polyline | null>(null);
  useEffect(() => { if (!map) return; const p = new google.maps.Polyline({ map, strokeColor: color, strokeWeight: 4, strokeOpacity: 0.9, zIndex: 10, clickable: false }); setLine(p); return () => { p.setMap(null); setLine(null); }; }, [map, color]);
  useEffect(() => { line?.setPath(geometry ? geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] })) : []); }, [line, geometry]);
  return null;
}
