import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { api } from '../../lib/api';
import { debounce, toLngLat } from '../../lib/mapUtil';

/** Address search through the API (Places Autocomplete → Details). A session token groups the calls for billing. */
export function SearchBox({ onPick }: { onPick?: (lngLat: [number, number]) => void }) {
  const map = useMap(); const [q, setQ] = useState(''); const [items, setItems] = useState<{ placeId: string; text: string; main?: string; secondary?: string }[]>([]);
  const session = useRef(crypto.randomUUID()); const [open, setOpen] = useState(false);
  const search = useRef(debounce(async (text: string) => {
    if (text.length < 3) return setItems([]);
    const c = map?.getCenter(); try { setItems(await api.autocomplete(text, c ? toLngLat(c) : undefined, session.current)); setOpen(true); } catch (e) { console.warn(e); }
  }, 250)).current;
  useEffect(() => { search(q); }, [q]);
  const pick = async (placeId: string) => {
    const p = await api.place(placeId, session.current); session.current = crypto.randomUUID(); setOpen(false); setQ(p.formatted);
    if (map) { if (p.bbox) map.fitBounds({ west: p.bbox[0], south: p.bbox[1], east: p.bbox[2], north: p.bbox[3] }); else map.setCenter({ lat: p.lngLat[1], lng: p.lngLat[0] }); if ((map.getZoom() ?? 0) < 17) map.setZoom(17); }
    onPick?.(p.lngLat);
  };
  return <div className="search">
    <input className="f" placeholder="Search an address…" value={q} onChange={e => setQ(e.target.value)} onFocus={() => items.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
    {open && items.length > 0 && <ul className="search-list">{items.map(i => <li key={i.placeId} onMouseDown={() => pick(i.placeId)}><b>{i.main ?? i.text}</b>{i.secondary && <small> {i.secondary}</small>}</li>)}</ul>}
  </div>;
}
