import { useState } from 'react';
import { get } from '../api';
import { Card, ErrorBox, Loading, Table, useAsync } from '../ui';

const FR = (v: any) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });

/** État du stock par campagne : sacs et poids net reçus au magasin (pesées), par produit. */
export default function EtatStock() {
  const [camp, setCamp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const refs = useAsync(() => get<any[]>('/campaigns').catch(() => [] as any[]), []);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/stock-state?${new URLSearchParams({ ...(camp && { campaign_id: camp }), ...(from && { from }), ...(to && { to }) })}`), [camp, from, to]);
  const rows = data ?? [];
  return (
    <Card title="État du stock">
      <div className="toolbar pesees-filters">
        <label>Campagne <select value={camp} onChange={(e) => setCamp(e.target.value)}><option value="">Toutes</option>{(refs.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={rows} empty="Aucune pesée sur ces critères." columns={[
        { header: 'Produit', render: (r) => <strong>{r.product}</strong> }, { header: 'Pesées', align: 'right', render: (r) => r.receptions },
        { header: 'Nb sacs', align: 'right', render: (r) => FR(r.bags) }, { header: 'Stock (kg)', align: 'right', render: (r) => <strong>{FR(r.kg)}</strong> },
      ]} />}
      <p className="muted">Stock = poids net reçu au magasin par les pesées. Les sorties (ventes, expéditions) ne sont pas encore déduites ici.</p>
    </Card>
  );
}
