import { useState } from 'react';
import QRCode from 'qrcode';
import { get, getBlob, post } from '../api';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Tabs, useAction, useAsync } from '../ui';

const KG = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));
const M = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const STATUS: Record<string, [string, any]> = {
  arrived: ['Attendue', 'neutral'], weighing_in: ['Entrée pesée', 'warn'], weighed: ['Pesée terminée', 'warn'], analysed: ['Analysée', 'info'], settled: ['Réglée', 'ok'], refused: ['Refoulée', 'danger'],
};
// Analyse : [clé, libellé] ; les lignes marquées « calculé » se déduisent des autres.
const ANALYSIS_COL1: [string, string][] = [['foreign', 'Matières étrangères'], ['broken_beans', 'Fèves brisées'], ['brisures', 'Brisures'], ['waste', 'Déchet']];
const ANALYSIS_COL2: [string, string][] = [['crabots', 'Crabots'], ['mouldy', 'Fèves moisies'], ['slaty', 'Fèves ardoisées'], ['insect', 'Fèves mitées'], ['germinated', 'Fèves germées']];
type Act = { kind: 'in' | 'out' | 'analysis' | 'settle' | 'refuse' | 'pieces'; d: any } | null;

function esc(s: any) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }
const N2 = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const DT = (v: any) => (v ? new Date(v).toLocaleString('fr-FR') : '');
const DD = (v: any) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');

/** Ouvre le bulletin de pesée de l'exportateur (modèle : indication connaissement, pesée, analyse, livraison produit, visas) dans une fenêtre d'impression. */
async function printBulletin(id: string) {
  const b: any = await get(`/deliveries/${id}/bulletin`);
  const w = window.open('', '_blank');
  if (!w) throw new Error('Le navigateur a bloqué la fenêtre d\'impression : autorisez les fenêtres pour ce site.');
  const iss = b.issuer ?? {}; const d = b.defects ?? {};
  const num = (k: string) => (d[k] === undefined || d[k] === null || d[k] === '' ? null : Number(d[k]));
  const sum = (a: string, c: string) => (num(a) === null && num(c) === null ? null : (num(a) ?? 0) + (num(c) ?? 0));
  const defective = num('defective') ?? sum('mouldy', 'insect');
  const accepted = b.bags_discharged == null ? null : Number(b.bags_discharged) - Number(b.bags_refused ?? 0);
  const avgDecl = b.declared_bags > 0 ? Number(b.declared_kg) / Number(b.declared_bags) : null;
  const avgAcc = accepted && accepted > 0 ? Number(b.net_delivered_kg) / accepted : null;
  const missing = b.bags_discharged == null ? null : Number(b.declared_bags) - Number(b.bags_discharged);
  let logo = '';
  try { const lb = await getBlob('/organization/logo'); if (lb) logo = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(lb); }); } catch { /* sans logo */ }
  const qr = await QRCode.toDataURL(`BULLETIN ${b.bulletin_no}|LIVRAISON ${b.number}|NET PAYE ${b.net_payable_kg ?? ''}`, { margin: 0, width: 150 });
  const row = (l: string, v: any, strong = false) => `<div class="r"><span>${l}</span><b${strong ? ' class="s"' : ''}>${esc(v ?? '')}</b></div>`;
  const an = (list: [string, string][]) => list.map(([k, l]) => row(l, N2(num(k)))).join('');
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bulletin de pesée ${esc(b.bulletin_no)}</title>
<style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:12px/1.35 Arial,Helvetica,sans-serif;margin:0;color:#111}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.id{display:flex;gap:10px;align-items:flex-start;max-width:50%}.id img{max-height:56px;max-width:110px}.id div{font-size:11px}.id strong{font-size:13px}
.camp{text-align:right;font-size:13px}.title{margin:6px auto;border:2px solid #111;padding:5px 0;text-align:center;font-weight:700;font-size:15px;letter-spacing:.5px;width:55%}
.sub{display:flex;justify-content:space-between;margin:2px 0 6px}.sub .m{text-align:center}.sub .m b{display:block;font-size:13px}
.sec{background:#e6e6e6;text-align:center;font-weight:700;margin:8px 0 4px;padding:2px 0;letter-spacing:.4px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:2px 28px}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px 22px}.r{display:flex;justify-content:space-between;gap:8px}.r span{color:#222}.r b{font-weight:600;text-align:right}.r b.s{font-weight:800}
.big .r b{font-size:13px}.foot{display:flex;justify-content:space-between;margin-top:46px;text-align:center}.foot div{width:30%;border-top:1px solid #111;padding-top:3px;font-size:11px;min-height:60px}
.imp{margin-top:14px;font-size:11px;color:#333;display:flex;justify-content:space-between}.qr{float:right}.lbl{font-weight:700}</style></head><body>
<div class="top"><div class="id">${logo ? `<img src="${logo}" alt="">` : ''}<div><strong>${esc(iss.commercial_name ?? iss.name ?? '')}</strong><br>${esc(iss.address ?? '')}<br>${iss.phone ? 'Tél : ' + esc(iss.phone) + '<br>' : ''}${iss.ccc_code ? 'N° CC : ' + esc(iss.ccc_code) : ''}</div></div>
<div class="camp">Campagne : ${esc(iss.campaign ?? '')}<br>Usine : ${esc(iss.plant ?? iss.name ?? '')}</div></div>
<div class="sub"><div>Date pesée<br><b>${DD(b.tare_at)}</b><br><b>SAIGIC :</b></div><div class="m"><div class="title">BULLETIN DE PESEE</div>Achat<b>PROJET</b></div>
<div style="text-align:right"><b style="font-size:14px">${b.decision === 'accepted' ? 'Produit accepté' : 'Produit refusé'}</b><br>N° Bulletin<br><b>${esc(b.bulletin_no)}</b></div></div>
<div class="sec">INDICATION CONNAISSEMENT</div>
<div class="g2"><div>${row('Propriétaire', iss.commercial_name ?? iss.name)}${row('Origine', b.origin)}${row('Chauffeur', b.driver_name)}${row('N° tracteur', b.truck_no)}${row('N° Remorque', b.trailer_no)}${row('Poids brut déclaré', N2(b.declared_gross_kg))}${row('Poids net déclaré', N2(b.declared_kg))}</div>
<div>${row('Fournisseur', b.source_org_name)}${row('Transporteur', b.transporter)}${row('Connaissement', b.bl_no)}${row('Nb Sacs déclaré', N2(b.declared_bags))}${row('Poids Moyen', N2(avgDecl))}${row('Date Cnt', DD(b.departure_date))}${row('Destination', iss.plant ?? '')}</div></div>
<div class="sec">PESEE</div>
<div class="g2"><div>${row("Poids d'entrée", N2(b.gross_kg))}${row("Date d'entrée", DT(b.gross_at))}${row("Pont d'entrée", b.bridge_in)}</div><div>${row('Poids de sortie', N2(b.tare_kg))}${row('Date de sortie', DT(b.tare_at))}${row('Pont de sortie', b.bridge_out)}</div></div>
<div class="sec">ANALYSE</div>
<div class="g3"><div>${row('Humidité', N2(b.moisture_pct))}${row('Grainage', b.bean_count ?? '')}${an(ANALYSIS_COL1)}</div>
<div>${an(ANALYSIS_COL2.slice(0, 1))}${row('Fèves moisies', N2(num('mouldy')))}${row('Fèves ardoisées', N2(num('slaty')))}${row('Fèves mitées', N2(num('insect')))}${row('Moisie + Mitée', N2(sum('mouldy', 'insect')))}${row('Fèves germées', N2(num('germinated')))}</div>
<div>${row('Fèves plates', N2(num('flat')))}${row('Fèves violettes', N2(num('violet')))}${row('Résidus', N2(num('residues')))}${row('Résidus + Crabots', N2(sum('residues', 'crabots')))}${row('FFA', N2(num('ffa')))}${row('Fèves défectueuses', N2(defective))}</div></div>
<div class="sec">LIVRAISON PRODUIT</div>
<div class="g3 big"><div>${row('Poids Brut (KG)', N2(b.net_kg))}${row('Sacs acceptés', accepted ?? '')}${row('Tare sac acceptés', N2(b.sack_tare_kg))}${row('Poids Net Livré', N2(b.net_delivered_kg), true)}${row('Réfaction', N2(b.refaction_kg))}</div>
<div>${row('Nb Sacs déchargés', b.bags_discharged ?? '')}${row('Sacs refusés', b.bags_refused ?? 0)}${row('Tare palettes', N2(b.pallet_tare_kg))}${row('Poids moyen sac accepté', N2(avgAcc))}${row('Réfaction/Sacs', b.refaction_kg && accepted ? N2(Number(b.refaction_kg) / accepted) : '0')}</div>
<div>${row('Manquants', missing ?? '')}${row('Écarts', N2(b.variance_kg))}<img class="qr" src="${qr}" width="110" height="110" alt="QR"></div></div>
<div class="g2 big" style="margin-top:6px"><div>${row('Poids Net Payé', N2(b.net_payable_kg), true)}</div><div>${row('Classement', b.grade ?? '', true)}</div></div>
${b.decision === 'rejected' || b.analysis_notes ? `<p><span class="lbl">Observations :</span> ${esc(b.analysis_notes)}</p>` : ''}
<div class="foot"><div>VISA PONT BASCULE<br>${esc(b.weigher_name)}</div><div>VISA FOURNISSEUR</div><div>VISA CHEF USINE</div></div>
<div class="imp"><span>Imprimé par : ${esc(iss.printed_by ?? b.analyst_name ?? '')} le ${new Date().toLocaleString('fr-FR')}</span><span>Analyste : ${esc(b.analyst_name)} · Livraison ${esc(b.number)} · Fiche ${esc(b.source_sheet_no)} · ${esc(b.producers)} producteur(s)</span></div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}

const num = (v: string) => (v === '' || v == null ? undefined : Number(v));
function WeighIn({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ gross: '', declGross: '', origin: '', transporter: '', bridge: 'Pont bascule' }); const a = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Modal title={`Pesée d'entrée · ${d.number}`} onClose={onClose}>
    <p className="muted">Camion <strong>{d.truck_no}</strong> chargé · {d.source_org_name} · poids net déclaré {KG(d.declared_kg)} kg · {d.declared_bags} sacs.</p>
    <div className="form-grid">
      <Field label="Poids d'entrée (kg)" hint="Camion chargé, lu au pont bascule"><input type="number" step="0.001" min="0" autoFocus value={f.gross} onChange={s('gross')} /></Field>
      <Field label="Pont d'entrée"><input value={f.bridge} onChange={s('bridge')} /></Field>
      <Field label="Poids brut déclaré (kg)" hint="Facultatif, si la coopérative l'a déclaré"><input type="number" step="0.001" min="0" value={f.declGross} onChange={s('declGross')} /></Field>
      <Field label="Origine"><input value={f.origin} onChange={s('origin')} placeholder="localité de la coopérative" /></Field>
      <Field label="Transporteur"><input value={f.transporter} onChange={s('transporter')} /></Field>
    </div>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || !Number(f.gross)} onClick={() => a.run(async () => {
      await post(`/deliveries/${d.id}/weigh-in`, { gross_kg: Number(f.gross), declared_gross_kg: num(f.declGross), origin: f.origin || undefined, transporter: f.transporter || undefined, bridge_in: f.bridge || undefined }); onDone(); })}>Enregistrer l'entrée</button></div>
  </Modal>;
}
function WeighOut({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ tare: '', bridge: d.bridge_in ?? 'Pont bascule', bags: '', refused: '0', sack: '', pallet: '0' }); const a = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const brut = f.tare ? Number(d.gross_kg) - Number(f.tare) : null;
  const net = brut != null ? brut - Number(f.sack || 0) - Number(f.pallet || 0) : null;
  const accepted = f.bags !== '' ? Number(f.bags) - Number(f.refused || 0) : null;
  return <Modal title={`Pesée de sortie · ${d.number}`} onClose={onClose}>
    <p className="muted">Poids d'entrée : <strong>{KG(d.gross_kg)} kg</strong> · net déclaré {KG(d.declared_kg)} kg · {d.declared_bags} sacs déclarés.</p>
    <div className="form-grid">
      <Field label="Poids de sortie (kg)" hint="Camion déchargé, lu au pont bascule"><input type="number" step="0.001" min="0" autoFocus value={f.tare} onChange={s('tare')} /></Field>
      <Field label="Pont de sortie"><input value={f.bridge} onChange={s('bridge')} /></Field>
      <Field label="Sacs déchargés"><input type="number" min="0" value={f.bags} onChange={s('bags')} /></Field>
      <Field label="Sacs refusés"><input type="number" min="0" value={f.refused} onChange={s('refused')} /></Field>
      <Field label="Tare des sacs acceptés (kg)"><input type="number" step="0.001" min="0" value={f.sack} onChange={s('sack')} /></Field>
      <Field label="Tare des palettes (kg)"><input type="number" step="0.001" min="0" value={f.pallet} onChange={s('pallet')} /></Field>
    </div>
    {net != null && net > 0 && <p><strong>Poids brut livré : {KG(brut)} kg · poids net livré : {KG(net)} kg</strong> <span className="muted">(écart avec le déclaré : {KG(net - Number(d.declared_kg))} kg{accepted != null ? ` · sacs acceptés : ${accepted} · manquants : ${Number(d.declared_bags) - Number(f.bags)}` : ''})</span></p>}
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || !f.tare} onClick={() => a.run(async () => {
      await post(`/deliveries/${d.id}/weigh-out`, { tare_kg: Number(f.tare), bridge_out: f.bridge || undefined, bags_discharged: num(f.bags), bags_refused: num(f.refused), sack_tare_kg: num(f.sack), pallet_tare_kg: num(f.pallet) }); onDone(); })}>Enregistrer la sortie</button></div>
  </Modal>;
}
function Analysis({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ moisture: '', beans: '', grade: '', decision: 'accepted', notes: '', refaction: '' }); const [df, setDf] = useState<Record<string, string>>({}); const a = useAction();
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const D = (k: string, label: string) => <Field key={k} label={`${label} (%)`}><input type="number" step="0.01" min="0" max="100" value={df[k] ?? ''} onChange={(e) => setDf({ ...df, [k]: e.target.value })} /></Field>;
  const payable = d.net_delivered_kg != null ? Number(d.net_delivered_kg) - Number(f.refaction || 0) : null;
  return <Modal title={`Analyse · ${d.number}`} onClose={onClose}>
    <p className="muted">{d.source_org_name} · poids net livré <strong>{KG(d.net_delivered_kg ?? d.net_kg)} kg</strong>.</p>
    <div className="form-grid">
      <Field label="Humidité (%)"><input type="number" step="0.01" min="0" max="100" value={f.moisture} onChange={s('moisture')} /></Field>
      <Field label="Grainage (fèves / 100 g)"><input type="number" min="0" value={f.beans} onChange={s('beans')} /></Field>
      {[...ANALYSIS_COL1, ...ANALYSIS_COL2, ['flat', 'Fèves plates'], ['violet', 'Fèves violettes'], ['residues', 'Résidus'], ['ffa', 'FFA']].map(([k, l]) => D(k, l))}
      <Field label="Fèves défectueuses (%)" hint="Laisser vide : moisies + mitées"><input type="number" step="0.01" min="0" max="100" value={df.defective ?? ''} onChange={(e) => setDf({ ...df, defective: e.target.value })} /></Field>
      <Field label="Réfaction (kg)" hint="Retenue sur le poids net livré"><input type="number" step="0.001" min="0" value={f.refaction} onChange={s('refaction')} /></Field>
      <Field label="Classement (grade)"><input value={f.grade} onChange={s('grade')} placeholder="ex. GRADE 2" /></Field>
      <Field label="Décision"><select value={f.decision} onChange={s('decision')}><option value="accepted">Produit accepté</option><option value="rejected">Produit refusé</option></select></Field>
    </div>
    {payable != null && <p><strong>Poids net payé : {KG(payable)} kg</strong> <span className="muted">(net livré − réfaction)</span></p>}
    <Field label={f.decision === 'rejected' ? 'Motif du rejet (obligatoire)' : 'Observations'}><textarea rows={2} value={f.notes} onChange={s('notes')} /></Field>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={a.busy || f.moisture === ''} onClick={() => a.run(async () => {
        const defects: Record<string, number> = {}; for (const [k, v] of Object.entries(df)) if (v !== '') defects[k] = Number(v);
        await post(`/deliveries/${d.id}/analysis`, { moisture_pct: Number(f.moisture), ...(f.beans && { bean_count: Number(f.beans) }), defects, ...(f.refaction && { refaction_kg: Number(f.refaction) }), ...(f.grade && { grade: f.grade }), decision: f.decision, ...(f.notes && { notes: f.notes }) }); onDone();
      })}>Enregistrer et produire le bulletin</button></div>
  </Modal>;
}
function Settle({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(''); const [ref, setRef] = useState(''); const a = useAction();
  return <Modal title={`Règlement · ${d.number}`} onClose={onClose}>
    <p className="muted">{d.source_org_name} · {KG(d.net_payable_kg ?? d.net_kg)} kg à payer · bulletin {d.bulletin_no}.</p>
    <div className="form-grid">
      <Field label="Prix au kg"><input type="number" step="0.0001" min="0" autoFocus value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <Field label="Référence du paiement"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="virement, chèque…" /></Field>
    </div>
    {Number(price) > 0 && <p><strong>Montant : {M(Number(d.net_payable_kg ?? d.net_kg) * Number(price))}</strong></p>}
    <p className="muted">Le montant est enregistré sur la livraison et communiqué à la coopérative. L'écriture comptable se passe dans Comptabilité.</p>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || !Number(price)} onClick={() => a.run(async () => { await post(`/deliveries/${d.id}/settle`, { unit_price: Number(price), ...(ref && { payment_ref: ref }) }); onDone(); })}>Régler</button></div>
  </Modal>;
}


async function saveBlob(path: string, name: string) {
  const b = await getBlob(path); if (!b) throw new Error('Fichier introuvable');
  const url = URL.createObjectURL(b); const l = document.createElement('a'); l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Refuse({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''); const a = useAction();
  return <Modal title={`Refouler le chargement · ${d.number}`} onClose={onClose}>
    <p className="muted">{d.source_org_name} · fiche {d.source_sheet_no} · {KG(d.declared_kg)} kg déclarés.</p>
    <Field label="Motif du refoulement (obligatoire)"><textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="humidité excessive, qualité non conforme, documents manquants…" /></Field>
    <p className="muted">Le volume retourne dans le stock de la coopérative, qui peut réutiliser ses convois pour un autre chargement. Un chargement refoulé ne se règle pas et ne change plus.</p>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-danger" disabled={a.busy || reason.trim().length < 3} onClick={() => a.run(async () => { await post(`/deliveries/${d.id}/refuse`, { reason }); onDone(); })}>Refouler</button></div>
  </Modal>;
}

const PIECE: Record<string, string> = { fiche: 'Fiche d\'accompagnement', connaissement_ccc: 'Connaissement CCC' };
function Pieces({ d, onClose }: { d: any; onClose: () => void }) {
  const list = useAsync(() => get<any[]>(`/dispatch-sheets/${d.source_sheet_id}/attachments`), [d.id]); const a = useAction();
  return <Modal title={`Pièces du chargement · ${d.source_sheet_no}`} onClose={onClose}>
    {list.loading ? <Loading /> : !(list.data ?? []).length ? <Empty>Aucune pièce jointe à ce chargement.</Empty> :
      <table><thead><tr><th>Pièce</th><th>Fichier</th><th></th></tr></thead><tbody>{(list.data ?? []).map((p) => <tr key={p.id}><td>{PIECE[p.kind] ?? p.kind}</td><td>{p.filename}</td>
        <td><button className="btn btn-small btn-secondary" disabled={a.busy} onClick={() => a.run(() => saveBlob(`/dispatch-attachments/${p.id}/file`, p.filename))}>Télécharger</button></td></tr>)}</tbody></table>}
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
  </Modal>;
}

/** Livraisons reçues d'une coopérative (pont bascule, analyse, bulletin de pesée, règlement) et suivi des livraisons envoyées. */
export default function Livraisons() {
  const { can, org } = useAuth();
  const receive = can('deliveries:read');
  const supply = can('dispatch:manage');
  const [tab, setTab] = useState<'recues' | 'envoyees'>(receive ? 'recues' : 'envoyees');
  const inbox = useAsync(() => (receive ? get<any[]>('/deliveries') : Promise.resolve([])), [receive]);
  const outbox = useAsync(() => (supply || receive ? get<any[]>('/deliveries/sent') : Promise.resolve([])), [supply, receive]);
  const [act, setAct] = useState<Act>(null);
  const a = useAction();
  const done = () => { setAct(null); inbox.reload(); outbox.reload(); };
  const tabs: [any, string][] = [];
  if (receive) tabs.push(['recues', org?.kind === 'exporter' ? 'Pont bascule et analyse' : 'Livraisons reçues']);
  if (supply || receive) tabs.push(['envoyees', 'Mes livraisons envoyées']);
  const data = tab === 'recues' ? inbox : outbox;
  return (
    <>
      <PageHeader title={org?.kind === 'exporter' ? 'Réceptions : pont bascule, analyse, bulletin' : 'Livraisons'} subtitle="Une fiche d'accompagnement transmise devient une livraison attendue ; on pèse l'entrée puis la sortie, on analyse, on édite le bulletin de pesée et on règle." />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      <Card>
        {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}{a.error && <ErrorBox message={a.error} />}
        {data.loading ? <Loading /> : !(data.data ?? []).length ? <Empty>{tab === 'recues' ? 'Aucune livraison. Elles apparaissent quand une coopérative liée transmet une fiche d\'accompagnement.' : 'Aucune livraison envoyée.'}</Empty> :
          <div className="table-scroll"><table>
            <thead><tr><th>N°</th><th>{tab === 'recues' ? 'Coopérative' : 'Destinataire'}</th><th>Fiche</th><th>Camion</th><th className="r">Déclaré (kg)</th><th className="r">Entrée</th><th className="r">Sortie</th><th className="r">Net livré</th><th className="r">Net payé</th><th className="r">Écart</th><th className="r">Humidité %</th><th>Statut</th><th>Décision</th><th className="r">Montant</th><th /></tr></thead>
            <tbody>{(data.data ?? []).map((d) => (
              <tr key={d.id}>
                <td><code>{d.number}</code></td><td>{tab === 'recues' ? d.source_org_name : d.destination_name}</td><td>{d.source_sheet_no}</td><td>{d.truck_no}</td>
                <td className="r">{KG(d.declared_kg)}</td><td className="r">{KG(d.gross_kg)}</td><td className="r">{KG(d.tare_kg)}</td><td className="r"><strong>{KG(d.net_delivered_kg)}</strong></td><td className="r">{KG(d.net_payable_kg)}</td>
                <td className="r">{d.variance_kg != null ? `${KG(d.variance_kg)}${d.variance_pct != null ? ` (${M(d.variance_pct)} %)` : ''}` : ''}</td><td className="r">{M(d.moisture_pct)}</td>
                <td><StatusBadge map={STATUS} value={d.status} /></td><td>{d.decision === 'accepted' ? 'Acceptée' : d.decision === 'rejected' ? 'Rejetée' : ''}</td><td className="r">{M(d.amount)}</td>
                <td><span className="row-actions">
                  {tab === 'recues' && d.status === 'arrived' && can('deliveries:weigh') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'in', d })}>Peser l'entrée</button>}
                  {tab === 'recues' && d.status === 'weighing_in' && can('deliveries:weigh') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'out', d })}>Peser la sortie</button>}
                  {tab === 'recues' && d.status === 'weighed' && can('deliveries:analyse') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'analysis', d })}>Analyser</button>}
                  {tab === 'recues' && d.status === 'analysed' && d.decision === 'accepted' && can('deliveries:settle') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'settle', d })}>Régler</button>}
                  {tab === 'recues' && ['arrived', 'weighing_in', 'weighed', 'analysed'].includes(d.status) && can('deliveries:refuse') && <button className="btn btn-small btn-danger" onClick={() => setAct({ kind: 'refuse', d })}>Refouler</button>}
                  <button className="btn btn-small btn-secondary" onClick={() => setAct({ kind: 'pieces', d })}>Pièces</button>
                  {d.bulletin_no && d.decision === 'accepted' && <button className="btn btn-small btn-secondary" disabled={a.busy} onClick={() => a.run(() => printBulletin(d.id))}>Bon retour</button>}
                  {d.bulletin_no && d.decision === 'accepted' && <button className="btn btn-small btn-secondary" disabled={a.busy} onClick={() => a.run(() => saveBlob(`/deliveries/${d.id}/bulletin.pdf`, `bon-retour-${d.bulletin_no}.pdf`))}>PDF</button>}
                  {d.status === 'refused' && <span className="muted" title={d.refusal_reason}>{d.refusal_reason}</span>}
                </span></td>
              </tr>))}</tbody>
          </table></div>}
      </Card>
      {act?.kind === 'in' && <WeighIn d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'out' && <WeighOut d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'analysis' && <Analysis d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'refuse' && <Refuse d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'pieces' && <Pieces d={act.d} onClose={() => setAct(null)} />}
      {act?.kind === 'settle' && <Settle d={act.d} onClose={() => setAct(null)} onDone={done} />}
    </>
  );
}
