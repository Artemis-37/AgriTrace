import { useState } from 'react';
import { get } from '../api';
import { useAuth } from '../auth';
import { useDeepLink } from '../notifTarget';
import { Card, ErrorBox, Loading, PageHeader, useAsync } from '../ui';
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

type Key = 'cash' | 'variance' | 'accounts' | 'journal' | 'in' | 'out';
const GROUPS: { title: string; perm: string; items: [Key, string][] }[] = [
  { title: 'Opérations', perm: 'convoys:settle', items: [['cash', 'Traiter une pesée / régler un achat'], ['variance', 'Écarts de poids à valider']] },
  { title: 'Achats prod. agricole', perm: 'convoys:settle', items: [['cash', 'Journal des achats (pesées à traiter)']] },
  { title: 'Solde délégué', perm: 'convoys:settle', items: [['accounts', 'Solde et fiche des délégués']] },
  { title: 'Mouvements de caisse', perm: 'finance:read', items: [['journal', 'Mouvements de caisse'], ['in', 'Les entrées en caisse'], ['out', 'Les sorties de caisse']] },
];

/** Caisse : menu à gauche en rubriques dépliantes, journal de caisse avec solde d'ouverture et solde actuel. */
export default function Caisse() {
  const { can } = useAuth();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(([k]) => k !== 'variance' || can('weighings:approve')) })).filter((g) => can(g.perm) && g.items.length);
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
