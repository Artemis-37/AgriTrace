import { BankEvolution } from './Caisse';
import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { LOAN_KIND, date } from '../format';
import { Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';
import { FR, Journal } from './Caisse';
import { Bic, Dues, PeriodBar, campaignRange } from './Echeances';

type Key = string;
interface View { label: string; perm: string; el: () => ReactNode }
const V = (label: string, perm: string, el: () => ReactNode): View => ({ label, perm, el });
const GROUPS_ALL: { title: string; items: [Key, View][] }[] = [
  { title: 'Opérations', items: [['journal', V('Mouvements de caisse', 'finance:read', () => <Journal kind="" />)], ['deposits', V('Entrées en caisse', 'finance:read', () => <Journal kind="in" />)]] },
  { title: 'Dépenses', items: [['expenses', V('État des dépenses', 'finance:read', () => <Journal kind="out" />)]] },
  { title: 'Achats prod. agricole', items: [['purchases', V('Journal des achats', 'accounting:read', () => <Purchases state="all" title="Journal des achats" />)], ['settlements', V('État des règlements', 'accounting:read', () => <Purchases state="settled" title="État des règlements" />)]] },
  { title: 'Achats autres prod.', items: [['other-purchases', V('Achats d\'autres produits', 'dues:read', () => <Dues kind="supplier_invoice" />)]] },
  { title: 'Prêts', items: [['loans', V('État des prêts', 'loans:read', () => <Loans />)]] },
  { title: 'Ventes prod. agricoles', items: [['invoices', V('Factures de vente', 'invoices:read', () => <Invoices />)]] },
  { title: 'Ventes autres prod.', items: [['sales', V('État des ventes', 'dues:read', () => <Dues kind="other_sale" />)]] },
  { title: 'Les emprunts', items: [['borrow-new', V('Enregistrer un emprunt', 'dues:manage', () => <Dues kind="borrowing" startAdding key="bn" />)], ['borrowings', V('État des emprunts', 'dues:read', () => <Dues kind="borrowing" />)]] },
  { title: 'Prestations', items: [['services', V('État des prestations', 'dues:read', () => <Dues kind="service" />)]] },
  { title: 'Banques et comptes', items: [['banks', V('Les comptes', 'finance:read', () => <Banks />)], ['lenders', V('Les banques', 'partners:read', () => <Tiers kind="lender" title="Les banques et prêteurs" />)], ['withdrawals', V('État des retraits', 'finance:read', () => <Journal kind="out" />)], ['deposits2', V('État des dépôts', 'finance:read', () => <Journal kind="in" />)], ['all-tx', V('État global des transactions', 'finance:read', () => <Journal kind="" />)]] },
  { title: 'Délégués', items: [['delegates', V('Solde des délégués', 'accounting:read', () => <Delegates />)]] },
  { title: 'Exportateurs', items: [['exporters', V('État des exportateurs', 'prefinancing:read', () => <Exporters />)]] },
  { title: 'Impôts', items: [['taxes', V('Impôts et taxes', 'dues:read', () => <Dues kind="tax" />)], ['bic', V('BIC', 'dues:read', () => <Bic />)]] },
  { title: 'Fournisseurs', items: [['suppliers', V('Les fournisseurs', 'partners:read', () => <Tiers kind="supplier" title="Les fournisseurs" />)], ['supplier-invoices', V('Factures des fournisseurs', 'dues:read', () => <Dues kind="supplier_invoice" />)]] },
  { title: 'Journaux', items: [['j-cash', V('Journal de caisse', 'finance:read', () => <Journal kind="" />)], ['j-borrow', V('Journal des emprunts', 'dues:read', () => <Dues kind="borrowing" />)], ['j-loans', V('Journal des prêts', 'loans:read', () => <Loans />)], ['j-purchases', V('Journal des achats', 'accounting:read', () => <Purchases state="all" title="Journal des achats" />)],
    ['j-sales', V('Journal des ventes', 'invoices:read', () => <Invoices />)], ['j-settle', V('Journal des règlements', 'accounting:read', () => <Purchases state="settled" title="Journal des règlements" />)], ['j-banks', V('Journal des banques', 'finance:read', () => <Banks />)]] },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Comptabilité : menu en rubriques dépliantes et états imprimables (journaux, prêts, soldes des délégués, exportateurs, comptes). */
export default function Comptabilite() {
  const { can } = useAuth();
  const GROUPS = GROUPS_ALL.map((g) => ({ ...g, items: g.items.filter(([, v]) => can(v.perm)) })).filter((g) => g.items.length);
  const first = GROUPS[0]?.items[0]?.[0] ?? 'journal';
  const [cur, setCur] = useState<Key>(first);
  const [open, setOpen] = useState(GROUPS[0]?.title ?? '');
  const view = GROUPS.flatMap((g) => g.items).find(([k]) => k === cur)?.[1];
  return (
    <>
      <PageHeader title="Comptabilité" subtitle="États et journaux de la coopérative. Balance et écritures : onglet Comptabilité des Finances." actions={<Link className="btn btn-secondary" to="/finances?tab=accounting">Balance comptable</Link>} />
      <div className="caisse-layout">
        <nav className="accordion" aria-label="Menu de la comptabilité">
          {GROUPS.map((g) => (
            <div key={g.title} className={open === g.title ? 'open' : ''}>
              <button className="acc-head" aria-expanded={open === g.title} onClick={() => setOpen(open === g.title ? '' : g.title)}>{g.title}<span aria-hidden="true">{open === g.title ? '▴' : '▾'}</span></button>
              {open === g.title && <ul>{g.items.map(([k, v]) => <li key={k}><button className={cur === k ? 'on' : ''} onClick={() => setCur(k)}>{v.label}</button></li>)}</ul>}
            </div>
          ))}
        </nav>
        <div className="caisse-main">{view?.el()}</div>
      </div>
    </>
  );
}

/** Liste simple des tiers d'une rubrique (fournisseurs, banques) ; la gestion se fait dans le menu Partenaires. */
function Tiers({ kind, title }: { kind: string; title: string }) {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/partners?kind=${kind}`), [kind]);
  return (
    <Frame title={title} total={<span>NOMBRE <b>{(data ?? []).length}</b></span>}>
      {can('partners:manage') && <div className="toolbar"><Link className="btn" to="/partenaires">Ajouter ou modifier</Link></div>}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun élément." columns={[{ header: 'Nom', render: (p) => <strong>{p.name}</strong> }, { header: 'Téléphone', render: (p) => p.phone ?? '' }, { header: 'Adresse', render: (p) => p.address ?? '' }, { header: 'N° contribuable', render: (p) => p.tax_id ?? '' }]} />}
    </Frame>
  );
}

/** Factures de vente (produits agricoles) sur la période, avec le reste à encaisser. */
function Invoices() {
  const [[from, to], setRange] = useState<[string, string]>(campaignRange());
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/invoices'), []);
  const rows = (data ?? []).filter((i) => String(i.issue_date).slice(0, 10) >= from && String(i.issue_date).slice(0, 10) <= to && i.status !== 'cancelled');
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <Frame title={`Les ventes de produits agricoles du ${date(from)} au ${date(to)}`} total={<><span>TOTAL <b>{FR(sum('total'))}</b></span><span>ENCAISSÉ <b>{FR(sum('paid'))}</b></span><span>RESTE <b>{FR(sum('balance'))}</b></span></>}>
      <PeriodBar key={`${from}${to}`} from={from} to={to} onShow={(f, t) => setRange([f, t])} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucune facture sur la période." columns={[
        { header: 'N°', render: (r) => r.number }, { header: 'Date', render: (r) => date(r.issue_date) }, { header: 'Client', render: (r) => r.buyer_name }, { header: 'Échéance', render: (r) => date(r.due_date) },
        { header: 'Montant', align: 'right', render: (r) => FR(r.total) }, { header: 'Encaissé', align: 'right', render: (r) => FR(r.paid) }, { header: 'Reste', align: 'right', render: (r) => <strong>{FR(r.balance)}</strong> },
      ]} />}
    </Frame>
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
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/financial-accounts'), []);
  const rows = (data ?? []).filter((a) => a.owner_type !== 'collector' && a.owner_type !== 'producer');
  const [adding, setAdding] = useState(false);
  const [evo, setEvo] = useState<string | null>(null);
  const [name, setName] = useState(''); const [num, setNum] = useState(''); const [open0, setOpen0] = useState('');
  const act = useAction();
  return (
    <Frame title="État des comptes bancaires et caisses" total={<span>SOLDE <b>{FR(rows.reduce((s, r) => s + Number(r.balance), 0))}</b></span>}>
      {can('cash:manage') && <div className="toolbar"><button className="btn" onClick={() => setAdding(true)}>Nouveau</button></div>}
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucun compte." columns={[{ header: 'N°', render: (a) => rows.indexOf(a) + 1 }, { header: 'Compte', render: (a) => <strong>{a.name}</strong> }, { header: 'N° de compte', render: (a) => a.account_number ?? '—' }, { header: 'Type', render: (a) => (a.owner_type === 'cash_register' ? 'Caisse' : 'Compte bancaire') }, { header: 'Solde', align: 'right', render: (a) => <strong>{FR(Number(a.balance))}</strong> }, { header: '', render: (a) => a.owner_type === 'other' && <button className="btn btn-small btn-secondary" onClick={() => setEvo(a.id)}>Évolution</button> }]} />}
      {evo && <Modal title="Évolution du compte" onClose={() => setEvo(null)}><BankEvolution accountId={evo} /></Modal>}
      {adding && <Modal title="Nouveau compte" onClose={() => setAdding(false)}>
        <Field label="Banque (ou nom du compte)"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
        <Field label="N° de compte"><input value={num} onChange={(e) => setNum(e.target.value)} maxLength={60} /></Field>
        <Field label="Solde initial (FCFA)" hint="Entrée tracée « Solde initial » dans le compte ; laissez vide si le compte est à zéro."><input inputMode="decimal" value={open0} onChange={(e) => setOpen0(e.target.value)} maxLength={18} /></Field>
        <div className="modal-actions"><button className="btn" disabled={act.busy || name.trim().length < 2 || (open0.trim() !== '' && !/^\d+([.,]\d{1,4})?$/.test(open0.trim()))} onClick={() => act.run(async () => { await post('/financial-accounts', { owner_type: 'other', name: num.trim() ? `${name.trim()} ${num.trim()}` : name.trim(), bank_name: name.trim(), ...(num.trim() && { account_number: num.trim() }), ...(open0.trim() && { opening_balance: open0.trim().replace(',', '.') }) }); setAdding(false); setName(''); setNum(''); setOpen0(''); reload(); })}>Enregistrer</button><button className="btn btn-ghost" onClick={() => setAdding(false)}>Annuler</button></div>
      </Modal>}
    </Frame>
  );
}
