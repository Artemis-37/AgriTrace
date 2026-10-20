import { useState } from 'react';
import { dateTime } from './format';
import { flush, removeOp, useOffline } from './offline';
import { Badge, Modal } from './ui';

const STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'info']> = {
  pending: ['En attente', 'warn'], accepted: ['Envoyée', 'ok'], rejected: ['Refusée', 'bad'], to_correct: ['À corriger', 'bad'], conflict: ['Conflit', 'bad'], pending_validation: ['À valider par un responsable', 'info'],
};

/** Bandeau d'état de la liaison avec le serveur et file des opérations faites hors connexion. */
export default function OfflineBar() {
  const o = useOffline();
  const [open, setOpen] = useState(false);
  const shown = o.ops.filter((x) => x.status !== 'accepted' || Date.now() - Date.parse(x.createdAt) < 86400000);
  if (!o.offline && !o.pending && !o.failed) return null;
  return (
    <>
      <div className={`offline-bar ${o.offline ? 'is-off' : ''}`} role="status">
        {o.offline
          ? <strong>Hors connexion — le serveur est injoignable. Vous pouvez continuer ; tout sera envoyé au retour du serveur.</strong>
          : <strong>{o.flushing ? 'Envoi en cours…' : 'Opérations en attente d\'envoi'}</strong>}
        {o.pending > 0 && <span> · {o.pending} en attente</span>}
        {o.failed > 0 && <span> · <Badge tone="bad">{o.failed} à traiter</Badge></span>}
        <button className="btn btn-small btn-secondary" onClick={() => setOpen(true)}>Détails</button>
        {!o.offline && o.pending > 0 && <button className="btn btn-small" onClick={() => void flush()}>Envoyer maintenant</button>}
      </div>
      {open && (
        <Modal title="Opérations de ce poste" onClose={() => setOpen(false)}>
          {!shown.length ? <p className="empty">Aucune opération.</p> : (
            <ul className="list">
              {shown.map((x) => (
                <li key={x.id}>
                  <Badge tone={STATUS[x.status]?.[1] ?? 'neutral'}>{STATUS[x.status]?.[0] ?? x.status}</Badge> <strong>{x.label}</strong><br />
                  <small className="muted">{dateTime(x.createdAt)}</small>
                  {x.error && <div className="muted">{x.error}</div>}
                  {x.status !== 'pending' && <button className="btn btn-small btn-secondary" onClick={() => void removeOp(x.id)}>Retirer de la liste</button>}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">Une opération refusée ou à corriger n'est pas perdue : elle est conservée ici avec le motif du serveur.</p>
        </Modal>
      )}
    </>
  );
}
