import { useEffect, useState } from 'react';
import { get } from '../api';
import { DECLARATION_STATUS, date, kg, money } from '../format';
import { onFlushed } from '../offline';
import NewPurchase from './NewPurchase';
import { Card, ErrorBox, Loading, PageHeader, Stat, StatusBadge, Table, useAsync } from '../ui';

/** Espace du collecteur : « Mes achats » (déclarer), « Mon stock » (acheté, en route, livré, compte) et « Historique ». */
function useMine() {
  const r = useAsync(async () => {
    const [decls, producers] = await Promise.all([get<any[]>('/purchase-declarations?limit=500'), get<any[]>('/producers?limit=200').catch(() => [] as any[])]);
    const names = new Map(producers.map((p) => [p.id, `${p.last_name} ${p.first_names}`]));
    return decls.map((d) => ({ ...d, producer_name: names.get(d.producer_id) ?? '—' }));
  }, []);
  useEffect(() => onFlushed(r.reload), [r.reload]);
  return r;
}

const cols = (): any[] => [
  { header: 'Date', render: (d: any) => date(d.operation_date) }, { header: 'Producteur', render: (d: any) => d.producer_name },
  { header: 'Quantité', align: 'right', render: (d: any) => `${Number(d.quantity).toLocaleString('fr-FR')} ${d.unit}` },
  { header: 'Montant', align: 'right', render: (d: any) => (d.amount ? money(d.amount, d.currency ?? 'XOF') : '—') },
  { header: 'État', render: (d: any) => <StatusBadge map={DECLARATION_STATUS} value={d.status} /> },
];

export function MesAchats() {
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useMine();
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []).filter((d) => String(d.operation_date).slice(0, 10) === today || d.status === 'draft' || d.status === 'to_correct');
  return (
    <>
      <PageHeader title="Mes achats" subtitle="Déclarez vos achats auprès des producteurs. Ceux du jour et ceux à corriger apparaissent ici." actions={<button className="btn" onClick={() => setCreating(true)}>Déclarer un achat</button>} />
      {creating && <NewPurchase onClose={() => setCreating(false)} onDone={() => setTimeout(reload, 800)} />}
      <Card>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : <Table rows={rows} empty="Aucun achat du jour. Utilisez « Déclarer un achat »." columns={cols()} />}
      </Card>
    </>
  );
}

export function Historique() {
  const { data, loading, error, reload } = useMine();
  const [status, setStatus] = useState('');
  const rows = (data ?? []).filter((d) => !status || d.status === status);
  return (
    <>
      <PageHeader title="Historique de mes achats" subtitle="Tous vos achats déclarés, du plus récent au plus ancien." />
      <Card>
        <div className="toolbar"><select aria-label="Filtrer par état" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les états</option>{Object.entries(DECLARATION_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : <Table rows={rows} empty="Aucun achat." columns={cols()} />}
      </Card>
    </>
  );
}

export function MonStock() {
  const { data: s, loading, error, reload } = useAsync(() => get<any>('/convoys/my-stock'), []);
  useEffect(() => onFlushed(reload), [reload]);
  if (loading) return <Loading />;
  if (error || !s) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  if (!s.collector) return <p className="empty">Ce compte n'est pas rattaché à un collecteur.</p>;
  return (
    <>
      <PageHeader title="Mon stock acheté" subtitle="Ce que vous avez acheté, ce qui est en route et ce qui a été livré au magasin central." />
      <div className="stats">
        <Stat label="Acheté (déclaré)" value={kg(s.purchased_kg)} hint={`${s.purchases} achat(s) · ${s.purchased_bags} sacs`} />
        <Stat label="En route (convois)" value={kg(s.in_transit_kg)} hint={`${s.in_transit_convoys} convoi(s)`} tone="warn" />
        <Stat label="Livré au magasin" value={kg(s.delivered_kg)} hint={`${s.delivered_bags} sacs`} tone="ok" />
        <Stat label="Encore chez moi (estimé)" value={kg(s.held_kg)} />
        <Stat label="Solde de ma fiche" value={money(-Number(s.balance))} hint={Number(s.balance) > 0 ? 'Négatif : la coopérative vous doit cette somme' : 'Positif : vous devez cette somme à la coopérative'} tone="ok" />
      </div>
    </>
  );
}
