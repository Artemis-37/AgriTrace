import { FormEvent, useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';
import DocumentsPanel from './DocumentsPanel';

type Tab = 'distribution' | 'training' | 'social_infrastructure' | 'catalogue';
const LABEL: Record<Tab, string> = { distribution: 'Distributions', training: 'Formations', social_infrastructure: 'Infrastructures sociales', catalogue: 'Catalogue des articles' };
const GROUPS: Record<string, string[]> = {
  Finance: ['Bourses', 'Crédit', 'Primes', 'Prêts', 'Subventions'], 'Intrants et Outils': [], 'Services et Dépistages': [],
};
const CUR: Record<string, string> = { unit: 'unités', XOF: 'FCFA', EUR: '€', USD: '$' };

/** Données saisies sur le terrain par les coachs : distributions, formations, infrastructures sociales, et catalogue des articles. */
export default function Terrain() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can('field_records:read') ? 'distribution' : 'catalogue');
  const [detail, setDetail] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const manage = can('field_records:manage');
  const kind = tab === 'catalogue' ? null : tab;
  const { data, loading, error, reload } = useAsync(() => (kind ? get<any[]>(`/field-records?kind=${kind}`) : get<any[]>('/distribution-articles')), [tab]);
  const act = useAction();
  const tabs = (['distribution', 'training', 'social_infrastructure', 'catalogue'] as Tab[]).map((k) => [k, LABEL[k]] as [Tab, string]);

  return (
    <>
      <PageHeader title="Données de terrain" subtitle="Distributions, formations et infrastructures enregistrées par les coachs ; catalogue des articles distribuables"
        actions={tab === 'catalogue' && manage ? <button className="btn" onClick={() => setAdding(true)}>Ajouter un article</button> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <Card>
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
      </Card>
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
        <Field label="Catégorie"><select value={category} onChange={(e) => { setCategory(e.target.value); setGroup(GROUPS[e.target.value]?.[0] ?? ''); }}>{Object.keys(GROUPS).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Groupe" hint="Choisissez un groupe existant ou saisissez-en un nouveau"><input list="groupes" value={group} onChange={(e) => setGroup(e.target.value)} required /><datalist id="groupes">{(GROUPS[category] ?? []).map((g) => <option key={g} value={g} />)}</datalist></Field>
        <Field label="Article"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} /></Field>
        <Field label="Unité (facultatif)"><input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} placeholder="sac de 50 kg, litre…" /></Field>
        {act.error && <ErrorBox message={act.error} />}
        <button className="btn" disabled={act.busy}>Ajouter</button>
      </form>
    </Modal>
  );
}
