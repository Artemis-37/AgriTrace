import { FormEvent, useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';
import DocumentsPanel from './DocumentsPanel';

type Tab = 'distribution' | 'training' | 'social_infrastructure' | 'catalogue' | 'modeles';
const LABEL: Record<Tab, string> = { distribution: 'Distributions', training: 'Formations', social_infrastructure: 'Infrastructures sociales', catalogue: 'Catalogue des articles', modeles: 'Modèles de saisie' };
const GROUPS: Record<string, string[]> = {
  Finance: ['Bourses', 'Crédit', 'Primes', 'Prêts', 'Subventions'], 'Intrants et Outils': [], 'Services et Dépistages': [],
};
const CUR: Record<string, string> = { unit: 'unités', XOF: 'FCFA', EUR: '€', USD: '$' };

/** Données saisies sur le terrain par les coachs : distributions, formations, infrastructures sociales, et catalogue des articles. */
export default function Terrain() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can('field_records:read') ? 'distribution' : can('field_templates:manage') ? 'modeles' : 'catalogue');
  const [detail, setDetail] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const manage = can('field_records:manage');
  const kind = tab === 'catalogue' || tab === 'modeles' ? null : tab;
  const { data, loading, error, reload } = useAsync(() => (tab === 'modeles' ? Promise.resolve([]) : kind ? get<any[]>(`/field-records?kind=${kind}`) : get<any[]>('/distribution-articles')), [tab]);
  const act = useAction();
  const tabs = (['distribution', 'training', 'social_infrastructure', 'catalogue', ...(can('field_templates:manage') ? ['modeles'] : [])] as Tab[]).map((k) => [k, LABEL[k]] as [Tab, string]);

  return (
    <>
      <PageHeader title="Données de terrain" subtitle="Distributions, formations et infrastructures enregistrées par les coachs ; catalogue des articles distribuables"
        actions={tab === 'catalogue' && manage ? <button className="btn" onClick={() => setAdding(true)}>Ajouter un article</button> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'modeles' && <Templates />}
      {tab !== 'modeles' && <Card>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {act.error && <ErrorBox message={act.error} />}
        {loading ? <Loading /> : tab === 'catalogue' ? (
          <Table rows={data ?? []} empty="Le catalogue est vide : ajoutez les articles que les coachs pourront distribuer." columns={[
            { header: 'Catégorie', render: (a) => a.category }, { header: 'Groupe', render: (a) => a.group_name }, { header: 'Article', render: (a) => <strong>{a.name}</strong> },
            { header: 'Unité', render: (a) => a.unit ?? '—' },
            ...(manage ? [{ header: '', render: (a: any) => <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={async () => { if (confirm(`Retirer « ${a.name} » du catalogue ?`)) { if (await act.run(() => post(`/distribution-articles/${a.id}/retirer`))) reload(); } }}>Retirer</button> }] : []),
          ]} />
        ) : (
          <Table rows={data ?? []} empty="Aucun enregistrement." columns={[
            { header: 'Date', render: (r) => dateTime(r.created_at) },
            { header: tab === 'distribution' ? 'Distribution' : tab === 'training' ? 'Formation' : 'Infrastructure', render: (r) => <button className="btn btn-ghost btn-small" onClick={() => setDetail(r)}><strong>{r.title}</strong></button> },
            { header: tab === 'distribution' ? 'Bénéficiaire' : tab === 'training' ? 'Participants' : 'Position', render: (r) => tab === 'distribution' ? (r.data?.producer_name ?? '—') : tab === 'training' ? `${(r.data?.participants ?? []).length}` : (r.latitude != null ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : '—') },
            { header: 'Enregistré par', render: (r) => r.created_by_name ?? '—' },
          ]} />
        )}
      </Card>}
      {adding && <AddArticle onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <p className="muted">{dateTime(detail.created_at)} · {detail.created_by_name ?? ''}</p>
          {detail.kind === 'distribution' && (
            <>
              <p><strong>{detail.data?.producer_name}</strong> <Badge tone="info">{detail.data?.category}</Badge></p>
              <Table rows={detail.data?.items ?? []} columns={[
                { header: 'Article', render: (i: any) => i.name }, { header: 'Groupe', render: (i: any) => i.group ?? '—' },
                { header: 'Quantité', align: 'right', render: (i: any) => `${i.quantity} ${CUR[i.currency] ?? ''}` },
              ]} />
            </>
          )}
          {detail.kind === 'training' && (
            <>
              <p>Module : {detail.data?.module || '—'}</p>
              <Table rows={detail.data?.participants ?? []} columns={[
                { header: 'Participant', render: (p: any) => p.name }, { header: 'Rôle', render: (p: any) => (p.role === 'principal' ? 'Agriculteur principal' : 'Partie prenante') }, { header: 'Score', align: 'right', render: (p: any) => p.score ?? '—' },
              ]} />
            </>
          )}
          {detail.kind === 'social_infrastructure' && (
            <Table rows={Object.entries(detail.data ?? {})} columns={[{ header: 'Question', render: ([k]: any) => k }, { header: 'Réponse', render: ([, v]: any) => String(v) }]} />
          )}
          <DocumentsPanel subjectType="field_record" subjectId={detail.id} kinds={['Preuve de distribution', 'Signature du bénéficiaire', 'Photo de la formation', 'Photo']} locked />
        </Modal>
      )}
    </>
  );
}

function AddArticle({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState('Finance');
  const [group, setGroup] = useState('Primes');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const act = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await act.run(() => post('/distribution-articles', { category, group_name: group.trim(), name: name.trim(), ...(unit.trim() ? { unit: unit.trim() } : {}) }))) onDone();
  };
  return (
    <Modal title="Ajouter un article au catalogue" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <Field label="Catégorie" hint="Choisissez une catégorie existante ou saisissez-en une nouvelle"><input list="categories" value={category} onChange={(e) => { setCategory(e.target.value); if (GROUPS[e.target.value]) setGroup(GROUPS[e.target.value][0] ?? ''); }} required maxLength={80} /><datalist id="categories">{Object.keys(GROUPS).map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Groupe" hint="Choisissez un groupe existant ou saisissez-en un nouveau"><input list="groupes" value={group} onChange={(e) => setGroup(e.target.value)} required /><datalist id="groupes">{(GROUPS[category] ?? []).map((g) => <option key={g} value={g} />)}</datalist></Field>
        <Field label="Article"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} /></Field>
        <Field label="Unité (facultatif)"><input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} placeholder="sac de 50 kg, litre…" /></Field>
        {act.error && <ErrorBox message={act.error} />}
        <button className="btn" disabled={act.busy}>Ajouter</button>
      </form>
    </Modal>
  );
}

type Q = { key: string; label: string; type: 'text' | 'number' | 'select'; required: boolean; options: string[] };
const slug = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 30);

/** Modèles que l'ADG rédige pour sa coopérative puis déploie vers les coachs (infrastructures, thèmes de formation). */
function Templates() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/field-templates?all=1'), []);
  const [edit, setEdit] = useState<{ kind: 'infrastructure' | 'training_theme'; row?: any } | null>(null);
  const act = useAction();
  const rows = (data ?? []).filter((r) => r.active);
  const state = (r: any) => (r.deployed_at == null ? <Badge tone="warn">Brouillon</Badge> : r.modified_since_deploy ? <Badge tone="warn">Modifié, à redéployer (v{r.version})</Badge> : <Badge tone="ok">Déployé v{r.version}</Badge>);
  return (
    <Card>
      <p className="muted">Ces modèles sont propres à votre coopérative. Un modèle n'est visible des coachs qu'après son <strong>déploiement</strong> ; ils le reçoivent dès qu'ils ouvrent l'écran concerné avec du réseau (puis il reste disponible hors connexion). Les enregistrements déjà faits ne changent pas.</p>
      <div className="toolbar">
        <button className="btn" onClick={() => setEdit({ kind: 'infrastructure' })}>Nouvelle catégorie d'infrastructure</button>
        <button className="btn btn-secondary" onClick={() => setEdit({ kind: 'training_theme' })}>Nouveau thème de formation</button>
        <button className="btn btn-ghost" disabled={act.busy} onClick={async () => { if (await act.run(() => post('/field-templates/defaults'))) reload(); }}>Charger les modèles de départ</button>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading ? <Loading /> : (
        <Table rows={rows} empty="Aucun modèle. Chargez les modèles de départ (École, thèmes de formation) ou créez les vôtres." columns={[
          { header: 'Type', render: (r) => (r.kind === 'infrastructure' ? 'Infrastructure' : 'Thème de formation') },
          { header: 'Catégorie', render: (r) => <button className="btn btn-ghost btn-small" onClick={() => setEdit({ kind: r.kind, row: r })}><strong>{r.category}</strong></button> },
          { header: 'Contenu', render: (r) => (r.kind === 'infrastructure' ? `${r.definition.questions.length} questions` : `${r.definition.modules.length} modules`) },
          { header: 'État', render: state },
          { header: '', render: (r) => (
            <span className="row-actions">
              <button className="btn btn-small" disabled={act.busy || (r.deployed_at != null && !r.modified_since_deploy)} onClick={async () => { if (await act.run(() => post(`/field-templates/${r.id}/deployer`))) reload(); }}>Déployer</button>
              <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={async () => { if (confirm(`Retirer « ${r.category} » ? Les coachs ne le verront plus.`)) { if (await act.run(() => post(`/field-templates/${r.id}/retirer`))) reload(); } }}>Retirer</button>
            </span>) },
        ]} />
      )}
      {edit && <TemplateEditor kind={edit.kind} row={edit.row} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function TemplateEditor({ kind, row, onClose, onDone }: { kind: 'infrastructure' | 'training_theme'; row?: any; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<string>(row?.category ?? '');
  const [qs, setQs] = useState<Q[]>(kind === 'infrastructure' ? (row?.definition.questions ?? [{ key: 'nom', label: 'Nom', type: 'text', required: true, options: [] }]) : []);
  const [modules, setModules] = useState<string>((row?.definition.modules ?? []).join('\n'));
  const act = useAction();
  const set = (i: number, patch: Partial<Q>) => setQs((a) => a.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: number) => setQs((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const definition = kind === 'infrastructure'
      ? { questions: qs.map((q) => ({ ...q, key: q.key || slug(q.label), options: q.type === 'select' ? q.options : [] })) }
      : { modules: modules.split('\n').map((m) => m.trim()).filter(Boolean) };
    if (await act.run(() => post('/field-templates', { kind, category: category.trim(), definition }))) onDone();
  };
  return (
    <Modal title={row ? `Modifier « ${row.category} »` : kind === 'infrastructure' ? "Nouvelle catégorie d'infrastructure" : 'Nouveau thème de formation'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <Field label={kind === 'infrastructure' ? "Catégorie (École, Centre de santé, Point d'eau…)" : 'Thème de formation'}>
          <input value={category} onChange={(e) => setCategory(e.target.value)} required maxLength={120} readOnly={!!row} />
        </Field>
        {kind === 'training_theme' ? (
          <Field label="Modules (un par ligne)" hint="Laissez vide pour que le coach saisisse le module librement"><textarea rows={10} value={modules} onChange={(e) => setModules(e.target.value)} /></Field>
        ) : (
          <>
            {qs.map((q, i) => (
              <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}>
                <Field label={`Question ${i + 1}`}><input value={q.label} onChange={(e) => set(i, { label: e.target.value, ...(q.key === '' || q.key === slug(q.label) ? { key: slug(e.target.value) } : {}) })} required maxLength={300} /></Field>
                <div className="toolbar">
                  <select aria-label="Type de réponse" value={q.type} onChange={(e) => set(i, { type: e.target.value as Q['type'] })}><option value="text">Texte</option><option value="number">Nombre</option><option value="select">Liste de choix</option></select>
                  <label><input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} /> Obligatoire</label>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => move(i, -1)} aria-label="Monter">↑</button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => move(i, 1)} aria-label="Descendre">↓</button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setQs((a) => a.filter((_, j) => j !== i))}>Supprimer</button>
                </div>
                {q.type === 'select' && <Field label="Choix (séparés par des virgules)"><input value={q.options.join(', ')} onChange={(e) => set(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} placeholder="Oui, Non" /></Field>}
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={() => setQs((a) => [...a, { key: '', label: '', type: 'text', required: true, options: [] }])}>Ajouter une question</button>
          </>
        )}
        {act.error && <ErrorBox message={act.error} />}
        <button className="btn" disabled={act.busy}>Enregistrer le brouillon</button>
        <small className="muted">L'enregistrement ne change rien pour les coachs : utilisez ensuite « Déployer ».</small>
      </form>
    </Modal>
  );
}
