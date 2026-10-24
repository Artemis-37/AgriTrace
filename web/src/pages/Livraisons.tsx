import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Tabs, useAction, useAsync } from '../ui';

const KG = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));
const M = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const STATUS: Record<string, [string, any]> = {
  arrived: ['Attendue', 'neutral'], weighing_in: ['Entrée pesée', 'warn'], weighed: ['Pesée terminée', 'warn'], analysed: ['Analysée', 'info'], settled: ['Réglée', 'ok'],
};
const DEFECTS: [string, string][] = [['mouldy', 'Moisies (%)'], ['slaty', 'Ardoisées (%)'], ['insect', 'Mitées / attaquées (%)'], ['germinated', 'Germées (%)'], ['flat', 'Plates (%)']];
type Act = { kind: 'in' | 'out' | 'analysis' | 'settle'; d: any } | null;

function esc(s: any) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }

/** Ouvre le bulletin de pesée dans une fenêtre d'impression (enregistrable en PDF). */
async function printBulletin(id: string) {
  const b: any = await get(`/deliveries/${id}/bulletin`);
  const d = b.defects ?? {};
  const w = window.open('', '_blank');
  if (!w) throw new Error('Le navigateur a bloqué la fenêtre d\'impression : autorisez les fenêtres pour ce site.');
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bulletin de pesée ${esc(b.bulletin_no)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:28px;color:#1c2b22}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}th{width:42%;background:#f3f1ea;font-weight:600}.sig{display:flex;gap:40px;margin-top:48px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:12px}
.tag{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:700;background:${b.decision === 'accepted' ? '#d9efe0' : '#f6d9d6'}}</style></head><body>
<h1>Bulletin de pesée n° ${esc(b.bulletin_no)}</h1><p>${esc(b.destination_name)} · livraison ${esc(b.number)} · édité le ${new Date().toLocaleDateString('fr-FR')}</p>
<h2>Livraison</h2><table><tr><th>Coopérative fournisseuse</th><td>${esc(b.source_org_name)}</td></tr><tr><th>Fiche d'accompagnement</th><td>${esc(b.source_sheet_no)}</td></tr>
<tr><th>Connaissement / lot DSE</th><td>${esc(b.bl_no)} ${b.lot_id_dse ? '/ ' + esc(b.lot_id_dse) : ''}</td></tr><tr><th>Chauffeur · camion · remorque</th><td>${esc(b.driver_name)} · ${esc(b.truck_no)} · ${esc(b.trailer_no)}</td></tr>
<tr><th>Producteurs listés</th><td>${esc(b.producers)}</td></tr></table>
<h2>Pesée au pont bascule</h2><table><tr><th>Poids déclaré</th><td>${KG(b.declared_kg)} kg</td></tr><tr><th>Poids brut (entrée, camion chargé)</th><td>${KG(b.gross_kg)} kg · ${new Date(b.gross_at).toLocaleString('fr-FR')}</td></tr>
<tr><th>Tare (sortie, camion vide)</th><td>${KG(b.tare_kg)} kg · ${new Date(b.tare_at).toLocaleString('fr-FR')}</td></tr><tr><th>Poids net</th><td><strong>${KG(b.net_kg)} kg</strong></td></tr>
<tr><th>Écart avec le déclaré</th><td>${KG(b.variance_kg)} kg${b.variance_pct != null ? ` (${M(b.variance_pct)} %)` : ''}</td></tr><tr><th>Sacs comptés</th><td>${esc(b.bags_counted ?? '')}</td></tr></table>
<h2>Analyse</h2><table><tr><th>Humidité</th><td>${M(b.moisture_pct)} %</td></tr><tr><th>Grainage (fèves / 100 g)</th><td>${esc(b.bean_count ?? '')}</td></tr>
${Object.keys(d).map((k) => `<tr><th>${esc((DEFECTS.find((x) => x[0] === k)?.[1]) ?? k)}</th><td>${esc(d[k])}</td></tr>`).join('')}
<tr><th>Qualité</th><td>${esc(b.grade)}</td></tr><tr><th>Décision</th><td><span class="tag">${b.decision === 'accepted' ? 'Acceptée' : 'Rejetée'}</span> ${esc(b.analysis_notes)}</td></tr></table>
<div class="sig"><div>Responsable pont bascule<br>${esc(b.weigher_name)}</div><div>Analyste<br>${esc(b.analyst_name)}</div><div>Le transporteur</div></div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}

function WeighIn({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(''); const a = useAction();
  return <Modal title={`Pesée d'entrée · ${d.number}`} onClose={onClose}>
    <p className="muted">Camion <strong>{d.truck_no}</strong> chargé · {d.source_org_name} · déclaré {KG(d.declared_kg)} kg.</p>
    <Field label="Poids brut (kg)" hint="Camion chargé, lu au pont bascule"><input type="number" step="0.001" min="0" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || !Number(v)} onClick={() => a.run(async () => { await post(`/deliveries/${d.id}/weigh-in`, { gross_kg: Number(v) }); onDone(); })}>Enregistrer l'entrée</button></div>
  </Modal>;
}
function WeighOut({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(''); const [bags, setBags] = useState(''); const a = useAction();
  const net = v ? Number(d.gross_kg) - Number(v) : null;
  return <Modal title={`Pesée de sortie · ${d.number}`} onClose={onClose}>
    <p className="muted">Poids brut à l'entrée : <strong>{KG(d.gross_kg)} kg</strong> · déclaré {KG(d.declared_kg)} kg.</p>
    <div className="form-grid">
      <Field label="Tare (kg)" hint="Camion déchargé, lu au pont bascule"><input type="number" step="0.001" min="0" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Field label="Sacs comptés"><input type="number" min="0" value={bags} onChange={(e) => setBags(e.target.value)} /></Field>
    </div>
    {net != null && net > 0 && <p><strong>Poids net : {KG(net)} kg</strong> <span className="muted">(écart avec le déclaré : {KG(net - Number(d.declared_kg))} kg)</span></p>}
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || !v} onClick={() => a.run(async () => { await post(`/deliveries/${d.id}/weigh-out`, { tare_kg: Number(v), ...(bags && { bags_counted: Number(bags) }) }); onDone(); })}>Enregistrer la sortie</button></div>
  </Modal>;
}
function Analysis({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ moisture: '', beans: '', grade: '', decision: 'accepted', notes: '' }); const [df, setDf] = useState<Record<string, string>>({}); const a = useAction();
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Modal title={`Analyse · ${d.number}`} onClose={onClose}>
    <p className="muted">{d.source_org_name} · poids net <strong>{KG(d.net_kg)} kg</strong>.</p>
    <div className="form-grid">
      <Field label="Humidité (%)"><input type="number" step="0.01" min="0" max="100" value={f.moisture} onChange={s('moisture')} /></Field>
      <Field label="Grainage (fèves / 100 g)"><input type="number" min="0" value={f.beans} onChange={s('beans')} /></Field>
      {DEFECTS.map(([k, l]) => <Field key={k} label={l}><input type="number" step="0.1" min="0" max="100" value={df[k] ?? ''} onChange={(e) => setDf({ ...df, [k]: e.target.value })} /></Field>)}
      <Field label="Qualité / grade"><input value={f.grade} onChange={s('grade')} placeholder="ex. Grade 1" /></Field>
      <Field label="Décision"><select value={f.decision} onChange={s('decision')}><option value="accepted">Acceptée</option><option value="rejected">Rejetée</option></select></Field>
    </div>
    <Field label={f.decision === 'rejected' ? 'Motif du rejet (obligatoire)' : 'Observations'}><textarea rows={2} value={f.notes} onChange={s('notes')} /></Field>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={a.busy || f.moisture === ''} onClick={() => a.run(async () => {
        const defects: Record<string, number> = {}; for (const [k, v] of Object.entries(df)) if (v !== '') defects[k] = Number(v);
        await post(`/deliveries/${d.id}/analysis`, { moisture_pct: Number(f.moisture), ...(f.beans && { bean_count: Number(f.beans) }), defects, ...(f.grade && { grade: f.grade }), decision: f.decision, ...(f.notes && { notes: f.notes }) }); onDone();
      })}>Enregistrer et produire le bulletin</button></div>
  </Modal>;
}
function Settle({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(''); const [ref, setRef] = useState(''); const a = useAction();
  return <Modal title={`Règlement · ${d.number}`} onClose={onClose}>
    <p className="muted">{d.source_org_name} · {KG(d.net_kg)} kg acceptés · bulletin {d.bulletin_no}.</p>
    <div className="form-grid">
      <Field label="Prix au kg"><input type="number" step="0.0001" min="0" autoFocus value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <Field label="Référence du paiement"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="virement, chèque…" /></Field>
    </div>
    {Number(price) > 0 && <p><strong>Montant : {M(Number(d.net_kg) * Number(price))}</strong></p>}
    <p className="muted">Le montant est enregistré sur la livraison et communiqué à la coopérative. L'écriture comptable se passe dans Comptabilité.</p>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || !Number(price)} onClick={() => a.run(async () => { await post(`/deliveries/${d.id}/settle`, { unit_price: Number(price), ...(ref && { payment_ref: ref }) }); onDone(); })}>Régler</button></div>
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
            <thead><tr><th>N°</th><th>{tab === 'recues' ? 'Coopérative' : 'Destinataire'}</th><th>Fiche</th><th>Camion</th><th className="r">Déclaré (kg)</th><th className="r">Brut</th><th className="r">Tare</th><th className="r">Net</th><th className="r">Écart</th><th className="r">Humidité %</th><th>Statut</th><th>Décision</th><th className="r">Montant</th><th /></tr></thead>
            <tbody>{(data.data ?? []).map((d) => (
              <tr key={d.id}>
                <td><code>{d.number}</code></td><td>{tab === 'recues' ? d.source_org_name : d.destination_name}</td><td>{d.source_sheet_no}</td><td>{d.truck_no}</td>
                <td className="r">{KG(d.declared_kg)}</td><td className="r">{KG(d.gross_kg)}</td><td className="r">{KG(d.tare_kg)}</td><td className="r"><strong>{KG(d.net_kg)}</strong></td>
                <td className="r">{d.variance_kg != null ? `${KG(d.variance_kg)}${d.variance_pct != null ? ` (${M(d.variance_pct)} %)` : ''}` : ''}</td><td className="r">{M(d.moisture_pct)}</td>
                <td><StatusBadge map={STATUS} value={d.status} /></td><td>{d.decision === 'accepted' ? 'Acceptée' : d.decision === 'rejected' ? 'Rejetée' : ''}</td><td className="r">{M(d.amount)}</td>
                <td><span className="row-actions">
                  {tab === 'recues' && d.status === 'arrived' && can('deliveries:weigh') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'in', d })}>Peser l'entrée</button>}
                  {tab === 'recues' && d.status === 'weighing_in' && can('deliveries:weigh') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'out', d })}>Peser la sortie</button>}
                  {tab === 'recues' && d.status === 'weighed' && can('deliveries:analyse') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'analysis', d })}>Analyser</button>}
                  {tab === 'recues' && d.status === 'analysed' && d.decision === 'accepted' && can('deliveries:settle') && <button className="btn btn-small btn-primary" onClick={() => setAct({ kind: 'settle', d })}>Régler</button>}
                  {d.bulletin_no && <button className="btn btn-small btn-secondary" disabled={a.busy} onClick={() => a.run(() => printBulletin(d.id))}>Bulletin</button>}
                </span></td>
              </tr>))}</tbody>
          </table></div>}
      </Card>
      {act?.kind === 'in' && <WeighIn d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'out' && <WeighOut d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'analysis' && <Analysis d={act.d} onClose={() => setAct(null)} onDone={done} />}
      {act?.kind === 'settle' && <Settle d={act.d} onClose={() => setAct(null)} onDone={done} />}
    </>
  );
}
