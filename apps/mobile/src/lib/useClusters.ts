import { useMemo } from 'react';
import Supercluster from 'supercluster';
import type { Region } from 'react-native-maps';

export type ClusterItem = { kind: 'cluster'; id: number; count: number; lngLat: [number, number] } | { kind: 'point'; feature: GeoJSON.Feature<GeoJSON.Point>; lngLat: [number, number] };

/** Clusters point features for the current region. Pure client-side (supercluster), recomputed on region change. */
export function useClusters(fc: GeoJSON.FeatureCollection, region: Region | null, radius = 50, maxZoom = 15): ClusterItem[] {
  const index = useMemo(() => {
    const sc = new Supercluster<GeoJSON.GeoJsonProperties, GeoJSON.GeoJsonProperties>({ radius, maxZoom });
    sc.load(fc.features.filter(f => f.geometry.type === 'Point') as GeoJSON.Feature<GeoJSON.Point>[]);
    return sc;
  }, [fc, radius, maxZoom]);
  return useMemo(() => {
    if (!region) return [];
    const zoom = Math.round(Math.log2(360 / region.longitudeDelta));
    const bbox: [number, number, number, number] = [region.longitude - region.longitudeDelta, region.latitude - region.latitudeDelta, region.longitude + region.longitudeDelta, region.latitude + region.latitudeDelta];
    return index.getClusters(bbox, zoom).map(f => {
      const lngLat = f.geometry.coordinates as [number, number];
      return f.properties && (f.properties as any).cluster
        ? { kind: 'cluster' as const, id: (f.properties as any).cluster_id as number, count: (f.properties as any).point_count as number, lngLat }
        : { kind: 'point' as const, feature: f as GeoJSON.Feature<GeoJSON.Point>, lngLat };
    });
  }, [index, region]);
}
export const regionToBbox = (r: Region) => [r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2].join(',');
export const regionZoom = (r: Region) => Math.log2(360 / r.longitudeDelta);
