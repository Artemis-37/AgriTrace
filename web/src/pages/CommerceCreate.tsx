import { useState } from 'react';
import { get, idem, post } from '../api';
import { kg } from '../format';
import { Card, ErrorBox, Field, Loading, Modal, Table, useAction, useAsync } from '../ui';

/** Création d'une expédition à partir des réservations d'une commande. */
export function CreateShipment({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [key] = useState(idem());
  const orders = useAsync(() => get<any[]>('/sales-orders'), []);
  const whs = useAsync(() => get<any[]>('/warehouses').catch(() => []), []);
  const logi = useAsync(async () => ({ carriers: await get<any[]>('/carriers'), vehicles: await get<any[]>('/vehicles'), drivers: await get<any[]>('/drivers') }), []);
  const [f, setF] = useState({ order_id: '', warehouse_id: '', destination: '', carrier_id: '', vehicle_id: '', driver_id: '' });
  const order = useAsync(() => (f.order_id ? get<any>(`/sales-orders/${f.order_id}`) : Promise.resolve(null)), [f.order_id]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const allocs = ((order.data?.allocations ?? []) as any[]).filter((a) => !a.released && Number(a.remaining_kg) > 0);
  const items = allocs.filter((a) => Number(qty[a.id] ?? 0) > 0).map((a) => ({ allocation_id: a.id, planned_kg: qty[a.id] }));
  const opt = (rows: any[] | undefined, label: (r: any) => string) => (rows ?? []).map((r) => <option key={r.id} value={r.id}>{label(r)}</option>);
  return (
    <Modal title="Nouvelle expédition" onClose={onClose}>
      <Field label="Commande"><select value={f.order_id} onChange={(e) => { setF({ ...f, order_id: e.target.value }); setQty({}); }}><option value="">—</option>{opt((orders.data ?? []).filter((o) => ['confirmed', 'partially_shipped'].includes(o.status)), (o) => o.number)}</select></Field>
      <Field label="Magasin d'origine"><select value={f.warehouse_id} onChange={set('warehouse_id')}><option value="">—</option>{opt((whs.data ?? []).filter((w) => w.status === 'active'), (w) => w.name)}</select></Field>
      <Field label="Destination"><input value={f.destination} onChange={set('destination')} /></Field>
      <Field label="Transporteur"><select value={f.carrier_id} onChange={set('carrier_id')}><option value="">—</option>{opt(logi.data?.carriers, (c) => c.name)}</select></Field>
      <Field label="Véhicule"><select value={f.vehicle_id} onChange={set('vehicle_id')}><option value="">—</option>{opt(logi.data?.vehicles, (v) => v.plate)}</select></Field>
      <Field label="Chauffeur"><select value={f.driver_id} onChange={set('driver_id')}><option value="">—</option>{opt(logi.data?.drivers, (d) => d.full_name)}</select></Field>
      {f.order_id && (order.loading ? <Loading /> : (
        <Table rows={allocs} empty="Aucune réservation disponible : réservez d'abord du stock sur la commande." columns={[
          { header: 'Lot', render: (a: any) => a.lot_code }, { header: 'Dépôt', render: (a: any) => a.warehouse_code }, { header: 'Reste à expédier', align: 'right', render: (a: any) => kg(a.remaining_kg) },
          { header: 'Prévu (kg)', render: (a: any) => <input aria-label={`Prévu ${a.lot_code}`} style={{ width: 100 }} inputMode="decimal" value={qty[a.id] ?? ''} onChange={(e) => setQty({ ...qty, [a.id]: e.target.value })} /> },
        ]} />
      ))}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !f.order_id || !f.warehouse_id || f.destination.trim().length < 2 || !items.length} onClick={() => run(async () => {
          await post('/shipments', { idempotency_key: key, order_id: f.order_id, origin_warehouse_id: f.warehouse_id, destination: f.destination,
            ...(f.carrier_id && { carrier_id: f.carrier_id }), ...(f.vehicle_id && { vehicle_id: f.vehicle_id }), ...(f.driver_id && { driver_id: f.driver_id }), items }); onDone();
        })}>Créer</button></div>
    </Modal>
  );
}

/** Transporteurs, véhicules, chauffeurs : trois petits formulaires. */
export function Logistics({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'carriers' | 'vehicles' | 'drivers'>('carriers');
  const logi = useAsync(async () => ({ carriers: await get<any[]>('/carriers'), vehicles: await get<any[]>('/vehicles'), drivers: await get<any[]>('/drivers') }), []);
  const [f, setF] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
  const body = kind === 'carriers' ? clean({ code: (f.code ?? '').toUpperCase(), name: f.name ?? '', phone: f.phone ?? '' })
    : kind === 'vehicles' ? clean({ plate: f.plate ?? '', carrier_id: f.carrier_id ?? '', kind: f.vkind ?? '', capacity_kg: f.capacity_kg ?? '' })
    : clean({ full_name: f.full_name ?? '', carrier_id: f.carrier_id ?? '', phone: f.phone ?? '', licence_no: f.licence_no ?? '' });
  const valid = kind === 'carriers' ? (f.code ?? '').length >= 2 && (f.name ?? '').length >= 2 : kind === 'vehicles' ? (f.plate ?? '').length >= 3 : (f.full_name ?? '').length >= 2;
  const carriers = <Field label="Transporteur"><select value={f.carrier_id ?? ''} onChange={set('carrier_id')}><option value="">—</option>{(logi.data?.carriers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>;
  return (
    <Modal title="Transport" onClose={onClose}>
      <div className="toolbar">{([['carriers', 'Transporteurs'], ['vehicles', 'Véhicules'], ['drivers', 'Chauffeurs']] as const).map(([k, l]) => <button key={k} className={`btn btn-small ${kind === k ? '' : 'btn-secondary'}`} onClick={() => { setKind(k); setF({}); }}>{l}</button>)}</div>
      <Card>
        {logi.loading ? <Loading /> : <ul className="list">{(logi.data?.[kind] ?? []).map((r: any) => <li key={r.id}>{r.name ?? r.plate ?? r.full_name}{r.code ? ` (${r.code})` : ''}</li>)}{!(logi.data?.[kind] ?? []).length && <li className="muted">Aucun élément.</li>}</ul>}
      </Card>
      {kind === 'carriers' && <><Field label="Code"><input value={f.code ?? ''} onChange={set('code')} /></Field><Field label="Nom"><input value={f.name ?? ''} onChange={set('name')} /></Field><Field label="Téléphone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field></>}
      {kind === 'vehicles' && <><Field label="Immatriculation"><input value={f.plate ?? ''} onChange={set('plate')} /></Field>{carriers}<Field label="Type"><input value={f.vkind ?? ''} onChange={set('vkind')} /></Field><Field label="Capacité (kg)"><input inputMode="decimal" value={f.capacity_kg ?? ''} onChange={set('capacity_kg')} /></Field></>}
      {kind === 'drivers' && <><Field label="Nom complet"><input value={f.full_name ?? ''} onChange={set('full_name')} /></Field>{carriers}<Field label="Téléphone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field><Field label="N° de permis"><input value={f.licence_no ?? ''} onChange={set('licence_no')} /></Field></>}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Fermer</button>
        <button className="btn" disabled={busy || !valid} onClick={() => run(async () => { await post(`/${kind}`, body); setF({}); logi.reload(); })}>Ajouter</button></div>
    </Modal>
  );
}

/** Contrat de vente cadre avec un acheteur. */
export function CreateContract({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const buyers = useAsync(() => get<any[]>('/buyers'), []);
  const chains = useAsync(() => get<any[]>('/value-chains'), []);
  const [f, setF] = useState({ number: '', buyer_id: '', value_chain_id: '', starts_on: new Date().toISOString().slice(0, 10), ends_on: '', quantity_kg: '', unit_price: '', payment_terms_days: '30' });
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Contrat de vente" onClose={onClose}>
      <Field label="N° de contrat"><input value={f.number} onChange={set('number')} /></Field>
      <Field label="Acheteur"><select value={f.buyer_id} onChange={set('buyer_id')}><option value="">—</option>{(buyers.data ?? []).filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Filière"><select value={f.value_chain_id} onChange={set('value_chain_id')}><option value="">Toutes</option>{(chains.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Début"><input type="date" value={f.starts_on} onChange={set('starts_on')} /></Field><Field label="Fin"><input type="date" value={f.ends_on} onChange={set('ends_on')} /></Field>
      <Field label="Quantité totale (kg)" hint="Optionnel : plafonne les commandes rattachées"><input inputMode="decimal" value={f.quantity_kg} onChange={set('quantity_kg')} /></Field>
      <Field label="Prix unitaire"><input inputMode="decimal" value={f.unit_price} onChange={set('unit_price')} /></Field>
      <Field label="Délai de paiement (jours)"><input type="number" min="0" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || f.number.length < 3 || !f.buyer_id || !f.ends_on} onClick={() => run(async () => {
          await post('/sales-contracts', { number: f.number, buyer_id: f.buyer_id, starts_on: f.starts_on, ends_on: f.ends_on, payment_terms_days: Number(f.payment_terms_days),
            ...(f.value_chain_id && { value_chain_id: f.value_chain_id }), ...(f.quantity_kg && { quantity_kg: f.quantity_kg }), ...(f.unit_price && { unit_price: f.unit_price }) }); onDone();
        })}>Créer</button></div>
    </Modal>
  );
}
