import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { LOAN_KIND, date } from '../format';
import { Card, ErrorBox, Loading, PageHeader, Table, useAsync } from '../ui';
import { FR, Journal } from './Caisse';
import { Bic, Dues } from './Echeances';

type Key = 'journal' | 'expenses' | 'purchases' | 'settlements' | 'loans' | 'delegates' | 'exporters' | 'banks' | 'suppliers' | 'borrowings' | 'services' | 'sales' | 'taxes' | 'bic';
const PERM: Record<Key, string> = { journal: 'finance:read', expenses: 'finance:read', purchases: 'accounting:read', settlements: 'accounting:read', loans: 'loans:read', delegates: 'accounting:read', exporters: 'prefinancing:read', banks: 'finance:read', suppliers: 'dues:read', borrowings: 'dues:read', services: 'dues:read', sales: 'dues:read', taxes: 'dues:read', bic: 'dues:read' };
const ALL: { title: string; items: [Key, string][] }[] = [
  { title: 'Opérations', items: [['journal', 'Mouvements de caisse']] },
  { title: 'Dépenses', items: [['expenses', 'État des dépenses']] },
  { title: 'Achats prod. agricole', items: [['purchases', 'Journal des achats'], ['settlements', 'État des règlements']] },
  { title: 'Prêts', items: [['loans', 'État des prêts']] },
  { title: 'Délégués', items: [['delegates', 'Solde des délégués']] },
  { title: 'Exportateurs', items: [['exporters', 'État des exportateurs']] },
  { title: 'Banques et comptes', items: [['banks', 'État des comptes']] },
  { title: 'Fournisseurs', items: [['suppliers', 'Factures des fournisseurs']] },
  { title: 'Emprunts', items: [['borrowings', 'État des emprunts']] },
  { title: 'Prestations', items: [['services', 'État des prestations']] },
  { title: 'Ventes autres produits', items: [['sales', 'État des ventes']] },
  { title: 'Impôts', items: [['taxes', 'Impôts et taxes'], ['bic', 'Estimation du BIC']] },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Comptabilité : menu en rubriques dépliantes et états imprimables (journaux, prêts, soldes des délégués, exportateurs, comptes). */
export default function Comptabilite() {
  const { can } = useAuth();
  const GROUPS = ALL.map((g) => ({ ...g, items: g.items.filter(([k]) => can(PERM[k])) })).filter((g) => g.items.length);
  const [cur, setCur] = useState<Key>(GROUPS[0]?.items[0]?.[0] ?? 'journal');
  const [open, setOpen] = useState(GROUPS[0]?.title ?? '');
  const find = (k: Key) => GROUPS.find((g) => g.items.some(([x]) => x === k))!.title;
  return (
    <>
      <PageHeader title="Comptabilité" subtitle="États et journaux de la coopérative. Balance et écritures : onglet Comptabilité des Finances." actions={<Link className="btn btn-secondary" to="/finances?tab=accounting">Balance comptable</Link>} />
      <div className="caisse-layout">
        <nav className="accordion" aria-label="Menu de la comptabilité">
          {GROUPS.map((g) => (
            <div key={g.title} className={open === g.title ? 'open' : ''}>
              <button className="acc-head" aria-expanded={open === g.title} onClick={() => setOpen(open === g.title ? '' : g.title)}>{g.title}<span aria-hidden="true">{open === g.title ? '▴' : '▾'}</span></button>
              {open === g.title && <ul>{g.items.map(([k, l]) => <li key={k}><button className={cur === k ? 'on' : ''} onClick={() => { setCur(k); setOpen(find(k)); }}>{l}</button></li>)}</ul>}
            </div>
          ))}
        </nav>
        <div className="caisse-main">
          {cur === 'journal' && <Journal kind="" />}
          {cur === 'expenses' && <Journal kind="out" />}
          {cur === 'purchases' && <Purchases state="all" title="Journal des achats" />}
          {cur === 'settlements' && <Purchases state="settled" title="État des règlements" />}
          {cur === 'loans' && <Loans />}
          {cur === 'delegates' && <Delegates />}
          {cur === 'exporters' && <Exporters />}
          {cur === 'banks' && <Banks />}
          {cur === 'suppliers' && <Dues kind="supplier_invoice" />}
          {cur === 'borrowings' && <Dues kind="borrowing" />}
          {cur === 'services' && <Dues kind="service" />}
          {cur === 'sales' && <Dues kind="other_sale" />}
          {cur === 'taxes' && <Dues kind="tax" />}
          {cur === 'bic' && <Bic />}
        </div>
      </div>
    </>
  );
}

function Frame({ title, children, total }: { title: string; children: ReactNode; total?: ReactNode }) {
  return (
    <Card>
      <div className="journal-head"><h2>{title}</h2><div className="toolbar"><button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button></div></div>
      {children}
      {total && <div className="solde-bar totals">{total}</div>}
    </Card>
  );
}

function Purchases({ state, title }: { state: 'all' | 'settled'; title: string }) {
  const y = new Date().getFullYear();
  const [from, setFrom] = useState(`${y - (new Date().getMonth() < 8 ? 1 : 0)}-09-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/accounting/etats/pesees?${new URLSearchParams({ state, from, to, ...(q.trim() && { q: q.trim() }) })}`), [state, from, to, q]);
  const rows = data ?? [];
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <Frame title={`${title} — du ${date(from)} au ${date(to)}`} total={<><span>NOMBRE <b>{rows.length}</b></span><span>POIDS TOTAL <b>{FR(sum('total_kg'))}</b></span><span>MONTANT <b>{FR(sum('amount'))}</b></span></>}>
      <div className="toolbar pesees-filters"><label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <input type="search" placeholder="Fournisseur, code, connaissement" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <div className="pesees-table"><Table rows={rows} empty="Aucun achat sur la période." columns={[
        { header: 'Date', render: (r) => date(r.received_at) }, { header: 'N° connaissement', render: (r) => r.convoy_no }, { header: 'Bulletin', render: (r) => r.bulletin_no },
        { header: 'Sacs', align: 'right', render: (r) => r.bags ?? '' }, { header: 'Poids', align: 'right', render: (r) => FR(r.gross_kg) },
        { header: 'Réfaction', align: 'right', render: (r) => (Number(r.refaction_kg) ? FR(r.refaction_kg) : '') }, { header: 'Poids net', align: 'right', render: (r) => FR(r.total_kg) },
        { header: 'Prix kilo', align: 'right', render: (r) => FR(r.unit_price) }, { header: 'Net à payer', align: 'right', render: (r) => FR(r.amount) },
        { header: 'Origine', render: (r) => r.origin ?? '' }, { header: 'Fournisseur', render: (r) => `${r.collector_code ?? ''} : ${r.collector_name}` },
      ]} /></div>}
    </Frame>
  );
}

function Loans() {
  const [st, setSt] = useState<'open' | 'closed' | 'all'>('open');
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/loans'), []);
  const all = (data ?? []).filter((l) => ['disbursed', 'repaid'].includes(l.status));
  const rows = all.filter((l) => st === 'all' || (st === 'open' ? Number(l.remaining) > 0 : Number(l.remaining) <= 0));
  return (
    <Frame title="État des prêts" total={<><span>TOTAL <b>{FR(rows.reduce((s, l) => s + Number(l.approved_amount ?? 0), 0))}</b></span><span>RESTE À RÉGLER <b>{FR(rows.reduce((s, l) => s + Number(l.remaining ?? 0), 0))}</b></span></>}>
      <div className="seg" role="radiogroup" aria-label="Solde">{([['open', 'Non soldés'], ['closed', 'Soldés'], ['all', 'Tout']] as const).map(([k, l]) => <label key={k} className={st === k ? 'on' : ''}><input type="radio" name="loan-st" checked={st === k} onChange={() => setSt(k)} />{l}</label>)}</div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucun prêt décaissé." columns={[
        { header: 'Date', render: (l) => date(l.requested_at) }, { header: 'Type de prêt', render: (l) => LOAN_KIND[l.kind] ?? l.kind },
        { header: 'Montant', align: 'right', render: (l) => FR(Number(l.approved_amount)) }, { header: 'Réglé', align: 'right', render: (l) => FR(Number(l.approved_amount) - Number(l.remaining)) },
        { header: 'Reste à régler', align: 'right', render: (l) => <strong>{FR(Number(l.remaining))}</strong> }, { header: 'Bénéficiaire', render: (l) => l.borrower_name ?? '—' },
      ]} />}
    </Frame>
  );
}

function Delegates() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/accounting/etats/delegues'), []);
  const [q, setQ] = useState('');
  const rows = (data ?? []).filter((r) => !q.trim() || `${r.member_code ?? ''} ${r.name}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Frame title="État des soldes des délégués" total={<span>SOLDE <b>{FR(rows.reduce((s, r) => s + Number(r.solde), 0))}</b></span>}>
      <div className="toolbar"><input type="search" placeholder="Saisir le code ou le nom" aria-label="Code ou nom" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucun délégué." columns={[
        { header: 'ID', render: (r) => <code>{r.member_code ?? '—'}</code> }, { header: 'Nom', render: (r) => <strong>{r.name}</strong> }, { header: 'Contact', render: (r) => r.phone ?? '' },
        { header: 'Localité', render: (r) => r.origin ?? '' }, { header: 'Solde', align: 'right', render: (r) => <strong>{FR(Number(r.solde))}</strong> },
      ]} />}
      <p className="muted">Solde positif : le délégué doit ce montant à la coopérative (financements non encore couverts par ses livraisons).</p>
    </Frame>
  );
}

function Exporters() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => (can('prefinancing:read') ? get<any[]>('/prefinancings') : Promise.resolve([])), []);
  const by = new Map<string, number>();
  for (const p of data ?? []) if (p.status !== 'cancelled') by.set(p.funder, (by.get(p.funder) ?? 0) + Number(p.outstanding));
  const rows = [...by.entries()].map(([name, solde]) => ({ name, solde }));
  return (
    <Frame title="État des exportateurs" total={<span>SOLDE <b>{FR(rows.reduce((s, r) => s + r.solde, 0))}</b></span>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucun préfinancement." columns={[{ header: 'Nom', render: (r) => <strong>{r.name}</strong> }, { header: 'Solde (reste à rembourser)', align: 'right', render: (r) => FR(r.solde) }]} />}
    </Frame>
  );
}

function Banks() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/financial-accounts'), []);
  const rows = (data ?? []).filter((a) => a.owner_type !== 'collector' && a.owner_type !== 'producer');
  return (
    <Frame title="État des comptes" total={<span>SOLDE <b>{FR(rows.reduce((s, r) => s + Number(r.balance), 0))}</b></span>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucun compte." columns={[{ header: 'Compte', render: (a) => <strong>{a.name}</strong> }, { header: 'Type', render: (a) => (a.owner_type === 'cash_register' ? 'Caisse' : 'Compte') }, { header: 'Solde', align: 'right', render: (a) => FR(Number(a.balance)) }]} />}
    </Frame>
  );
}
