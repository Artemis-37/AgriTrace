import { ANALYSIS } from '../analysis';
import QRCode from 'qrcode';
import { FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import OrgLogo from '../OrgLogo';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Table, Tabs, useAction, useAsync } from '../ui';
import { useDeepLink } from '../notifTarget';

const STATUS: Record<string, [string, any]> = { pending: ['En attente', 'warn'], approved: ['Approuvée', 'good'], rejected: ['Refusée', 'bad'], failed: ['Échec', 'bad'] };
const TYPE_LABEL: Record<string, string> = {
  convoy_reception: 'Réception de convoi', convoy_settlement: 'Règlement de convoi', financial_transaction: 'Opération de caisse',
  accounting_entry: 'Écriture comptable', warehouse_movement: 'Mouvement de stock',
};

/** Reçu prêt à imprimer : rendu hors de l'application (portail) pour que seule cette feuille sorte à l'impression. */
function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: 160, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc('')); }, [text]);
  return src ? <img src={src} alt="QR code du bulletin" width={90} height={90} /> : null;
}

const fmtKg = (v: string | null | undefined) => (v == null ? '' : `${v} kg`);

/** Bulletin de pesée, présenté par parties : connaissement, pesée, analyse, livraison produit, visas. Les lignes sans donnée ne sont pas imprimées. */
function Bulletin({ r }: { r: any }) {
  const b = r.bulletin; const o = r.organization ?? {};
  const rank = (k: string) => { const i = ANALYSIS.indexOf(k); return i < 0 ? 99 : i; };
  const an = (Object.entries(b.analysis ?? {}) as [string, string][]).sort((x, y) => rank(x[0]) - rank(y[0]));
  const L = (label: string, v: any, strong = false) => (v == null || v === '' ? null : <div className={`bp-l${strong ? ' net' : ''}`}><span>{label}</span><b>{v}</b></div>);
  const qr = `AGRITRACE|${b.no}|${b.convoy_no}|NET ${b.net} kg|${String(b.received_at).slice(0, 10)}`;
  return (
    <div className="bp">
      <div className="bp-top">
        <div><small>Date pesée</small><b>{dateTime(b.weigh_in_at ?? b.received_at)}</b></div>
        <div className="bp-title">BULLETIN DE PESÉE</div>
        <div className="bp-no"><small>N° Bulletin</small><b>{b.no}</b></div>
      </div>
      {r.duplicate && <p className="receipt-dup">DUPLICATA n°{r.copy_no}</p>}
      {r.cancelled && <p className="receipt-dup">OPÉRATION ANNULÉE</p>}
      {b.status === 'pending_variance' && <p className="receipt-dup">ÉCART À VALIDER — NON PAYABLE</p>}

      <h3>Indication connaissement</h3>
      <div className="bp-2">
        <div>{L('Propriétaire', o.commercial_name || o.name)}{L('Origine', b.origin)}{L('Chauffeur', b.driver)}{L('N° tracteur', b.truck)}{L('N° remorque', b.trailer)}{L('Poids déclaré', fmtKg(b.declared))}</div>
        <div>{L('Fournisseur', b.collector)}{L('Connaissement', b.convoy_no)}{L('Nb sacs déclaré', b.declared_bags)}{L('Destination', b.warehouse)}{L('Date réception', dateTime(b.received_at))}</div>
      </div>

      <h3>Pesée</h3>
      <div className="bp-2">
        <div>{L("Poids d'entrée", fmtKg(b.weigh_in))}{L("Date d'entrée", b.weigh_in ? dateTime(b.weigh_in_at) : null)}{L("Pont d'entrée", b.weigh_in ? b.warehouse : null)}</div>
        <div>{L('Poids de sortie', fmtKg(b.weigh_out))}{L('Date de sortie', b.weigh_out ? dateTime(b.weigh_out_at) : null)}{L('Pont de sortie', b.weigh_out ? b.warehouse : null)}</div>
      </div>

      {an.length > 0 && <><h3>Analyse</h3>
        <div className="bp-3">{an.map(([k, v]) => L(k, v))}</div></>}

      <h3>Livraison produit</h3>
      <div className="bp-2 bp-liv">
        <div>{L('Poids brut (kg)', fmtKg(b.gross))}{L('Sacs acceptés', b.bags_unloaded != null ? b.bags_unloaded - (b.bags_refused ?? 0) : b.bags)}{L('Tare sacs acceptés', fmtKg(b.bag_tare))}{L('Poids net livré', fmtKg(b.net_delivered))}{L('Réfaction', fmtKg(b.refaction))}{L('POIDS NET PAYÉ', fmtKg(b.net), true)}</div>
        <div>{L('Nb sacs déchargés', b.bags_unloaded)}{L('Sacs refusés', b.bags_refused)}{L('Manquants', b.missing)}{L('Écart / poids déclaré', b.variance == null ? null : `${b.variance} kg`)}{L('Poids moyen sac accepté', fmtKg(b.avg_bag))}{L('Classement', b.grade)}
          <div className="bp-qr"><Qr text={qr} /></div></div>
      </div>
      {b.notes && <p><strong>Observations :</strong> {b.notes}</p>}
      <footer className="bp-visas">
        <div><span>{r.operator ?? ''}</span></div><div><span>{b.collector ?? ''}</span></div><div><span>{b.approver ?? ''}</span></div>
      </footer>
    </div>
  );
}

function Receipt({ r, onClose }: { r: any; onClose: () => void }) {
  useEffect(() => { document.body.classList.add('printing-receipt'); return () => document.body.classList.remove('printing-receipt'); }, []);
  const o = r.organization ?? {};
  return (
    <>
      <Modal title={r.title} onClose={onClose}>
        <p className="muted">Aperçu avant impression. {r.duplicate ? `Cette pièce a déjà été imprimée : le document porte la mention « DUPLICATA n°${r.copy_no} ».` : ''}</p>
        <div className="modal-actions"><button className="btn" onClick={() => window.print()}>Imprimer</button><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
      </Modal>
      {createPortal(
        <div id="receipt-print" className="receipt-sheet">
          <header>
            <OrgLogo height={64} />
            <div><h1>{o.commercial_name || o.name}</h1>
              <small>{[o.address, o.phone, o.email].filter(Boolean).join(' · ')}</small></div>
          </header>
          {r.bulletin ? <Bulletin r={r} /> : <>
          <h2>{r.title} <span className="receipt-no">n° {r.number}</span></h2>
          {r.duplicate && <p className="receipt-dup">DUPLICATA n°{r.copy_no}</p>}
          {r.cancelled && <p className="receipt-dup">OPÉRATION ANNULÉE</p>}
          <p>{r.label}</p>
          <table><tbody>{r.lines.map((l: any, i: number) => <tr key={i}><th>{l.label}</th><td>{l.value}</td></tr>)}</tbody></table>
          {r.notes && <p><strong>Observations :</strong> {r.notes}</p>}
          <p>Date de l'opération : {dateTime(r.at)} · Opérateur : {r.operator ?? '—'}</p>
          <footer>
            <div><span>Opérateur</span></div><div><span>Responsable / contre-signature</span></div>
          </footer></>}
          <small>Édité le {dateTime(new Date().toISOString())} par {r.printed_by ?? '—'}</small>
        </div>, document.body)}
    </>
  );
}

function RequestModal({ op, onClose, onDone }: { op: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const act = useAction();
  const submit = (e: FormEvent) => { e.preventDefault(); act.run(async () => { await post('/cancellation-requests', { entity_type: op.entity_type, entity_id: op.entity_id, reason }); onDone(); }); };
  return (
    <Modal title="Demander l'annulation" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p><strong>{TYPE_LABEL[op.entity_type]}</strong> — {op.label}</p>
        <p className="muted">L'opération n'est annulée qu'après l'approbation d'un responsable (administrateur de la coopérative). Rien n'est supprimé de l'historique : l'annulation passe par une écriture inverse.</p>
        <Field label="Motif de la demande (5 caractères minimum)"><textarea required minLength={5} maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {act.error && <ErrorBox message={act.error} />}
        <div className="modal-actions"><button className="btn" disabled={act.busy || reason.trim().length < 5}>Envoyer la demande</button><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
      </form>
    </Modal>
  );
}

function Requests({ approver, reloadKey }: { approver: boolean; reloadKey: number }) {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/cancellation-requests${status ? `?status=${status}` : ''}`), [status, reloadKey]);
  const [deciding, setDeciding] = useState<any | null>(null);
  return (
    <Card>
      <div className="toolbar"><label>Statut <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous</option><option value="pending">En attente</option><option value="approved">Approuvées</option><option value="rejected">Refusées</option></select></label></div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune demande d'annulation." columns={[
          { header: 'Demandée le', render: (q) => dateTime(q.requested_at) },
          { header: 'Opération', render: (q) => <><Badge>{TYPE_LABEL[q.entity_type]}</Badge> {q.entity_label}</> },
          { header: 'Demandeur', render: (q) => q.requested_by_name ?? '—' },
          { header: 'Motif', render: (q) => q.reason },
          { header: 'Statut', render: (q) => <StatusBadge map={STATUS} value={q.status} /> },
          { header: 'Décision', render: (q) => q.status === 'pending' ? (approver ? <button className="btn btn-small" onClick={() => setDeciding(q)}>Traiter</button> : '—') : `${q.decided_by_name ?? ''} · ${q.decision_note ?? ''}` },
        ]} />
      )}
      {deciding && <Decide q={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload(); }} />}
    </Card>
  );
}

function Decide({ q, onClose, onDone }: { q: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const go = (decision: 'approve' | 'reject') => act.run(async () => { await post(`/cancellation-requests/${q.id}/decide`, { decision, note }); onDone(); });
  return (
    <Modal title="Demande d'annulation" onClose={onClose}>
      <p><strong>{TYPE_LABEL[q.entity_type]}</strong> — {q.entity_label}</p>
      <p>Demandée par <strong>{q.requested_by_name}</strong> le {dateTime(q.requested_at)}</p>
      <p>Motif : {q.reason}</p>
      <Field label="Commentaire (obligatoire en cas de refus)"><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn" disabled={act.busy} onClick={() => go('approve')}>Approuver l'annulation</button>
        <button className="btn btn-danger" disabled={act.busy || note.trim().length < 3} onClick={() => go('reject')}>Refuser</button>
      </div>
    </Modal>
  );
}

/** Opérations réalisées par l'utilisateur (magasinier, caissier, comptable…) : impression des reçus et demandes d'annulation. */
export default function Operations() {
  const { can } = useAuth();
  const approver = can('cancellations:decide');
  const link = useDeepLink(['mine', 'requests']);
  const [tab, setTab] = useState<'mine' | 'requests'>((link.tab as any) ?? (approver ? 'requests' : 'mine'));
  const [all, setAll] = useState(false);
  const [key, setKey] = useState(0);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/my-operations${all ? '?all=1' : ''}`), [all, key]);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [asking, setAsking] = useState<any | null>(null);
  const act = useAction();
  const print = (o: any) => act.run(async () => setReceipt(await get(`/operation-receipts/${o.entity_type}/${o.entity_id}`)));
  return (
    <>
      <PageHeader title="Mes opérations" subtitle="Imprimez les reçus de vos opérations et demandez l'annulation d'une erreur : un responsable doit l'approuver" />
      <Tabs value={tab} onChange={setTab} tabs={[['mine', approver ? 'Opérations' : 'Mes opérations'], ['requests', approver ? "Demandes d'annulation" : 'Mes demandes']]} />
      {tab === 'requests' ? <Requests approver={approver} reloadKey={key} /> : (
        <Card>
          {approver && <label className="toolbar"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Voir les opérations de toute l'équipe</label>}
          {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
          {loading ? <Loading /> : (
            <Table rows={data ?? []} empty="Aucune opération réalisée avec ce compte." columns={[
              { header: 'Date', render: (o) => dateTime(o.at) },
              { header: 'Type', render: (o) => <Badge>{TYPE_LABEL[o.entity_type]}</Badge> },
              { header: 'Opération', render: (o) => o.label },
              ...(all ? [{ header: 'Par', render: (o: any) => o.by ?? '—' }] : []),
              { header: 'Annulation', render: (o) => o.request_status ? <StatusBadge map={STATUS} value={o.request_status} /> : o.why_not ? <small className="muted">{o.why_not}</small> : '—' },
              { header: '', render: (o) => (
                <span className="row-actions">
                  <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={() => print(o)}>Imprimer le reçu</button>
                  {o.cancellable && <button className="btn btn-ghost btn-small" onClick={() => setAsking(o)}>Demander l'annulation</button>}
                </span>) },
            ]} />
          )}
        </Card>
      )}
      {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
      {asking && <RequestModal op={asking} onClose={() => setAsking(null)} onDone={() => { setAsking(null); setKey((k) => k + 1); setTab('requests'); }} />}
    </>
  );
}
