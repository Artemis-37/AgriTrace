import { get } from '../api';
import { Card, ErrorBox, Loading, useAsync } from '../ui';
import { date } from '../format';

const FR = (v: any, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d }));

/** Fiche d'un producteur de la base importée par la coopérative, ouverte en fenêtre liée. */
export default function ProducerCard({ id }: { id: string }) {
  const { data: p, loading, error, reload } = useAsync(() => get<any>(`/producers/${id}`), [id]);
  if (loading) return <Loading />;
  if (error || !p) return <ErrorBox message={error ?? 'Fiche indisponible'} onRetry={reload} />;
  const rows: [string, any][] = [
    ['Code', p.internal_code], ['Nom & prénoms', `${p.last_name} ${p.first_names}`], ['Section', p.section ?? '—'], ['Village', p.village ?? '—'],
    ['Département', p.department ?? '—'], ['Région', p.region ?? '—'], ['Téléphone', p.phone ?? '—'],
    ['Superficie (ha)', FR(p.area_ha)], ['Estimation de production (kg)', FR(p.estimated_kg, 0)],
    ["Date d'adhésion", p.joined_on ? date(p.joined_on) : '—'], ['Statut', p.status === 'active' ? 'Actif' : p.status === 'suspended' ? 'Suspendu' : 'Sorti'],
  ];
  return (
    <Card>
      <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Card>
  );
}
