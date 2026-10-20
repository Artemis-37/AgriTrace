import { FormEvent, useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { PRIORITY, TASK_CATEGORY, TASK_STATUS, date, dateTime } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Tabs, useAction, useAsync } from '../ui';
import { Confirm } from './Declarations';
import DocumentsPanel from './DocumentsPanel';

export default function Missions() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'tasks' | 'requests'>('tasks');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState<'task' | 'request' | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>(can('tasks:read_all') ? 'all' : 'mine');
  const { data, loading, error, reload } = useAsync(async () => {
    const [tasks, dash, users, producers] = await Promise.all([
      get<any[]>('/tasks'), get<any>(`/tasks/dashboard${scope === 'all' ? '?scope=all' : ''}`).catch(() => null),
      can('users:read') ? get<any[]>('/users').catch(() => []) : Promise.resolve([]), can('producers:read') ? get<any[]>('/producers').catch(() => []) : Promise.resolve([]),
    ]);
    return { tasks, dash, users: new Map(users.map((u) => [u.id, u.full_name])), producers: new Map(producers.map((p) => [p.id, `${p.last_name} ${p.first_names}`])) };
  }, [scope]);
  const c = data?.dash?.counts;
  const rows = (data?.tasks ?? []).filter((t) => !status || t.status === status);

  return (
    <>
      <PageHeader title="Missions" subtitle="Tâches officielles de terrain, exécution et vérification"
        actions={<>
          {can('tasks:request') && <button className="btn btn-secondary" onClick={() => setCreating('request')}>Demander une mission</button>}
          {can('tasks:create') && <button className="btn" onClick={() => setCreating('task')}>Nouvelle mission</button>}
        </>} />
      {c && (
        <div className="grid">
          <Stat label="Attribuées" value={c.assigned} tone="info" />
          <Stat label="Urgentes" value={c.urgent} tone={c.urgent ? 'bad' : 'neutral'} />
          <Stat label="En retard" value={c.overdue} tone={c.overdue ? 'warn' : 'neutral'} />
          <Stat label="À vérifier" value={c.to_review} tone={c.to_review ? 'warn' : 'neutral'} />
          <Stat label="À corriger" value={c.to_correct} tone={c.to_correct ? 'bad' : 'neutral'} />
          <Stat label="Terminées" value={c.done} tone="ok" />
          <Stat label="Producteurs non cartographiés" value={c.unmapped_producers} tone="neutral" />
          <Stat label="Parcelles sans polygone" value={c.parcels_without_polygon} tone="neutral" />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[['tasks', 'Missions'], ...(can('tasks:request') || can('tasks:decide_requests') ? [['requests', 'Demandes'] as ['requests', string]] : [])]} />
      {tab === 'tasks' ? (
        <Card>
          <div className="toolbar">
            <select aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous les statuts</option>{Object.entries(TASK_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {can('tasks:read_all') && <select aria-label="Périmètre" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')}><option value="all">Toute la coopérative</option><option value="mine">Mes missions</option></select>}
          </div>
          {error && <ErrorBox message={error} onRetry={reload} />}
          {loading ? <Loading /> : (
            <Table rows={rows} empty="Aucune mission." columns={[
              { header: 'Code', render: (t) => <button className="btn btn-ghost btn-small" onClick={() => setDetail(t.id)}><strong>{t.code}</strong></button> },
              { header: 'Titre', render: (t) => t.title },
              { header: 'Catégorie', render: (t) => TASK_CATEGORY[t.category] ?? t.category },
              { header: 'Producteur', render: (t) => data?.producers.get(t.producer_id) ?? '—' },
              { header: 'Responsable', render: (t) => data?.users.get(t.assignee_id) ?? (t.assignee_id ? '…' : '—') },
              { header: 'Priorité', render: (t) => <StatusBadge map={PRIORITY} value={t.priority} /> },
              { header: 'Échéance', render: (t) => <>{date(t.due_date)} {t.overdue && <Badge tone="bad">En retard</Badge>}</> },
              { header: 'Statut', render: (t) => <StatusBadge map={TASK_STATUS} value={t.status} /> },
            ]} />
          )}
        </Card>
      ) : <Requests onChange={reload} />}
      {detail && <Detail id={detail} onClose={() => setDetail(null)} onChange={reload} />}
      {creating && <Create kind={creating} users={data?.users} onClose={() => setCreating(null)} onDone={() => { setCreating(null); reload(); }} />}
    </>
  );
}

function Create({ kind, users, onClose, onDone }: { kind: 'task' | 'request'; users?: Map<string, string>; onClose: () => void; onDone: () => void }) {
  const producers = useAsync(() => get<any[]>('/producers').catch(() => []), []);
  const [f, setF] = useState({ title: '', description: '', category: 'mapping', priority: 'normal', due_date: '', producer_id: '', assignee_id: '', instructions: '', expected_result: '', validation_criteria: '' });
  const [key] = useState(idem);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const opt = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''));
      if (kind === 'request') await post('/task-requests', { idempotency_key: key, title: f.title, category: f.category, ...opt({ description: f.description, producer_id: f.producer_id }) });
      else await post('/tasks', { idempotency_key: key, title: f.title, category: f.category, priority: f.priority, publish: !!f.assignee_id,
        ...opt({ description: f.description, due_date: f.due_date, producer_id: f.producer_id, assignee_id: f.assignee_id, instructions: f.instructions, expected_result: f.expected_result, validation_criteria: f.validation_criteria }) });
      onDone();
    });
  };
  return (
    <Modal title={kind === 'task' ? 'Nouvelle mission' : 'Demander une mission'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Titre"><input required minLength={3} value={f.title} onChange={set('title')} /></Field>
        <Field label="Catégorie"><select value={f.category} onChange={set('category')}>{Object.entries(TASK_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Producteur concerné"><select value={f.producer_id} onChange={set('producer_id')}><option value="">— Aucun —</option>{(producers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.internal_code} {p.last_name} {p.first_names}</option>)}</select></Field>
        <Field label="Description"><textarea rows={2} value={f.description} onChange={set('description')} /></Field>
        {kind === 'task' && <>
          <Field label="Priorité"><select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Date limite"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
          <Field label="Responsable" hint="Si renseigné, la mission est ouverte et le responsable est notifié ; sinon elle reste en brouillon.">
            <select value={f.assignee_id} onChange={set('assignee_id')}><option value="">— Brouillon —</option>{[...(users?.entries() ?? [])].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          </Field>
          <Field label="Instructions"><textarea rows={2} value={f.instructions} onChange={set('instructions')} /></Field>
          <Field label="Résultat attendu"><input value={f.expected_result} onChange={set('expected_result')} /></Field>
          <Field label="Critères de validation"><input value={f.validation_criteria} onChange={set('validation_criteria')} /></Field>
        </>}
        {error && <ErrorBox message={error} />}
        <div className="modal-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button className="btn" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}

function Detail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { can } = useAuth();
  const { data: t, loading, error, reload } = useAsync(() => get<any>(`/tasks/${id}`), [id]);
  const [act, setAct] = useState<{ to: string; label: string; reason?: boolean } | null>(null);
  const [entry, setEntry] = useState({ kind: 'observation', content: '' });
  const { busy, error: err, run } = useAction();
  const refresh = () => { reload(); onChange(); };
  if (loading) return <Modal title="Mission" onClose={onClose}><Loading /></Modal>;
  if (error || !t) return <Modal title="Mission" onClose={onClose}><ErrorBox message={error ?? 'Introuvable'} /></Modal>;
  const exec = t.can_execute;
  const buttons: { to: string; label: string; reason?: boolean; show: boolean; secondary?: boolean }[] = [
    { to: 'open', label: 'Ouvrir', show: t.status === 'draft' && can('tasks:create') },
    { to: 'in_progress', label: t.status === 'to_correct' ? 'Reprendre' : 'Démarrer', show: ['open', 'to_correct'].includes(t.status) && exec },
    { to: 'submitted', label: 'Soumettre pour vérification', show: t.status === 'in_progress' && exec },
    { to: 'validated', label: 'Valider', reason: false, show: t.status === 'submitted' && can('tasks:review') && !exec },
    { to: 'to_correct', label: 'Renvoyer à corriger', reason: true, show: t.status === 'submitted' && can('tasks:review') && !exec, secondary: true },
    { to: 'completed', label: 'Marquer terminée', show: t.status === 'validated' && can('tasks:close') },
    { to: 'closed', label: 'Clôturer', show: ['validated', 'completed'].includes(t.status) && can('tasks:close') },
    { to: 'cancelled', label: 'Annuler', reason: true, show: !['closed', 'cancelled'].includes(t.status) && can('tasks:close'), secondary: true },
  ];
  const addEntry = () => run(async () => {
    await post(`/tasks/${id}/entries`, { idempotency_key: idem(), kind: entry.kind, content: entry.content });
    setEntry({ ...entry, content: '' }); reload();
  });
  const addGps = () => run(async () => {
    const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }) : rej(new Error('Position indisponible sur cet appareil')));
    await post(`/tasks/${id}/entries`, { idempotency_key: idem(), kind: 'gps', latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)), accuracy_m: Number(pos.coords.accuracy.toFixed(1)) });
    reload();
  });

  return (
    <Modal title={`${t.code} — ${t.title}`} onClose={onClose}>
      <p><StatusBadge map={TASK_STATUS} value={t.status} /> <StatusBadge map={PRIORITY} value={t.priority} /> · {TASK_CATEGORY[t.category]} · échéance {date(t.due_date)}</p>
      {t.producer && <p>Producteur : <strong>{t.producer.internal_code} {t.producer.last_name} {t.producer.first_names}</strong>, {t.producer.village ?? '—'}</p>}
      {t.mapping && <p className="notice">{t.mapping.message}</p>}
      {t.review_note && <p className="notice">Retour du contrôle : {t.review_note}</p>}
      {t.instructions && <p><strong>Instructions :</strong> {t.instructions}</p>}
      {t.expected_result && <p><strong>Résultat attendu :</strong> {t.expected_result}</p>}
      {t.validation_criteria && <p><strong>Critères de validation :</strong> {t.validation_criteria}</p>}
      <h2>Saisies</h2>
      {t.entries.length ? <ul className="plain">{t.entries.map((e: any) => (
        <li key={e.id}><Badge>{e.kind}</Badge> {e.content ?? (e.latitude ? `${e.latitude}, ${e.longitude} (±${e.accuracy_m ?? '?'} m)` : '')} <small className="muted">{dateTime(e.recorded_at)}</small></li>
      ))}</ul> : <p className="muted">Aucune saisie.</p>}
      {exec && t.status === 'in_progress' && (
        <div style={{ margin: '.75rem 0' }}>
          <div className="toolbar">
            <select aria-label="Type de saisie" value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}><option value="observation">Observation</option><option value="result">Résultat</option></select>
            <input aria-label="Texte" style={{ flex: 1, minWidth: 180 }} value={entry.content} onChange={(e) => setEntry({ ...entry, content: e.target.value })} placeholder="Texte de la saisie" />
            <button className="btn btn-small" disabled={busy || !entry.content.trim()} onClick={addEntry}>Ajouter</button>
            <button className="btn btn-small btn-secondary" disabled={busy} onClick={addGps}>Ajouter ma position</button>
          </div>
        </div>
      )}
      <DocumentsPanel subjectType="task" subjectId={t.id} kinds={['task_report', 'photo', 'other']} locked={['validated', 'closed', 'cancelled'].includes(t.status)} />
      <h2>Historique</h2>
      <ul className="plain">{t.history.map((h: any) => <li key={h.id}>{dateTime(h.created_at)} — {TASK_STATUS[h.to_status]?.[0] ?? h.to_status} par {h.actor_name ?? '—'}{h.note ? ` : ${h.note}` : ''}</li>)}</ul>
      {err && <ErrorBox message={err} />}
      <div className="modal-foot">
        {buttons.filter((b) => b.show).map((b) => (
          <button key={b.to} className={`btn btn-small ${b.secondary ? 'btn-secondary' : ''}`} disabled={busy}
            onClick={() => (b.reason ? setAct(b) : run(async () => { await post(`/tasks/${id}/transition`, { to: b.to }); refresh(); }))}>{b.label}</button>
        ))}
      </div>
      {act && <Confirm title={act.label} reason onClose={() => setAct(null)} onSubmit={async (note) => { await post(`/tasks/${id}/transition`, { to: act.to, note }); setAct(null); refresh(); }} />}
    </Modal>
  );
}

function Requests({ onChange }: { onChange: () => void }) {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/task-requests'), []);
  const [dec, setDec] = useState<{ r: any; decision: 'accept' | 'reject' } | null>(null);
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune demande." columns={[
          { header: 'Date', render: (r) => dateTime(r.created_at) },
          { header: 'Demandeur', render: (r) => r.requested_by_name ?? '—' },
          { header: 'Titre', render: (r) => <strong>{r.title}</strong> },
          { header: 'Catégorie', render: (r) => TASK_CATEGORY[r.category] ?? r.category },
          { header: 'Statut', render: (r) => <StatusBadge map={{ pending: ['En attente', 'warn'], accepted: ['Acceptée', 'ok'], rejected: ['Refusée', 'bad'] }} value={r.status} /> },
          { header: '', render: (r) => r.status === 'pending' && can('tasks:decide_requests') && (
            <div className="row-actions"><button className="btn btn-small" onClick={() => setDec({ r, decision: 'accept' })}>Accepter</button>
              <button className="btn btn-small btn-secondary" onClick={() => setDec({ r, decision: 'reject' })}>Refuser</button></div>) },
        ]} />
      )}
      {dec && <Confirm title={dec.decision === 'accept' ? 'Accepter la demande (mission en brouillon)' : 'Refuser la demande'} reason label="Motif de la décision" onClose={() => setDec(null)}
        onSubmit={async (note) => { await post(`/task-requests/${dec.r.id}/decide`, { decision: dec.decision, note }); setDec(null); reload(); onChange(); }} />}
    </Card>
  );
}
