import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { DECLARATION_STATUS, NEXT_DECLARATION, date, money } from '../format';
import { Card, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Table, useAction, useAsync } from '../ui';

export default function Declarations() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<{ id: string; to: string; label: string } | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [decls, producers] = await Promise.all([get<any[]>('/purchase-declarations'), get<any[]>('/producers').catch(() => [])]);
    const names = new Map(producers.map((p) => [p.id, `${p.last_name} ${p.first_names}`]));
    return decls.map((d) => ({ ...d, producer_name: names.get(d.producer_id) ?? '—' }));
  }, []);
  const rows = (data ?? []).filter((d) => !status || d.status === status);
  const needsReason = (to: string) => ['to_correct', 'rejected'].includes(to);

  return (
    <>
      <PageHeader title="Déclarations d'achat" subtitle="Achats déclarés par les collecteurs, avant et après réception" />
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
            { header: 'Date', render: (d) => date(d.operation_date) },
            { header: 'Producteur', render: (d) => <strong>{d.producer_name}</strong> },
            { header: 'Quantité', align: 'right', render: (d) => `${Number(d.quantity)} ${d.unit}` },
            { header: 'Montant', align: 'right', render: (d) => money(d.amount, d.currency ?? 'XOF') },
            { header: 'Statut', render: (d) => <StatusBadge map={DECLARATION_STATUS} value={d.status} /> },
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
