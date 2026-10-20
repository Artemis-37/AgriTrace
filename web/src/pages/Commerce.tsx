import { useState } from 'react';
import { useDeepLink } from '../notifTarget';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { INVOICE_STATUS, ORDER_STATUS, SHIPMENT_STATUS, date, kg, money } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Tabs, useAction, useAsync } from '../ui';
import { Confirm } from './Declarations';
import DocumentsPanel from './DocumentsPanel';
import { Claims, CreateContract, CreateShipment, Logistics } from './CommerceCreate';

type Tab = 'orders' | 'shipments' | 'invoices' | 'buyers' | 'claims';

export default function Commerce() {
  const { can } = useAuth();
  const all: [Tab, string, boolean][] = [
    ['orders', 'Commandes', can('buyers:read')], ['shipments', 'Expéditions', can('logistics:read')],
    ['invoices', 'Factures', can('invoices:read')], ['buyers', 'Acheteurs', can('buyers:read')], ['claims', 'Réclamations', can('claims:manage')],
  ];
  const tabs = all.filter((t) => t[2]);
  const dl = useDeepLink(tabs.map((t) => t[0]));
  const [tab, setTab] = useState<Tab>((dl.tab as Tab) ?? tabs[0]?.[0] ?? 'orders');
  return (
    <>
      <PageHeader title="Commerce" subtitle="Commandes, expéditions, factures et encaissements" />
      <Tabs value={tab} onChange={setTab} tabs={tabs.map(([k, l]) => [k, l] as [Tab, string])} />
      {tab === 'orders' && <Orders />}
      {tab === 'shipments' && <Shipments />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'buyers' && <Buyers />}
      {tab === 'claims' && <Claims />}
    </>
  );
}

/* ---------------- Commandes ---------------- */
function Orders() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<string | null>(useDeepLink().open);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/sales-orders${status ? `?status=${status}` : ''}`), [status]);
  const buyers = useAsync(() => get<any[]>('/buyers'), []);
  const names = new Map((buyers.data ?? []).map((b) => [b.id, b.name]));
  return (
    <Card>
      <div className="toolbar">
        <select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(ORDER_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        {can('orders:manage') && <button className="btn" onClick={() => setCreating(true)}>Nouvelle commande</button>}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune commande." columns={[
          { header: 'N°', render: (o) => <button className="link" onClick={() => setDetail(o.id)}>{o.number}</button> },
          { header: 'Acheteur', render: (o) => names.get(o.buyer_id) ?? '—' },
          { header: 'Quantité', align: 'right', render: (o) => kg(o.ordered_kg) },
          { header: 'Montant', align: 'right', render: (o) => money(o.amount, o.currency) },
          { header: 'Statut', render: (o) => <StatusBadge map={ORDER_STATUS} value={o.status} /> },
        ]} />
      )}
      {creating && <CreateOrder buyers={(buyers.data ?? []).filter((b) => b.status === 'active')} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {detail && <OrderDetail id={detail} onClose={() => { setDetail(null); reload(); }} />}
    </Card>
  );
}

function CreateOrder({ buyers, onClose, onDone }: { buyers: any[]; onClose: () => void; onDone: () => void }) {
  const chains = useAsync(() => get<any[]>('/value-chains'), []);
  const [key] = useState(idem());
  const [f, setF] = useState({ buyer_id: '', value_chain_id: '', quantity_kg: '', unit_price: '', description: '' });
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Nouvelle commande" onClose={onClose}>
      <Field label="Acheteur"><select value={f.buyer_id} onChange={set('buyer_id')}><option value="">—</option>{buyers.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></Field>
      <Field label="Filière"><select value={f.value_chain_id} onChange={set('value_chain_id')}><option value="">—</option>{(chains.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Désignation"><input value={f.description} onChange={set('description')} /></Field>
      <Field label="Quantité (kg)"><input inputMode="decimal" value={f.quantity_kg} onChange={set('quantity_kg')} /></Field>
      <Field label="Prix unitaire (par kg)"><input inputMode="decimal" value={f.unit_price} onChange={set('unit_price')} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !f.buyer_id || !f.value_chain_id || !f.quantity_kg || !f.unit_price} onClick={() => run(async () => {
          await post('/sales-orders', { idempotency_key: key, buyer_id: f.buyer_id, value_chain_id: f.value_chain_id, lines: [{ description: f.description || undefined, quantity_kg: f.quantity_kg, unit_price: f.unit_price }] }); onDone();
        })}>Créer</button></div>
    </Modal>
  );
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const { data: o, loading, error, reload } = useAsync(() => get<any>(`/sales-orders/${id}`), [id]);
  const stocks = useAsync(() => (can('warehouses:read') ? get<any[]>('/stocks') : Promise.resolve([])), []);
  const act = useAction();
  const [alloc, setAlloc] = useState({ line_id: '', stock: '', quantity_kg: '' });
  const [ask, setAsk] = useState<'cancel' | 'close' | null>(null);
  const manage = can('orders:manage');
  return (
    <Modal title={o ? `Commande ${o.number}` : 'Commande'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {o && (
        <>
          <p><StatusBadge map={ORDER_STATUS} value={o.status} /> · {o.buyer?.name} · {o.currency} · paiement à {o.payment_terms_days} j</p>
          <Table rows={o.lines} columns={[
            { header: 'Désignation', render: (l: any) => l.description ?? '—' }, { header: 'Quantité', align: 'right', render: (l: any) => kg(l.quantity_kg) },
            { header: 'Prix', align: 'right', render: (l: any) => money(l.unit_price, o.currency) }, { header: 'Montant', align: 'right', render: (l: any) => money(l.amount, o.currency) },
          ]} />
          <h3>Réservations de stock</h3>
          <Table rows={o.allocations} empty="Aucune réservation." columns={[
            { header: 'Lot', render: (a: any) => a.lot_code }, { header: 'Dépôt', render: (a: any) => a.warehouse_code },
            { header: 'Réservé', align: 'right', render: (a: any) => kg(a.quantity_kg) }, { header: 'Chargé', align: 'right', render: (a: any) => kg(a.loaded_kg) },
            { header: '', render: (a: any) => manage && !a.released && Number(a.loaded_kg) === 0 && <button className="btn btn-small btn-secondary" disabled={act.busy} onClick={() => act.run(async () => { await post(`/sales-orders/${id}/allocations/${a.id}/release`); reload(); })}>Libérer</button> },
          ]} />
          {manage && ['confirmed', 'partially_shipped'].includes(o.status) && (
            <div className="toolbar">
              <select aria-label="Ligne" value={alloc.line_id} onChange={(e) => setAlloc({ ...alloc, line_id: e.target.value })}><option value="">Ligne…</option>{o.lines.map((l: any) => <option key={l.id} value={l.id}>{l.description ?? kg(l.quantity_kg)}</option>)}</select>
              <select aria-label="Stock" value={alloc.stock} onChange={(e) => setAlloc({ ...alloc, stock: e.target.value })}><option value="">Lot / dépôt…</option>
                {(stocks.data ?? []).filter((s) => Number(s.balance_kg) > 0).map((s) => <option key={`${s.lot_id}|${s.warehouse_id}`} value={`${s.lot_id}|${s.warehouse_id}`}>{s.lot_code} — {s.warehouse_name} ({kg(s.balance_kg)})</option>)}</select>
              <input aria-label="Quantité (kg)" placeholder="kg" inputMode="decimal" value={alloc.quantity_kg} onChange={(e) => setAlloc({ ...alloc, quantity_kg: e.target.value })} />
              <button className="btn btn-secondary" disabled={act.busy || !alloc.line_id || !alloc.stock || !alloc.quantity_kg} onClick={() => act.run(async () => {
                const [lot_id, warehouse_id] = alloc.stock.split('|'); await post(`/sales-orders/${id}/allocations`, { line_id: alloc.line_id, lot_id, warehouse_id, quantity_kg: alloc.quantity_kg }); setAlloc({ line_id: '', stock: '', quantity_kg: '' }); reload();
              })}>Réserver</button>
            </div>
          )}
          <DocumentsPanel subjectType="order" subjectId={id} kinds={['contract', 'other']} />
          <h3>Expéditions et factures</h3>
          <p className="muted">{o.shipments.length} expédition(s) : {o.shipments.map((s: any) => s.reference).join(', ') || '—'} · {o.invoices.length} facture(s) : {o.invoices.map((i: any) => i.number).join(', ') || '—'}</p>
          <div className="modal-foot">
            {manage && o.status === 'draft' && <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await post(`/sales-orders/${id}/confirm`); reload(); })}>Confirmer</button>}
            {manage && ['draft', 'confirmed'].includes(o.status) && <button className="btn btn-secondary" onClick={() => setAsk('cancel')}>Annuler la commande</button>}
            {manage && ['delivered', 'shipped', 'partially_shipped'].includes(o.status) && <button className="btn btn-secondary" onClick={() => setAsk('close')}>Clôturer</button>}
          </div>
          {ask && <Confirm title={ask === 'cancel' ? 'Annuler la commande' : 'Clôturer la commande'} reason label="Motif" onClose={() => setAsk(null)} onSubmit={async (reason) => { await post(`/sales-orders/${id}/${ask}`, { reason }); setAsk(null); reload(); }} />}
        </>
      )}
    </Modal>
  );
}

/* ---------------- Expéditions ---------------- */
const hasGap = (items: any[], qty: Record<string, string>) => items.some((i) => Number(qty[i.id] ?? i.loaded_kg) !== Number(i.loaded_kg));
function Shipments() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [logi, setLogi] = useState(false);
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<string | null>(useDeepLink().open);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/shipments${status ? `?status=${status}` : ''}`), [status]);
  return (
    <Card>
      <div className="toolbar"><select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(SHIPMENT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        {can('logistics:manage') && <button className="btn btn-secondary" onClick={() => setLogi(true)}>Transporteurs, véhicules, chauffeurs</button>}
        {can('shipments:manage') && <button className="btn" onClick={() => setCreating(true)}>Nouvelle expédition</button>}</div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune expédition." columns={[
          { header: 'Référence', render: (s) => <button className="link" onClick={() => setDetail(s.id)}>{s.reference}</button> }, { header: 'Destination', render: (s) => s.destination },
          { header: 'Chargé', align: 'right', render: (s) => kg(s.loaded_kg) }, { header: 'Livré', align: 'right', render: (s) => kg(s.delivered_kg) },
          { header: 'Statut', render: (s) => <StatusBadge map={SHIPMENT_STATUS} value={s.status} /> },
        ]} />
      )}
      {creating && <CreateShipment onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {logi && <Logistics onClose={() => setLogi(false)} />}
      {detail && <ShipmentDetail id={detail} onClose={() => { setDetail(null); reload(); }} />}
    </Card>
  );
}

function ShipmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, me } = useAuth();
  const people = useAsync(async () => (can('users:read') ? (await get<any[]>('/users')).filter((u) => u.membership_status === 'active') : []), []);
  const [gapReason, setGapReason] = useState('');
  const [handler, setHandler] = useState('');
  const { data: s, loading, error, reload } = useAsync(() => get<any>(`/shipments/${id}`), [id]);
  const act = useAction();
  const [recv, setRecv] = useState('');
  const [bl, setBl] = useState('');
  const [port, setPort] = useState('');
  const [exporter, setExporter] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const logi = useAsync(async () => (can('logistics:read') ? { carriers: await get<any[]>('/carriers'), vehicles: await get<any[]>('/vehicles'), drivers: await get<any[]>('/drivers') } : { carriers: [], vehicles: [], drivers: [] }), []);
  const [asg, setAsg] = useState<{ carrier_id?: string; vehicle_id?: string; driver_id?: string }>({});
  const manage = can('shipments:manage');
  return (
    <Modal title={s ? `Expédition ${s.reference}` : 'Expédition'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {s && (
        <>
          <p><StatusBadge map={SHIPMENT_STATUS} value={s.status} /> · vers {s.destination}</p>
          {s.bill_of_lading_no && <p>N° de connaissement (B/L) : <strong>{s.bill_of_lading_no}</strong>{s.port ? ` · Port : ${s.port}` : ''}{s.exporter_name ? ` · Exportateur : ${s.exporter_name}` : ''}</p>}
          <p className="muted">
            Transporteur : {logi.data?.carriers.find((x: any) => x.id === s.carrier_id)?.name ?? '—'} · Véhicule : {logi.data?.vehicles.find((x: any) => x.id === s.vehicle_id)?.plate ?? '—'} · Chauffeur : {logi.data?.drivers.find((x: any) => x.id === s.driver_id)?.full_name ?? '—'}
          </p>
          {manage && ['planned', 'loaded'].includes(s.status) && (
            <div className="toolbar">
              <select aria-label="Transporteur" value={asg.carrier_id ?? ''} onChange={(e) => setAsg({ ...asg, carrier_id: e.target.value })}><option value="">Transporteur…</option>{(logi.data?.carriers ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <select aria-label="Véhicule" value={asg.vehicle_id ?? ''} onChange={(e) => setAsg({ ...asg, vehicle_id: e.target.value })}><option value="">Véhicule…</option>{(logi.data?.vehicles ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.plate}</option>)}</select>
              <select aria-label="Chauffeur" value={asg.driver_id ?? ''} onChange={(e) => setAsg({ ...asg, driver_id: e.target.value })}><option value="">Chauffeur…</option>{(logi.data?.drivers ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select>
              <button className="btn btn-secondary" disabled={act.busy || !(asg.carrier_id || asg.vehicle_id || asg.driver_id)} onClick={() => act.run(async () => { await post(`/shipments/${id}/assign`, Object.fromEntries(Object.entries(asg).filter(([, v]) => v))); setAsg({}); reload(); })}>Affecter</button>
            </div>
          )}
          <Table rows={s.items} columns={[
            { header: 'Lot', render: (i: any) => i.lot_code }, { header: 'Prévu', align: 'right', render: (i: any) => kg(i.planned_kg) },
            { header: 'Chargé', align: 'right', render: (i: any) => kg(i.loaded_kg) },
            { header: 'Livré', align: 'right', render: (i: any) => s.status === 'in_transit' && manage
              ? <input aria-label={`Livré ${i.lot_code}`} style={{ width: 90 }} inputMode="decimal" value={qty[i.id] ?? i.loaded_kg} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /> : kg(i.delivered_kg) },
            { header: 'Écart', align: 'right', render: (i: any) => Number(i.discrepancy_kg) ? <Badge tone="warn">{kg(i.discrepancy_kg)}</Badge> : '—' },
          ]} />
          {s.incidents.length > 0 && <><h3>Incidents</h3><ul>{s.incidents.map((x: any) => <li key={x.id}>{x.kind} — {x.description}{x.resolved_at ? ' (résolu)' : ''}</li>)}</ul></>}
          <DocumentsPanel subjectType="shipment" subjectId={id} kinds={['proof_of_delivery', 'transport_doc', 'weighing_ticket', 'other']} locked={['cancelled', 'validated'].includes(s.status)} onChange={reload} />
          {s.status === 'delivered' && !s.documents.length && <p className="muted">La validation exige une preuve de livraison.</p>}
          {s.status === 'in_transit' && manage && <Field label="Réceptionnaire"><input value={recv} onChange={(e) => setRecv(e.target.value)} /></Field>}
          {s.status === 'in_transit' && manage && hasGap(s.items, qty) && (
            <>
              <p className="notice">Écart constaté entre le chargé et le livré : un motif et un responsable de traitement sont obligatoires.</p>
              <Field label="Motif de l'écart"><input value={gapReason} onChange={(e) => setGapReason(e.target.value)} /></Field>
              <Field label="Responsable de traitement"><select value={handler} onChange={(e) => setHandler(e.target.value)}><option value="">—</option>
                {(people.data?.length ? people.data : me ? [{ id: me.user.id, full_name: me.user.full_name }] : []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
            </>
          )}
          <div className="modal-foot">
            {manage && s.status === 'planned' && <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await post(`/shipments/${id}/load`, {}); reload(); })}>Confirmer le chargement</button>}
            {manage && s.status === 'loaded' && <>
              <Field label="N° de connaissement (B/L) — obligatoire" hint="Document remis par la compagnie maritime pour l'expédition vers le port."><input value={bl} onChange={(e) => setBl(e.target.value)} maxLength={60} /></Field>
              <Field label="Port de chargement"><input value={port} onChange={(e) => setPort(e.target.value)} maxLength={120} /></Field>
              <Field label="Exportateur"><input value={exporter} onChange={(e) => setExporter(e.target.value)} maxLength={150} /></Field>
              <button className="btn" disabled={act.busy || bl.trim().length < 3} onClick={() => act.run(async () => { await post(`/shipments/${id}/depart`, { bill_of_lading_no: bl.trim(), ...(port.trim() && { port: port.trim() }), ...(exporter.trim() && { exporter_name: exporter.trim() }) }); reload(); })}>Départ</button></>}
            {manage && s.status === 'in_transit' && <button className="btn" disabled={act.busy || recv.trim().length < 2 || (hasGap(s.items, qty) && (gapReason.trim().length < 3 || !handler))} onClick={() => act.run(async () => {
              await post(`/shipments/${id}/deliver`, { received_by_name: recv, items: s.items.map((i: any) => ({ item_id: i.id, delivered_kg: qty[i.id] ?? i.loaded_kg, ...(Number(qty[i.id] ?? i.loaded_kg) !== Number(i.loaded_kg) && { reason: gapReason, handler_id: handler }) })) }); reload();
            })}>Enregistrer la livraison</button>}
            {can('shipments:validate') && s.status === 'delivered' && <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await post(`/shipments/${id}/validate`, {}); reload(); })}>Valider la livraison</button>}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------------- Factures ---------------- */
function Invoices() {
  const { can } = useAuth();
  const [overdue, setOverdue] = useState(false);
  const [detail, setDetail] = useState<string | null>(useDeepLink().open);
  const [issuing, setIssuing] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/invoices${overdue ? '?overdue=true' : ''}`), [overdue]);
  const rows = data ?? [];
  const sum = (f: (x: any) => number) => rows.filter((x) => x.status !== 'cancelled').reduce((s, x) => s + f(x), 0);
  return (
    <Card>
      <div className="grid">
        <Stat label="Facturé" value={money(sum((x) => Number(x.total)))} /><Stat label="Encaissé" value={money(sum((x) => Number(x.paid)))} tone="ok" />
        <Stat label="Solde à recevoir" value={money(sum((x) => Number(x.balance)))} tone="info" /><Stat label="En retard" value={money(sum((x) => (x.overdue ? Number(x.balance) : 0)))} tone="bad" />
      </div>
      <div className="toolbar">
        <label><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Échues seulement</label>
        {can('invoices:issue') && <button className="btn" onClick={() => setIssuing(true)}>Émettre une facture</button>}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={rows} empty="Aucune facture." columns={[
          { header: 'N°', render: (i) => <button className="link" onClick={() => setDetail(i.id)}>{i.number}</button> }, { header: 'Acheteur', render: (i) => i.buyer_name },
          { header: 'Échéance', render: (i) => <>{date(i.due_date)} {i.overdue && <Badge tone="bad">Échue</Badge>}</> },
          { header: 'Total', align: 'right', render: (i) => money(i.total, i.currency) }, { header: 'Solde', align: 'right', render: (i) => money(i.balance, i.currency) },
          { header: 'Statut', render: (i) => <StatusBadge map={INVOICE_STATUS} value={i.status} /> },
        ]} />
      )}
      {issuing && <IssueInvoice onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); reload(); }} />}
      {detail && <InvoiceDetail id={detail} onClose={() => { setDetail(null); reload(); }} />}
    </Card>
  );
}

function IssueInvoice({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [key] = useState(idem());
  const [orderId, setOrderId] = useState('');
  const orders = useAsync(() => get<any[]>('/sales-orders'), []);
  const order = useAsync(() => (orderId ? get<any>(`/sales-orders/${orderId}`) : Promise.resolve(null)), [orderId]);
  const shipments = useAsync(async () => {
    if (!order.data) return [];
    const list = await Promise.all((order.data.shipments as any[]).filter((s) => s.status === 'validated').map((s) => get<any>(`/shipments/${s.id}`)));
    return list.flatMap((s) => (s.items as any[]).map((i) => ({ ...i, reference: s.reference })));
  }, [order.data]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  const items = (shipments.data ?? []).map((i) => ({ ...i, left: (Number(i.delivered_kg) - Number(i.invoiced_kg)).toFixed(3) })).filter((i) => Number(i.left) > 0);
  const lines = items.filter((i) => Number(qty[i.id] ?? 0) > 0).map((i) => ({ shipment_item_id: i.id, quantity_kg: qty[i.id] }));
  return (
    <Modal title="Émettre une facture" onClose={onClose}>
      <p className="notice">Seules les livraisons validées sont facturables, dans la limite du livré non encore facturé.</p>
      <Field label="Commande"><select value={orderId} onChange={(e) => { setOrderId(e.target.value); setQty({}); }}><option value="">—</option>{(orders.data ?? []).filter((o) => !['draft', 'cancelled'].includes(o.status)).map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}</select></Field>
      {orderId && <Table rows={items} empty="Rien à facturer pour cette commande." columns={[
        { header: 'Expédition', render: (i: any) => i.reference }, { header: 'Lot', render: (i: any) => i.lot_code },
        { header: 'Reste à facturer', align: 'right', render: (i: any) => kg(i.left) },
        { header: 'À facturer (kg)', render: (i: any) => <input aria-label={`Facturer ${i.lot_code}`} style={{ width: 100 }} inputMode="decimal" value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /> },
      ]} />}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !lines.length} onClick={() => run(async () => { await post('/invoices', { idempotency_key: key, order_id: orderId, lines }); onDone(); })}>Émettre</button></div>
    </Modal>
  );
}

const METHODS: Record<string, string> = { cash: 'Espèces', bank_transfer: 'Virement', mobile_money: 'Mobile money', cheque: 'Chèque', other: 'Autre' };
function InvoiceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const { data: i, loading, error, reload } = useAsync(() => get<any>(`/invoices/${id}`), [id]);
  const [p, setP] = useState({ amount: '', received_on: new Date().toISOString().slice(0, 10), method: 'bank_transfer', reference: '' });
  const [key, setKey] = useState(idem());
  const [cancel, setCancel] = useState(false);
  const [cn, setCn] = useState({ amount: '', reason: '' });
  const [cnKey, setCnKey] = useState(idem());
  const act = useAction();
  const banks = useAsync(async () => (can('cash:operate') && can('finance:read') ? (await get<any[]>('/financial-accounts')).filter((a) => a.owner_type === 'other' && a.status === 'active') : []), []);
  const [acct, setAcct] = useState('');
  return (
    <Modal title={i ? `Facture ${i.number}` : 'Facture'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {i && (
        <>
          <p><StatusBadge map={INVOICE_STATUS} value={i.status} /> · {i.buyer_name} · échéance {date(i.due_date)} · solde <strong>{money(i.balance, i.currency)}</strong></p>
          <Table rows={i.lines} columns={[{ header: 'Lot', render: (l: any) => l.lot_code }, { header: 'Quantité', align: 'right', render: (l: any) => kg(l.quantity_kg) }, { header: 'Prix', align: 'right', render: (l: any) => money(l.unit_price, i.currency) }, { header: 'Montant', align: 'right', render: (l: any) => money(l.amount, i.currency) }]} />
          <h3>Paiements reçus</h3>
          <Table rows={i.payments} empty="Aucun paiement." columns={[{ header: 'Date', render: (x: any) => date(x.received_on) }, { header: 'Mode', render: (x: any) => METHODS[x.method] ?? x.method }, { header: 'Référence', render: (x: any) => x.reference ?? '—' }, { header: 'Montant', align: 'right', render: (x: any) => money(x.amount, i.currency) }]} />
          {can('invoices:payments') && ['issued', 'partially_paid'].includes(i.status) && (
            <div className="toolbar">
              <input aria-label="Montant" placeholder="Montant" inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} />
              <input aria-label="Date" type="date" value={p.received_on} onChange={(e) => setP({ ...p, received_on: e.target.value })} />
              <select aria-label="Mode" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input aria-label="Référence" placeholder="Référence" value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} />
              {!!banks.data?.length && <select aria-label="Compte de réception" value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">Sans écriture comptable</option>{banks.data.map((a: any) => <option key={a.id} value={a.id}>Comptabiliser sur {a.name}</option>)}</select>}
              <button className="btn" disabled={act.busy || !p.amount} onClick={() => act.run(async () => { await post(`/invoices/${id}/payments`, { idempotency_key: key, amount: p.amount, received_on: p.received_on, method: p.method, ...(p.reference && { reference: p.reference }), ...(acct && { account_id: acct }) }); setKey(idem()); setP({ ...p, amount: '', reference: '' }); reload(); })}>Enregistrer le paiement</button>
            </div>
          )}
          {(i.credit_notes.length > 0 || (can('invoices:issue') && ['issued', 'partially_paid'].includes(i.status))) && <h3>Avoirs</h3>}
          {i.credit_notes.length > 0 && <Table rows={i.credit_notes} columns={[{ header: 'N°', render: (x: any) => x.number }, { header: 'Date', render: (x: any) => date(x.issued_on) }, { header: 'Motif', render: (x: any) => x.reason }, { header: 'Montant', align: 'right', render: (x: any) => money(x.amount, i.currency) }]} />}
          {can('invoices:issue') && ['issued', 'partially_paid'].includes(i.status) && Number(i.balance) > 0 && (
            <div className="toolbar">
              <input aria-label="Montant de l'avoir" placeholder="Montant de l'avoir" inputMode="decimal" value={cn.amount} onChange={(e) => setCn({ ...cn, amount: e.target.value })} />
              <input aria-label="Motif de l'avoir" placeholder="Motif (écart de poids, qualité…)" value={cn.reason} onChange={(e) => setCn({ ...cn, reason: e.target.value })} />
              <button className="btn btn-secondary" disabled={act.busy || !cn.amount || cn.reason.length < 3} onClick={() => act.run(async () => { await post(`/invoices/${id}/credit-notes`, { idempotency_key: cnKey, amount: cn.amount, reason: cn.reason }); setCn({ amount: '', reason: '' }); setCnKey(idem()); reload(); })}>Émettre un avoir</button>
            </div>
          )}
          <DocumentsPanel subjectType="invoice" subjectId={id} kinds={['invoice_copy', 'payment_proof', 'other']} locked={i.status === 'cancelled'} />
          <div className="modal-foot">{can('invoices:issue') && i.status !== 'cancelled' && !i.payments.length && !i.credit_notes.length && <button className="btn btn-secondary" onClick={() => setCancel(true)}>Annuler la facture</button>}</div>
          {cancel && <Confirm title="Annuler la facture" reason label="Motif" onClose={() => setCancel(false)} onSubmit={async (reason) => { await post(`/invoices/${id}/cancel`, { reason }); setCancel(false); reload(); }} />}
        </>
      )}
    </Modal>
  );
}

/* ---------------- Acheteurs ---------------- */
function Buyers() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [stmt, setStmt] = useState<string | null>(null);
  const [contract, setContract] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/buyers'), []);
  return (
    <Card>
      <div className="toolbar">{can('buyers:manage') && <button className="btn btn-secondary" onClick={() => setContract(true)}>Nouveau contrat de vente</button>}
        {can('buyers:manage') && <button className="btn" onClick={() => setCreating(true)}>Nouvel acheteur</button>}</div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucun acheteur." columns={[
          { header: 'Code', render: (b) => b.code }, { header: 'Nom', render: (b) => b.name }, { header: 'Pays', render: (b) => b.country ?? '—' },
          { header: 'Délai', render: (b) => `${b.payment_terms_days} j` },
          { header: 'Statut', render: (b) => <Badge tone={b.status === 'active' ? 'ok' : 'warn'}>{b.status === 'active' ? 'Actif' : b.status === 'suspended' ? 'Suspendu' : 'Clôturé'}</Badge> },
          { header: '', render: (b) => can('invoices:read') && <button className="btn btn-small btn-secondary" onClick={() => setStmt(b.id)}>Situation</button> },
        ]} />
      )}
      {creating && <CreateBuyer onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {contract && <CreateContract onClose={() => setContract(false)} onDone={() => setContract(false)} />}
      {stmt && <Statement id={stmt} onClose={() => setStmt(null)} />}
    </Card>
  );
}

function CreateBuyer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', country: '', phone: '', email: '', payment_terms_days: '30' });
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Nouvel acheteur" onClose={onClose}>
      <Field label="Code"><input value={f.code} onChange={set('code')} /></Field><Field label="Nom"><input value={f.name} onChange={set('name')} /></Field>
      <Field label="Pays"><input value={f.country} onChange={set('country')} /></Field><Field label="Téléphone"><input value={f.phone} onChange={set('phone')} /></Field>
      <Field label="E-mail"><input type="email" value={f.email} onChange={set('email')} /></Field><Field label="Délai de paiement (jours)"><input type="number" min="0" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || f.code.length < 2 || f.name.length < 2} onClick={() => run(async () => {
          await post('/buyers', { code: f.code, name: f.name, payment_terms_days: Number(f.payment_terms_days), ...(f.country && { country: f.country }), ...(f.phone && { phone: f.phone }), ...(f.email && { email: f.email }) }); onDone();
        })}>Créer</button></div>
    </Modal>
  );
}

function Statement({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => get<any>(`/buyers/${id}/statement`), [id]);
  return (
    <Modal title={data ? `Situation — ${data.buyer.name}` : 'Situation'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}
      {data && (
        <>
          <div className="grid"><Stat label="Facturé" value={money(data.totals.invoiced)} /><Stat label="Encaissé" value={money(data.totals.paid)} tone="ok" /><Stat label="Solde" value={money(data.totals.balance)} tone="info" /><Stat label="En retard" value={money(data.totals.overdue)} tone="bad" /></div>
          <Table rows={data.invoices} empty="Aucune facture." columns={[{ header: 'N°', render: (i: any) => i.number }, { header: 'Échéance', render: (i: any) => date(i.due_date) }, { header: 'Solde', align: 'right', render: (i: any) => money(i.balance, i.currency) }, { header: 'Statut', render: (i: any) => <StatusBadge map={INVOICE_STATUS} value={i.status} /> }]} />
        </>
      )}
    </Modal>
  );
}
