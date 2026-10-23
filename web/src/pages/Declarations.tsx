import { useEffect, useState } from 'react';
import { download, get, post } from '../api';
import { useAuth } from '../auth';
import { DECLARATION_STATUS, NEXT_DECLARATION, date, money } from '../format';
import NewPurchase from './NewPurchase';
import DocumentsPanel from './DocumentsPanel';
import { onFlushed } from '../offline';
import { Card, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Table, useAction, useAsync } from '../ui';

export default function Declarations() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<{ id: string; to: string; label: string } | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    // Les informations du producteur (base importée par la coopérative) viennent avec chaque déclaration.
    return (await get<any[]>('/purchase-declarations')).map((d) => ({ ...d, producer_name: d.producer_name ?? '—' }));
  }, []);
  const rows = (data ?? []).filter((d) => !status || d.status === status);
  const [creating, setCreating] = useState(false);
  const [docsFor, setDocsFor] = useState<any | null>(null);
  useEffect(() => onFlushed(reload), [reload]);
  const needsReason = (to: string) => ['to_correct', 'rejected'].includes(to);

  return (
    <>
      <PageHeader title="Déclarations d'achat" subtitle="Achats déclarés par les délégués, avant et après réception" actions={<>{<button className="btn btn-secondary" onClick={() => download('/purchase-declarations/export/xlsx', 'achats-declares.xlsx').catch(() => undefined)}>Exporter vers Excel</button>}{can('declarations:create') && <button className="btn" onClick={() => setCreating(true)}>Saisir un achat</button>}</>} />
      {creating && <NewPurchase onClose={() => setCreating(false)} onDone={() => setTimeout(reload, 800)} />}
      <Card>
        <div className="toolbar">
          <select aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {Object.entries(DECLARATION_STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Table rows={rows} empty="Aucune déclaration." columns={[
            { header: 'Code', render: (d) => <code>{d.producer_code ?? '—'}</code> },
            { header: 'Nom & prénoms', render: (d) => <strong>{d.producer_name}</strong> },
            { header: 'Section', render: (d) => d.producer_section ?? '' },
            { header: 'Village', render: (d) => d.producer_village ?? '' },
            { header: 'Téléphone', render: (d) => d.producer_phone ?? '' },
            { header: 'Superficie (ha)', align: 'right', render: (d) => (d.producer_area_ha != null ? Number(d.producer_area_ha).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '') },
            { header: 'Estimation (kg)', align: 'right', render: (d) => (d.producer_estimated_kg != null ? Number(d.producer_estimated_kg).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '') },
            { header: 'Date', render: (d) => date(d.operation_date) },
            { header: 'Quantité', align: 'right', render: (d) => `${Number(d.quantity)} ${d.unit}` },
            { header: 'Montant', align: 'right', render: (d) => money(d.amount, d.currency ?? 'XOF') },
            { header: 'Statut', render: (d) => <StatusBadge map={DECLARATION_STATUS} value={d.status} /> },
            { header: 'Pièces', render: (d) => can('documents:read') && <button className="link" onClick={() => setDocsFor(d)}>Pièces</button> },
            { header: '', render: (d) => can('declarations:validate') && (NEXT_DECLARATION[d.status] ?? []).length > 0 && (
              <div className="row-actions">
                {NEXT_DECLARATION[d.status].map(([to, label]) => (
                  <button key={to} className={`btn btn-small ${to === 'accepted' ? '' : 'btn-secondary'}`} onClick={() => setPending({ id: d.id, to, label })}>{label}</button>
                ))}
              </div>
            ) },
          ]} />
        )}
      </Card>
      {docsFor && (
        <Modal title={`Pièces — ${docsFor.producer_name}, ${date(docsFor.operation_date)}`} onClose={() => setDocsFor(null)}>
          <DocumentsPanel subjectType="declaration" subjectId={docsFor.id} kinds={['Photo du reçu', 'Copie du reçu', 'Autre']} locked={!can('documents:upload')} />
        </Modal>
      )}
      {pending && <Confirm title={pending.label} reason={needsReason(pending.to)} onClose={() => setPending(null)}
        onSubmit={async (reason) => { await post(`/purchase-declarations/${pending.id}/transition`, { to: pending.to, ...(reason && { reason }) }); setPending(null); reload(); }} />}
    </>
  );
}

export function Confirm({ title, reason, optional, onClose, onSubmit, intro, label = 'Motif' }: {
  title: string; reason?: boolean; optional?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void>; intro?: string; label?: string;
}) {
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title={title} onClose={onClose}>
      {intro && <p className="notice">{intro}</p>}
      {reason && <Field label={label}><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || (!!reason && !optional && text.trim().length < 3)} onClick={() => run(() => onSubmit(text.trim()))}>{busy ? 'En cours…' : 'Confirmer'}</button>
      </div>
    </Modal>
  );
}
