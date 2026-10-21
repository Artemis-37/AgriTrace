import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { PARCEL_LEVEL, date, ha } from '../format';
import { Badge, Card, ErrorBox, Loading, Modal, PageHeader, StatusBadge, Table, useAsync } from '../ui';
import { Confirm } from './Declarations';

export default function Parcels() {
  const { can } = useAuth();
  const [level, setLevel] = useState('');
  const [act, setAct] = useState<{ p: any; kind: 'control' | 'verify' } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [parcels, producers, checks] = await Promise.all([get<any[]>('/parcels'), get<any[]>('/producers').catch(() => []), get<any>('/parcels/checks').catch(() => null)]);
    const names = new Map(producers.map((p) => [p.id, `${p.last_name} ${p.first_names}`]));
    return { parcels: parcels.map((p) => ({ ...p, producer_name: names.get(p.producer_id) ?? '—' })), checks };
  }, []);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const { parcels, checks } = data;
  const rows = parcels.filter((p) => !level || p.verification_status === level);
  const c = checks?.counts;

  return (
    <>
      <PageHeader title="Parcelles" subtitle="Données déclarées, contrôlées puis vérifiées par une inspection de terrain" />
      {c && (c.missing_coordinates + c.potential_duplicates + c.inconsistent_area > 0) && (
        <p className="notice">
          Contrôles de données : {c.missing_coordinates} sans coordonnées GPS · {c.potential_duplicates} doublon(s) potentiel(s) · {c.inconsistent_area} superficie(s) incohérente(s).
        </p>
      )}
      <Card>
        <div className="toolbar">
          <select aria-label="Filtrer par niveau" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Tous les niveaux</option>
            {Object.entries(PARCEL_LEVEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <Table rows={rows} empty="Aucune parcelle." columns={[
          { header: 'Code', render: (p) => <button className="btn btn-ghost btn-small" onClick={() => setDetail(p.id)}><strong>{p.code}</strong></button> },
          { header: 'Producteur', render: (p) => p.producer_name },
          { header: 'Déclarée', align: 'right', render: (p) => ha(p.declared_area_ha) },
          { header: 'Mesurée', align: 'right', render: (p) => ha(p.geometry_area_ha) },
          { header: 'GPS', render: (p) => (p.latitude ? <Badge tone="ok">Oui</Badge> : <Badge tone="warn">Manquant</Badge>) },
          { header: 'Niveau', render: (p) => <StatusBadge map={PARCEL_LEVEL} value={p.verification_status} /> },
          { header: 'Enregistrée', render: (p) => date(p.registered_on) },
          { header: '', render: (p) => (
            <div className="row-actions">
              {p.verification_status === 'declared' && can('parcels:control') && <button className="btn btn-small btn-secondary" onClick={() => setAct({ p, kind: 'control' })}>Contrôler</button>}
              {p.verification_status === 'controlled' && can('parcels:verify') && <button className="btn btn-small" onClick={() => setAct({ p, kind: 'verify' })}>Vérifier</button>}
            </div>
          ) },
        ]} />
      </Card>
      {act && (
        <Confirm title={act.kind === 'control' ? `Contrôler ${act.p.code}` : `Vérifier ${act.p.code}`} reason optional label="Note (facultative)"
          intro={act.kind === 'control' ? 'Le contrôle exige des coordonnées GPS et une superficie mesurée cohérente avec la superficie déclarée.' : 'La vérification exige une inspection de terrain conforme, terminée après la dernière modification de la parcelle.'}
          onClose={() => setAct(null)}
          onSubmit={async (note) => { await post(`/parcels/${act.p.id}/${act.kind}`, note ? { note } : {}); setAct(null); reload(); }} />
      )}
      {detail && <ParcelDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function ParcelDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => get<any>(`/parcels/${id}`), [id]);
  const versions = useAsync(() => get<any[]>(`/parcels/${id}/geometry-versions`), [id]);
  const EVENT: Record<string, string> = { created: 'Créée', updated: 'Modifiée', controlled: 'Contrôlée', verified: 'Vérifiée', reset: 'Remise à « déclarée »', archived: 'Archivée' };
  return (
    <Modal title={data ? `Parcelle ${data.code}` : 'Parcelle'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}
      {data && (
        <>
          <p>Déclarée : {ha(data.declared_area_ha)} · Mesurée : {ha(data.geometry_area_ha)} · {data.latitude ? `GPS ${data.latitude}, ${data.longitude}` : 'GPS manquant'}</p>
          <h3>Historique</h3>
          <ul className="plain">{data.history.map((h: any, i: number) => <li key={i}>{new Date(h.at).toLocaleString('fr-FR')} — {EVENT[h.event] ?? h.event}</li>)}</ul>
          <h3>Versions du tracé ({versions.data?.length ?? 0})</h3>
          {versions.data?.length ? <ul className="plain">{versions.data.map((v: any) => <li key={v.version}>Version {v.version} — {new Date(v.changed_at).toLocaleString('fr-FR')} — {ha(v.area_ha)}{v.actor_name ? ` — ${v.actor_name}` : ''}{v.reason ? ` — ${v.reason}` : ''}</li>)}</ul> : <p className="muted">Aucun tracé enregistré.</p>}
          <h3>Inspections ({data.inspections.length})</h3>
          {data.inspections.length ? <ul className="plain">{data.inspections.map((i: any) => <li key={i.id}>{i.kind} — {i.status}{i.outcome ? ` — ${i.outcome}` : ''}</li>)}</ul> : <p className="muted">Aucune inspection.</p>}
        </>
      )}
    </Modal>
  );
}
