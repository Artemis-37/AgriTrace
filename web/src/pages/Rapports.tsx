import { useState } from 'react';
import { download, get } from '../api';
import { kg, money } from '../format';
import { Card, ErrorBox, Field, Loading, PageHeader, Stat, Table, useAsync } from '../ui';

const GROUPS: [string, string][] = [['section', 'Section'], ['village', 'Village'], ['collector', 'Collecteur'], ['chain', 'Filière'], ['day', 'Jour']];

/** Rapports d'achats filtrables par période, section, collecteur et filière (CDC §26), exportables vers Excel. */
export default function Rapports() {
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
