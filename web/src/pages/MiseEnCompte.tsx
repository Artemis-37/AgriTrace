import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { date } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';

const f = (n: any) => Number(n ?? 0).toLocaleString('fr-FR');
const MODES: Record<string, string> = { account: 'Sur le compte du délégué', cheque: 'Chèque', cash: 'Espèces', transfer: 'Vers un autre compte' };
const STATE: Record<string, [string, 'ok' | 'bad' | 'warn']> = { pending: ['En attente', 'warn'], approved: ['Approuvé', 'ok'], rejected: ['Refusé', 'bad'] };

/** Mise en compte (retenues sur règlements) des délégués : clôture du compte, demande de reversement, approbation par l'administrateur. */
export default function MiseEnCompte() {
  const { can } = useAuth();
  const [tab, setTab] = useState('delegues');
  const tabs: [string, string][] = [['delegues', 'Délégués'], ['demandes', 'Demandes de reversement']];
  return (
    <>
      <PageHeader title="Mise en compte des délégués" subtitle="Somme retenue sur les règlements, reversée une fois le compte du délégué clôturé : sur son compte, par chèque, en espèces ou vers un autre compte, après approbation de l'administrateur." />
      <Tabs tabs={tabs as any} value={tab as any} onChange={setTab as any} />
      {tab === 'delegues' ? <Delegues canAct={can('savings:request')} /> : <Demandes canDecide={can('savings:approve')} />}
    </>
  );
}

function Delegues({ canAct }: { canAct: boolean }) {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/collector-savings'), []);
  const [rel, setRel] = useState<any | null>(null);
  const [closing, setClosing] = useState<any | null>(null);
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <div className="table-scroll"><Table rows={data ?? []} empty="Aucun délégué." columns={[
        { header: 'Code', render: (r) => <code>{r.code ?? '—'}</code> }, { header: 'Délégué', render: (r) => <strong>{r.name}</strong> },
        { header: 'Retenu', render: (r) => <span className="r">{f(r.retained)}</span> }, { header: 'Reversé', render: (r) => <span className="r">{f(r.released)}</span> },
        { header: 'En attente', render: (r) => <span className="r">{f(r.pending)}</span> }, { header: 'Disponible', render: (r) => <strong className="r">{f(r.available)}</strong> },
        { header: 'Compte', render: (r) => r.account_closed_at ? <Badge tone="neutral">Clôturé le {date(r.account_closed_at)}</Badge> : <Badge tone="ok">Ouvert</Badge> },
        { header: '', render: (r) => canAct ? (
          <span className="row-actions">
            {!r.account_closed_at && <button className="btn btn-small btn-secondary" onClick={() => setClosing(r)}>Clôturer le compte</button>}
            {r.account_closed_at && Number(r.available) > 0 && <button className="btn btn-small" onClick={() => setRel(r)}>Reverser…</button>}
          </span>) : null },
      ]} /></div>}
      {closing && <Close r={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload(); }} />}
      {rel && <Release r={rel} onClose={() => setRel(null)} onDone={() => { setRel(null); reload(); }} />}
    </Card>
  );
}

function Close({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('Fin de campagne');
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Clôturer le compte de ${r.name}`} onClose={onClose}>
      <p className="muted">Une fois le compte clôturé, la mise en compte ({f(r.available)} FCFA) peut être reversée après approbation de l'administrateur. Une nouvelle livraison rouvre le compte.</p>
      <Field label="Motif"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || reason.trim().length < 3} onClick={() => run(async () => { await post(`/collector-savings/collectors/${r.collector_id}/close`, { reason }); onDone(); })}>Clôturer</button></div>
    </Modal>
  );
}

function Release({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { data } = useAsync(async () => ({ accounts: await get<any[]>('/financial-accounts').catch(() => [] as any[]), regs: await get<any[]>('/cash-registers').catch(() => [] as any[]) }), []);
  const [mode, setMode] = useState('account');
  const [amount, setAmount] = useState(String(Math.round(Number(r.available))));
  const [target, setTarget] = useState('');
  const [cheque, setCheque] = useState('');
  const [session, setSession] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const banks = (data?.accounts ?? []).filter((a) => a.owner_type === 'other' && a.status === 'active');
  const open = (data?.regs ?? []).filter((x) => x.open_session_id);
  const ok = /^\d+(\.\d{1,4})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(r.available)
    && (mode === 'account' || (mode === 'cash' && session) || (mode === 'transfer' && target) || (mode === 'cheque' && target && cheque.trim()));
  return (
    <Modal title={`Reverser la mise en compte de ${r.name}`} onClose={onClose}>
      <p className="muted">Disponible : <strong>{f(r.available)} FCFA</strong>. La demande sera soumise à l'administrateur de la coopérative.</p>
      <Field label="Montant à reverser (FCFA)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Destination"><div className="role-pick">{Object.entries(MODES).map(([k, v]) => <label key={k} className="check"><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} /> {v}</label>)}</div></Field>
      {mode === 'cheque' && <>
        <Field label="Compte bancaire débité"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">—</option>{banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="N° du chèque"><input value={cheque} onChange={(e) => setCheque(e.target.value)} maxLength={40} /></Field></>}
      {mode === 'cash' && <Field label="Caisse (session ouverte)"><select value={session} onChange={(e) => setSession(e.target.value)}><option value="">—</option>{open.map((x) => <option key={x.id} value={x.open_session_id}>{x.name}</option>)}</select></Field>}
      {mode === 'transfer' && <Field label="Autre compte"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">—</option>{(data?.accounts ?? []).filter((a) => a.status === 'active' && a.owner_type !== 'cash_register').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      <Field label="Observation (facultatif)"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !ok} onClick={() => run(async () => { await post('/collector-savings/requests', { collector_id: r.collector_id, amount, mode, ...(mode === 'cheque' || mode === 'transfer' ? { target_account_id: target } : {}), ...(mode === 'cheque' ? { cheque_no: cheque.trim() } : {}), ...(mode === 'cash' ? { cash_session_id: session } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }); onDone(); })}>Soumettre à l'approbation</button></div>
    </Modal>
  );
}

function Demandes({ canDecide }: { canDecide: boolean }) {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/collector-savings/requests'), []);
  const act = useAction();
  const [rej, setRej] = useState<any | null>(null);
  const [comment, setComment] = useState('');
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading ? <Loading /> : <div className="table-scroll"><Table rows={data ?? []} empty="Aucune demande." columns={[
        { header: 'Date', render: (q) => date(q.requested_at) }, { header: 'Délégué', render: (q) => <strong>{q.collector_name}</strong> },
        { header: 'Montant', render: (q) => <span className="r">{f(q.amount)}</span> },
        { header: 'Destination', render: (q) => MODES[q.mode] + (q.mode === 'cheque' ? ` n° ${q.cheque_no}` : q.target_account_name ? ` — ${q.target_account_name}` : '') },
        { header: 'Demandé par', render: (q) => q.requested_by_name ?? '—' },
        { header: 'État', render: (q) => <Badge tone={STATE[q.status][1]}>{STATE[q.status][0]}</Badge> },
        { header: 'Décision', render: (q) => q.status === 'pending' ? '' : `${q.decided_by_name ?? ''}${q.decision_comment ? ' : ' + q.decision_comment : ''}${q.entry_number ? ' · écriture ' + q.entry_number : ''}` },
        { header: '', render: (q) => canDecide && q.status === 'pending' ? (
          <span className="row-actions">
            <button className="btn btn-small" disabled={act.busy} onClick={() => act.run(async () => { await post(`/collector-savings/requests/${q.id}/approve`, {}); reload(); })}>Approuver</button>
            <button className="btn btn-small btn-secondary" onClick={() => { setRej(q); setComment(''); }}>Refuser</button>
          </span>) : null },
      ]} /></div>}
      {rej && (
        <Modal title={`Refuser le reversement de ${rej.collector_name}`} onClose={() => setRej(null)}>
          <Field label="Motif du refus"><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="modal-foot"><button className="btn btn-secondary" onClick={() => setRej(null)}>Annuler</button>
            <button className="btn" disabled={act.busy || comment.trim().length < 3} onClick={() => act.run(async () => { await post(`/collector-savings/requests/${rej.id}/reject`, { comment }); setRej(null); reload(); })}>Refuser</button></div>
        </Modal>)}
    </Card>
  );
}
