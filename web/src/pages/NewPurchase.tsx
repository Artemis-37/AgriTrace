import { useState } from 'react';
import { get, idem } from '../api';
import { useAuth } from '../auth';
import { enqueue, useOffline } from '../offline';
import { Field, Modal, useAction, useAsync, ErrorBox, Loading } from '../ui';

/** Saisie d'un achat. Fonctionne hors connexion : l'achat est gardé sur le poste puis envoyé (et soumis) dès que le serveur répond. */
export default function NewPurchase({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { org } = useAuth();
  const off = useOffline();
  const act = useAction();
  const { data, loading, error } = useAsync(async () => {
    // Même flux de référence que le mobile (producteurs, filières, campagnes), sans exiger d'autres droits de consultation.
    let cursor = ''; const producers: any[] = [], chains: any[] = [], campaigns: any[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await get<any>(`/sync/changes?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      producers.push(...(r.changes.producers ?? [])); chains.push(...(r.changes.value_chains ?? [])); campaigns.push(...(r.changes.campaigns ?? []));
      cursor = r.next_cursor; if (!r.has_more) break;
    }
    return { producers: producers.filter((p) => ['active', 'to_verify'].includes(p.status)), chains, campaigns };
  }, []);
  const [f, setF] = useState({ producer_id: '', value_chain_id: '', campaign_id: '', operation_date: new Date().toISOString().slice(0, 10), quantity: '', unit: 'kg', bags: '', receipt: '' });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  if (loading) return <Modal title="Saisir un achat" onClose={onClose}><Loading /></Modal>;
  if (error || !data) return <Modal title="Saisir un achat" onClose={onClose}><ErrorBox message={error ?? 'Chargement impossible'} /></Modal>;
  const camps = data.campaigns.filter((c) => !f.value_chain_id || c.value_chain_id === f.value_chain_id);
  const valid = f.producer_id && f.value_chain_id && f.campaign_id && /^\d+(\.\d{1,3})?$/.test(f.quantity) && Number(f.quantity) > 0;
  return (
    <Modal title="Saisir un achat" onClose={onClose}>
      {off.offline && <p className="notice" role="status">Hors connexion : l'achat sera enregistré sur ce poste et envoyé dès que le serveur sera joignable.</p>}
      <Field label="Producteur"><select value={f.producer_id} onChange={set('producer_id')}><option value="">—</option>{data.producers.map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_names} ({p.internal_code})</option>)}</select></Field>
      <Field label="Filière"><select value={f.value_chain_id} onChange={(e) => setF({ ...f, value_chain_id: e.target.value, campaign_id: '' })}><option value="">—</option>{data.chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Campagne"><select value={f.campaign_id} onChange={set('campaign_id')}><option value="">—</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Date de l'achat"><input type="date" value={f.operation_date} onChange={set('operation_date')} /></Field>
      <Field label="Quantité"><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} placeholder="ex. 650" /></Field>
      <Field label="Unité"><select value={f.unit} onChange={set('unit')}><option value="kg">kg</option><option value="sac">sac</option></select></Field>
      <Field label="Nombre de sacs (facultatif)"><input inputMode="numeric" value={f.bags} onChange={set('bags')} /></Field>
      <Field label="Numéro du reçu d'achat (facultatif)"><input value={f.receipt} onChange={set('receipt')} maxLength={40} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !valid || !org} onClick={() => act.run(async () => {
          const id = crypto.randomUUID ? crypto.randomUUID() : idem();
          const producer = data.producers.find((p) => p.id === f.producer_id);
          await enqueue(org!.id, 'purchase_declaration.create', {
            id, producer_id: f.producer_id, value_chain_id: f.value_chain_id, campaign_id: f.campaign_id, operation_date: f.operation_date,
            quantity: f.quantity, unit: f.unit, ...(f.bags && { bags: Number(f.bags) }), ...(f.receipt.trim() && { purchase_receipt_no: f.receipt.trim() }),
          }, `Achat de ${f.quantity} ${f.unit} — ${producer?.last_name ?? ''}`);
          await enqueue(org!.id, 'purchase_declaration.submit', { id }, `Soumission de l'achat — ${producer?.last_name ?? ''}`);
          onDone(); onClose();
        })}>{off.offline ? 'Enregistrer sur ce poste' : 'Enregistrer et soumettre'}</button>
      </div>
    </Modal>
  );
}
