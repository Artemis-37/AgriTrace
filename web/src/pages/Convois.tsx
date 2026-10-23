import { ANALYSIS } from '../analysis';
import { useEffect, useState } from 'react';
import { useDeepLink } from '../notifTarget';
import { get, idem, patch, post } from '../api';
import { useAuth } from '../auth';
import { enqueue, onFlushed, useOffline } from '../offline';
import { date, dateTime } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';

const STATUS: Record<string, [string, import('../format').Tone]> = { in_transit: ['En route', 'warn'], received: ['Reçu — en caisse', 'neutral'], settled: ['Réglé', 'ok'] };
export const num = (v: any) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Convois des délégués (délégués) vers le magasin central : déclaration, réception et pesée, traitement en caisse. */
export default function Convois() {
  const { can } = useAuth();
  const tabs: [string, string][] = [];
  if (can('convoys:read')) tabs.push(['list', 'Convois']);
  if (can('weighings:approve')) tabs.push(['variance', 'Écarts de poids']);
  if (!can('convoys:settle') && can('collector:stock')) tabs.push(['mine', 'Ma fiche']);
  const dl = useDeepLink(tabs.map((t) => t[0]));
  const [tab, setTab] = useState(dl.tab ?? tabs[0]?.[0] ?? 'list');
  return (
    <>
      <PageHeader title="Convois des délégués" subtitle="Achats chez les producteurs convoyés vers le magasin central, pesés à la réception puis réglés en caisse." />
      <Tabs tabs={tabs as any} value={tab as any} onChange={setTab as any} />
      {tab === 'list' && <List />}
      {tab === 'variance' && <Variance />}
      {tab === 'mine' && <Card><Fiche collectorId={undefined} /></Card>}
    </>
  );
}

function List() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys'), []);
  useEffect(() => onFlushed(reload), [reload]);
  return (
    <Card>
      <div className="toolbar">{can('convoys:create') && <button className="btn" onClick={() => setCreating(true)}>Déclarer un convoi</button>}</div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucun convoi." columns={[
          { header: 'N° de convoi', render: (v) => v.convoy_no }, { header: 'Délégué', render: (v) => v.collector_name },
          { header: 'Chauffeur', render: (v) => v.driver_name }, { header: 'Camion', render: (v) => v.truck_no },
          { header: 'Poids reçu (kg)', align: 'right', render: (v) => (v.total_kg ? num(v.total_kg) : '—') },
          { header: 'Sacs', align: 'right', render: (v) => v.bags ?? '—' },
          { header: 'Montant', align: 'right', render: (v) => (v.amount ? num(v.amount) : '—') },
          { header: 'État', render: (v) => <Badge tone={STATUS[v.status]?.[1] ?? 'neutral'}>{STATUS[v.status]?.[0] ?? v.status}</Badge> },
        ]} />
      )}
      {creating && <CreateConvoy onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
    </Card>
  );
}

function CreateConvoy({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { org, can } = useAuth();
  const off = useOffline();
  const act = useAction();
  const [f, setF] = useState({ convoy_no: '', driver_name: '', truck_no: '', trailer_no: '', declared_bags: '', declared_kg: '' });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const avail = useAsync(() => (off.offline || !can('convoys:create') ? Promise.resolve([] as any[]) : get<any[]>('/convoys/available-declarations').catch(() => [] as any[])), []);
  const [picked, setPicked] = useState<string[]>([]);
  const list = avail.data ?? [];
  const pickKg = list.filter((d) => picked.includes(d.id)).reduce((a, d) => a + Number(d.kg), 0), pickBags = list.filter((d) => picked.includes(d.id)).reduce((a, d) => a + Number(d.bags ?? 0), 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // Numéro automatique (coopérative avec code CCC) : aperçu fourni par le serveur ; inconnu hors connexion ou pour un compte sans délégué.
  const next = useAsync(() => (off.offline || !can('convoys:create') ? Promise.resolve(null) : get<{ auto: boolean; convoy_no: string | null }>('/convoys/next-number').catch(() => null)), []);
  const auto = next.data?.auto === true;
  const noKnown = next.data?.auto === false;
  const valid = (auto || !noKnown || f.convoy_no.trim().length >= 2) && (f.convoy_no.trim() === '' || f.convoy_no.trim().length >= 2) && f.driver_name.trim().length >= 2 && f.truck_no.trim().length >= 2 && (!f.declared_kg || /^\d+(\.\d{1,3})?$/.test(f.declared_kg));
  return (
    <Modal title="Déclarer un convoi" onClose={onClose}>
      {off.offline && <p className="notice" role="status">Hors connexion : le convoi sera enregistré sur ce poste puis envoyé dès que le serveur sera joignable.</p>}
      {auto
        ? <Field label="Numéro de connaissement" hint="Attribué automatiquement par le logiciel (code CCC de la coopérative, année, 3 lettres de votre nom, n° d'ordre). Il accompagne le convoi jusqu'au magasin."><input value={next.data!.convoy_no ?? ''} readOnly aria-readonly="true" /></Field>
        : <Field label="Numéro de connaissement" hint={noKnown ? 'Saisi par le délégué ; il accompagne le convoi jusqu\'au magasin.' : 'Laissez vide si la coopérative a renseigné son code CCC : le numéro est alors attribué automatiquement à l\'envoi.'}><input value={f.convoy_no} onChange={set('convoy_no')} maxLength={60} /></Field>}
      <Field label="Nom du chauffeur"><input value={f.driver_name} onChange={set('driver_name')} maxLength={120} /></Field>
      <Field label="N° du camion"><input value={f.truck_no} onChange={set('truck_no')} maxLength={40} /></Field>
      <Field label="N° de la remorque (facultatif)"><input value={f.trailer_no} onChange={set('trailer_no')} maxLength={40} /></Field>
      {list.length > 0 && (
        <fieldset className="field">
          <legend>Achats chargés dans ce convoi (facultatif)</legend>
          <ul className="list">
            {list.map((d) => (
              <li key={d.id}><label><input type="checkbox" checked={picked.includes(d.id)} onChange={() => toggle(d.id)} /> {d.producer_name} · {date(d.operation_date)} · {num(d.kg)} kg · {d.bags ?? 0} sacs</label></li>
            ))}
          </ul>
          {picked.length > 0 && <p className="muted">{picked.length} achat(s) : {num(pickKg)} kg, {pickBags} sacs — le poids et les sacs déclarés sont déduits de ces achats si vous ne les saisissez pas.</p>}
        </fieldset>
      )}
      <Field label="Nombre de sacs déclaré (facultatif)"><input inputMode="numeric" value={f.declared_bags} onChange={set('declared_bags')} /></Field>
      <Field label="Poids déclaré en kg (facultatif)"><input inputMode="decimal" value={f.declared_kg} onChange={set('declared_kg')} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !valid || !org} onClick={() => act.run(async () => {
          await enqueue(org!.id, 'convoy.create', {
            idempotency_key: idem(), ...(!auto && f.convoy_no.trim() && { convoy_no: f.convoy_no.trim() }), driver_name: f.driver_name.trim(), truck_no: f.truck_no.trim(), ...(f.trailer_no.trim() && { trailer_no: f.trailer_no.trim() }),
            ...(f.declared_bags && { declared_bags: Number(f.declared_bags) }), ...(f.declared_kg && { declared_kg: f.declared_kg }), ...(picked.length && { declaration_ids: picked }),
          }, `Convoi ${auto ? next.data!.convoy_no : f.convoy_no.trim() || 'à numéroter'}`);
          onDone();
        })}>{off.offline ? 'Enregistrer sur ce poste' : 'Enregistrer'}</button>
      </div>
    </Modal>
  );
}

export function Receive() {
  const { org } = useAuth();
  const act = useAction();
  const { data, loading, error, reload } = useAsync(async () => ({
    expected: await get<any[]>('/convoys/expected'), whs: await get<any[]>('/warehouses').catch(() => [] as any[]),
  }), []);
  useEffect(() => onFlushed(reload), [reload]);
  const [collector, setCollector] = useState('');
  const [convoyNo, setConvoyNo] = useState('');
  const [wh, setWh] = useState('');
  const [kg, setKg] = useState('');
  const [bags, setBags] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState('');
  const [d, setD] = useState({ wIn: '', wOut: '', tare: '', ref: '', grade: '', trailer: '', unl: '', refused: '' });
  const [an, setAn] = useState<Record<string, string>>({});
  const [m, setM] = useState({ driver: '', truck: '', bags: '', kg: '' });
  const setF = (k: keyof typeof d) => (e: any) => setD((x) => ({ ...x, [k]: e.target.value }));
  const exp0 = data?.expected.find((v) => v.collector_id === collector && v.convoy_no === convoyNo.trim());
  const content = useAsync(() => (exp0?.declaration_count > 0 ? get<any[]>(`/convoys/${exp0.id}/declarations`) : Promise.resolve([] as any[])), [exp0?.id]);
  // Convoi déclaré par le délégué : remorque et provenance reprises automatiquement (modifiables).
  useEffect(() => { if (exp0) setD((x) => ({ ...x, trailer: exp0.trailer_no ?? '' })); }, [exp0?.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const collectors = [...new Map(data.expected.map((v) => [v.collector_id, v.collector_code ? `${v.collector_name} (${v.collector_code})` : v.collector_name])).entries()];
  const mine = data.expected.filter((v) => v.collector_id === collector);
  const expected = mine.find((v) => v.convoy_no === convoyNo.trim());
  const W = /^\d+(\.\d{1,3})?$/;
  // Saisie complète : connaissement non déclaré par le délégué, informations saisies par le magasinier.
  const manual = !!collector && convoyNo.trim().length >= 2 && !expected;
  const declared = expected ? (expected.declared_kg != null ? Number(expected.declared_kg) : 0) : (W.test(m.kg) ? Number(m.kg) : 0);
  const declaredBags = expected ? expected.declared_bags : (/^\d+$/.test(m.bags) ? Number(m.bags) : null);
  const twoWeighings = d.wIn !== '' || d.wOut !== '';
  const net = twoWeighings && W.test(d.wIn) && W.test(d.wOut) ? Number(d.wIn) - Number(d.wOut) - Number(W.test(d.tare) ? d.tare : 0) - Number(W.test(d.ref) ? d.ref : 0) : NaN;
  const kgEff = twoWeighings ? (Number.isFinite(net) && net > 0 ? String(Math.round(net * 1000) / 1000) : '') : kg;
  const optOk = (v: string) => v === '' || W.test(v);
  const gapPct = declared > 0 && /^\d+(\.\d{1,3})?$/.test(kgEff) ? Math.abs(Number(kgEff) - declared) * 100 / declared : 0;
  const tol = Number(expected?.weight_tolerance_pct ?? 2);
  const blocked = gapPct > tol;
  const valid = collector && convoyNo.trim().length >= 2 && wh && (!manual || (m.driver.trim().length >= 2 && m.truck.trim().length >= 2 && (m.kg === '' || W.test(m.kg)) && /^\d*$/.test(m.bags))) && (!blocked || notes.trim().length >= 5) && /^\d+(\.\d{1,3})?$/.test(kgEff) && Number(kgEff) > 0 && /^[1-9]\d*$/.test(bags)
    && optOk(d.tare) && optOk(d.ref) && (!twoWeighings || (W.test(d.wIn) && W.test(d.wOut))) && /^\d*$/.test(d.unl) && /^\d*$/.test(d.refused);
  return (
    <Card title="Réceptionner un convoi">
      <div className="grid-3">
      <Field label="Délégué"><select value={collector} onChange={(e) => { setCollector(e.target.value); setConvoyNo(''); }}><option value="">—</option>{collectors.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>
      <Field label="Numéro de connaissement" hint={mine.length ? `En route : ${mine.map((v) => v.convoy_no).join(', ')}` : undefined}>
        <input list="convois-attendus" value={convoyNo} onChange={(e) => setConvoyNo(e.target.value)} /></Field>
      <datalist id="convois-attendus">{mine.map((v) => <option key={v.id} value={v.convoy_no} />)}</datalist>
      {expected && <p className="muted span-all">Chauffeur : {expected.driver_name} · Camion : {expected.truck_no}{expected.declared_kg ? ` · Déclaré : ${num(expected.declared_kg)} kg` : ''}{expected.declared_bags != null ? ` / ${expected.declared_bags} sacs` : ''}</p>}
      {(content.data ?? []).length > 0 && (
        <details open className="span-all"><summary>Contenu déclaré : {(content.data ?? []).length} achat(s)</summary>
          <ul className="list">{(content.data ?? []).map((d) => <li key={d.id}>{d.producer_name} · {date(d.operation_date)} · {num(d.kg)} kg · {d.bags} sacs</li>)}</ul></details>
      )}
      <Field label="Magasin"><select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">—</option>{data.whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      <h3>Indication connaissement</h3>
      {manual && <>
        <p className="notice" role="status">Ce connaissement n'a pas été déclaré par le délégué : saisissez les informations du bordereau ; il sera enregistré à la réception.</p>
        <div className="grid-3">
        <Field label="Nom du chauffeur"><input value={m.driver} onChange={(e) => setM({ ...m, driver: e.target.value })} maxLength={120} /></Field>
        <Field label="N° du camion"><input value={m.truck} onChange={(e) => setM({ ...m, truck: e.target.value })} maxLength={40} /></Field>
        <Field label="Nombre de sacs déclaré (facultatif)"><input inputMode="numeric" value={m.bags} onChange={(e) => setM({ ...m, bags: e.target.value })} /></Field>
        <Field label="Poids déclaré en kg (facultatif)"><input inputMode="decimal" value={m.kg} onChange={(e) => setM({ ...m, kg: e.target.value })} /></Field>
        </div>
      </>}
      {collector && <p className="muted">Provenance (profil du délégué) : <strong>{data.expected.find((v) => v.collector_id === collector)?.collector_origin ?? 'non renseignée'}</strong>{expected ? ' · remorque reprise du convoi déclaré (modifiable).' : ''}</p>}
      <Field label="Remorque"><input value={d.trailer} onChange={setF('trailer')} maxLength={40} /></Field>
      <h3>Livraison produit</h3>
      <div className="grid-3">
      <Field label="Pesée à l'entrée, camion chargé (kg)"><input inputMode="decimal" value={d.wIn} onChange={setF('wIn')} /></Field>
      <Field label="Pesée à la sortie, camion vide (kg)"><input inputMode="decimal" value={d.wOut} onChange={setF('wOut')} /></Field>
      <Field label="Tare des sacs (kg)"><input inputMode="decimal" value={d.tare} onChange={setF('tare')} /></Field>
      <Field label="Réfaction (kg)"><input inputMode="decimal" value={d.ref} onChange={setF('ref')} /></Field>
      <Field label="Poids net payé (kg)" hint={twoWeighings ? 'Calculé : entrée − sortie − tare − réfaction' : 'Sans double pesée, saisissez directement le poids net'}><input inputMode="decimal" value={twoWeighings ? kgEff : kg} readOnly={twoWeighings} onChange={(e) => setKg(e.target.value)} /></Field>
      <Field label="Nombre de sacs reçus"><input inputMode="numeric" value={bags} onChange={(e) => setBags(e.target.value)} /></Field>
      <Field label="Sacs déchargés"><input inputMode="numeric" value={d.unl} onChange={setF('unl')} /></Field>
      <Field label="Sacs refusés"><input inputMode="numeric" value={d.refused} onChange={setF('refused')} /></Field>
      <Field label="Manquants (automatique)" hint="Sacs déclarés − sacs déchargés"><input readOnly disabled value={declaredBags != null && /^\d+$/.test(d.unl) && d.unl !== '' ? String(declaredBags - Number(d.unl)) : '—'} /></Field>
      <Field label="Écart / poids déclaré (automatique)" hint="Poids net payé − poids déclaré"><input readOnly disabled value={declared > 0 && /^\d+(\.\d{1,3})?$/.test(kgEff) ? `${Math.round(Number(kgEff) - declared)} kg` : '—'} /></Field>
      <Field label="Qualité / grade"><input value={d.grade} onChange={setF('grade')} maxLength={20} /></Field>
      </div>
      <h3>Analyse</h3>
      <div className="grid-3">{ANALYSIS.map((k) => <Field key={k} label={k}><input inputMode="decimal" value={an[k] ?? ''} onChange={(e) => setAn((x) => ({ ...x, [k]: e.target.value }))} maxLength={10} /></Field>)}</div>
      {blocked && <p className="notice" role="status">Écart de {gapPct.toFixed(1)} % avec le poids déclaré (tolérance {tol} %) : la réception sera retenue jusqu'à validation par un responsable, et la cause est obligatoire.</p>}
      <Field label={blocked ? 'Cause de l\'écart (obligatoire)' : 'Observations (facultatif)'}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      {done && <p className="notice" role="status">{done}</p>}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !valid || !org} onClick={() => act.run(async () => {
        await enqueue(org!.id, 'convoy.receive', { idempotency_key: idem(), collector_id: collector, convoy_no: convoyNo.trim(), warehouse_id: wh, total_kg: kgEff, bags: Number(bags), ...(notes.trim() && { notes: notes.trim() }),
          ...(manual && { driver_name: m.driver.trim(), truck_no: m.truck.trim(), ...(m.bags && { declared_bags: Number(m.bags) }), ...(m.kg && { declared_kg: m.kg }) }),
          ...(twoWeighings && { weigh_in_kg: d.wIn, weigh_out_kg: d.wOut }),
          ...(d.tare && { bag_tare_kg: d.tare }), ...(d.ref && { refaction_kg: d.ref }), ...(d.grade.trim() && { grade: d.grade.trim() }), ...(d.trailer.trim() && { trailer_no: d.trailer.trim() }),
          ...(d.unl && { bags_unloaded: Number(d.unl) }), ...(d.refused && { bags_refused: Number(d.refused) }),
          ...(Object.values(an).some((v) => v.trim()) && { analysis: Object.fromEntries(Object.entries(an).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) }) }, `Réception du convoi ${convoyNo.trim()}`);
        setDone(`Convoi ${convoyNo.trim()} enregistré : il sera transmis à la caisse dès l'envoi au serveur.`); setConvoyNo(''); setKg(''); setBags(''); setNotes(''); setD({ wIn: '', wOut: '', tare: '', ref: '', grade: '', trailer: '', unl: '', refused: '' }); setAn({}); setM({ driver: '', truck: '', bags: '', kg: '' }); reload();
      })}>Valider la réception et transmettre à la caisse</button></div>
    </Card>
  );
}

/** Saisie des résultats d'analyse après la pesée (tant que la caisse n'a pas réglé). */
export function Analyses() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys/receptions/recent'), []);
  const [sel, setSel] = useState<any>(null);
  const [an, setAn] = useState<Record<string, string>>({});
  const [grade, setGrade] = useState('');
  const act = useAction();
  const open = (r: any) => { setSel(r); setAn(r.analysis ?? {}); setGrade(r.grade ?? ''); };
  return (
    <Card title="Résultats d'analyse">
      <p className="muted">Complétez l'analyse d'une réception déjà pesée : elle apparaît sur le bulletin de pesée. Possible tant que la caisse n'a pas réglé la réception.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune réception récente." columns={[
          { header: 'Bulletin', render: (r) => r.bulletin_no }, { header: 'Connaissement', render: (r) => r.convoy_no }, { header: 'Reçu le', render: (r) => dateTime(r.received_at) },
          { header: 'Net payé (kg)', align: 'right', render: (r) => num(r.total_kg) }, { header: 'Analyse', render: (r) => (Object.keys(r.analysis ?? {}).length ? `${Object.keys(r.analysis).length} ligne(s)` : '—') },
          { header: '', render: (r) => (r.status === 'settled' ? <Badge>Réglée</Badge> : <button className="btn btn-ghost" onClick={() => open(r)}>Saisir l'analyse</button>) },
        ]} />
      )}
      {sel && (
        <Modal title={`Analyse · ${sel.bulletin_no}`} onClose={() => setSel(null)}>
          <Field label="Qualité / grade"><input value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={20} /></Field>
          <div className="grid-2">{ANALYSIS.map((k) => <Field key={k} label={k}><input inputMode="decimal" value={an[k] ?? ''} onChange={(e) => setAn((x) => ({ ...x, [k]: e.target.value }))} maxLength={10} /></Field>)}</div>
          {act.error && <ErrorBox message={act.error} />}
          <div className="modal-actions"><button className="btn" disabled={act.busy} onClick={() => act.run(async () => {
            await patch(`/convoys/receptions/${sel.id}/analysis`, { analysis: Object.fromEntries(Object.entries(an).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])), ...(grade.trim() && { grade: grade.trim() }) });
            setSel(null); reload();
          })}>Enregistrer</button><button className="btn btn-ghost" onClick={() => setSel(null)}>Annuler</button></div>
        </Modal>
      )}
    </Card>
  );
}

export function Variance() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys/variance-queue'), []);
  const [sel, setSel] = useState<any>(null);
  const [comment, setComment] = useState('');
  const act = useAction();
  const { can } = useAuth();
  const cfg = useAsync(() => (can('convoys:settle') ? get<any>('/convoys/settings') : Promise.resolve(null)), []);
  const [tol, setTol] = useState<string | null>(null);
  return (
    <Card title="Écarts de poids à valider">
      {cfg.data && (
        <div className="toolbar">
          <label>Tolérance entre connaissement et pesée (%){' '}
            <input inputMode="decimal" size={5} value={tol ?? String(Number(cfg.data.weight_tolerance_pct))} onChange={(e) => setTol(e.target.value)} /></label>{' '}
          <button className="btn btn-secondary" disabled={act.busy || tol === null || !/^\d+(\.\d{1,3})?$/.test(tol)} onClick={() => act.run(async () => {
            await post('/convoys/settings', { transport_unit: String(cfg.data.transport_unit), retention_per_kg: String(cfg.data.retention_per_kg), weight_tolerance_pct: tol }); setTol(null); cfg.reload();
          })}>Enregistrer</button>
        </div>
      )}
      <p className="muted">Le poids pesé s'écarte du connaissement au-delà de la tolérance. La validation doit être faite par un autre utilisateur que celui qui a réceptionné ; la caisse ne peut pas régler avant.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucun écart en attente." columns={[
          { header: 'N° de convoi', render: (r) => r.convoy_no }, { header: 'Délégué', render: (r) => r.collector_name },
          { header: 'Déclaré (kg)', align: 'right', render: (r) => num(r.declared_kg) }, { header: 'Pesé (kg)', align: 'right', render: (r) => num(r.total_kg) },
          { header: 'Écart', align: 'right', render: (r) => <Badge tone="warn">{num(r.variance_kg)} kg ({Number(r.variance_pct).toFixed(1)} %)</Badge> },
          { header: 'Cause indiquée', render: (r) => r.notes },
          { header: '', render: (r) => <button className="btn" onClick={() => { setSel(r); setComment(''); }}>Examiner</button> },
        ]} />
      )}
      {sel && (
        <Modal title={`Écart de poids — ${sel.convoy_no}`} onClose={() => setSel(null)}>
          <p>Déclaré {num(sel.declared_kg)} kg, pesé {num(sel.total_kg)} kg : {num(sel.variance_kg)} kg ({Number(sel.variance_pct).toFixed(1)} %).</p>
          <p className="muted">Cause indiquée à la réception : {sel.notes}</p>
          <Field label="Motif de la validation (5 caractères au moins)"><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></Field>
          {act.error && <ErrorBox message={act.error} />}
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setSel(null)}>Fermer</button>
            <button className="btn" disabled={act.busy || comment.trim().length < 5} onClick={() => act.run(async () => { await post(`/convoy-receptions/${sel.id}/approve-variance`, { comment: comment.trim() }); setSel(null); reload(); })}>Accepter l'écart et transmettre à la caisse</button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function Cash() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys/cashier-queue'), []);
  useEffect(() => onFlushed(reload), [reload]);
  const [sel, setSel] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const { can } = useAuth();
  return (
    <Card title="Réceptions à traiter">
      {can('cash:operate') && <div className="toolbar"><button className="btn btn-secondary" onClick={() => setPaying(true)}>Payer un délégué en espèces</button></div>}
      {paying && <Payout onClose={() => setPaying(false)} />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune réception en attente." columns={[
          { header: 'N° de convoi', render: (r) => r.convoy_no }, { header: 'Délégué', render: (r) => r.collector_name },
          { header: 'Poids (kg)', align: 'right', render: (r) => num(r.total_kg) }, { header: 'Sacs', align: 'right', render: (r) => r.bags },
          { header: 'Écart vs déclaré (kg)', align: 'right', render: (r) => (r.variance_kg == null ? '—' : num(r.variance_kg)) },
          { header: '', render: (r) => <button className="btn" onClick={() => setSel(r)}>Traiter</button> },
        ]} />
      )}
      {sel && <Settle r={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); reload(); }} />}
    </Card>
  );
}

function Settle({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const cfg = useAsync(() => get<any>('/convoys/settings'), []);
  const [price, setPrice] = useState('');
  const [tu, setTu] = useState<string | null>(null);
  const [rt, setRt] = useState<string | null>(null);
  const t = tu ?? String(Number(cfg.data?.transport_unit ?? 0)), q = rt ?? String(Number(cfg.data?.retention_per_kg ?? 0));
  const num4 = (v: string) => /^\d+(\.\d{1,4})?$/.test(v);
  const ok = num4(price) && Number(price) > 0 && num4(t) && num4(q);
  const w = Number(r.total_kg);
  const gross = ok ? Math.round(w * Number(price)) : 0, transport = ok ? Math.round(w * Number(t)) : 0, ret = ok ? Math.round(w * Number(q)) : 0;
  const net = gross + transport - ret;
  const cols = useAsync(() => get<any[]>('/convoys/collectors'), []);
  const outstanding = Math.max(0, Number(cols.data?.find((c: any) => c.id === r.collector_id)?.advance_outstanding ?? 0));
  const maxNet = Math.max(0, Math.min(outstanding, net));
  const [nt, setNt] = useState<string | null>(null);
  const netted = nt === null ? maxNet : Math.min(Math.max(0, Number(nt) || 0), maxNet);
  const [key] = useState(idem());
  const f = (n: number) => n.toLocaleString('fr-FR');
  return (
    <Modal title={`Traiter le convoi ${r.convoy_no}`} onClose={onClose}>
      <p>{r.collector_name} · {num(r.total_kg)} kg · {r.bags} sacs</p>
      <Field label="P.U. — prix d'achat au kg (FCFA)"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <Field label="Coût de transport au kg (FCFA)"><input inputMode="decimal" value={t} onChange={(e) => setTu(e.target.value)} /></Field>
      <Field label="Retenue au kg (FCFA)"><input inputMode="decimal" value={q} onChange={(e) => setRt(e.target.value)} /></Field>
      {ok && <table><tbody>
        <tr><td>Montant brut (poids × P.U.)</td><td className="r">{f(gross)}</td></tr>
        <tr><td>Transport (poids × coût unitaire)</td><td className="r">{f(transport)}</td></tr>
        <tr><td>Montant total produit</td><td className="r">{f(gross + transport)}</td></tr>
        <tr><td>Retenue</td><td className="r">− {f(ret)}</td></tr>
        <tr><td><strong>Net à payer (porté au compte du délégué)</strong></td><td className="r"><strong>{f(net)}</strong></td></tr></tbody></table>}
      {ok && outstanding > 0 && <>
        <p className="notice">Avances (financements) non soldées de ce délégué : <strong>{f(outstanding)}</strong>. Elles sont imputées sur ce net à payer (dette 401 compensée par l'avance 409).</p>
        <Field label="Avances à imputer sur cette livraison (FCFA)"><input aria-label="Avances à imputer" inputMode="numeric" value={nt ?? String(maxNet)} onChange={(e) => setNt(e.target.value)} /></Field>
        <table><tbody><tr><td><strong>Reste à payer au délégué après imputation</strong></td><td className="r"><strong>{f(net - netted)}</strong></td></tr></tbody></table></>}
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !ok || net <= 0} onClick={() => act.run(async () => { await post(`/convoy-receptions/${r.id}/settle`, { idempotency_key: key, unit_price: price, transport_unit: t, retention_per_kg: q, ...(outstanding > 0 && { net_advance: String(netted) }) }); onDone(); })}>Enregistrer le net à payer</button>
      </div>
    </Modal>
  );
}

function Payout({ onClose }: { onClose: () => void }) {
  const act = useAction();
  const { data, loading, error } = useAsync(async () => ({
    accounts: (await get<any[]>('/financial-accounts')).filter((a) => a.owner_type === 'collector'),
    registers: (await get<any[]>('/cash-registers')).filter((r) => r.open_session_id),
  }), []);
  const [col, setCol] = useState('');
  const [session, setSession] = useState('');
  const [amount, setAmount] = useState('');
  const [key] = useState(idem());
  const [done, setDone] = useState('');
  const acc = data?.accounts.find((a) => a.owner_id === col);
  const ok = col && session && /^\d+(\.\d{1,4})?$/.test(amount) && Number(amount) > 0 && acc && Number(amount) <= Number(acc.balance);
  return (
    <Modal title="Payer un délégué en espèces" onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}
      {data && (
        <>
          <Field label="Délégué"><select value={col} onChange={(e) => setCol(e.target.value)}><option value="">—</option>{data.accounts.map((a) => <option key={a.id} value={a.owner_id}>{a.name} — solde {Number(a.balance).toLocaleString('fr-FR')}</option>)}</select></Field>
          <Field label="Caisse (session ouverte)"><select value={session} onChange={(e) => setSession(e.target.value)}><option value="">—</option>{data.registers.map((r) => <option key={r.id} value={r.open_session_id}>{r.name}</option>)}</select></Field>
          <Field label="Montant (FCFA)" hint={acc ? `Maximum : ${Number(acc.balance).toLocaleString('fr-FR')}` : undefined}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          {act.error && <ErrorBox message={act.error} />}
          {done && <p className="notice" role="status">{done}</p>}
          <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Fermer</button>
            <button className="btn" disabled={act.busy || !ok || !!done} onClick={() => act.run(async () => { await post('/convoys/payout', { idempotency_key: key, collector_id: col, cash_session_id: session, amount }); setDone('Paiement enregistré : compte du délégué et caisse mis à jour.'); })}>Payer</button></div>
        </>
      )}
    </Modal>
  );
}

const FR = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));

/** Fiche de suivi du compte délégué, dans la présentation de la fiche papier (solde = ce que le délégué doit à la coopérative). */
export function Fiche({ collectorId }: { collectorId?: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, loading, error, reload } = useAsync(() => get<any>(`/convoys/statement?${new URLSearchParams({ ...(collectorId && { collector_id: collectorId }), ...(from && { from }), ...(to && { to }) })}`), [collectorId, from, to]);
  useEffect(() => onFlushed(reload), [reload]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const s = Number(data.solde);
  return (
    <>
      <div className="toolbar"><strong>Fiche de suivi du compte — {data.collector.full_name}</strong>
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button></div>
      <div className="tw"><table>
        <thead><tr><th>Date</th><th>Libellé</th><th>Pièce</th><th className="r">Poids (A)</th><th className="r">P.U. (B)</th><th className="r">Montant brut (C)</th><th className="r">Coût transport (D)</th><th className="r">Transport total (E)</th><th className="r">Total produit (F)</th><th className="r">Retenue</th><th className="r">Net à payer (I)</th><th className="r">Finance (J)</th><th className="r">Solde (K)</th></tr></thead>
        <tbody>
          {Number(data.opening) !== 0 && <tr><td colSpan={12}>Report à l'ouverture</td><td className="r">{FR(data.opening)}</td></tr>}
          {data.rows.map((r: any) => (
            <tr key={r.id}><td>{date(r.date)}</td><td>{r.label}</td><td>{r.piece ?? ''}</td><td className="r">{FR(r.weight)}</td><td className="r">{FR(r.unit_price)}</td><td className="r">{FR(r.gross_amount)}</td>
              <td className="r">{FR(r.transport_unit)}</td><td className="r">{FR(r.transport_total)}</td><td className="r">{FR(r.product_total)}</td><td className="r">{FR(r.retention_amount)}</td>
              <td className="r">{FR(r.net_payable)}</td><td className="r">{FR(r.finance)}</td><td className="r"><strong>{FR(r.solde)}</strong></td></tr>
          ))}
          {!data.rows.length && <tr><td colSpan={13} className="muted">Aucune opération sur la période.</td></tr>}
        </tbody></table></div>
      {Number(data.advance_outstanding) > 0 && <p className="notice">Avances non encore imputées sur une livraison : {FR(data.advance_outstanding)} FCFA.</p>}
      <p className="notice">{s > 0 ? `Le délégué doit ${FR(s)} FCFA à la coopérative (financements non encore couverts par ses livraisons).` : s < 0 ? `La coopérative doit ${FR(-s)} FCFA au délégué.` : 'Compte soldé.'}</p>
    </>
  );
}

export function Accounts() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys/collectors'), []);
  const [col, setCol] = useState('');
  const [adv, setAdv] = useState<'advance' | 'carry_forward' | null>(null);
  const [n, setN] = useState(0);
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <div className="toolbar">
          <select aria-label="Délégué" value={col} onChange={(e) => setCol(e.target.value)}><option value="">Choisir un délégué…</option>{(data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} — solde {FR(c.solde)}</option>)}</select>
          {col && can('cash:operate') && <button className="btn" onClick={() => setAdv('advance')}>Remettre un financement</button>}
          {col && <button className="btn btn-secondary" onClick={() => setAdv('carry_forward')}>Reporter un solde de campagne</button>}
        </div>
      )}
      {col && <Fiche key={col + n} collectorId={col} />}
      {adv && <Advance kind={adv} collectorId={col} onClose={() => setAdv(null)} onDone={() => { setAdv(null); setN(n + 1); reload(); }} />}
    </Card>
  );
}

function Advance({ kind, collectorId, onClose, onDone }: { kind: 'advance' | 'carry_forward'; collectorId: string; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const regs = useAsync(async () => (kind === 'advance' ? (await get<any[]>('/cash-registers')).filter((r) => r.open_session_id) : []), [kind]);
  const [f, setF] = useState({ amount: '', piece: '', session: '', date: '', label: '' });
  const [key] = useState(idem());
  const ok = /^\d+(\.\d{1,4})?$/.test(f.amount) && Number(f.amount) > 0 && (kind === 'carry_forward' || f.session);
  return (
    <Modal title={kind === 'advance' ? 'Remettre un financement (Finance cacao)' : 'Reporter le solde de la campagne précédente'} onClose={onClose}>
      <Field label="Montant (FCFA)"><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="N° de pièce"><input value={f.piece} onChange={(e) => setF({ ...f, piece: e.target.value })} maxLength={60} /></Field>
      <Field label="Date de l'opération (laisser vide : aujourd'hui)"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      {kind === 'advance' && <Field label="Caisse (session ouverte)"><select value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })}><option value="">—</option>{(regs.data ?? []).map((r: any) => <option key={r.id} value={r.open_session_id}>{r.name}</option>)}</select></Field>}
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
          await post('/convoys/advances', { idempotency_key: key, collector_id: collectorId, kind, amount: f.amount, ...(f.piece && { piece_no: f.piece }), ...(f.date && { operation_date: f.date }), ...(kind === 'advance' && { cash_session_id: f.session }) }); onDone();
        })}>Enregistrer</button></div>
    </Modal>
  );
}
