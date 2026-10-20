import { useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Stat, Table, useAction, useAsync } from '../ui';
import { date, money } from '../format';

const KIND: Record<string, string> = { purchase: 'Achat', expense: 'Dépense', advance: 'Avance', other: 'Autre' };
const today = () => new Date().toISOString().slice(0, 10);

export default function Prefinancement() {
  const { can } = useAuth();
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => ({ list: await get<any[]>('/prefinancings'), report: await get<any>('/prefinancings/report') }), []);
  return (
    <>
      <PageHeader title="Préfinancement" subtitle="Fonds reçus par la coopérative, utilisation, justificatifs et remboursements"
        actions={can('prefinancing:manage') && <button className="btn" onClick={() => setCreating(true)}>Enregistrer un fonds reçu</button>} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : data && (
        <>
          {data.report.by_currency.map((r: any) => (
            <div className="grid" key={r.currency}>
              <Stat label={`Reçu (${r.currency})`} value={money(r.received, r.currency)} /><Stat label="Utilisé" value={money(r.used, r.currency)} tone="info" />
              <Stat label="Disponible" value={money(r.available, r.currency)} tone="ok" /><Stat label="Remboursé" value={money(r.repaid, r.currency)} />
              <Stat label="Reste à rembourser" value={money(r.outstanding, r.currency)} tone="warn" /><Stat label="Achats financés" value={money(r.purchases_financed, r.currency)} />
            </div>
          ))}
          {data.report.overdue.length > 0 && <p className="notice">{data.report.overdue.length} préfinancement(s) échu(s) non soldé(s) : {data.report.overdue.map((o: any) => o.number).join(', ')}.</p>}
          <Card>
            <Table rows={data.list} empty="Aucun préfinancement." columns={[
              { header: 'N°', render: (p) => <button className="link" onClick={() => setDetail(p.id)}>{p.number}</button> }, { header: 'Bailleur', render: (p) => p.funder },
              { header: 'Montant', align: 'right', render: (p) => money(p.amount, p.currency) }, { header: 'Disponible', align: 'right', render: (p) => money(p.available, p.currency) },
              { header: 'À rembourser', align: 'right', render: (p) => money(p.outstanding, p.currency) },
              { header: 'Échéance', render: (p) => <>{date(p.due_date)} {p.overdue && <Badge tone="bad">Échu</Badge>}</> },
            ]} />
          </Card>
        </>
      )}
      {creating && <Create onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {detail && <Detail id={detail} canManage={can('prefinancing:manage')} onClose={() => { setDetail(null); reload(); }} />}
    </>
  );
}

function Create({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [key] = useState(idem());
  const banks = useAsync(async () => (await get<any[]>('/financial-accounts')).filter((a) => ['other', 'cash_register'].includes(a.owner_type) && a.status === 'active'), []);
  const [f, setF] = useState({ account_id: '', funder: '', amount: '', currency: 'XOF', received_on: today(), due_date: '', conditions: '' });
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Fonds reçu" onClose={onClose}>
      <Field label="Compte qui reçoit les fonds"><select aria-label="Compte qui reçoit les fonds" value={f.account_id} onChange={set('account_id')}><option value="">—</option>{(banks.data ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></Field>
      <Field label="Bailleur / financeur"><input value={f.funder} onChange={set('funder')} /></Field>
      <Field label="Montant"><input inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
      <Field label="Devise"><input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
      <Field label="Date de réception"><input type="date" value={f.received_on} onChange={set('received_on')} /></Field>
      <Field label="Échéance de remboursement"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
      <Field label="Conditions"><textarea rows={3} value={f.conditions} onChange={set('conditions')} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !f.account_id || f.funder.length < 2 || !f.amount || f.currency.length !== 3} onClick={() => run(async () => {
          await post('/prefinancings', { idempotency_key: key, account_id: f.account_id, funder: f.funder, amount: f.amount, currency: f.currency, received_on: f.received_on, ...(f.due_date && { due_date: f.due_date }), ...(f.conditions && { conditions: f.conditions }) }); onDone();
        })}>Enregistrer</button></div>
    </Modal>
  );
}

function Detail({ id, canManage, onClose }: { id: string; canManage: boolean; onClose: () => void }) {
  const { data: p, loading, error, reload } = useAsync(() => get<any>(`/prefinancings/${id}`), [id]);
  const [u, setU] = useState({ kind: 'purchase', amount: '', used_on: today(), purpose: '', document_ref: '' });
  const [r, setR] = useState({ amount: '', paid_on: today(), reference: '' });
  const [uk, setUk] = useState(idem());
  const [rk, setRk] = useState(idem());
  const act = useAction();
  return (
    <Modal title={p ? `Préfinancement ${p.number}` : 'Préfinancement'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {p && (
        <>
          <p>{p.funder} · {money(p.amount, p.currency)} · disponible <strong>{money(p.available, p.currency)}</strong> · reste à rembourser <strong>{money(p.outstanding, p.currency)}</strong></p>
          {p.account_name && <p className="muted">Compte : {p.account_name}{p.receipt_entry_number ? ` · écriture ${p.receipt_entry_number}` : ''}</p>}
          {p.conditions && <p className="muted">Conditions : {p.conditions}</p>}
          <h3>Utilisations</h3>
          <Table rows={p.uses} empty="Aucune utilisation." columns={[{ header: 'Date', render: (x: any) => date(x.used_on) }, { header: 'Nature', render: (x: any) => KIND[x.kind] ?? x.kind }, { header: 'Objet', render: (x: any) => x.purpose }, { header: 'Justificatif', render: (x: any) => x.document_ref ?? '—' }, { header: 'Montant', align: 'right', render: (x: any) => money(x.amount, p.currency) }]} />
          {canManage && p.status === 'active' && (
            <div className="toolbar">
              <select aria-label="Nature" value={u.kind} onChange={(e) => setU({ ...u, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input aria-label="Montant utilisé" placeholder="Montant" inputMode="decimal" value={u.amount} onChange={(e) => setU({ ...u, amount: e.target.value })} />
              <input aria-label="Date d'utilisation" type="date" value={u.used_on} onChange={(e) => setU({ ...u, used_on: e.target.value })} />
              <input aria-label="Objet" placeholder="Objet" value={u.purpose} onChange={(e) => setU({ ...u, purpose: e.target.value })} />
              <input aria-label="Justificatif" placeholder="Réf. justificatif" value={u.document_ref} onChange={(e) => setU({ ...u, document_ref: e.target.value })} />
              <button className="btn" disabled={act.busy || !u.amount || u.purpose.length < 3} onClick={() => act.run(async () => { await post(`/prefinancings/${id}/uses`, { idempotency_key: uk, kind: u.kind, amount: u.amount, used_on: u.used_on, purpose: u.purpose, ...(u.document_ref && { document_ref: u.document_ref }) }); setUk(idem()); setU({ ...u, amount: '', purpose: '', document_ref: '' }); reload(); })}>Utiliser</button>
            </div>
          )}
          <h3>Remboursements</h3>
          <Table rows={p.repayments} empty="Aucun remboursement." columns={[{ header: 'Date', render: (x: any) => date(x.paid_on) }, { header: 'Référence', render: (x: any) => x.reference ?? '—' }, { header: 'Montant', align: 'right', render: (x: any) => money(x.amount, p.currency) }]} />
          {canManage && p.status === 'active' && (
            <div className="toolbar">
              <input aria-label="Montant remboursé" placeholder="Montant" inputMode="decimal" value={r.amount} onChange={(e) => setR({ ...r, amount: e.target.value })} />
              <input aria-label="Date de remboursement" type="date" value={r.paid_on} onChange={(e) => setR({ ...r, paid_on: e.target.value })} />
              <input aria-label="Référence" placeholder="Référence" value={r.reference} onChange={(e) => setR({ ...r, reference: e.target.value })} />
              <button className="btn" disabled={act.busy || !r.amount} onClick={() => act.run(async () => { await post(`/prefinancings/${id}/repayments`, { idempotency_key: rk, amount: r.amount, paid_on: r.paid_on, ...(r.reference && { reference: r.reference }) }); setRk(idem()); setR({ ...r, amount: '', reference: '' }); reload(); })}>Rembourser</button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
