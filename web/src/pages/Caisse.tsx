import { useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { useDeepLink } from '../notifTarget';
import { Card, ErrorBox, Field, Loading, PageHeader, useAction, useAsync } from '../ui';
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

type Key = 'cash' | 'variance' | 'accounts' | 'journal' | 'in' | 'out' | 'desk' | 'entry';
const GROUPS: { title: string; perm: string; items: [Key, string][] }[] = [
  { title: 'Opérations', perm: 'convoys:settle', items: [['cash', 'Traiter une pesée / régler un achat'], ['variance', 'Écarts de poids à valider']] },
  { title: 'Achats prod. agricole', perm: 'convoys:settle', items: [['cash', 'Journal des achats (pesées à traiter)']] },
  { title: 'Solde délégué', perm: 'convoys:settle', items: [['accounts', 'Solde et fiche des délégués']] },
  { title: 'Mouvements de caisse', perm: 'finance:read', items: [['desk', 'Ouvrir / fermer la caisse'], ['entry', 'Enregistrer une entrée / sortie'], ['journal', 'Mouvements de caisse'], ['in', 'Les entrées en caisse'], ['out', 'Les sorties de caisse']] },
];

/** Caisse : menu à gauche en rubriques dépliantes, journal de caisse avec solde d'ouverture et solde actuel. */
export default function Caisse() {
  const { can } = useAuth();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(([k]) => (k !== 'variance' || can('weighings:approve')) && (!['desk', 'entry'].includes(k) || can('cash:operate'))) })).filter((g) => can(g.perm) && g.items.length);
  const dl = useDeepLink(['cash', 'journal']);
  const first = (dl.tab as Key) ?? groups[0]?.items[0]?.[0] ?? 'journal';
  const [cur, setCur] = useState<Key>(first);
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
              {open === g.title && <ul>{g.items.map(([k, l]) => <li key={k + l}><button className={cur === k ? 'on' : ''} onClick={() => setCur(k)}>{l}</button></li>)}</ul>}
            </div>
          ))}
        </nav>
        <div className="caisse-main">
          {cur === 'cash' && <Cash />}
          {cur === 'variance' && <Variance />}
          {cur === 'accounts' && <Accounts />}
          {cur === 'desk' && <CashDesk />}
          {cur === 'entry' && <CashEntry />}
          {(cur === 'journal' || cur === 'in' || cur === 'out') && <Journal key={cur} kind={cur === 'in' ? 'in' : cur === 'out' ? 'out' : ''} />}
        </div>
      </div>
    </>
  );
}

export function Journal({ kind }: { kind: '' | 'in' | 'out' }) {
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date()));
  const [q, setQ] = useState({ from, to });
  const { data, loading, error, reload } = useAsync(() => get<any>(`/cash-journal?${new URLSearchParams({ from: q.from, to: q.to, ...(kind && { kind }) })}`), [q.from, q.to, kind]);
  const title = kind === 'in' ? 'Entrées en caisse' : kind === 'out' ? 'Sorties de caisse' : 'Journal de caisse';
  const pick = (p: Period) => { const r = range(p); if (r) { setFrom(r[0]); setTo(r[1]); setQ({ from: r[0], to: r[1] }); } };
  return (
    <Card>
      <div className="journal-head">
        <h2>{title} — période du {new Date(q.from).toLocaleDateString('fr-FR', { timeZone: 'UTC' })} au {new Date(q.to).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</h2>
        <div className="toolbar">
          <label>Date de début <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Date de fin <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
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
/** Ouverture (fonds de caisse) et fermeture (montant compté) de la session de caisse. */
function CashDesk() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ regs: await get<any[]>('/cash-registers'), accts: await get<any[]>('/financial-accounts').catch(() => [] as any[]) }), []);
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const act = useAction();
  return (
    <Card>
      <h2 className="win-title">Ouverture et fermeture de la caisse</h2>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}{msg && <p className="notice" role="status">{msg}</p>}
      {loading || !data ? <Loading /> : (
        <>
          {!data.regs.length && <p className="muted">Aucune caisse n'est créée.</p>}
          {data.regs.map((r) => {
            const bal = data.accts.find((a) => a.id === r.account_id)?.balance;
            const v = amount[r.id] ?? '';
            return (
              <fieldset key={r.id} className="bloc"><legend>{r.name} — {r.open_session_id ? 'session ouverte' : 'fermée'}</legend>
                {r.open_session_id && bal !== undefined && <p>Solde attendu : <strong>{FR(bal)}</strong> FCFA</p>}
                <div className="grid-2">
                  <Field label={r.open_session_id ? 'Montant compté en caisse (FCFA)' : 'Fonds de caisse à l\'ouverture (FCFA)'}><input inputMode="decimal" value={v} onChange={(e) => setAmount({ ...amount, [r.id]: e.target.value })} /></Field>
                  <div className="field-btn"><button className="btn" disabled={act.busy || !AMT.test(v)} onClick={() => act.run(async () => {
                    if (r.open_session_id) { const c = await post<any>(`/cash-sessions/${r.open_session_id}/close`, { counted_amount: v }); setMsg(`Caisse fermée. Écart compté − attendu : ${FR(c.variance ?? c.difference ?? 0)} FCFA.`); }
                    else { await post(`/cash-registers/${r.id}/sessions`, { opening_amount: v }); setMsg('Caisse ouverte.'); }
                    setAmount({ ...amount, [r.id]: '' }); reload();
                  })}>{r.open_session_id ? 'Fermer la caisse' : 'Ouvrir la caisse'}</button></div>
                </div>
              </fieldset>
            );
          })}
          {can('cash:manage') && <div className="toolbar"><input placeholder="Nom de la nouvelle caisse" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-secondary" disabled={act.busy || name.trim().length < 2} onClick={() => act.run(async () => { await post('/cash-registers', { name: name.trim() }); setName(''); reload(); })}>Créer une caisse</button></div>}
        </>
      )}
    </Card>
  );
}

/** Entrée ou sortie de caisse avec motif obligatoire ; une erreur se corrige par une écriture inverse. */
function CashEntry() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/cash-registers'), []);
  const open = (data ?? []).filter((r) => r.open_session_id);
  const [reg, setReg] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(idem());
  const [msg, setMsg] = useState('');
  const act = useAction();
  const regId = reg || open[0]?.id || '';
  const ok = regId && AMT.test(amount) && Number(amount) > 0 && reason.trim().length >= 3;
  return (
    <Card>
      <h2 className="win-title">Enregistrer une entrée ou une sortie de caisse</h2>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}{msg && <p className="notice" role="status">{msg}</p>}
      {loading ? <Loading /> : !open.length ? <p className="muted">Aucune caisse ouverte : ouvrez d'abord la caisse.</p> : (
        <fieldset className="bloc"><legend>Mouvement</legend>
          <div className="grid-2">
            <Field label="Caisse"><select value={regId} onChange={(e) => setReg(e.target.value)}>{open.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Sens"><span className="seg" role="radiogroup" aria-label="Sens">{([['in', 'Entrée'], ['out', 'Sortie']] as const).map(([k, l]) => <button key={k} className={dir === k ? 'on' : ''} onClick={() => setDir(k)}>{l}</button>)}</span></Field>
          </div>
          <div className="grid-2"><Field label="Montant (FCFA)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Motif (obligatoire)"><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field></div>
          <button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
            const r0 = open.find((r) => r.id === regId); await post('/financial-transactions', { idempotency_key: key, account_id: r0.account_id, cash_session_id: r0.open_session_id, direction: dir, amount, reason: reason.trim() });
            setMsg(`${dir === 'in' ? 'Entrée' : 'Sortie'} de ${FR(amount)} FCFA enregistrée.`); setAmount(''); setReason(''); setKey(idem());
          })}>Enregistrer</button>
        </fieldset>
      )}
    </Card>
  );
}
