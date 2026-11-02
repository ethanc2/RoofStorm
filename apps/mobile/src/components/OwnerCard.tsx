import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, Image } from 'react-native';
import { api } from '../lib/api';
import { enqueue } from '../lib/offlineQueue';
import { C } from '../lib/theme';
import type { Disposition } from '@stormroute/shared';
const LABEL: Record<Disposition, string> = { not_home: 'Not home', not_interested: 'Not interested', callback: 'Callback', do_not_knock: 'Do not knock', inspection_set: 'Inspection set' };
// Hermes (RN 0.76 / Expo 52) exposes crypto.randomUUID; fall back to a Math.random v4 (server validates clientId as a UUID)
const uuid = (): string => (globalThis as any).crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
const compass = (deg: number | null) => deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
const pitch12 = (deg: number | null) => deg == null ? null : `${Math.round(Math.tan(deg * Math.PI / 180) * 12)}/12`;

export function OwnerCard({ card, onClose, onChanged }: { card: any; onClose: () => void; onChanged: () => void }) {
  const p = card.parcel, st = card.lastStorm, roof = card.roof; const [form, setForm] = useState<any>(null); const [photoOk, setPhotoOk] = useState(!!card.streetViewUrl);
  const dnk = card.knocks[0]?.disposition === 'do_not_knock';
  const log = (disposition: Disposition) => { enqueue('/v1/knocks', { parcelId: p.id, clientId: uuid(), disposition }); onClose(); setTimeout(onChanged, 800); };
  const createInspection = () => { enqueue('/v1/inspections', { parcelId: p.id, clientId: uuid(), ...form, scheduledAt: new Date(form.scheduledAt).toISOString() }); onClose(); setTimeout(onChanged, 800); };
  const [first = '', ...rest] = (p.owner_name ?? '').split(' & ')[0].split(' ');
  return <View style={s.sheet}><ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 32 }}>
    {photoOk && <Image source={api.streetViewSource(p.id)} style={s.photo} resizeMode="cover" onError={() => setPhotoOk(false)} accessibilityLabel={`Street View of ${p.site_address}`} />}
    {dnk && <View style={s.dnk}><Text style={{ color: '#fff', fontWeight: '700' }}>Do not knock</Text></View>}
    <Text style={s.h2}>{p.site_address}</Text><Text style={s.sub}>{p.city}, {p.state} {p.zip}{p.year_built ? ` · built ${p.year_built}` : ''}</Text>
    <View style={s.storm}><View style={[s.sw, !st && { backgroundColor: C.line }]} /><View><Text style={s.size}>{st?.hailIn ? `${Number(st.hailIn).toFixed(2)}" hail` : st ? `${st.gustMph} mph wind` : 'No hail'}</Text><Text style={s.sub}>{st ? `Verified ${st.eventDate}` : 'No verified storm in 90 days'}</Text></View></View>
    {roof && <View style={s.roof}>
      {roof.roofAreaSqft ? <Text style={s.roofItem}><Text style={s.roofNum}>{(roof.roofAreaSqft / 100).toFixed(1)}</Text> sq</Text> : null}
      {pitch12(roof.pitchDeg) && <Text style={s.roofItem}><Text style={s.roofNum}>{pitch12(roof.pitchDeg)}</Text> pitch</Text>}
      {roof.segmentCount ? <Text style={s.roofItem}><Text style={s.roofNum}>{roof.segmentCount}</Text> facets{roof.dominantAzimuthDeg != null ? ` · ${compass(roof.dominantAzimuthDeg)}` : ''}</Text> : null}
      {roof.imageryDate && <Text style={s.sub}>aerial {roof.imageryDate}</Text>}
    </View>}
    <Row k="Owner" v={p.owner_name ?? 'Unknown'} /><Row k="Mailing" v={p.owner_occupied === false ? p.mailing_address : 'Same as site'} /><Row k="Owner-occupied" v={p.owner_occupied == null ? 'Unknown' : p.owner_occupied ? 'Yes' : 'No — absentee'} />
    {card.jobs.map((j: any) => <View key={j.jnid} style={s.jn}><View style={[s.dot, { backgroundColor: C.status[j.statusName] ?? C.status.Signed }]} /><Text style={{ fontWeight: '600' }}>{j.jnid} · {j.statusName}</Text><Text style={s.sub}>  {j.salesRep}</Text></View>)}
    {card.knocks.length > 0 && <><Text style={s.h3}>Knock history</Text>{card.knocks.map((k: any) => <Text key={k.id} style={s.sub}>{new Date(k.created_at).toLocaleDateString()} · {LABEL[k.disposition as Disposition]} · {k.user_name}{k.note ? ` · ${k.note}` : ''}</Text>)}</>}
    {!form ? <>
      <Text style={s.h3}>Log this door</Text>
      <View style={s.grid}>{(['not_home', 'not_interested', 'callback', 'do_not_knock'] as Disposition[]).map(d => <Pressable key={d} style={s.disp} onPress={() => log(d)}><View style={[s.dot, { backgroundColor: C.disp[d] }]} /><Text style={{ fontWeight: '600' }}>{LABEL[d]}</Text></Pressable>)}</View>
      <Pressable style={s.go} onPress={() => setForm({ firstName: first, lastName: rest.join(' '), phone: '', scheduledAt: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 16), notes: '' })}><Text style={s.goText}>Inspection set</Text></Pressable>
    </> : <>
      <Text style={s.h3}>Set an inspection</Text>
      {(['firstName', 'lastName', 'phone', 'scheduledAt', 'notes'] as const).map(k => <TextInput key={k} style={s.input} placeholder={k} value={form[k]} onChangeText={t => setForm({ ...form, [k]: t })} keyboardType={k === 'phone' ? 'phone-pad' : 'default'} />)}
      <Text style={s.sub}>Creates a JobNimbus contact, Roof Inspection job and appointment; storm date and hail size go into the job's custom fields.</Text>
      <Pressable style={s.go} onPress={createInspection}><Text style={s.goText}>Create in JobNimbus</Text></Pressable>
      <Pressable style={s.quiet} onPress={() => setForm(null)}><Text style={{ fontWeight: '700' }}>Back</Text></Pressable>
    </>}
    <Pressable style={s.quiet} onPress={onClose}><Text style={{ fontWeight: '700' }}>Close</Text></Pressable>
  </ScrollView></View>;
}
const Row = ({ k, v }: { k: string; v: string }) => <View style={s.row}><Text style={s.sub}>{k}</Text><Text style={{ fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text></View>;
const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: C.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, elevation: 12, shadowColor: '#000', shadowOpacity: .15, shadowRadius: 20 },
  h2: { fontSize: 22, fontWeight: '700' }, h3: { fontSize: 14, fontWeight: '700', color: C.ink2, marginTop: 16, marginBottom: 6 }, sub: { color: C.ink2, fontSize: 13 },
  storm: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.surface2, borderRadius: 12, padding: 10, marginVertical: 10 }, sw: { width: 14, height: 40, borderRadius: 4, backgroundColor: C.hail2 }, size: { fontSize: 24, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderColor: C.line },
  jn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, marginTop: 8 }, dot: { width: 10, height: 10, borderRadius: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, disp: { width: '48%', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.line },
  go: { backgroundColor: C.accent, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 }, goText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  quiet: { backgroundColor: C.surface2, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 },
  input: { borderWidth: 1.5, borderColor: C.line, borderRadius: 10, padding: 10, marginTop: 8 }, dnk: { backgroundColor: C.hail3, borderRadius: 10, padding: 8, marginBottom: 8 },
  photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, marginBottom: 10, backgroundColor: C.surface2 },
  roof: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', paddingVertical: 6, borderBottomWidth: 1, borderColor: C.line }, roofItem: { color: C.ink2, fontSize: 13 }, roofNum: { color: C.ink, fontWeight: '700', fontSize: 15 },
});
