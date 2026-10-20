import { useState } from 'react';
import { get } from '../api';
import { useAuth } from '../auth';
import { OUTCOME, VALIDITY, date, dateTime } from '../format';
import { Card, ErrorBox, Loading, PageHeader, Stat, StatusBadge, Table, useAsync } from '../ui';

export default function Quality() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'inspections' | 'certificates' | 'rules'>('inspections');
  const alerts = useAsync(() => (can('alerts:read') ? get<any>('/alerts') : Promise.resolve(null)), []);
  const c = alerts.data?.counts;
  return (
    <>
      <PageHeader title="Qualité et conformité" subtitle="AgriTrace facilite la collecte des preuves ; il ne remplace pas la décision d'un organisme officiel de certification" />
      {c && (
        <div className="grid">
          <Stat label="Certificats expirés" value={c.certificates_expired} tone={c.certificates_expired ? 'bad' : 'ok'} />
          <Stat label="Certificats expirant bientôt" value={c.certificates_expiring} tone={c.certificates_expiring ? 'warn' : 'ok'} />
          <Stat label="Inspections en retard" value={c.inspections_overdue} tone={c.inspections_overdue ? 'warn' : 'ok'} />
          <Stat label="Actions correctives en retard" value={c.corrective_actions_overdue} tone={c.corrective_actions_overdue ? 'bad' : 'ok'} />
        </div>
      )}
      <div className="tabs" role="tablist">
        {([['inspections', 'Inspections'], ['certificates', 'Certificats'], ['rules', 'Règles qualité']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'inspections' && <Inspections />}
      {tab === 'certificates' && <Certificates />}
      {tab === 'rules' && <Rules />}
    </>
  );
}

const SUBJECT: Record<string, string> = { producer: 'Producteur', collector: 'Collecteur', lot: 'Lot', weighing: 'Pesée', warehouse: 'Magasin', parcel: 'Parcelle' };
const KIND: Record<string, string> = { field: 'Terrain', quality: 'Qualité', compliance: 'Conformité' };
const STATE: Record<string, string> = { planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée' };

function Inspections() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/inspections'), []);
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucune inspection." columns={[
        { header: 'Objet', render: (i) => SUBJECT[i.subject_type] ?? i.subject_type },
        { header: 'Type', render: (i) => KIND[i.kind] ?? i.kind },
        { header: 'État', render: (i) => STATE[i.status] ?? i.status },
        { header: 'Prévue le', render: (i) => date(i.scheduled_for) },
        { header: 'Terminée le', render: (i) => dateTime(i.completed_at) },
        { header: 'Issue', render: (i) => <StatusBadge map={OUTCOME} value={i.outcome} /> },
      ]} />}
    </Card>
  );
}

function Certificates() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => (can('certificates:read') ? get<any[]>('/certificates') : Promise.resolve([])), []);
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun certificat enregistré." columns={[
        { header: 'Schéma', render: (c) => <strong>{c.scheme}</strong> },
        { header: 'Numéro', render: (c) => c.number },
        { header: 'Émetteur', render: (c) => c.issuer },
        { header: 'Émis le', render: (c) => date(c.issued_on) },
        { header: 'Expire le', render: (c) => date(c.expires_on) },
        { header: 'Validité', render: (c) => <StatusBadge map={VALIDITY} value={c.validity} /> },
      ]} />}
    </Card>
  );
}

function Rules() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => (can('quality:read') ? get<any[]>('/quality-rules') : Promise.resolve([])), []);
  const range = (r: any) => (r.kind === 'boolean' ? (r.expected_bool ? 'Oui attendu' : 'Non attendu') : [r.min_value !== null ? `≥ ${Number(r.min_value)}` : '', r.max_value !== null ? `≤ ${Number(r.max_value)}` : ''].filter(Boolean).join(' et ') + (r.unit ? ` ${r.unit}` : ''));
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucune règle." columns={[
        { header: 'Code', render: (r) => r.code }, { header: 'Libellé', render: (r) => r.label },
        { header: 'Seuil', render: (r) => range(r) }, { header: 'Marché', render: (r) => r.market ?? 'Tous' },
        { header: 'Bloquante', render: (r) => (r.blocking ? 'Oui' : 'Non') },
      ]} />}
    </Card>
  );
}
