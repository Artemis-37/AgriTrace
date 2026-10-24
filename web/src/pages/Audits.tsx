import { useState } from 'react';
import { get, getBlob, post, postForm } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Tabs, useAction, useAsync } from '../ui';

const D = (v: any) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');
const DT = (v: any) => (v ? new Date(v).toLocaleString('fr-FR') : '');
const STATUS: Record<string, [string, any]> = {
  planned: ['Programmé', 'neutral'], in_progress: ['En cours', 'warn'], findings_issued: ['Rapport publié', 'info'], closed: ['Clos', 'ok'], cancelled: ['Annulé', 'bad'],
};
const RESULT: Record<string, [string, any]> = { conform: ['Conforme', 'ok'], observation: ['Observation', 'info'], minor: ['Mineure', 'warn'], major: ['Majeure', 'bad'], critical: ['Critique', 'bad'] };
const FSTATUS: Record<string, [string, any]> = { open: ['À traiter', 'warn'], responded: ['Réponse reçue', 'info'], verified: ['Vérifié', 'ok'] };
const AREAS: [string, string][] = [['tracabilite', 'Traçabilité'], ['stock', 'Stock'], ['pesee', 'Pesées'], ['comptabilite', 'Comptabilité'], ['caisse', 'Caisse'], ['social', 'Social'], ['environnement', 'Environnement'], ['autre', 'Autre']];
const AREA = Object.fromEntries(AREAS);
const SUPSTATUS: Record<string, [string, any]> = { pending: ['En attente', 'warn'], active: ['Active', 'ok'] };

async function saveBlob(path: string, name: string) {
  const b = await getBlob(path); if (!b) throw new Error('Fichier introuvable');
  const url = URL.createObjectURL(b); const l = document.createElement('a'); l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function NewAudit({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const sups = useAsync(() => get<any[]>('/supervisions'), []); const a = useAction();
  const [f, setF] = useState<any>({ supervised_org_id: '', title: '', scope: [], starts_on: '', ends_on: '' });
  const active = (sups.data ?? []).filter((s) => s.i_supervise && s.status === 'active');
  const tog = (k: string) => setF({ ...f, scope: f.scope.includes(k) ? f.scope.filter((x: string) => x !== k) : [...f.scope, k] });
  return <Modal title="Programmer un audit" onClose={onClose}>
    {sups.loading ? <Loading /> : !active.length ? <Empty>Aucune coopérative n'a encore accepté votre supervision. Proposez-la dans l'onglet « Supervision ».</Empty> : <>
      <Field label="Coopérative auditée"><select value={f.supervised_org_id} onChange={(e) => setF({ ...f, supervised_org_id: e.target.value })}><option value="">Choisir…</option>{active.map((s) => <option key={s.other_id} value={s.other_id}>{s.other_name}</option>)}</select></Field>
      <Field label="Intitulé de la mission"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Audit traçabilité et pesées" /></Field>
      <Field label="Périmètre"><span className="row-actions">{AREAS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={f.scope.includes(k)} onChange={() => tog(k)} /> {l}</label>)}</span></Field>
      <div className="form-grid"><Field label="Début"><input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field><Field label="Fin"><input type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field></div></>}
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={a.busy || !f.supervised_org_id || f.title.trim().length < 3} onClick={() => a.run(async () => { const r = await post('/audits', { ...f, starts_on: f.starts_on || undefined, ends_on: f.ends_on || undefined }); onDone(r.id); })}>Programmer</button></div>
  </Modal>;
}

function ShareModal({ id, side, onClose, onDone }: { id: string; side: string; onClose: () => void; onDone: () => void }) {
  const cat = useAsync(() => get<any[]>('/audits/catalog'), []); const a = useAction();
  const [mode, setMode] = useState<'snapshot' | 'note' | 'document'>('snapshot');
  const [f, setF] = useState<any>({ title: '', view: '', from: '', to: '', body: '' }); const [file, setFile] = useState<File | null>(null);
  const ok = f.title.trim().length >= 2 && (mode === 'snapshot' ? !!f.view : mode === 'note' ? !!f.body.trim() : !!file);
  return <Modal title="Partager dans l'audit" onClose={onClose}>
    <p className="muted">Ce que vous partagez est une copie figée, visible uniquement des participants désignés de cet audit. Vous voyez qui la consulte, et vous pouvez la retirer.</p>
    <Field label="Type"><select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="snapshot">Extrait de mes données</option><option value="document">Document (PDF, Excel, image…)</option><option value="note">Note</option></select></Field>
    <Field label="Titre"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    {mode === 'snapshot' && <>
      <Field label="Extrait"><select value={f.view} onChange={(e) => setF({ ...f, view: e.target.value })}><option value="">Choisir…</option>{(cat.data ?? []).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</select></Field>
      <div className="form-grid"><Field label="Du (par défaut : début de la mission)"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Au"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
      <p className="muted">Les producteurs apparaissent par leur code seulement : ni nom ni téléphone. {side === 'supervised' ? '' : ''}</p></>}
    {mode === 'note' && <Field label="Texte"><textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>}
    {mode === 'document' && <Field label="Fichier (10 Mo maximum)"><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={a.busy || !ok} onClick={() => a.run(async () => {
        if (mode === 'document') { const fd = new FormData(); fd.append('file', file!); fd.append('title', f.title); await postForm(`/audits/${id}/shares/document`, fd); }
        else await post(`/audits/${id}/shares`, mode === 'note' ? { kind: 'note', title: f.title, body: f.body } : { kind: 'snapshot', title: f.title, view: f.view, from: f.from || undefined, to: f.to || undefined });
        onDone(); })}>Partager</button></div>
  </Modal>;
}

function ShareView({ id, share, onClose }: { id: string; share: any; onClose: () => void }) {
  const d = useAsync(() => get<any>(`/audits/${id}/shares/${share.id}`), [share.id]);
  const p = d.data?.payload;
  return <Modal title={share.title} onClose={onClose}>
    {d.loading ? <Loading /> : d.error ? <ErrorBox message={d.error} /> : !p ? <Empty>Ce partage a été retiré.</Empty> : p.text ? <p style={{ whiteSpace: 'pre-wrap' }}>{p.text}</p> : <>
      <p className="muted">Extrait figé le {DT(p.generated_at)} · période {p.from} → {p.to} · {p.rows.length} ligne(s){p.truncated ? ' (tronqué)' : ''}</p>
      <div className="table-scroll" style={{ maxHeight: 420 }}><table><thead><tr>{p.columns.map((c: any) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>{p.rows.map((r: any, i: number) => <tr key={i}>{p.columns.map((c: any) => <td key={c.key}>{String(r[c.key] ?? '')}</td>)}</tr>)}</tbody></table></div></>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
  </Modal>;
}

function FindingModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ area: 'pesee', result: 'minor', requirement: '', description: '', evidence: '', due_on: '' }); const a = useAction();
  return <Modal title="Nouveau constat" onClose={onClose}>
    <div className="form-grid"><Field label="Domaine"><select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>{AREAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Résultat"><select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>{Object.entries(RESULT).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
    <Field label="Exigence contrôlée"><input value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} /></Field>
    <Field label="Constat"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    <Field label="Preuve (facultatif)"><input value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></Field>
    <Field label="Échéance de correction (facultatif)"><input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} /></Field>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={a.busy || f.requirement.trim().length < 3 || f.description.trim().length < 3} onClick={() => a.run(async () => { await post(`/audits/${id}/findings`, { ...f, evidence: f.evidence || undefined, due_on: f.due_on || undefined }); onDone(); })}>Ajouter</button></div>
  </Modal>;
}

function RespondModal({ id, finding, onClose, onDone }: { id: string; finding: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ response: '', action_plan: '', action_due_on: finding.due_on ? String(finding.due_on).slice(0, 10) : '' }); const a = useAction();
  return <Modal title={`Répondre au constat n° ${finding.no}`} onClose={onClose}>
    <p className="muted">{finding.requirement} — {finding.description}</p>
    <Field label="Votre réponse"><textarea rows={3} autoFocus value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })} /></Field>
    <Field label="Plan d'action"><textarea rows={3} value={f.action_plan} onChange={(e) => setF({ ...f, action_plan: e.target.value })} /></Field>
    <Field label="Échéance du plan"><input type="date" value={f.action_due_on} onChange={(e) => setF({ ...f, action_due_on: e.target.value })} /></Field>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={a.busy || f.response.trim().length < 3} onClick={() => a.run(async () => { await post(`/audits/${id}/findings/${finding.id}/respond`, { response: f.response, action_plan: f.action_plan || undefined, action_due_on: f.action_due_on || undefined }); onDone(); })}>Envoyer la réponse</button></div>
  </Modal>;
}

function CloseModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [s, setS] = useState(''); const a = useAction();
  return <Modal title="Clore l'audit" onClose={onClose}>
    <Field label="Synthèse de clôture"><textarea rows={4} autoFocus value={s} onChange={(e) => setS(e.target.value)} /></Field>
    <p className="muted">Un audit clos n'accepte plus de partage ni de constat.</p>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || s.trim().length < 3} onClick={() => a.run(async () => { await post(`/audits/${id}/close`, { summary: s }); onDone(); })}>Clore</button></div>
  </Modal>;
}

function AuditDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { can } = useAuth();
  const d = useAsync(() => get<any>(`/audits/${id}`), [id]);
  const cand = useAsync(() => (can('audits:manage') || can('audits:respond') ? get<any[]>(`/audits/${id}/candidates`).catch(() => []) : Promise.resolve([])), [id]);
  const log = useAsync(() => get<any[]>(`/audits/${id}/access-log`).catch(() => []), [id]);
  const [tab, setTab] = useState<'resume' | 'constats' | 'donnees' | 'journal'>('resume');
  const [modal, setModal] = useState<any>(null); const [pick, setPick] = useState(''); const a = useAction();
  const reload = () => { d.reload(); cand.reload(); log.reload(); setModal(null); };
  const x = d.data;
  if (d.loading) return <Loading />;
  if (d.error || !x) return <ErrorBox message={d.error ?? 'Audit introuvable'} onRetry={d.reload} />;
  const sup = x.side === 'supervisor'; const open = ['planned', 'in_progress', 'findings_issued'].includes(x.status);
  const myPeople = (x.participants ?? []).filter((p: any) => p.side === x.side);
  const act = (path: string, body?: any) => a.run(async () => { await post(path, body); reload(); });
  return <>
    <PageHeader title={`${x.number} · ${x.title}`} subtitle={`${x.supervisor_name} audite ${x.supervised_name}${x.starts_on ? ` · du ${D(x.starts_on)}` : ''}${x.ends_on ? ` au ${D(x.ends_on)}` : ''}`}
      actions={<><button className="btn btn-ghost" onClick={onBack}>← Tous les audits</button>
        {sup && x.participant && x.status === 'planned' && <button className="btn btn-primary" disabled={a.busy} onClick={() => act(`/audits/${id}/start`)}>Démarrer l'audit</button>}
        {sup && x.participant && x.status === 'in_progress' && <button className="btn btn-primary" disabled={a.busy} onClick={() => act(`/audits/${id}/issue`)}>Publier le rapport</button>}
        {sup && x.participant && x.status === 'findings_issued' && <button className="btn btn-primary" onClick={() => setModal({ k: 'close' })}>Clore</button>}
        {sup && x.participant && ['planned', 'in_progress'].includes(x.status) && <button className="btn btn-danger" disabled={a.busy} onClick={() => act(`/audits/${id}/cancel`)}>Annuler</button>}</>} />
    {a.error && <ErrorBox message={a.error} />}
    <p><StatusBadge map={STATUS} value={x.status} /> {x.participant ? <Badge tone="ok">Vous êtes participant</Badge> : <Badge tone="neutral">Non désigné : vous ne voyez pas les données partagées</Badge>}</p>
    <Tabs tabs={[['resume', 'Résumé et participants'], ['constats', `Constats (${(x.findings ?? []).length})`], ['donnees', `Données partagées (${(x.shares ?? []).length})`], ['journal', 'Journal d\'accès']]} value={tab} onChange={setTab} />
    <Card>
      {tab === 'resume' && <>
        <dl className="kv"><dt>Périmètre</dt><dd>{(x.scope ?? []).map((k: string) => AREA[k] ?? k).join(', ') || 'Non précisé'}</dd><dt>Statut</dt><dd><StatusBadge map={STATUS} value={x.status} /></dd>
          {x.closing_summary && <><dt>Synthèse</dt><dd>{x.closing_summary}</dd></>}</dl>
        <h3>Participants</h3>
        <p className="muted">Seuls les participants désignés voient les données partagées. Chaque partie désigne les siens.</p>
        <table><thead><tr><th>Nom</th><th>Organisation</th><th></th></tr></thead><tbody>{(x.participants ?? []).map((p: any) => <tr key={p.user_id}><td>{p.full_name}</td><td>{p.side === 'supervisor' ? x.supervisor_name : x.supervised_name}</td>
          <td>{p.side === x.side && open && (can('audits:manage') || can('audits:respond')) && myPeople.length > 1 && <button className="btn btn-small btn-ghost" onClick={() => act(`/audits/${id}/participants/${p.user_id}/remove`)}>Retirer</button>}</td></tr>)}</tbody></table>
        {open && (can('audits:manage') || can('audits:respond')) && (cand.data ?? []).length > 0 && <div className="row-actions"><select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Désigner un participant de mon organisation…</option>{(cand.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
          <button className="btn btn-small btn-secondary" disabled={!pick || a.busy} onClick={() => act(`/audits/${id}/participants`, { user_id: pick })}>Désigner</button></div>}</>}
      {tab === 'constats' && <>
        {sup && x.participant && ['in_progress', 'planned'].includes(x.status) && <p><button className="btn btn-secondary" onClick={() => setModal({ k: 'finding' })}>Ajouter un constat</button></p>}
        {!(x.findings ?? []).length ? <Empty>{sup ? 'Aucun constat saisi.' : 'Le rapport de l\'exportateur n\'est pas encore publié.'}</Empty> :
          <div className="table-scroll"><table><thead><tr><th>N°</th><th>Domaine</th><th>Exigence</th><th>Résultat</th><th>Constat</th><th>Statut</th><th>Réponse et plan d'action</th><th></th></tr></thead>
            <tbody>{x.findings.map((f: any) => <tr key={f.id}><td>{f.no}</td><td>{AREA[f.area] ?? f.area}</td><td>{f.requirement}</td><td><StatusBadge map={RESULT} value={f.result} /></td><td>{f.description}{f.due_on ? <><br /><span className="muted">Échéance {D(f.due_on)}</span></> : null}</td>
              <td><StatusBadge map={FSTATUS} value={f.result === 'conform' ? undefined : f.status} /></td><td>{f.response}{f.action_plan ? <><br /><em>{f.action_plan}</em></> : null}{f.verification_comment ? <><br /><span className="muted">Vérification : {f.verification_comment}</span></> : null}</td>
              <td className="row-actions">{!sup && x.status === 'findings_issued' && x.participant && f.result !== 'conform' && f.status === 'open' && can('audits:respond') && <button className="btn btn-small btn-primary" onClick={() => setModal({ k: 'respond', f })}>Répondre</button>}
                {sup && x.participant && f.status === 'responded' && <button className="btn btn-small btn-secondary" disabled={a.busy} onClick={() => act(`/audits/${id}/findings/${f.id}/verify`, {})}>Vérifier</button>}</td></tr>)}</tbody></table></div>}</>}
      {tab === 'donnees' && <>
        {!x.participant ? <Empty>Vous n'êtes pas désigné pour cet audit : les données partagées ne vous sont pas accessibles.</Empty> : <>
          {open && can('audits:share') && <p><button className="btn btn-secondary" onClick={() => setModal({ k: 'share' })}>Partager un extrait, un document ou une note</button></p>}
          {!(x.shares ?? []).length ? <Empty>Rien n'a encore été partagé.</Empty> :
            <table><thead><tr><th>Titre</th><th>Type</th><th>Partagé par</th><th>Date</th><th></th></tr></thead><tbody>{x.shares.map((s: any) => <tr key={s.id}>
              <td>{s.title}{s.withdrawn_at && <> <Badge tone="bad">Retiré</Badge></>}</td><td>{s.kind === 'snapshot' ? `Extrait (${s.row_count ?? 0} lignes)` : s.kind === 'document' ? `Document ${s.file_name ?? ''}` : 'Note'}</td>
              <td>{s.shared_by_name} {s.mine ? <Badge tone="info">nous</Badge> : null}</td><td>{DT(s.created_at)}</td>
              <td className="row-actions">{!s.withdrawn_at && s.kind !== 'document' && <button className="btn btn-small btn-secondary" onClick={() => setModal({ k: 'view', s })}>Consulter</button>}
                {!s.withdrawn_at && s.kind === 'document' && <button className="btn btn-small btn-secondary" disabled={a.busy} onClick={() => a.run(() => saveBlob(`/audits/${id}/shares/${s.id}/file`, s.file_name))}>Télécharger</button>}
                {!s.withdrawn_at && s.mine && open && <button className="btn btn-small btn-ghost" disabled={a.busy} onClick={() => act(`/audits/${id}/shares/${s.id}/withdraw`)}>Retirer</button>}</td></tr>)}</tbody></table>}</>}</>}
      {tab === 'journal' && (!x.participant ? <Empty>Réservé aux participants.</Empty> : !(log.data ?? []).length ? <Empty>Personne n'a encore consulté ce que vous avez partagé.</Empty> :
        <table><thead><tr><th>Date</th><th>Consulté par</th><th>Organisation</th><th>Partage</th></tr></thead><tbody>{log.data!.map((l, i) => <tr key={i}><td>{DT(l.created_at)}</td><td>{l.reader}</td><td>{l.reader_org}</td><td>{l.title}</td></tr>)}</tbody></table>)}
    </Card>
    {modal?.k === 'close' && <CloseModal id={id} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.k === 'finding' && <FindingModal id={id} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.k === 'respond' && <RespondModal id={id} finding={modal.f} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.k === 'share' && <ShareModal id={id} side={x.side} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.k === 'view' && <ShareView id={id} share={modal.s} onClose={() => { setModal(null); log.reload(); }} />}
  </>;
}

function Supervision() {
  const { can, org } = useAuth();
  const sups = useAsync(() => get<any[]>('/supervisions'), []); const a = useAction(); const [code, setCode] = useState('');
  const exporter = org?.kind === 'exporter';
  return <Card>
    {a.error && <ErrorBox message={a.error} />}
    <p className="muted">{exporter ? 'Vous êtes le supérieur hiérarchique des coopératives qui acceptent votre supervision. Sans leur accord, aucun audit n\'est possible.' : 'Un exportateur peut vous proposer sa supervision. Vous l\'acceptez, et vous pouvez la révoquer quand aucun audit n\'est en cours.'}</p>
    {exporter && can('links:manage') && <div className="row-actions"><input placeholder="Code de la coopérative" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      <button className="btn btn-secondary" disabled={a.busy || code.length < 2} onClick={() => a.run(async () => { await post('/supervisions', { code }); setCode(''); sups.reload(); })}>Proposer la supervision</button></div>}
    {sups.loading ? <Loading /> : !(sups.data ?? []).length ? <Empty>Aucune supervision.</Empty> :
      <table><thead><tr><th>Organisation</th><th>Rôle</th><th>Statut</th><th></th></tr></thead><tbody>{sups.data!.map((s) => <tr key={s.id}><td>{s.other_name} <code>{s.other_code}</code></td><td>{s.i_supervise ? 'Je supervise' : 'Me supervise'}</td><td><StatusBadge map={SUPSTATUS} value={s.status} /></td>
        <td className="row-actions">{!s.i_supervise && s.status === 'pending' && can('links:manage') && <button className="btn btn-small btn-primary" disabled={a.busy} onClick={() => a.run(async () => { await post(`/supervisions/${s.id}/accept`); sups.reload(); })}>Accepter</button>}
          {can('links:manage') && <button className="btn btn-small btn-ghost" disabled={a.busy} onClick={() => a.run(async () => { await post(`/supervisions/${s.id}/revoke`); sups.reload(); })}>Révoquer</button>}</td></tr>)}</tbody></table>}
  </Card>;
}

/** Module d'audit : l'exportateur audite les coopératives qui ont accepté sa supervision ; chacun partage des copies figées de ses données, visibles des seuls participants désignés. */
export default function Audits() {
  const { can, org } = useAuth();
  const list = useAsync(() => get<any[]>('/audits'), []);
  const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState<'audits' | 'supervision'>('audits'); const [adding, setAdding] = useState(false);
  const exporter = org?.kind === 'exporter';
  if (sel) return <AuditDetail id={sel} onBack={() => { setSel(null); list.reload(); }} />;
  return <>
    <PageHeader title="Audits" subtitle={exporter ? 'Missions d\'audit des coopératives que vous supervisez : données partagées, constats, plans d\'action.' : 'Audits de votre exportateur : désignez vos participants, partagez vos données, répondez aux constats.'}
      actions={exporter && can('audits:manage') ? <button className="btn btn-primary" onClick={() => setAdding(true)}>Programmer un audit</button> : undefined} />
    <Tabs tabs={[['audits', 'Missions d\'audit'], ['supervision', 'Supervision']]} value={tab} onChange={setTab} />
    {tab === 'supervision' ? <Supervision /> : <Card>
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.loading ? <Loading /> : !(list.data ?? []).length ? <Empty>Aucun audit.</Empty> :
        <div className="table-scroll"><table><thead><tr><th>N°</th><th>Intitulé</th><th>{exporter ? 'Coopérative' : 'Exportateur'}</th><th>Période</th><th>Statut</th><th className="r">Constats</th><th className="r">À traiter</th><th></th></tr></thead>
          <tbody>{list.data!.map((a) => <tr key={a.id}><td><code>{a.number}</code></td><td>{a.title}</td><td>{a.i_supervise ? a.supervised_name : a.supervisor_name}</td><td>{D(a.starts_on)} {a.ends_on ? `→ ${D(a.ends_on)}` : ''}</td><td><StatusBadge map={STATUS} value={a.status} /></td>
            <td className="r">{a.findings}</td><td className="r">{a.open_findings}</td><td><button className="btn btn-small btn-secondary" onClick={() => setSel(a.id)}>Ouvrir</button></td></tr>)}</tbody></table></div>}
    </Card>}
    {adding && <NewAudit onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); list.reload(); setSel(id); }} />}
  </>;
}
