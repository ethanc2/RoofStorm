import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toLngLat } from '../lib/mapUtil';
/** Streets under the newest verified storm, ranked by hail × roof age × occupancy (spec F8). */
export function RideSwath({ storms, map, onRoute, onClose }: { storms: GeoJSON.Feature[]; map: google.maps.Map | null; onRoute: (g: GeoJSON.LineString | null) => void; onClose: () => void }) {
  const newest = [...storms].sort((a, b) => String(b.properties!.eventDate).localeCompare(String(a.properties!.eventDate)))[0];
  const [streets, setStreets] = useState<any[] | null>(null); const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (newest) api.streets(newest.properties!.id).then(setStreets).catch(console.error); }, [newest?.properties?.id]);
  const routeStreet = async (s: any) => {
    setBusy(s.street);
    try {
      const parcels = await api.parcelsByIds(s.parcel_ids);
      if (!parcels.length) return alert('No parcels for this street are cached yet.');
      const c = map?.getCenter(); const start: [number, number] = c ? toLngLat(c) : [parcels[0].lng, parcels[0].lat];
      const r = await api.optimize({ stops: parcels.map(p => ({ lngLat: [p.lng, p.lat], label: p.site_address, parcelId: p.id })), start, roundTrip: true, mode: 'walking' });
      onRoute(r.geometry ?? { type: 'LineString', coordinates: [start, ...r.order.map(i => [parcels[i].lng, parcels[i].lat]), start] });
    } catch (e) { alert(`Could not route: ${e}`); } finally { setBusy(null); }
  };
  if (!newest) return <div className="sub">No storms in view.</div>;
  const p = newest.properties!;
  return <div>
    <h2>Ride the swath</h2><div className="sub">Verified {p.eventDate} · hail to {p.maxHailIn}"</div>
    <div className="sub" style={{ marginTop: 6 }}>Priority = hail × roof-age factor × owner-occupied. Signed homes and streets knocked in the last 48 h drop out.</div>
    {!streets ? <div className="sub">Ranking streets…</div> : streets.map(s => <div className="stop" key={s.street}><span className="n" style={{ background: s.score >= 1.8 ? '#d7263d' : s.score >= 1.2 ? '#f4883c' : '#c9a227', width: 36, borderRadius: 8 }}>{s.score}</span>
      <span style={{ flex: 1 }}>{s.street}<small>{s.homes} homes · up to {Number(s.max_hail_in).toFixed(1)}" · roofs avg {s.avg_roof_age ?? '?'} yrs · {s.owner_occupied} owner-occupied</small></span><button className="chip" disabled={!!busy} onClick={() => routeStreet(s)}>{busy === s.street ? '…' : 'Route'}</button></div>)}
    <button className="btn quiet" onClick={onClose}>Close</button>
  </div>;
}

