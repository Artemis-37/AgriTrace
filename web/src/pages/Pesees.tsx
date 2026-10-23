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
  const [adding, setAdding] = useState(autoNew && can('convoys:receive'));
  const [receipt, setReceipt] = useState<any | null>(null);
  const act = useAction();
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/convoys/receptions?${new URLSearchParams({ state, ...(q.trim() && { q: q.trim() }), ...(from && { from }), ...(to && { to }) })}`), [state, q, from, to]);
  const rows = data ?? [];
  const done = rows.filter((r) => r.status === 'settled'), todo = rows.filter((r) => r.status !== 'settled');
  const STATE: [State, string][] = [['pending', 'Non traitées'], ['settled', 'Traitées'], ['all', 'Toutes']];
  if (adding) return <><p><button className="btn btn-ghost" onClick={() => { setAdding(false); reload(); }}>← Retour à la liste des pesées</button></p><Receive /></>;
  return (
    <Card>
      <div className="toolbar pesees-filters">
        <div className="seg" role="radiogroup" aria-label="État de traitement">
          {STATE.map(([k, l]) => <label key={k} className={state === k ? 'on' : ''}><input type="radio" name="pesee-state" checked={state === k} onChange={() => setState(k)} />{l}</label>)}
        </div>
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
            { header: 'Sacs', align: 'right', render: (r) => r.bags ?? '—' },
            { header: 'Poids brut', align: 'right', render: (r) => (r.gross_kg ? num(r.gross_kg) : '—') },
            { header: 'Réfaction', align: 'right', render: (r) => (Number(r.refaction_kg) ? num(r.refaction_kg) : '—') },
            { header: 'Poids net', align: 'right', render: (r) => <strong>{num(r.total_kg)}</strong> },
            { header: 'Prix/kg', align: 'right', render: (r) => (r.unit_price ? num(r.unit_price) : '—') },
            { header: 'Net à payer', align: 'right', render: (r) => (r.amount ? num(r.amount) : '—') },
            { header: 'Origine', render: (r) => r.origin ?? '—' },
            { header: 'Délégué', render: (r) => <>{r.collector_code ? <code>{r.collector_code}</code> : null} {r.collector_name}</> },
            { header: 'État', render: (r) => (r.status === 'settled' ? <Badge tone="ok">Traitée</Badge> : r.status === 'pending_variance' ? <Badge tone="warn">Écart à valider</Badge> : <Badge tone="neutral">Non traitée</Badge>) },
            { header: '', render: (r) => <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={() => act.run(async () => setReceipt(await get(`/operation-receipts/convoy_reception/${r.id}`)))}>Bulletin</button> },
          ]} /></div>
          <div className="totals" role="status">
            <span>Nombre <strong>{rows.length}</strong></span>
            <span>Poids net total <strong>{num(sum(rows, 'total_kg'))} kg</strong></span>
            <span>Traité <strong>{num(sum(done, 'total_kg'))} kg</strong></span>
            <span>Non traité <strong>{num(sum(todo, 'total_kg'))} kg</strong></span>
          </div>
        </>
      )}
            {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
    </Card>
  );
}
