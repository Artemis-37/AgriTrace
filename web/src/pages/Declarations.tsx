import { useEffect, useState } from 'react';
import { download, get, post } from '../api';
import { useAuth } from '../auth';
import { DECLARATION_STATUS, NEXT_DECLARATION, bagWeightError, date, money } from '../format';
import { PeekLink } from '../peek';
import ProducerCard from './ProducerCard';
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
  const [fixing, setFixing] = useState<any | null>(null);
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
            { header: 'Nom & prénoms', render: (d) => <strong><PeekLink title={`Producteur — ${d.producer_name}`} label={d.producer_name} disabled={!can('producers:read') || !d.producer_id} render={() => <ProducerCard id={d.producer_id} />} /></strong> },
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
            { header: '', render: (d) => can('declarations:correct') && CORRECTABLE.has(d.status) && <button className="btn btn-small btn-secondary" onClick={() => setFixing(d)}>Corriger</button> },
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
      {fixing && <CorrectPurchase d={fixing} onClose={() => setFixing(null)} onDone={() => { setFixing(null); reload(); }} />}
      {pending && <Confirm title={pending.label} reason={needsReason(pending.to)} onClose={() => setPending(null)}
        onSubmit={async (reason) => { await post(`/purchase-declarations/${pending.id}/transition`, { to: pending.to, ...(reason && { reason }) }); setPending(null); reload(); }} />}
    </>
  );
}

/** États où un achat mal saisi peut encore être corrigé (avant validation, refus, annulation ou réception au magasin). */
const CORRECTABLE = new Set(['draft', 'received', 'in_review', 'to_correct']);

/** Le délégué s'est trompé et a prévenu par téléphone : le responsable de traçabilité corrige, avec un motif conservé au journal. */
function CorrectPurchase({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ quantity: String(Number(d.quantity)), bags: d.bags == null ? '' : String(d.bags), operation_date: String(d.operation_date).slice(0, 10), reason: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  const bagError = bagWeightError(f.quantity, d.unit, f.bags);
  const valid = !bagError && /^\d+(\.\d{1,3})?$/.test(f.quantity) && Number(f.quantity) > 0 && (f.bags === '' || /^\d+$/.test(f.bags)) && f.reason.trim().length >= 3;
  return (
    <Modal title={`Corriger l'achat — ${d.producer_name}`} onClose={onClose}>
      <p className="notice">Un sac pèse entre 50 et 75 kg. La correction est journalisée avec son motif (anciennes et nouvelles valeurs conservées).</p>
      <Field label={`Quantité (${d.unit})`}><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} /></Field>
      <Field label="Nombre de sacs"><input inputMode="numeric" value={f.bags} onChange={set('bags')} /></Field>
      <Field label="Date de l'achat"><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.operation_date} onChange={set('operation_date')} /></Field>
      <Field label="Motif de la correction"><textarea rows={3} value={f.reason} onChange={set('reason')} placeholder="Ex. : le délégué a signalé un zéro oublié" /></Field>
      {bagError && <ErrorBox message={bagError} />}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !valid} onClick={() => run(async () => {
          await post(`/purchase-declarations/${d.id}/correct`, { quantity: f.quantity, ...(f.bags !== '' && { bags: Number(f.bags) }), operation_date: f.operation_date, reason: f.reason.trim() });
          onDone();
        })}>{busy ? 'En cours…' : 'Enregistrer la correction'}</button>
      </div>
    </Modal>
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
