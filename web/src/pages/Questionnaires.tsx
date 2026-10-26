import { useRef, useState } from 'react';
import { del, download, get, post, postForm, putForm } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';
import { AssignDialog } from './Affectations';
import { QTYPE_FR, QType, Question, showAnswer } from './QuestionnaireAnswer';

type Q = { id: string; title: string; description: string; question_count: number; archived: boolean; created_at: string; assignments: number; template_code?: string | null; updated_at?: string | null };
type Asg = { id: string; title: string; scope: string; created_at: string; questionnaire_id: string | null; targets: number; done: number };
const d = (x: string | null) => (x ? new Date(x).toLocaleDateString('fr-FR') : '—');

/** Tâches = questionnaires : l'ADG les crée ou les importe, les affecte à tous les producteurs ou à certains ; le coach les renseigne auprès du producteur. */
export default function Questionnaires() {
  const { can } = useAuth();
  const manage = can('questionnaires:manage');
  const list = useAsync(() => get<Q[]>('/questionnaires'), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Q | null>(null);
  const [importing, setImporting] = useState(false);
  const [assign, setAssign] = useState<Q | null>(null);
  const [coaching, setCoaching] = useState(false);
  const [results, setResults] = useState<Q | null>(null);
  const [logos, setLogos] = useState(false);
  const act = useAction();
  return (
    <>
      <PageHeader title="Questionnaires (tâches)" subtitle="Un questionnaire est une tâche que le coach renseigne auprès du producteur. Créez-le ou importez-le, puis envoyez-le à tous les producteurs ou à certains."
        actions={<>{can('training:assign') && <button className="btn" onClick={() => setCoaching(true)}>Lancer le coaching agricole (6 étapes)</button>}{manage && <button className="btn btn-secondary" onClick={() => setLogos(true)}>Logos des certifications</button>}{manage && <><button className="btn btn-secondary" onClick={() => setCreating(true)}>Créer un questionnaire</button><button className="btn btn-secondary" onClick={() => setImporting(true)}>Importer (Excel / CSV)</button><button className="btn btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { await post('/questionnaires/defaults'); list.reload(); })}>Recharger les modèles types</button></>}</>} />
      <Card>
        {act.error && <ErrorBox message={act.error} />}
        {list.loading ? <Loading /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
          <Table rows={list.data ?? []} empty={manage ? 'Aucun questionnaire. Créez-en un ou importez un fichier Excel.' : 'Aucun questionnaire.'} columns={[
            { header: 'Questionnaire', render: (q: Q) => <><strong>{q.title}</strong>{q.template_code && <> <Badge tone="info">Modèle type</Badge></>}{q.archived && <> <Badge tone="neutral">Archivé</Badge></>}{q.description && <div className="muted" style={{ fontSize: '.85rem' }}>{q.description}</div>}</> },
            { header: 'Questions', align: 'right', render: (q: Q) => q.question_count },
            { header: 'Envois', align: 'right', render: (q: Q) => q.assignments },
            { header: 'Créé le', render: (q: Q) => d(q.created_at) },
            { header: '', render: (q: Q) => (
              <span style={{ display: 'inline-flex', gap: '.4rem', flexWrap: 'wrap' }}>
                {can('training:assign') && !q.archived && <button className="btn btn-small" onClick={() => setAssign(q)}>Envoyer aux producteurs</button>}
                {q.assignments > 0 && <button className="btn btn-small btn-secondary" onClick={() => setResults(q)}>Résultats</button>}
                {manage && <button className="btn btn-small btn-secondary" onClick={() => setEditing(q)}>Modifier</button>}
                {manage && <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { await post(`/questionnaires/${q.id}/duplicate`); list.reload(); })}>Dupliquer</button>}
                {manage && <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { await post(`/questionnaires/${q.id}/archive`); list.reload(); })}>{q.archived ? 'Réactiver' : 'Archiver'}</button>}
              </span>) },
          ]} />
        )}
      </Card>
      {editing && <QuestionnaireEditor edit={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} />}
      {creating && <QuestionnaireEditor onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />}
      {importing && <ImportQuestionnaire onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />}
      {coaching && <AssignDialog program title="Lancer le coaching agricole (6 étapes)" questionnaire={{ id: 'coaching', title: 'Diagnostic → PDE → BPA → Champ école → Suivi → Évaluation' }} onClose={() => setCoaching(false)} onDone={() => { setCoaching(false); list.reload(); }} />}
      {assign && <AssignDialog title={`Envoyer « ${assign.title} »`} questionnaire={assign} onClose={() => setAssign(null)} onDone={() => { setAssign(null); list.reload(); }} />}
      {results && <Results q={results} onClose={() => setResults(null)} />}
      {logos && <CertificationLogos onClose={() => setLogos(false)} />}
    </>
  );
}

function QuestionnaireEditor({ onClose, onDone, edit }: { onClose: () => void; onDone: () => void; edit?: Q }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [qs, setQs] = useState<{ label: string; type: QType; options: string; required: boolean }[]>([{ label: '', type: 'text', options: '', required: false }]);
  const { busy, error, run } = useAction();
  const full = useAsync(async () => (edit ? get<{ title: string; description: string; questions: Question[]; assignments: number }>(`/questionnaires/${edit.id}`) : null), [edit?.id]);
  const loaded = useRef('');
  if (full.data && loaded.current !== edit?.id) {
    loaded.current = edit!.id;
    setTitle(full.data.title); setDescription(full.data.description);
    setQs(full.data.questions.map((q) => ({ label: q.label, type: q.type, options: (q.options ?? []).join('; '), required: q.required })));
  }
  const upd = (i: number, patch: Partial<(typeof qs)[number]>) => setQs((l) => l.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) => setQs((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const ok = title.trim().length >= 3 && qs.length > 0 && qs.every((q) => q.label.trim().length >= 2 && (!['choice', 'multi'].includes(q.type) || q.options.split(/[;\n]/).filter((o) => o.trim()).length >= 2));
  return (
    <Modal title={edit ? 'Modifier le questionnaire' : 'Créer un questionnaire'} onClose={onClose}>
      {edit && full.loading && <Loading />}
      {edit && (full.data?.assignments ?? 0) > 0 && <p className="notice">Ce questionnaire a déjà été envoyé : seuls le titre et la description peuvent changer. Pour modifier les questions, dupliquez-le.</p>}
      <Field label="Titre"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Suivi des plantations" /></Field>
      <Field label="Description (facultatif)"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <h3>Questions</h3>
      {qs.map((q, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '.5rem .6rem', marginBottom: '.5rem' }}>
          <div className="toolbar">
            <strong>{i + 1}.</strong>
            <input aria-label={`Question ${i + 1}`} style={{ flex: '1 1 14rem' }} value={q.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Intitulé de la question" />
            <select aria-label="Type de réponse" value={q.type} onChange={(e) => upd(i, { type: e.target.value as QType })}>{Object.entries(QTYPE_FR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label><input type="checkbox" checked={q.required} onChange={(e) => upd(i, { required: e.target.checked })} /> Obligatoire</label>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">↑</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => move(i, 1)} disabled={i === qs.length - 1} aria-label="Descendre">↓</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setQs((l) => l.filter((_, j) => j !== i))} disabled={qs.length === 1} aria-label="Supprimer la question">Supprimer</button>
          </div>
          {(q.type === 'choice' || q.type === 'multi') && <input aria-label="Choix" style={{ width: '100%', marginTop: '.4rem' }} value={q.options} onChange={(e) => upd(i, { options: e.target.value })} placeholder="Choix possibles, séparés par des points-virgules : Maladies; Prix; Autre" />}
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => setQs((l) => [...l, { label: '', type: 'text', options: '', required: false }])}>Ajouter une question</button>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !ok} onClick={() => run(async () => { await post(edit ? `/questionnaires/${edit.id}/update` : '/questionnaires', { title: title.trim(), description: description.trim(), questions: qs.map((q) => ({ label: q.label.trim(), type: q.type, options: q.options, required: q.required })) }); onDone(); })}>Enregistrer le questionnaire</button></div>
    </Modal>
  );
}

function ImportQuestionnaire({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title="Importer un questionnaire" onClose={onClose}>
      <p className="muted">Fichier Excel (.xlsx) ou CSV, une ligne par question : colonnes <strong>Question</strong>, <strong>Type</strong> (Texte, Nombre, Oui/Non, Choix, Choix multiple, Date), <strong>Choix</strong> (séparés par « ; ») et <strong>Obligatoire</strong> (oui/non).</p>
      <p><button className="btn btn-secondary btn-small" onClick={() => download('/questionnaires/template', 'modele-questionnaire.xlsx')}>Télécharger le modèle Excel</button></p>
      <Field label="Fichier"><input ref={file} type="file" accept=".xlsx,.csv" aria-label="Fichier du questionnaire" /></Field>
      <Field label="Titre (facultatif : sinon le nom du fichier)"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy} onClick={() => run(async () => {
          const f = file.current?.files?.[0]; if (!f) throw new Error('Choisir un fichier Excel ou CSV');
          const form = new FormData(); form.append('file', f); if (title.trim()) form.append('title', title.trim());
          await postForm('/questionnaires/import', form); onDone();
        })}>{busy ? 'Importation…' : 'Importer'}</button></div>
    </Modal>
  );
}

function Results({ q, onClose }: { q: Q; onClose: () => void }) {
  const asg = useAsync(async () => (await get<Asg[]>('/producer-assignments')).filter((a) => a.questionnaire_id === q.id), [q.id]);
  const [sel, setSel] = useState<string>('');
  const cur = sel || asg.data?.[0]?.id || '';
  const res = useAsync(() => (cur ? get<any>(`/questionnaires/assignments/${cur}/results`) : Promise.resolve(null)), [cur]);
  return (
    <Modal title={`Résultats : ${q.title}`} onClose={onClose}>
      {asg.loading ? <Loading /> : (
        <>
          <div className="toolbar">
            <select aria-label="Envoi" value={cur} onChange={(e) => setSel(e.target.value)}>{(asg.data ?? []).map((a) => <option key={a.id} value={a.id}>Envoi du {d(a.created_at)} · {a.scope === 'all' ? 'tous' : 'certains'} · {a.done}/{a.targets} fait(s)</option>)}</select>
            {cur && <button className="btn btn-secondary btn-small" onClick={() => download(`/questionnaires/assignments/${cur}/results?format=csv`, 'resultats-questionnaire.csv')}>Exporter (CSV)</button>}
          </div>
          {res.loading ? <Loading /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : res.data && (
            <div style={{ overflow: 'auto', maxHeight: '55vh' }}>
              <Table rows={res.data.rows.map((r: any, i: number) => ({ ...r, id: String(i) }))} empty="Aucun producteur." columns={[
                { header: 'Producteur', render: (r: any) => <><code>{r.internal_code}</code> {r.last_name} {r.first_names}</> },
                { header: 'État', render: (r: any) => (r.status === 'done' ? <Badge tone="ok">Fait le {d(r.answered_at)}</Badge> : <Badge tone="warn">À faire</Badge>) },
                ...res.data.questions.map((qq: Question) => ({ header: qq.label, render: (r: any) => showAnswer(r.answers?.[qq.id]) })),
              ]} />
            </div>
          )}
        </>
      )}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

/** Logos des certifications (fournis par la coopérative) : ils s'impriment en tête des fiches d'inspection interne exportées. */
function CertificationLogos({ onClose }: { onClose: () => void }) {
  const list = useAsync(() => get<{ scheme: string; label: string; has_logo: boolean }[]>('/certification-logos'), []);
  const { busy, error, run } = useAction();
  return (
    <Modal title="Logos des certifications" onClose={onClose}>
      <p className="muted">Téléversez le logo officiel de chaque certification (PNG ou JPEG, 1 Mo maximum). Lors de l'export d'une fiche d'inspection interne, le logo de la certification choisie figure en tête du PDF.</p>
      {list.loading ? <Loading /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : (list.data ?? []).map((c) => (
        <Field key={c.scheme} label={`${c.label}${c.has_logo ? ' — logo enregistré' : ' — aucun logo'}`}>
          <span style={{ display: 'inline-flex', gap: '.5rem', alignItems: 'center' }}>
            <input type="file" accept="image/png,image/jpeg" aria-label={`Logo ${c.label}`} disabled={busy} onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              run(async () => { const form = new FormData(); form.append('file', f); await putForm(`/certification-logos/${c.scheme}`, form); list.reload(); });
            }} />
            {c.has_logo && <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => run(async () => { await del(`/certification-logos/${c.scheme}`); list.reload(); })}>Retirer</button>}
          </span>
        </Field>
      ))}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}
