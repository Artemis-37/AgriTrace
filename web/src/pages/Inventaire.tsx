import { useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { COUNT_STATUS, dateTime, kg } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Table, useAction, useAsync } from '../ui';
import { Confirm } from './Declarations';

export default function Inventaire() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/stock-counts${status ? `?status=${status}` : ''}`), [status]);
  const whs = useAsync(() => get<any[]>('/warehouses').catch(() => []), []);
  const names = new Map((whs.data ?? []).map((w) => [w.id, w.name]));
  return (
    <>
      <PageHeader title="Inventaire" subtitle="Comptage physique, écarts et approbation. Les corrections sont des mouvements d'ajustement, jamais des suppressions."
        actions={<button className="btn" onClick={() => setOpening(true)}>Ouvrir un inventaire</button>} />
      <Card>
        <div className="toolbar"><select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(COUNT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Table rows={data ?? []} empty="Aucun inventaire." columns={[
            { header: 'N°', render: (s) => <button className="link" onClick={() => setDetail(s.id)}>{s.number}</button> },
            { header: 'Magasin', render: (s) => names.get(s.warehouse_id) ?? '—' }, { header: 'Ouvert le', render: (s) => dateTime(s.opened_at) },
            { header: 'Statut', render: (s) => <StatusBadge map={COUNT_STATUS} value={s.status} /> },
          ]} />
        )}
      </Card>
      {opening && <Open whs={whs.data ?? []} onClose={() => setOpening(false)} onDone={(id) => { setOpening(false); reload(); setDetail(id); }} />}
      {detail && <Detail id={detail} canApprove={can('stock:count_approve')} onClose={() => { setDetail(null); reload(); }} />}
    </>
  );
}

function Open({ whs, onClose, onDone }: { whs: any[]; onClose: () => void; onDone: (id: string) => void }) {
  const [key] = useState(idem());
  const [wh, setWh] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title="Ouvrir un inventaire" onClose={onClose}>
      <p className="notice">Le stock théorique est figé à l'ouverture. L'écart sera calculé par rapport à cette valeur.</p>
      <Field label="Magasin"><select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">—</option>{whs.filter((w) => w.status === 'active').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !wh} onClick={() => run(async () => { const s = await post('/stock-counts', { idempotency_key: key, warehouse_id: wh }); onDone(s.id); })}>Ouvrir</button></div>
    </Modal>
  );
}

function Detail({ id, canApprove, onClose }: { id: string; canApprove: boolean; onClose: () => void }) {
  const { data: s, loading, error, reload } = useAsync(() => get<any>(`/stock-counts/${id}`), [id]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const act = useAction();
  const lines: any[] = s?.lines ?? [];
  const editable = s?.status === 'counting';
  const changed = lines.filter((l) => counted[l.lot_id] !== undefined && counted[l.lot_id] !== '').map((l) => ({ lot_id: l.lot_id, counted_kg: counted[l.lot_id], ...(reasons[l.lot_id] && { reason: reasons[l.lot_id] }) }));
  return (
    <Modal title={s ? `Inventaire ${s.number}` : 'Inventaire'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {s && (
        <>
          <p><StatusBadge map={COUNT_STATUS} value={s.status} /></p>
          <Table rows={lines} empty="Aucun lot en stock dans ce magasin." columns={[
            { header: 'Lot', render: (l) => l.lot_code }, { header: 'Théorique', align: 'right', render: (l) => kg(l.theoretical_kg) },
            { header: 'Compté', align: 'right', render: (l) => editable
              ? <input aria-label={`Compté ${l.lot_code}`} style={{ width: 100 }} inputMode="decimal" placeholder={l.counted_kg ?? ''} value={counted[l.lot_id] ?? ''} onChange={(e) => setCounted({ ...counted, [l.lot_id]: e.target.value })} /> : kg(l.counted_kg) },
            { header: 'Écart', align: 'right', render: (l) => l.counted_kg === null || l.counted_kg === undefined ? '—' : Number(l.variance_kg) === 0 ? <Badge tone="ok">0</Badge> : <Badge tone="warn">{kg(l.variance_kg)}</Badge> },
            { header: 'Motif', render: (l) => editable ? <input aria-label={`Motif ${l.lot_code}`} value={reasons[l.lot_id] ?? l.reason ?? ''} onChange={(e) => setReasons({ ...reasons, [l.lot_id]: e.target.value })} /> : (l.reason ?? '—') },
            { header: 'Compteur', render: (l) => l.counted_by_name ?? '—' },
          ]} />
          <div className="modal-foot">
            {editable && <button className="btn btn-secondary" disabled={act.busy || !changed.length} onClick={() => act.run(async () => { await post(`/stock-counts/${id}/counts`, { lines: changed }); setCounted({}); reload(); })}>Enregistrer le comptage</button>}
            {editable && <button className="btn" disabled={act.busy || changed.length > 0} title={changed.length ? 'Enregistrer le comptage d\'abord' : ''} onClick={() => act.run(async () => { await post(`/stock-counts/${id}/submit`, {}); reload(); })}>Soumettre</button>}
            {canApprove && s.status === 'submitted' && <><button className="btn" onClick={() => setAsk('approve')}>Approuver</button><button className="btn btn-secondary" onClick={() => setAsk('reject')}>Rejeter</button></>}
            {['counting', 'submitted'].includes(s.status) && <button className="btn btn-secondary" onClick={() => setAsk('cancel')}>Annuler</button>}
          </div>
          {ask && <Confirm title={ask === 'approve' ? 'Approuver l\'inventaire' : ask === 'reject' ? 'Rejeter l\'inventaire' : 'Annuler l\'inventaire'} reason label="Note" onClose={() => setAsk(null)}
            intro={ask === 'approve' ? 'Les écarts deviennent des mouvements d\'ajustement. L\'approbateur doit être différent du compteur.' : undefined}
            onSubmit={async (note) => { await post(`/stock-counts/${id}/${ask}`, ask === 'cancel' ? { reason: note, note } : { note }); setAsk(null); reload(); }} />}
        </>
      )}
    </Modal>
  );
}
