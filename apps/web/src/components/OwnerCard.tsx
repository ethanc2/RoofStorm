import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const compass = (deg: number | null) => deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
const pitchLabel = (deg: number | null) => deg == null ? null : `${Math.round(Math.tan(deg * Math.PI / 180) * 12)}/12 (${deg}°)`;

export function OwnerCard({ card, onClose }: { card: any; onClose: () => void }) {
  const p = card.parcel, s = card.lastStorm, roof = card.roof;
  const [photo, setPhoto] = useState<string | null | undefined>(undefined); // undefined = loading, null = none
  useEffect(() => {
    let url: string | null = null, live = true;
    if (!card.streetViewUrl) { setPhoto(null); return; }
    setPhoto(undefined); api.streetView(p.id).then(u => { if (!live) { if (u) URL.revokeObjectURL(u); return; } url = u; setPhoto(u); }).catch(() => live && setPhoto(null));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [p.id, card.streetViewUrl]);
  return <div>
    {photo === undefined ? <div className="photo skeleton" /> : photo ? <img className="photo" src={photo} alt={`Street View of ${p.site_address}`} /> : null}
    <h2>{p.site_address}</h2><div className="sub">{p.city}, {p.state} {p.zip}{p.year_built ? ` · built ${p.year_built}` : ''}</div>
    <h3>Storm</h3>
    <div>{s ? <><b>{s.hailIn ? `${Number(s.hailIn).toFixed(2)}" hail` : `${s.gustMph} mph wind`}</b> · verified {s.eventDate}</> : 'No verified storm in the stored window'}</div>
    <h3>Roof</h3>
    {roof ? <div className="counts">
      {roof.roofAreaSqft ? <span>{roof.roofAreaSqft.toLocaleString()} sq ft · {(roof.roofAreaSqft / 100).toFixed(1)} sq</span> : null}
      {pitchLabel(roof.pitchDeg) && <span>pitch {pitchLabel(roof.pitchDeg)}</span>}
      {roof.segmentCount ? <span>{roof.segmentCount} facets{roof.dominantAzimuthDeg != null ? ` · faces ${compass(roof.dominantAzimuthDeg)}` : ''}</span> : null}
      {roof.imageryDate && <span title={`imagery quality ${roof.imageryQuality ?? '?'}`}>aerial {roof.imageryDate}</span>}
    </div> : <div className="sub">No roof model available (Solar API has no coverage here)</div>}
    <h3>Owner</h3>
    <div><b>{p.owner_name ?? 'Unknown'}</b></div>
    <div className="sub">{p.owner_occupied === false ? `Absentee · mails to ${p.mailing_address}` : p.owner_occupied ? 'Owner-occupied' : 'Occupancy unknown'}</div>
    {card.jobs.length > 0 && <><h3>JobNimbus</h3>{card.jobs.map((j: any) => <div key={j.jnid}><b>{j.jnid} · {j.statusName}</b><div className="sub">{j.salesRep}</div></div>)}</>}
    {card.knocks.length > 0 && <><h3>Knock history</h3>{card.knocks.map((k: any) => <div key={k.id} className="sub">{new Date(k.created_at).toLocaleDateString()} · {k.disposition.replace('_', ' ')} · {k.user_name}{k.note ? ` · ${k.note}` : ''}</div>)}</>}
    <button className="btn quiet" onClick={onClose}>Close</button>
  </div>;
}

