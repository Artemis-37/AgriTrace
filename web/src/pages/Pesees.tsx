import { useState } from 'react';
import { get } from '../api';
import { useAuth } from '../auth';
import { useDeepLink } from '../notifTarget';
import { date } from '../format';
import { Badge, Card, ErrorBox, Loading, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';
import { Analyses, Receive, num } from './Convois';
import { Receipt } from './Operations';

type State = 'pending' | 'settled' | 'all';
const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

/** Pesées du magasin central : liste filtrable (non traitées = pas encore réglées en caisse) et saisie d'une pesée. */
export default function Pesees() {
  const { can } = useAuth();
  const tabs: [string, string][] = [['list', 'Pesées']];
  if (can('convoys:receive')) tabs.push(['analyses', 'Analyses']);
  const dl = useDeepLink(['list', 'analyses', 'new']);
  const [tab, setTab] = useState(dl.tab === 'analyses' ? 'analyses' : 'list');
  return (
    <>
      <PageHeader title="Pesées" subtitle="Réceptions pesées au magasin central : suivi, saisie d'une pesée, analyses et bulletin de pesée." />
      {tabs.length > 1 && <Tabs tabs={tabs as any} value={tab as any} onChange={setTab as any} />}
      {tab === 'list' ? <List autoNew={dl.tab === 'new'} /> : <Analyses />}
    </>
  );
}

function List({ autoNew }: { autoNew: boolean }) {
  const { can } = useAuth();
  const [state, setState] = useState<State>('pending');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [camp, setCamp] = useState('');
  const [prod, setProd] = useState('');
  const refs = useAsync(async () => ({ campaigns: await get<any[]>('/campaigns').catch(() => [] as any[]), products: await get<any[]>('/products').catch(() => [] as any[]) }), []);
  const [adding, setAdding] = useState(autoNew && can('convoys:receive'));
  const [receipt, setReceipt] = useState<any | null>(null);
  const [picked, setPicked] = useState<any | null>(null);
  const act = useAction();
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/convoys/receptions?${new URLSearchParams({ state, ...(q.trim() && { q: q.trim() }), ...(from && { from }), ...(to && { to }), ...(camp && { campaign_id: camp }), ...(prod && { product_id: prod }) })}`), [state, q, from, to, camp, prod]);
  const rows = data ?? [];
  const done = rows.filter((r) => r.status === 'settled'), todo = rows.filter((r) => r.status !== 'settled');
  const STATE: [State, string][] = [['pending', 'Non traitées'], ['settled', 'Traitées'], ['all', 'Toutes']];
  if (adding) return <><p><button className="btn btn-ghost" onClick={() => { setAdding(false); reload(); }}>← Retour à la liste des pesées</button></p><ConvoyPicker onPick={setPicked} picked={picked} /><Receive key={picked ? picked.id : 'libre'} initial={picked ? { collector: picked.collector_id, convoyNo: picked.convoy_no, code: picked.collector_code ?? '' } : undefined} /></>;
  return (
    <Card>
      <div className="toolbar pesees-filters">
        <div className="seg" role="radiogroup" aria-label="État de traitement">
          {STATE.map(([k, l]) => <label key={k} className={state === k ? 'on' : ''}><input type="radio" name="pesee-state" checked={state === k} onChange={() => setState(k)} />{l}</label>)}
        </div>
        <label>Campagne <select value={camp} onChange={(e) => setCamp(e.target.value)}><option value="">Toutes</option>{(refs.data?.campaigns ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Produit <select value={prod} onChange={(e) => setProd(e.target.value)}><option value="">Tous</option>{(refs.data?.products ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <input type="search" placeholder="Code, nom, connaissement ou bulletin" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {can('convoys:receive') && <button className="btn" onClick={() => setAdding(true)}>Enregistrer une pesée</button>}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading ? <Loading /> : (
        <>
          <div className="pesees-table"><Table rows={rows} empty="Aucune pesée pour ces critères." columns={[
            { header: 'Bulletin', render: (r) => r.bulletin_no }, { header: 'Date', render: (r) => date(r.received_at) },
            { header: 'Connaissement', render: (r) => r.convoy_no },
            { header: 'Produit', render: (r) => r.product ?? '—' },
            { header: 'Sacs', align: 'right', render: (r) => r.bags ?? '—' },
            { header: 'Poids brut', align: 'right', render: (r) => (r.gross_kg ? num(r.gross_kg) : '—') },
            { header: 'Réfaction', align: 'right', render: (r) => (Number(r.refaction_kg) ? num(r.refaction_kg) : '—') },
            { header: 'Poids net', align: 'right', render: (r) => <strong>{num(r.total_kg)}</strong> },
            { header: 'Traite', render: (r) => (r.campaign ? <>{r.campaign}</> : '—') },
            { header: 'Prix/kg', align: 'right', render: (r) => (r.unit_price ? num(r.unit_price) : r.traite_price ? <span className="muted" title="Prix de la traite, appliqué au règlement">{num(r.traite_price)}</span> : <span className="neg" title="Aucun prix fixé pour cette traite">non fixé</span>) },
            { header: 'Net à payer', align: 'right', render: (r) => (r.amount ? num(r.amount) : r.traite_price ? <span className="muted">{num(Number(r.traite_price) * Number(r.total_kg))}</span> : '—') },
            { header: 'Origine', render: (r) => r.origin ?? '—' },
            { header: 'Délégué', render: (r) => <>{r.collector_code ? <code>{r.collector_code}</code> : null} {r.collector_name}</> },
            { header: 'État', render: (r) => (r.status === 'settled' ? <Badge tone="ok">Traitée</Badge> : r.status === 'pending_variance' ? <Badge tone="warn">Écart à valider</Badge> : <Badge tone="neutral">Non traitée</Badge>) },
            { header: '', render: (r) => <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={() => act.run(async () => setReceipt(await get(`/operation-receipts/convoy_reception/${r.id}`)))}>Bulletin</button> },
          ]} /></div>
          <div className="totals" role="status">
            <span>Nombre<strong>{rows.length}</strong></span>
            <span>Total<strong>{num(sum(rows, 'total_kg'))} kg</strong></span>
            <span>Traité<strong>{num(sum(done, 'total_kg'))} kg</strong></span>
            <span>Non traité<strong>{num(sum(todo, 'total_kg'))} kg</strong></span>
          </div>
        </>
      )}
            {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
    </Card>
  );
}

/** Choix du convoi à peser : « Non traités » = en route, à peser ; « Traités » = déjà pesés (bulletin consultable). */
function ConvoyPicker({ picked, onPick }: { picked: any | null; onPick: (v: any | null) => void }) {
  const [tab, setTab] = useState<'todo' | 'done'>('todo');
  const [q, setQ] = useState('');
  const [receipt, setReceipt] = useState<any | null>(null);
  const act = useAction();
  const todo = useAsync(() => get<any[]>('/convoys/expected'), []);
  const done = useAsync(() => get<any[]>('/convoys/receptions?state=all'), []);
  const needle = q.trim().toLowerCase();
  const match = (...v: any[]) => !needle || v.some((x) => String(x ?? '').toLowerCase().includes(needle));
  const rowsTodo = (todo.data ?? []).filter((v) => match(v.convoy_no, v.collector_name, v.collector_code, v.truck_no, v.driver_name));
  const rowsDone = (done.data ?? []).filter((r) => match(r.convoy_no, r.bulletin_no, r.collector_name, r.collector_code));
  return (
    <Card title="Choisir le convoi">
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Convois">
          <label className={tab === 'todo' ? 'on' : ''}><input type="radio" name="pick-tab" checked={tab === 'todo'} onChange={() => setTab('todo')} />Non traités ({todo.data?.length ?? '…'})</label>
          <label className={tab === 'done' ? 'on' : ''}><input type="radio" name="pick-tab" checked={tab === 'done'} onChange={() => setTab('done')} />Traités ({done.data?.length ?? '…'})</label>
        </div>
        <input type="search" placeholder="Connaissement, délégué, camion" aria-label="Rechercher un convoi" value={q} onChange={(e) => setQ(e.target.value)} />
        {picked && <button className="btn btn-ghost" onClick={() => onPick(null)}>Saisie libre</button>}
      </div>
      {act.error && <ErrorBox message={act.error} />}
      {tab === 'todo' ? (todo.loading ? <Loading /> : (
        <Table rows={rowsTodo} empty="Aucun convoi en attente de pesée." columns={[
          { header: 'Connaissement', render: (v) => <strong>{v.convoy_no}</strong> },
          { header: 'Délégué', render: (v) => <>{v.collector_code ? <code>{v.collector_code}</code> : null} {v.collector_name}</> },
          { header: 'Camion', render: (v) => v.truck_no }, { header: 'Chauffeur', render: (v) => v.driver_name },
          { header: 'Sacs', align: 'right', render: (v) => v.declared_bags ?? '—' },
          { header: 'Poids déclaré', align: 'right', render: (v) => (v.declared_kg ? num(v.declared_kg) : '—') },
          { header: '', render: (v) => picked?.id === v.id ? <Badge tone="ok">Sélectionné</Badge> : <button className="btn btn-small" onClick={() => { onPick(v); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}>Peser ce convoi</button> },
        ]} />
      )) : (done.loading ? <Loading /> : (
        <Table rows={rowsDone} empty="Aucun convoi pesé." columns={[
          { header: 'Bulletin', render: (r) => r.bulletin_no }, { header: 'Date', render: (r) => date(r.received_at) },
          { header: 'Connaissement', render: (r) => r.convoy_no },
          { header: 'Délégué', render: (r) => <>{r.collector_code ? <code>{r.collector_code}</code> : null} {r.collector_name}</> },
          { header: 'Poids net', align: 'right', render: (r) => <strong>{num(r.total_kg)}</strong> },
          { header: 'État', render: (r) => (r.status === 'settled' ? <Badge tone="ok">Traitée</Badge> : r.status === 'pending_variance' ? <Badge tone="warn">Écart à valider</Badge> : <Badge tone="neutral">Pesée, attend la caisse</Badge>) },
          { header: '', render: (r) => <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={() => act.run(async () => setReceipt(await get(`/operation-receipts/convoy_reception/${r.id}`)))}>Bulletin</button> },
        ]} />
      ))}
      {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
    </Card>
  );
}
