import { useRef, useState } from 'react';
import { download, get, postForm } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { Badge, ErrorBox, Loading, useAction, useAsync } from '../ui';

export const DOC_KINDS: Record<string, string> = {
  proof_of_delivery: 'Preuve de livraison', transport_doc: 'Document de transport', weighing_ticket: 'Ticket de pesée', contract: 'Contrat', invoice_copy: 'Copie de facture',
  payment_proof: 'Justificatif de paiement', claim_evidence: 'Pièce de réclamation', task_report: 'Compte rendu', photo: 'Photo', other: 'Autre',
};

/** Pièces jointes d'un objet (expédition, commande, facture, réclamation) : liste, téléchargement contrôlé et ajout (PDF, JPEG ou PNG, 10 Mo). */
export default function DocumentsPanel({ subjectType, subjectId, kinds, defaultKind, locked = false, onChange }: {
  subjectType: string; subjectId: string; kinds: string[]; defaultKind?: string; locked?: boolean; onChange?: () => void;
}) {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => (can('documents:read') ? get<any[]>(`/documents?subject_type=${subjectType}&subject_id=${subjectId}`) : Promise.resolve([])), [subjectType, subjectId]);
  const [kind, setKind] = useState(defaultKind ?? kinds[0]);
  const file = useRef<HTMLInputElement>(null);
  const act = useAction();
  const docs = (data ?? []).filter((d) => d.is_latest);
  return (
    <>
      <h3>Documents</h3>
      {loading && <Loading />}{error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      <ul className="list">
        {docs.map((d) => (
          <li key={d.id}>
            {DOC_KINDS[d.kind] ?? d.kind} — {d.filename} {d.version > 1 && <Badge tone="info">v{d.version}</Badge>}{' '}
            <small className="muted">{dateTime(d.uploaded_at)} · {Math.max(1, Math.round(d.size_bytes / 1024))} Ko</small>{' '}
            <button className="btn btn-small btn-secondary" onClick={() => act.run(() => download(`/documents/${d.id}/download`, d.filename))}>Télécharger</button>
          </li>
        ))}
        {!docs.length && !loading && <li className="muted">Aucun document.</li>}
      </ul>
      {can('documents:upload') && !locked && (
        <div className="toolbar">
          <select aria-label="Type de document" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{DOC_KINDS[k] ?? k}</option>)}</select>
          <input ref={file} type="file" aria-label="Fichier" accept=".pdf,.jpg,.jpeg,.png" />
          <button className="btn btn-secondary" disabled={act.busy} onClick={() => act.run(async () => {
            const f = file.current?.files?.[0]; if (!f) throw new Error('Choisir un fichier (PDF, JPEG ou PNG, 10 Mo maximum)');
            const form = new FormData(); form.append('file', f); form.append('subject_type', subjectType); form.append('subject_id', subjectId); form.append('kind', kind);
            await postForm('/documents', form); if (file.current) file.current.value = ''; reload(); onChange?.();
          })}>Joindre</button>
        </div>
      )}
    </>
  );
}
