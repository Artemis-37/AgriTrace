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
  const [f, setF] = useState({ producer_id: '', value_chain_id: '', campaign_id: '', operation_date: new Date().toISOString().slice(0, 10), kg: '', bags: '', receipt: '' });
  const [q, setQ] = useState('');
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  if (loading) return <Modal title="Achat" onClose={onClose}><Loading /></Modal>;
  if (error || !data) return <Modal title="Achat" onClose={onClose}><ErrorBox message={error ?? 'Chargement impossible'} /></Modal>;
  const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const producer = data.producers.find((p) => p.id === f.producer_id);
  // Recherche par code ou par nom (nom, prénoms, dans les deux ordres), sans accents ni casse ; fonctionne hors connexion.
  const hits = !producer && q.trim().length >= 1
    ? data.producers.filter((p) => { const hay = norm(`${p.internal_code} ${p.last_name} ${p.first_names} ${p.first_names} ${p.last_name}`); return norm(q).split(/\s+/).every((w) => hay.includes(w)); }).slice(0, 8)
    : [];
  // Les producteurs sont liés à tous les produits de la coopérative : après le producteur, le délégué choisit le produit.
  const chains = data.chains;
  const chainId = f.value_chain_id || (chains.length === 1 ? chains[0].id : '');
  const camps = data.campaigns.filter((c) => !chainId || c.value_chain_id === chainId);
  const campId = f.campaign_id || (camps.length === 1 ? camps[0].id : '');
  const valid = !!producer && !!chainId && !!campId && /^\d+(\.\d{1,3})?$/.test(f.kg) && Number(f.kg) > 0 && /^\d+$/.test(f.bags) && f.receipt.trim().length > 0;
  return (
    <Modal title="Achat" onClose={onClose}>
      {off.offline && <p className="notice" role="status">Hors connexion : l'achat sera enregistré sur ce poste et envoyé dès que le serveur sera joignable.</p>}
      {!producer ? (
        <Field label="Producteur" hint="Tapez le code ou le nom du producteur.">
          <input type="search" role="combobox" aria-expanded={hits.length > 0} aria-label="Rechercher un producteur" placeholder="Code ou nom du producteur…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          {q.trim() && !hits.length && <small className="muted">Aucun producteur ne correspond.</small>}
          {!!hits.length && <ul className="search-hits" role="listbox">{hits.map((p) => (
            <li key={p.id} role="option"><button type="button" onClick={() => { setF({ ...f, producer_id: p.id, value_chain_id: '', campaign_id: '' }); setQ(''); }}>
              <strong>{p.last_name} {p.first_names}</strong> <span className="muted">{p.internal_code}{p.village ? ` · ${p.village}` : ''}</span></button></li>))}</ul>}
        </Field>
      ) : (
        <p className="notice"><strong>{producer.last_name} {producer.first_names}</strong> — {producer.internal_code}{producer.village ? ` · ${producer.village}` : ''}{' '}
          <button type="button" className="btn btn-small btn-secondary" onClick={() => setF({ ...f, producer_id: '', value_chain_id: '', campaign_id: '' })}>Changer</button></p>
      )}
      {producer && (
        <>
          {chains.length > 1 && <Field label="Produit"><select value={f.value_chain_id} onChange={(e) => setF({ ...f, value_chain_id: e.target.value, campaign_id: '' })}><option value="">—</option>{chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          {camps.length > 1 && <Field label="Campagne"><select value={f.campaign_id} onChange={set('campaign_id')}><option value="">—</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <Field label="Poids (kg)"><input inputMode="decimal" value={f.kg} onChange={set('kg')} placeholder="ex. 650" autoFocus /></Field>
          <Field label="Nombre de sacs"><input inputMode="numeric" value={f.bags} onChange={set('bags')} placeholder="ex. 10" /></Field>
          <Field label="N° du reçu"><input value={f.receipt} onChange={set('receipt')} maxLength={40} /></Field>
          <Field label="Date de l'achat" hint="Laissée vide, la date du jour est retenue."><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.operation_date} onChange={set('operation_date')} /></Field>
        </>
      )}
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !valid || !org} onClick={() => act.run(async () => {
          const id = crypto.randomUUID ? crypto.randomUUID() : idem();
          await enqueue(org!.id, 'purchase_declaration.create', {
            id, producer_id: f.producer_id, value_chain_id: chainId, campaign_id: campId, operation_date: f.operation_date || new Date().toISOString().slice(0, 10),
            quantity: f.kg, unit: 'kg', bags: Number(f.bags), purchase_receipt_no: f.receipt.trim(),
          }, `Achat de ${f.kg} kg — ${producer?.last_name ?? ''}`);
          await enqueue(org!.id, 'purchase_declaration.submit', { id }, `Soumission de l'achat — ${producer?.last_name ?? ''}`);
          onDone(); onClose();
        })}>{off.offline ? 'Enregistrer sur ce poste' : 'Enregistrer et soumettre'}</button>
      </div>
    </Modal>
  );
}
