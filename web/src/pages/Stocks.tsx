import { useState } from 'react';
import { download, get, post } from '../api';
import { useAuth } from '../auth';
import { dateTime, kg } from '../format';
import { Badge, Card, ErrorBox, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';
import { Confirm } from './Declarations';
import DocumentsPanel from './DocumentsPanel';

export default function Stocks() {
  const { can } = useAuth();
  const [trace, setTrace] = useState<string | null>(null);
  const [approve, setApprove] = useState<any | null>(null);
  const [docsFor, setDocsFor] = useState<any | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [stocks, lots, weighings] = await Promise.all([
      get<any[]>('/stocks'),
      can('lots:read') ? get<any[]>('/lots').catch(() => []) : [],
      can('weighings:read') ? get<any[]>('/weighings?status=pending_approval').catch(() => []) : [],
    ]);
    return { stocks, lots, weighings };
  }, []);
  const dl = useAction();

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Stocks et lots" subtitle="Quantités calculées depuis les mouvements, jamais saisies à la main" />
      {data.weighings.length > 0 && (
        <Card title={`Pesées à valider (${data.weighings.length})`}>
          <p className="muted">L'écart dépasse le seuil : la validation doit être faite par un autre utilisateur que l'opérateur.</p>
          <Table rows={data.weighings} columns={[
            { header: 'Pesée le', render: (w) => dateTime(w.weighed_at) },
            { header: 'Net', align: 'right', render: (w) => kg(w.net_kg) },
            { header: 'Déclaré', align: 'right', render: (w) => kg(w.declared_kg) },
            { header: 'Écart', align: 'right', render: (w) => <Badge tone="warn">{Number(w.variance_pct).toFixed(1)} %</Badge> },
            { header: '', render: (w) => (
              <div className="row-actions">
                {can('documents:read') && <button className="btn btn-small btn-secondary" onClick={() => setDocsFor(w)}>Pièces</button>}
                {can('weighings:approve') && <button className="btn btn-small" onClick={() => setApprove(w)}>Examiner</button>}
              </div>
            ) },
          ]} />
        </Card>
      )}
      <Card title="Stock par magasin et par lot">
        <Table rows={data.stocks} empty="Aucun stock enregistré." columns={[
          { header: 'Magasin', render: (s) => s.warehouse_name },
          { header: 'Lot', render: (s) => s.lot_code },
          { header: 'Quantité', align: 'right', render: (s) => <strong>{kg(s.balance_kg)}</strong> },
        ]} />
      </Card>
      {can('lots:read') && (
        <Card title="Lots">
          {dl.error && <ErrorBox message={dl.error} />}
          <Table rows={data.lots} empty="Aucun lot." columns={[
            { header: 'Code', render: (l) => <strong>{l.code}</strong> },
            { header: 'Type', render: (l) => l.kind },
            { header: 'Créé le', render: (l) => dateTime(l.created_at) },
            { header: 'Quantité', align: 'right', render: (l) => kg(l.balance_kg) },
            { header: '', render: (l) => (
              <div className="row-actions">
                <button className="btn btn-small btn-secondary" onClick={() => setTrace(l.id)}>Traçabilité</button>
                <button className="btn btn-small btn-secondary" disabled={dl.busy} onClick={() => dl.run(() => download(`/lots/${l.id}/traceability.pdf`, `tracabilite-${l.code}.pdf`))}>PDF</button>
              </div>
            ) },
          ]} />
        </Card>
      )}
      {trace && <Traceability id={trace} onClose={() => setTrace(null)} />}
      {docsFor && (
        <Modal title={`Pièces — pesée du ${dateTime(docsFor.weighed_at)}`} onClose={() => setDocsFor(null)}>
          <DocumentsPanel subjectType="weighing" subjectId={docsFor.id} kinds={['weighing_ticket', 'photo', 'other']} locked={!can('documents:upload')} />
        </Modal>
      )}
      {approve && <Confirm title="Valider l'écart de pesée" reason optional label="Commentaire (facultatif)" onClose={() => setApprove(null)}
        intro={`Net ${kg(approve.net_kg)} pour ${kg(approve.declared_kg)} déclarés (${Number(approve.variance_pct).toFixed(1)} %).`}
        onSubmit={async (c) => { await post(`/weighings/${approve.id}/approve`, { approve: true, ...(c && { comment: c }) }); setApprove(null); reload(); }} />}
    </>
  );
}

function Traceability({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => get<any>(`/lots/${id}/traceability`), [id]);
  return (
    <Modal title={data ? `Traçabilité ${data.lot.code}` : 'Traçabilité'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}
      {data && (
        <>
          <h3>Origines</h3>
          <Table rows={data.origins as any[]} empty="Aucune origine." columns={[
            { header: 'Producteur', render: (o) => `${o.producer_code} ${o.producer_name}` },
            { header: 'Net', align: 'right', render: (o) => kg(o.net_kg) },
            { header: 'Reçu', render: (o) => o.receipt_number },
          ]} />
          <h3>Anomalies</h3>
          {data.anomalies.length ? <ul className="plain">{data.anomalies.map((a: string) => <li key={a}>{a}</li>)}</ul> : <p className="muted">Aucune anomalie détectée.</p>}
          <h3>Informations manquantes</h3>
          {data.missing.length ? <ul className="plain">{data.missing.map((a: string) => <li key={a}>{a}</li>)}</ul> : <p className="muted">Aucune.</p>}
          <p className="muted">Généré le {dateTime(data.generated_at)}</p>
        </>
      )}
    </Modal>
  );
}
