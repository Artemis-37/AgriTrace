import { useState } from 'react';
import { useAuth } from '../auth';
import { download, get } from '../api';
import { kg, money } from '../format';
import { Card, ErrorBox, Field, Loading, PageHeader, Stat, Table, useAsync } from '../ui';

const GROUPS: [string, string][] = [['section', 'Section'], ['village', 'Village'], ['collector', 'Collecteur'], ['chain', 'Filière'], ['day', 'Jour']];

/** Rapports d'achats filtrables par période, section, collecteur et filière (CDC §26), exportables vers Excel. */
const OUTCOME: Record<string, string> = { compliant: 'Conforme', to_review: 'À revoir', non_compliant: 'Non conforme', pending: 'En cours' };
const KIND: Record<string, string> = { field: 'Terrain', quality: 'Qualité', compliance: 'Conformité' };
const MOVE: Record<string, string> = { reception: 'Réception', entry: 'Entrée', exit: 'Sortie', transfer_in: 'Transfert entrant', transfer_out: 'Transfert sortant', loss: 'Perte', adjustment_in: 'Ajustement +', adjustment_out: 'Ajustement −', split_in: 'Scission +', split_out: 'Scission −', merge_in: 'Fusion +', merge_out: 'Fusion −' };

/** Rapports finance, stock et qualité sur une période, avec export Excel (CDC §26). */
function Unified({ kind }: { kind: 'finance' | 'stock' | 'quality' }) {
  const [p, setP] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString();
  const { data: d, loading, error, reload } = useAsync(() => get<any>(`/reports/${kind}?${qs}`), [kind, p.from, p.to]);
  const file = { finance: 'Rapport_financier.xlsx', stock: 'Rapport_stock.xlsx', quality: 'Rapport_qualite.xlsx' }[kind];
  return (
    <>
      <Card>
        <div className="filters">
          <Field label="Du"><input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></Field>
          <Field label="Au"><input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></Field>
          <button className="btn btn-secondary" onClick={() => download(`/reports/${kind}/xlsx?${qs}`, file).catch(() => undefined)}>Exporter vers Excel</button>
        </div>
      </Card>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : d && kind === 'finance' && (
        <>
          <div className="stats">
            <Stat label="Trésorerie (comptes)" value={money(d.totals.treasury)} tone="ok" /><Stat label="Facturé sur la période" value={money(d.sales.invoiced)} />
            <Stat label="Créances à encaisser" value={money(d.sales.receivable)} tone="warn" /><Stat label="Dont échues" value={money(d.sales.overdue)} tone={Number(d.sales.overdue) > 0 ? 'bad' : 'neutral'} />
            <Stat label="Avoirs émis" value={money(d.sales.credited)} /><Stat label="Dû aux collecteurs" value={money(d.totals.owed_to_collectors)} tone="info" />
          </div>
          <Card><Table rows={d.accounts} empty="Aucun compte." columns={[{ header: 'Compte', render: (r: any) => <strong>{r.name}</strong> }, { header: 'Entrées', align: 'right', render: (r: any) => money(r.inflow, r.currency) },
            { header: 'Sorties', align: 'right', render: (r: any) => money(r.outflow, r.currency) }, { header: 'Solde', align: 'right', render: (r: any) => money(r.balance, r.currency) }]} /></Card>
          {d.prefinancing.length > 0 && <p className="notice">Préfinancement à rembourser : {d.prefinancing.map((x: any) => money(x.outstanding, x.currency)).join(' · ')}.</p>}
        </>
      )}
      {!loading && !error && d && kind === 'stock' && (
        <>
          <div className="stats"><Stat label="Stock total" value={kg(d.totals.kg)} tone="ok" /><Stat label="Pertes de la période" value={kg(d.totals.loss_kg)} tone={d.totals.loss_kg > 0 ? 'warn' : 'neutral'} /></div>
          <Card><Table rows={d.balances} empty="Aucun stock." columns={[{ header: 'Entrepôt', render: (r: any) => <strong>{r.warehouse}</strong> }, { header: 'Filière', render: (r: any) => r.chain },
            { header: 'Lots', align: 'right', render: (r: any) => r.lots }, { header: 'Stock', align: 'right', render: (r: any) => kg(r.kg) }]} /></Card>
          <Card><Table rows={d.flows} empty="Aucun mouvement sur la période." columns={[{ header: 'Mouvement', render: (r: any) => MOVE[r.type] ?? r.type }, { header: 'Sens', render: (r: any) => (r.direction === 'in' ? 'Entrée' : 'Sortie') },
            { header: 'Nombre', align: 'right', render: (r: any) => r.movements }, { header: 'Quantité', align: 'right', render: (r: any) => kg(r.kg) }]} /></Card>
        </>
      )}
      {!loading && !error && d && kind === 'quality' && (
        <>
          <div className="stats"><Stat label="Inspections" value={d.totals.inspections} /><Stat label="Conformes" value={d.totals.compliant} tone="ok" /><Stat label="Taux de conformité" value={d.totals.rate === null ? '—' : `${d.totals.rate} %`} tone="info" /></div>
          <Card><Table rows={d.inspections} empty="Aucune inspection sur la période." columns={[{ header: 'Nature', render: (r: any) => KIND[r.kind] ?? r.kind }, { header: 'Résultat', render: (r: any) => OUTCOME[r.outcome] ?? r.outcome }, { header: 'Nombre', align: 'right', render: (r: any) => r.n }]} /></Card>
          <Card><Table rows={d.failing_rules} empty="Aucune règle en échec." columns={[{ header: 'Règle', render: (r: any) => <strong>{r.label}</strong> }, { header: 'Bloquante', render: (r: any) => (r.blocking ? 'Oui' : 'Non') }, { header: 'Échecs', align: 'right', render: (r: any) => r.failures }]} /></Card>
        </>
      )}
    </>
  );
}

export default function Rapports() {
  const { can } = useAuth();
  const tabs: [string, string][] = [['purchases', 'Achats'], ...(can('finance:read') ? [['finance', 'Finance'] as [string, string]] : []), ...(can('warehouses:read') ? [['stock', 'Stock'] as [string, string]] : []), ...(can('quality:read') ? [['quality', 'Qualité'] as [string, string]] : [])];
  const [tab, setTab] = useState('purchases');
  return (
    <>
      {tabs.length > 1 && <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === 'purchases' ? <Achats /> : <><PageHeader title={`Rapport ${tabs.find(([k]) => k === tab)?.[1].toLowerCase()}`} subtitle="Synthèse sur la période choisie." /><Unified key={tab} kind={tab as any} /></>}
    </>
  );
}

function Achats() {
  const [f, setF] = useState({ group: 'section', from: '', to: '', section: '', collector_id: '', chain_id: '' });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const qs = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const filters = useAsync(() => get<any>('/reports/filters'), []);
  const rep = useAsync(() => get<any>(`/reports/purchases?${qs()}`), [f.group, f.from, f.to, f.section, f.collector_id, f.chain_id]);
  const fl = filters.data;
  return (
    <>
      <PageHeader title="Rapports" subtitle="Achats déclarés, hors brouillons, rejets et annulations."
        actions={<button className="btn btn-secondary" onClick={() => download(`/reports/purchases/xlsx?${qs()}`, 'Rapport_des_achats.xlsx').catch(() => undefined)}>Exporter vers Excel</button>} />
      <Card>
        <div className="filters">
          <Field label="Regrouper par"><select value={f.group} onChange={set('group')}>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Du"><input type="date" value={f.from} onChange={set('from')} /></Field>
          <Field label="Au"><input type="date" value={f.to} onChange={set('to')} /></Field>
          <Field label="Section"><select value={f.section} onChange={set('section')}><option value="">Toutes</option>{fl?.sections.map((s: string) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Collecteur"><select value={f.collector_id} onChange={set('collector_id')}><option value="">Tous</option>{fl?.collectors.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Filière"><select value={f.chain_id} onChange={set('chain_id')}><option value="">Toutes</option>{fl?.chains.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
      </Card>
      {rep.loading ? <Loading /> : rep.error ? <ErrorBox message={rep.error} onRetry={rep.reload} /> : rep.data && (
        <>
          <div className="stats">
            <Stat label="Achats" value={rep.data.total.declarations} />
            <Stat label="Sacs" value={rep.data.total.bags} />
            <Stat label="Poids net" value={kg(rep.data.total.kg)} />
            <Stat label="Montant" value={money(rep.data.total.amount)} />
          </div>
          <Card>
            <Table rows={rep.data.rows} empty="Aucun achat pour ces critères." columns={[
              { header: rep.data.group_label, render: (r: any) => <strong>{r.key}</strong> },
              { header: 'Achats', render: (r: any) => r.declarations }, { header: 'Sacs', render: (r: any) => r.bags },
              { header: 'Poids net', render: (r: any) => kg(r.kg) }, { header: 'Montant', render: (r: any) => money(r.amount) },
            ]} />
          </Card>
        </>
      )}
    </>
  );
}
