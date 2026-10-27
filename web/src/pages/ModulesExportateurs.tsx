import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';
import { Editor, Mod, Reader } from './ModulesFormation';
import { AssignDialog, AssignmentsTab } from './Affectations';
import { QuestionnaireEditor } from './Questionnaires';
import { Question, showAnswer } from './QuestionnaireAnswer';
import { download } from '../api';

type Sub = { id: string; title: string; theme: string; summary: string; crops: string[]; certifications: string[]; level: string; duration_min: number; content: Mod['content']; status: 'submitted' | 'forwarded' | 'declined'; submitted_by_name: string; decided_by_name: string | null; decided_at: string | null; decline_reason: string | null; created_at: string; results_count: number; results_forwarded: number };
type Res = { id: string; submission_id: string; module_title: string | null; submission_title: string; coach_name: string; exporter_name: string; session_date: string; village: string; participants: number; avg_score: string | null; notes: string; status: 'submitted' | 'forwarded'; created_at: string; forwarded_at: string | null };

const THEMES = ['Agriculture régénératrice', 'Collecte de documents et tenue de registres', 'Diversification', 'Eau, assainissement, et hygiène', 'Genre, jeunesse, et inclusion', 'Gestion des récoltes et des produits', 'Gouvernance coopérative', 'Normes et réglementations de certification', 'Santé et sécurité au travail'];
const SUB_STATE: Record<string, ['warn' | 'ok' | 'neutral', string]> = { submitted: ['warn', 'En attente de l\'ADG'], forwarded: ['ok', 'Transmis aux coachs'], declined: ['neutral', 'Non retenu'] };
const d = (x: string | null) => (x ? new Date(x).toLocaleDateString('fr-FR') : '—');

/**
 * Circuit exportateur : l'exportateur propose un module → l'ADG le transmet aux coachs (un clic, sans modification)
 * → les coachs saisissent leurs résultats (application mobile) → l'ADG les transmet à l'exportateur (un clic, sans modification).
 */
export default function ModulesExportateurs() {
  const { can } = useAuth();
  const [section, setSection] = useState<'modules' | 'taches'>('modules');
  const showTasks = can('training:forward') || can('tasks:propose');
  return (
    <>
      {showTasks && <Tabs tabs={[['modules', 'Modules de formation'], ['taches', 'Tâches']]} value={section} onChange={setSection} />}
      {section === 'taches' && showTasks ? <TachesExportateurs /> : <ModulesPart />}
    </>
  );
}

type TaskSub = { id: string; title: string; description: string; questions: Question[]; status: 'submitted' | 'forwarded' | 'declined'; decline_reason: string | null; created_at: string; results_forwarded_at: string | null; submitted_by_name: string; targets: number | null; answers: number | null };
const TASK_STATE: Record<string, ['warn' | 'ok' | 'neutral', string]> = { submitted: ['warn', 'En attente de l\'ADG'], forwarded: ['ok', 'Transmise aux coachs'], declined: ['neutral', 'Non retenue'] };

/** Circuit des tâches : l'exportateur crée une tâche (questions) → l'ADG la transmet aux coachs → les réponses reviennent à l'exportateur, transmises par l'ADG. */
function TachesExportateurs() {
  const { can } = useAuth();
  const adg = can('training:forward');
  const propose = can('tasks:propose');
  const [edit, setEdit] = useState(false);
  const [fwd, setFwd] = useState<TaskSub | null>(null);
  const [res, setRes] = useState<TaskSub | null>(null);
  const act = useAction();
  const subs = useAsync(() => get<TaskSub[]>('/task-submissions'), []);
  const run = (fn: () => Promise<unknown>) => act.run(async () => { await fn(); subs.reload(); });
  return (
    <>
      <PageHeader title={adg ? 'Tâches des exportateurs' : 'Mes tâches'}
        subtitle={adg ? 'Les tâches proposées par les exportateurs sont transmises aux coachs, et leurs réponses aux exportateurs, par un simple clic : l\'ADG ne modifie rien.' : 'Créez une tâche (un questionnaire) : l\'ADG la transmet aux coachs, qui la renseignent auprès des producteurs, et vous fait parvenir les réponses.'}
        actions={propose && <button className="btn" onClick={() => setEdit(true)}>Créer une tâche</button>} />
      {act.error && <ErrorBox message={act.error} />}
      <Card>
        {subs.loading ? <Loading /> : subs.error ? <ErrorBox message={subs.error} onRetry={subs.reload} /> : (
          <Table rows={subs.data ?? []} empty={adg ? 'Aucune tâche proposée par un exportateur.' : 'Vous n\'avez pas encore créé de tâche.'} columns={[
            { header: 'Date', render: (s: TaskSub) => d(s.created_at) },
            { header: 'Tâche', render: (s: TaskSub) => <><strong>{s.title}</strong><div className="muted" style={{ fontSize: '.85rem' }}>{s.questions.length} question(s)</div></> },
            ...(adg ? [{ header: 'Exportateur', render: (s: TaskSub) => s.submitted_by_name }] : []),
            { header: 'Statut', render: (s: TaskSub) => <><Badge tone={TASK_STATE[s.status][0]}>{TASK_STATE[s.status][1]}</Badge>{s.decline_reason && <div className="muted" style={{ fontSize: '.85rem' }}>{s.decline_reason}</div>}</> },
            { header: 'Réponses', render: (s: TaskSub) => s.status !== 'forwarded' ? '—' : adg ? `${s.answers ?? 0} sur ${s.targets ?? 0}` : s.results_forwarded_at ? `${s.answers ?? 0} reçue(s)` : 'Pas encore transmises' },
            { header: '', render: (s: TaskSub) => (
              <span className="row-actions">
                {adg && s.status === 'submitted' && <>
                  <button className="btn btn-small" disabled={act.busy} onClick={() => setFwd(s)}>Transmettre aux coachs</button>
                  <button className="btn btn-small btn-secondary" disabled={act.busy} onClick={() => { const reason = prompt('Motif du refus (facultatif) :'); if (reason !== null) run(() => post(`/task-submissions/${s.id}/decline`, { reason })); }}>Décliner</button>
                </>}
                {s.status === 'forwarded' && (adg || s.results_forwarded_at) && <button className="btn btn-small btn-secondary" onClick={() => setRes(s)}>Voir les réponses</button>}
                {adg && s.status === 'forwarded' && !s.results_forwarded_at && <button className="btn btn-small" disabled={act.busy} onClick={() => { if (confirm('Transmettre les réponses à l\'exportateur, telles que saisies par les coachs ?')) run(() => post(`/task-submissions/${s.id}/forward-results`, {})); }}>Transmettre les réponses</button>}
                {adg && s.results_forwarded_at && <Badge tone="ok">Transmises le {d(s.results_forwarded_at)}</Badge>}
              </span>) },
          ]} />
        )}
      </Card>
      {fwd && <AssignDialog title={`Transmettre « ${fwd.title} » aux coachs`} forwardUrl={`/task-submissions/${fwd.id}/forward`} onClose={() => setFwd(null)} onDone={() => { setFwd(null); subs.reload(); }} />}
      {res && <TaskAnswers s={res} onClose={() => setRes(null)} />}
      {edit && <QuestionnaireEditor saveUrl="/task-submissions" heading="Créer une tâche pour l'ADG" onClose={() => setEdit(false)} onDone={() => { setEdit(false); subs.reload(); }} />}
    </>
  );
}

function TaskAnswers({ s, onClose }: { s: TaskSub; onClose: () => void }) {
  const r = useAsync(() => get<{ questions: Question[]; rows: any[] }>(`/task-submissions/${s.id}/results`), [s.id]);
  return (
    <Modal title={`Réponses : ${s.title}`} onClose={onClose}>
      <div className="toolbar"><button className="btn btn-secondary btn-small" onClick={() => download(`/task-submissions/${s.id}/results?format=csv`, 'reponses-tache.csv')}>Exporter (CSV)</button></div>
      {r.loading ? <Loading /> : r.error ? <ErrorBox message={r.error} onRetry={r.reload} /> : r.data && (
        <div style={{ overflow: 'auto', maxHeight: '55vh' }}>
          <Table rows={r.data.rows.map((x: any, i: number) => ({ ...x, id: String(i) }))} empty="Aucun producteur ciblé." columns={[
            { header: 'Producteur', render: (x: any) => <><code>{x.internal_code}</code> {x.last_name} {x.first_names}</> },
            { header: 'État', render: (x: any) => x.status === 'done' ? <Badge tone="ok">Fait le {d(x.answered_at)}</Badge> : <Badge tone="warn">À faire</Badge> },
            ...r.data.questions.map((q: Question) => ({ header: q.label, render: (x: any) => showAnswer(x.answers?.[q.id]) })),
          ]} />
        </div>
      )}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

function ModulesPart() {
  const { can } = useAuth();
  const adg = can('training:forward');
  const propose = can('training:propose');
  const [tab, setTab] = useState<'subs' | 'results' | 'assign'>('subs');
  const [fwd, setFwd] = useState<Sub | null>(null);
  const [edit, setEdit] = useState(false);
  const [view, setView] = useState<Sub | null>(null);
  const act = useAction();
  const subs = useAsync(() => get<Sub[]>('/training-submissions'), []);
  const results = useAsync(() => get<Res[]>('/training-results'), []);
  const pending = (subs.data ?? []).filter((s) => s.status === 'submitted').length;
  const toForward = (results.data ?? []).filter((r) => r.status === 'submitted').length;
  const reload = () => { subs.reload(); results.reload(); };
  const run = (fn: () => Promise<unknown>) => act.run(async () => { await fn(); reload(); });

  return (
    <>
      <PageHeader title={adg ? 'Modules des exportateurs' : 'Mes modules de formation'}
        subtitle={adg ? 'Les modules proposés par les exportateurs sont transmis aux coachs, et leurs résultats aux exportateurs, par un simple clic : l\'ADG ne modifie rien.' : 'Proposez un module à l\'ADG ; il le transmet aux coachs et vous fait parvenir les résultats.'}
        actions={propose && <button className="btn" onClick={() => setEdit(true)}>Proposer un module</button>} />
      {adg && (
        <Tabs tabs={[['subs', `Propositions${pending ? ` (${pending})` : ''}`], ['results', `Résultats${toForward ? ` (${toForward})` : ''}`], ['assign', 'Affectations aux producteurs']]} value={tab} onChange={setTab} />
      )}
      {act.error && <ErrorBox message={act.error} />}
      {adg && tab === 'assign' && <AssignmentsTab />}
      {(!adg || tab === 'subs') && (
        <Card>
          {subs.loading ? <Loading /> : subs.error ? <ErrorBox message={subs.error} onRetry={subs.reload} /> : (
            <Table rows={subs.data ?? []} empty={adg ? 'Aucune proposition d\'exportateur.' : 'Vous n\'avez pas encore proposé de module.'} columns={[
              { header: 'Date', render: (s: Sub) => d(s.created_at) },
              { header: 'Module', render: (s: Sub) => <button className="btn btn-ghost" style={{ fontWeight: 700, textAlign: 'left' }} onClick={() => setView(s)}>{s.title}</button> },
              ...(adg ? [{ header: 'Exportateur', render: (s: Sub) => s.submitted_by_name }] : []),
              { header: 'Statut', render: (s: Sub) => <><Badge tone={SUB_STATE[s.status][0]}>{SUB_STATE[s.status][1]}</Badge>{s.decline_reason && <div className="muted" style={{ fontSize: '.85rem' }}>{s.decline_reason}</div>}</> },
              { header: 'Résultats', render: (s: Sub) => s.status === 'forwarded' ? (adg ? `${s.results_count} reçu(s), ${s.results_forwarded} transmis` : `${s.results_forwarded} reçu(s)`) : '—' },
              ...(adg ? [{ header: '', render: (s: Sub) => s.status === 'submitted' ? (
                <span className="row-actions">
                  <button className="btn btn-small" disabled={act.busy} onClick={() => setFwd(s)}>Transmettre aux coachs</button>
                  <button className="btn btn-small btn-secondary" disabled={act.busy} onClick={() => { const reason = prompt('Motif du refus (facultatif) :'); if (reason !== null) run(() => post(`/training-submissions/${s.id}/decline`, { reason })); }}>Décliner</button>
                </span>) : null }] : []),
            ]} />
          )}
        </Card>
      )}
      {(!adg || tab === 'results') && (
        <Card>
          {!adg && <h3 style={{ marginTop: 0 }}>Résultats reçus</h3>}
          {results.loading ? <Loading /> : results.error ? <ErrorBox message={results.error} onRetry={results.reload} /> : (
            <Table rows={results.data ?? []} empty={adg ? 'Aucun résultat saisi par les coachs.' : 'Aucun résultat transmis pour le moment.'} columns={[
              { header: 'Séance', render: (r: Res) => d(r.session_date) },
              { header: 'Module', render: (r: Res) => r.module_title ?? r.submission_title },
              ...(adg ? [{ header: 'Exportateur', render: (r: Res) => r.exporter_name }] : []),
              { header: 'Coach', render: (r: Res) => r.coach_name },
              { header: 'Village', render: (r: Res) => r.village || '—' },
              { header: 'Participants', render: (r: Res) => r.participants },
              { header: 'Score moyen', render: (r: Res) => r.avg_score === null ? '—' : `${Number(r.avg_score)} / 100` },
              { header: 'Observations', render: (r: Res) => r.notes || '—' },
              ...(adg ? [{ header: 'Statut', render: (r: Res) => r.status === 'forwarded' ? <Badge tone="ok">Transmis le {d(r.forwarded_at)}</Badge> : <button className="btn btn-small" disabled={act.busy} onClick={() => { if (confirm('Transmettre ces résultats à l\'exportateur, tels que saisis par le coach ?')) run(() => post(`/training-results/${r.id}/forward`)); }}>Transmettre à l'exportateur</button> }] : []),
            ]} />
          )}
        </Card>
      )}
      {fwd && <AssignDialog title={`Transmettre « ${fwd.title} » aux coachs`} forwardUrl={`/training-submissions/${fwd.id}/forward`} onClose={() => setFwd(null)} onDone={() => { setFwd(null); reload(); }} />}
      {view && <Reader m={{ ...view, id: view.id, code: null, review_state: 'exporter', version: 1, reviewed_at: null, updated_at: view.created_at } as unknown as Mod} onClose={() => setView(null)} />}
      {edit && <Editor m={null} themes={THEMES} saveUrl="/training-submissions" title="Proposer un module à l'ADG" onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </>
  );
}
