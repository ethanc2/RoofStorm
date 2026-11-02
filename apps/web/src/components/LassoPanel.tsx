import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toLngLat } from '../lib/mapUtil';

export function LassoPanel({ polygon, map, onRoute, onClear }: { polygon: GeoJSON.Polygon; map: google.maps.Map | null; onRoute: (g: GeoJSON.LineString | null) => void; onClear: () => void }) {
  const [parcels, setParcels] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'route' | 'mail'>('route');
  useEffect(() => { let live = true; setParcels(null); setErr(null); api.within(polygon).then(p => live && setParcels(p)).catch(e => live && setErr(String(e))); return () => { live = false; }; }, [polygon]);
  if (err) return <div className="sub">Couldn't load parcels: {err}</div>;
  if (!parcels) return <div className="sub">Finding houses inside the area… (first time in a neighbourhood this pulls parcel data from Regrid)</div>;
  const occ = parcels.filter(p => p.owner_occupied).length, hail = parcels.filter(p => p.hail_in >= 0.75).length;
  return <div>
    <h2>{parcels.length} houses selected</h2>
    <div className="counts"><span>{hail} under hail ≥ 0.75"</span><span>{occ} owner-occupied</span><span>{parcels.length - occ} absentee</span></div>
    <div className="counts"><button className="chip" aria-pressed={tab === 'route'} onClick={() => setTab('route')}>Knocking route</button><button className="chip" aria-pressed={tab === 'mail'} onClick={() => setTab('mail')}>Mail list</button></div>
    {tab === 'route' ? <RouteBuilder parcels={parcels} polygon={polygon} map={map} onRoute={onRoute} /> : <MailBuilder polygon={polygon} />}
    <button className="btn quiet" onClick={onClear}>Clear selection</button>
  </div>;
}

function RouteBuilder({ parcels, polygon, map, onRoute }: { parcels: any[]; polygon: GeoJSON.Polygon; map: google.maps.Map | null; onRoute: (g: GeoJSON.LineString | null) => void }) {
  const [occOnly, setOccOnly] = useState(true); const [mode, setMode] = useState<'walking' | 'driving'>('walking'); const [roundTrip, setRoundTrip] = useState(true);
  const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false); const [start, setStart] = useState<[number, number] | null>(null);
  const stops = parcels.filter((p: any) => !occOnly || p.owner_occupied);
  const run = async () => { setBusy(true); try {
    // Start = map centre (where the manager is looking); the rep's phone overrides with GPS when they run it live
    const c = map?.getCenter(); const s: [number, number] = c ? toLngLat(c) : [stops[0].lng, stops[0].lat]; setStart(s);
    const body = { stops: stops.map((p: any) => ({ lngLat: [p.lng, p.lat], label: p.site_address, parcelId: p.id })), start: s, roundTrip, mode };
    const r = await api.optimize(body); setResult({ ...r, stops: r.order.map(i => stops[i]) }); onRoute(r.geometry ?? { type: 'LineString', coordinates: [s, ...r.order.map(i => [stops[i].lng, stops[i].lat]), ...(roundTrip ? [s] : [])] });
  } catch (e) { alert(`Could not optimize: ${e}`); } finally { setBusy(false); } };
  const save = async () => { await api.saveRoute({ name: `Route · ${new Date().toLocaleDateString()}`, mode, start: start ?? [0, 0], end: roundTrip ? start : null, totalM: result.distanceM, totalS: result.durationS, stops: result.stops.map((p: any, i: number) => ({ parcelId: p.id, label: p.site_address, lngLat: [p.lng, p.lat], order: i, done: false })), polygon }); alert('Route saved'); };
  return <div>
    <label className="check"><input type="checkbox" checked={occOnly} onChange={e => setOccOnly(e.target.checked)} /> Owner-occupied only ({stops.length} stops)</label>
    <label className="check"><input type="checkbox" checked={roundTrip} onChange={e => setRoundTrip(e.target.checked)} /> Return to start</label>
    <label className="f">Mode<select className="f" value={mode} onChange={e => setMode(e.target.value as any)}><option value="walking">Walking</option><option value="driving">Driving</option></select></label>
    <button className="btn" disabled={busy || !stops.length} onClick={run}>{busy ? 'Optimizing…' : 'Optimize route'}</button>
    {result && <><div className="counts"><span>{result.stops.length} stops</span><span>{(result.distanceM / 1609).toFixed(1)} mi</span><span>{Math.round(result.durationS / 60)} min</span><span title="google = Routes API · google-ro = Route Optimization API · local = on-server estimate">{result.solver}</span></div>
      {result.stops.map((p: any, i: number) => <div className="stop" key={p.id}><span className="n">{i + 1}</span><span>{p.site_address}<small>{p.owner_name}{p.hail_in ? ` · ${Number(p.hail_in).toFixed(2)}" hail` : ''}</small></span></div>)}
      <button className="btn" onClick={save}>Save and assign</button></>}
  </div>;
}

function MailBuilder({ polygon }: { polygon: GeoJSON.Polygon }) {
  const [f, setF] = useState({ ownerOccupiedOnly: false, minHailIn: 0.75, excludeJnContacts: true, excludeDoNotKnock: true });
  const [quote, setQuote] = useState<any>(null); const [csv, setCsv] = useState<string | null>(null); const [csvUrl, setCsvUrl] = useState<string | null>(null);
  useEffect(() => { setQuote(null); api.mailQuote(polygon, f).then(setQuote).catch(console.error); }, [polygon, f]);
  useEffect(() => { if (!csv) return; const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); setCsvUrl(u); return () => URL.revokeObjectURL(u); }, [csv]);
  const run = async () => { const c = await api.mailCreate(`Mail · ${new Date().toLocaleDateString()}`, polygon, f); setCsv(await api.mailCsv(c.id)); };
  return <div>
    <label className="check"><input type="checkbox" checked={f.ownerOccupiedOnly} onChange={e => setF({ ...f, ownerOccupiedOnly: e.target.checked })} /> Owner-occupied only</label>
    <label className="check"><input type="checkbox" checked={f.excludeJnContacts} onChange={e => setF({ ...f, excludeJnContacts: e.target.checked })} /> Exclude existing JobNimbus contacts</label>
    <label className="f">Hail ≥ {f.minHailIn}"<input className="f" type="range" min={0} max={2.5} step={0.25} value={f.minHailIn} onChange={e => setF({ ...f, minHailIn: +e.target.value })} /></label>
    {quote && <div className="counts"><span>{quote.rowCount} addresses after dedupe</span><span>{quote.swathCredits} Swath credits</span></div>}
    <button className="btn" disabled={!quote?.rowCount} onClick={run}>Generate list</button>
    {csv && <><pre className="csv">{csv}</pre>{csvUrl && <a className="btn" download="mail-list.csv" href={csvUrl} style={{ textAlign: 'center', textDecoration: 'none' }}>Download CSV</a>}</>}
  </div>;
}
