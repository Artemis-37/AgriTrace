import { useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { useDeepLink } from '../notifTarget';
import { Card, ErrorBox, Field, Loading, PageHeader, useAction, useAsync } from '../ui';
import { PeekLink, usePeek } from '../peek';
import { Accounts, Cash, Variance } from './Convois';

export const FR = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }));
const iso = (d: Date) => d.toISOString().slice(0, 10);
type Period = '' | 'today' | 'week' | 'month' | 'year';
const range = (p: Period): [string, string] | null => {
  const n = new Date(), t = iso(n);
  if (p === 'today') return [t, t];
  if (p === 'week') { const d = new Date(n); d.setDate(n.getDate() - ((n.getDay() + 6) % 7)); return [iso(d), t]; }
  if (p === 'month') return [`${t.slice(0, 8)}01`, t];
  if (p === 'year') return [`${n.getFullYear()}-01-01`, t];
  return null;
};

type Key = 'cash' | 'variance' | 'accounts' | 'journal' | 'in' | 'out' | 'desk' | 'entry' | 'bank';
const GROUPS: { title: string; perm: string; items: [Key, string][] }[] = [
  { title: 'Opérations', perm: 'convoys:settle', items: [['cash', 'Traiter une pesée / régler un achat'], ['variance', 'Écarts de poids à valider']] },
  { title: 'Achats prod. agricole', perm: 'convoys:settle', items: [['cash', 'Journal des achats (pesées à traiter)']] },
  { title: 'Solde délégué', perm: 'convoys:settle', items: [['accounts', 'Solde et fiche des délégués']] },
  { title: 'Mouvements de caisse', perm: 'finance:read', items: [['desk', 'Créer une caisse'], ['entry', 'Enregistrer une entrée / sortie'], ['journal', 'Mouvements de caisse'], ['in', 'Les entrées en caisse'], ['out', 'Les sorties de caisse'], ['bank', 'Évolution des comptes bancaires']] },
];

/** Rubriques de saisie courte : elles s'ouvrent en fenêtre contextuelle centrée ; les états larges (journaux, soldes, listes) restent dans l'écran. */
const SMALL: Key[] = ['entry', 'desk'];

/** Caisse : menu à gauche en rubriques dépliantes, journal de caisse avec solde d'ouverture et solde actuel. */
export default function Caisse() {
  const { can } = useAuth();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(([k]) => (k !== 'variance' || can('weighings:approve')) && (k !== 'entry' || can('cash:operate')) && (k !== 'desk' || can('cash:manage'))) })).filter((g) => can(g.perm) && g.items.length);
  const dl = useDeepLink(['cash', 'journal']);
  const first = (dl.tab as Key) ?? groups[0]?.items[0]?.[0] ?? 'journal';
  const [cur, setCur] = useState<Key>(first);
  const peek = usePeek();
  const [tick, setTick] = useState(0); // rechargement de l'écran de fond à la fermeture d'une fenêtre
  const view = (k: Key) => (k === 'cash' ? <Cash /> : k === 'variance' ? <Variance /> : k === 'accounts' ? <Accounts /> : k === 'desk' ? <CashDesk /> : k === 'entry' ? <CashEntry /> : k === 'bank' ? <BankEvolution /> : <Journal kind={k === 'in' ? 'in' : k === 'out' ? 'out' : ''} />);
  const [open, setOpen] = useState<string>(groups.find((g) => g.items.some(([k]) => k === first))?.title ?? groups[0]?.title ?? '');
  if (!groups.length) return <Card><p className="muted">Votre rôle ne donne accès à aucune opération de caisse.</p></Card>;
  return (
    <>
      <PageHeader title="Gestion de la caisse" subtitle="Opérations de caisse, soldes des délégués et journal. Une erreur se corrige par une écriture inverse." />
      <div className="caisse-layout">
        <nav className="accordion" aria-label="Menu de la caisse">
          {groups.map((g) => (
            <div key={g.title} className={open === g.title ? 'open' : ''}>
              <button className="acc-head" aria-expanded={open === g.title} onClick={() => setOpen(open === g.title ? '' : g.title)}>{g.title}<span aria-hidden="true">{open === g.title ? '▴' : '▾'}</span></button>
              {open === g.title && <ul>{g.items.map(([k, l]) => <li key={k + l}><button className={cur === k ? 'on' : ''} onClick={() => (SMALL.includes(k) ? peek.open(l, view(k), () => setTick((t) => t + 1)) : setCur(k))}>{l}</button></li>)}</ul>}
            </div>
          ))}
        </nav>
        <div className="caisse-main" key={tick}>
          <FundBar />
          {view(cur)}
        </div>
      </div>
    </>
  );
}

export function Journal({ kind }: { kind: '' | 'in' | 'out' }) {
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date()));
  const [q, setQ] = useState({ from, to });
  const [fund, setFund] = useState('');
  const banks = useAsync(async () => (await get<any[]>('/financial-accounts').catch(() => [] as any[])).filter((a) => a.owner_type === 'other' && a.status === 'active'), []);
  const { data, loading, error, reload } = useAsync(() => get<any>(`/cash-journal?${new URLSearchParams({ from: q.from, to: q.to, ...(kind && { kind }), ...(fund && { account_id: fund }) })}`), [q.from, q.to, kind, fund]);
  const title = kind === 'in' ? 'Entrées en caisse' : kind === 'out' ? 'Sorties de caisse' : 'Journal de caisse';
  const pick = (p: Period) => { const r = range(p); if (r) { setFrom(r[0]); setTo(r[1]); setQ({ from: r[0], to: r[1] }); } };
  return (
    <Card>
      <div className="journal-head">
        <h2>{title} — période du {new Date(q.from).toLocaleDateString('fr-FR', { timeZone: 'UTC' })} au {new Date(q.to).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</h2>
        <div className="toolbar">
          <label>Date de début <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Date de fin <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <select aria-label="Fonds" value={fund} onChange={(e) => setFund(e.target.value)}><option value="">Fonds : espèces (caisse)</option>{(banks.data ?? []).map((b: any) => <option key={b.id} value={b.id}>Compte bancaire : {b.name}</option>)}</select>
          <select aria-label="Période prédéfinie" value="" onChange={(e) => pick(e.target.value as Period)}>
            <option value="">Période prédéfinie</option><option value="today">Aujourd'hui</option><option value="week">Cette semaine</option><option value="month">Ce mois</option><option value="year">Cette année</option>
          </select>
          <button className="btn" onClick={() => (from === q.from && to === q.to ? reload() : setQ({ from, to }))}>Afficher</button>
          <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading || !data ? <Loading /> : (
        <>
          <div className="solde-bar"><span>SOLDE OUVERTURE <b>{FR(data.opening)}</b></span><span className="big">SOLDE ACTUEL <b>{FR(data.closing)}</b></span></div>
          <div className="tw"><table>
            <thead><tr><th>N°</th><th>Date</th><th>Heure</th><th>Libellé</th><th className="r">Sortie</th><th className="r">Entrée</th><th className="r">Solde</th></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id} className={r.reversal ? 'muted' : ''}><td>{r.n}</td><td>{new Date(r.at).toLocaleDateString('fr-FR')}</td><td>{new Date(r.at).toLocaleTimeString('fr-FR')}</td>
                  <td>{r.label}{r.reversal ? ' (écriture inverse)' : ''}</td><td className="r">{FR(r.out)}</td><td className="r">{FR(r.in)}</td><td className="r"><strong>{FR(r.balance)}</strong></td></tr>
              ))}
              {!data.rows.length && <tr><td colSpan={7} className="muted">Aucun mouvement sur la période.</td></tr>}
            </tbody></table></div>
          <div className="solde-bar totals"><span>ENTRÉES <b>{FR(data.total_in)}</b></span><span>SORTIES <b>{FR(data.total_out)}</b></span><span>SOLDE <b>{FR(data.total_in - data.total_out)}</b></span></div>
        </>
      )}
    </Card>
  );
}

const AMT = /^\d{1,12}(\.\d{1,2})?$/;
/** Connexion du caissier à la caisse. La caisse ne se clôture pas (elle n'encaisse pas : bons de sortie, chèques, paiements en espèces) : le caissier se connecte et se déconnecte, sans fonds d'ouverture ni comptage. */
function CashDesk() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/cash-registers'), []);
  const [name, setName] = useState('');
  const act = useAction();
  return (
    <Card>
      <h2 className="win-title">Créer une caisse</h2>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading || !data ? <Loading /> : (
        <>
          <ul>{data.map((r) => <li key={r.id}>{r.name}</li>)}{!data.length && <li className="muted">Aucune caisse n'est créée.</li>}</ul>
          <div className="toolbar"><input placeholder="Nom de la nouvelle caisse" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={act.busy || name.trim().length < 2} onClick={() => act.run(async () => { await post('/cash-registers', { name: name.trim() }); setName(''); reload(); })}>Créer la caisse</button></div>
        </>
      )}
    </Card>
  );
}

/** Évolution d'un compte bancaire : solde d'ouverture, ce qui y est ajouté (+) ou soustrait (−), solde cumulé et courbe du solde. Réservé aux détenteurs du droit finance:read (caisse, comptabilité, direction…). */
export function BankEvolution({ accountId }: { accountId?: string }) {
  const [acc, setAcc] = useState(accountId ?? '');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [q, setQ] = useState({ from, to });
  const banks = useAsync(async () => (await get<any[]>('/financial-accounts')).filter((a) => a.owner_type === 'other'), []);
  const id = acc || banks.data?.[0]?.id || '';
  const { data, loading, error, reload } = useAsync(() => (id ? get<any>(`/financial-accounts/${id}/statement?from=${q.from}&to=${q.to}`) : Promise.resolve(null)), [id, q.from, q.to]);
  const pts: { date: string; balance: number }[] = data ? [{ date: q.from, balance: data.opening }, ...data.series] : [];
  const W = 640, H = 120, min = Math.min(...pts.map((p) => p.balance), 0), max = Math.max(...pts.map((p) => p.balance), 1);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${pts.length > 1 ? (i / (pts.length - 1)) * W : 0},${H - ((p.balance - min) / (max - min || 1)) * (H - 10) - 5}`).join(' ');
  return (
    <Card>
      <h2 className="win-title">Évolution des comptes bancaires</h2>
      <div className="toolbar">
        {!accountId && <label>Compte <select value={id} onChange={(e) => setAcc(e.target.value)}>{(banks.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn" onClick={() => (from === q.from && to === q.to ? reload() : setQ({ from, to }))}>Afficher</button>
        <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!id && !banks.loading ? <p className="muted">Aucun compte bancaire. Créez-le dans Comptabilité → États des comptes.</p> : loading || !data ? <Loading /> : (
        <>
          <div className="solde-bar"><span>SOLDE OUVERTURE <b>{FR(data.opening)}</b></span><span>AJOUTÉ (+) <b>{FR(data.total_in)}</b></span><span>SOUSTRAIT (−) <b>{FR(data.total_out)}</b></span><span className="big">SOLDE <b>{FR(data.closing)}</b></span></div>
          {pts.length > 1 && <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution du solde du compte" style={{ width: '100%', maxHeight: 140 }}><path d={path} fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
          <div className="tw"><table>
            <thead><tr><th>N°</th><th>Date</th><th>Heure</th><th>Libellé</th><th className="r">Soustrait (−)</th><th className="r">Ajouté (+)</th><th className="r">Solde</th><th>Opérateur</th></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id} className={r.reversal ? 'muted' : ''}><td>{r.n}</td><td>{new Date(r.at).toLocaleDateString('fr-FR')}</td><td>{new Date(r.at).toLocaleTimeString('fr-FR')}</td><td>{r.label}{r.reversal ? ' (écriture inverse)' : ''}</td>
                  <td className="r">{FR(r.out)}</td><td className="r">{FR(r.in)}</td><td className="r"><strong>{FR(r.balance)}</strong></td><td>{r.by ?? ''}</td></tr>
              ))}
              {!data.rows.length && <tr><td colSpan={8} className="muted">Aucun mouvement sur la période.</td></tr>}
            </tbody></table></div>
        </>
      )}
    </Card>
  );
}

/** Entrée ou sortie de caisse avec motif obligatoire ; une erreur se corrige par une écriture inverse. */
function CashEntry() {
  const { data, loading, error, reload } = useAsync(async () => ({ regs: await get<any[]>('/cash-registers'), banks: (await get<any[]>('/financial-accounts').catch(() => [] as any[])).filter((a) => a.owner_type === 'other' && a.status === 'active') }), []);
  const open = (data?.regs ?? []).filter((r) => r.open_session_id);
  const banks = data?.banks ?? [];
  const [mode, setMode] = useState<'cash' | 'bank'>('cash');
  const [bank, setBank] = useState('');
  const [reg, setReg] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(idem());
  const [msg, setMsg] = useState('');
  const act = useAction();
  const regId = reg || open[0]?.id || '';
  const bankId = bank || banks[0]?.id || '';
  const ok = regId && (mode === 'cash' || bankId) && AMT.test(amount) && Number(amount) > 0 && reason.trim().length >= 3;
  return (
    <Card>
      <h2 className="win-title">Enregistrer une entrée ou une sortie de caisse</h2>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}{msg && <p className="notice" role="status">{msg}</p>}
      {loading ? <Loading /> : !open.length ? <p className="muted">Aucune caisse connectée : le caissier doit d'abord se connecter à la caisse.</p> : (
        <fieldset className="bloc"><legend>Mouvement</legend>
          <div className="grid-2">
            <Field label="Caisse"><select value={regId} onChange={(e) => setReg(e.target.value)}>{open.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Mode (fonds de la caisse)"><span className="seg" role="radiogroup" aria-label="Mode">{([['cash', 'Espèces'], ['bank', 'Compte bancaire']] as const).map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</span></Field>
          </div>
          <div className="grid-2">
            {mode === 'bank' && <Field label="Banque (compte)" hint={banks.length ? undefined : 'Aucun compte bancaire : créez-le dans Comptabilité → États des comptes.'}><select value={bankId} onChange={(e) => setBank(e.target.value)}>{banks.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
            <Field label="Sens"><span className="seg" role="radiogroup" aria-label="Sens">{([['in', 'Entrée'], ['out', 'Sortie']] as const).map(([k, l]) => <button key={k} className={dir === k ? 'on' : ''} onClick={() => setDir(k)}>{l}</button>)}</span></Field>
          </div>
          <div className="grid-2"><Field label="Montant (FCFA)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Motif (obligatoire)"><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></div>
          <button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
            const r0 = open.find((r) => r.id === regId); await post('/financial-transactions', { idempotency_key: key, account_id: mode === 'bank' ? bankId : r0.account_id, cash_session_id: r0.open_session_id, direction: dir, amount, reason: reason.trim() });
            setMsg(`${dir === 'in' ? 'Entrée' : 'Sortie'} de ${FR(amount)} FCFA enregistrée ${mode === 'bank' ? `sur le compte ${banks.find((b: any) => b.id === bankId)?.name ?? ''}` : 'en espèces'}.`); setAmount(''); setReason(''); setKey(idem());
          })}>Enregistrer</button>
        </fieldset>
      )}
    </Card>
  );
}

/** Fonds disponible de la caisse = espèces + comptes bancaires, visible en permanence. */
export function FundBar() {
  const { data } = useAsync(() => get<any[]>('/financial-accounts').catch(() => [] as any[]), []);
  if (!data) return null;
  const cash = data.filter((a) => a.owner_type === 'cash_register').reduce((t, a) => t + Number(a.balance), 0);
  const banks = data.filter((a) => a.owner_type === 'other');
  const bank = banks.reduce((t, a) => t + Number(a.balance), 0);
  return (
    <div className="solde-bar" role="status" aria-label="Fonds disponible de la caisse">
      <span><PeekLink title="Mouvements de caisse (espèces)" label="ESPÈCES" render={() => <Journal kind="" />} /> <b>{FR(cash)}</b></span>
      {banks.map((b) => <span key={b.id}><PeekLink title={`Évolution du compte — ${b.name}`} label={b.name.toUpperCase()} render={() => <BankEvolution accountId={b.id} />} /> <b>{FR(b.balance)}</b></span>)}
      <span className="big">FONDS DISPONIBLE <b>{FR(cash + bank)}</b> FCFA</span>
    </div>
  );
}
