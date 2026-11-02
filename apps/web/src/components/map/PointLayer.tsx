import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer';

const dot = (color: string, size: number) => { const el = document.createElement('div'); el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)`; return el; };

/** Point features as AdvancedMarkers (requires a vector Map ID); optionally clustered. */
export function PointLayer({ data, color, size = 12, cluster = false, visible = true, onClick, title }: {
  data: GeoJSON.FeatureCollection; color: (props: any) => string; size?: number; cluster?: boolean; visible?: boolean; onClick?: (props: any, lngLat: [number, number]) => void; title?: (props: any) => string;
}) {
  const map = useMap(); const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]); const clusterer = useRef<MarkerClusterer>();
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    (async () => {
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker') as google.maps.MarkerLibrary; if (cancelled) return;
      markers.current.forEach(m => { m.map = null; }); clusterer.current?.clearMarkers();
      markers.current = data.features.filter(f => f.geometry.type === 'Point').map(f => {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const m = new AdvancedMarkerElement({ position: { lat, lng }, content: dot(color(f.properties), size), title: title?.(f.properties) });
        if (onClick) m.addListener('click', () => onClick(f.properties, [lng, lat]));
        return m;
      });
      if (!visible) return;
      if (cluster) { clusterer.current ??= new MarkerClusterer({ map, algorithm: new SuperClusterAlgorithm({ radius: 60, maxZoom: 15 }) }); clusterer.current.addMarkers(markers.current); }
      else markers.current.forEach(m => { m.map = map; });
    })();
    return () => { cancelled = true; };
  }, [map, data, visible, cluster, color, size, onClick, title]);
  useEffect(() => () => { markers.current.forEach(m => { m.map = null; }); clusterer.current?.setMap(null); }, []);
  return null;
}
