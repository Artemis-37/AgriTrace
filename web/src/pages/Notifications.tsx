import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import { targetOf } from '../notifTarget';
import { useAuth } from '../auth';
import { SEVERITY, dateTime } from '../format';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, useAction, useAsync } from '../ui';

export default function Notifications({ onChange }: { onChange?: () => void }) {
  const { can } = useAuth();
  const [showRead, setShowRead] = useState(false);
  const unread = !showRead;
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/notifications${unread ? '?unread=true' : ''}`), [unread]);
  const act = useAction();
  const done = () => { reload(); onChange?.(); };
  return (
    <>
      <PageHeader title="Notifications" subtitle="Alertes qui vous concernent : anomalies, échéances, validations en attente"
        actions={<>
          {can('notifications:scan') && <button className="btn btn-secondary" disabled={act.busy} onClick={() => act.run(async () => { await post('/notifications/scan'); done(); })}>Lancer le contrôle des alertes</button>}
          <button className="btn btn-secondary" disabled={act.busy} onClick={() => act.run(async () => { await post('/notifications/read-all'); done(); })}>Tout marquer comme lu</button>
        </>} />
      <Card>
        <div className="toolbar"><label><input type="checkbox" checked={showRead} onChange={(e) => setShowRead(e.target.checked)} /> Afficher aussi l'historique (déjà traitées)</label></div>
        {(error || act.error) && <ErrorBox message={(error ?? act.error)!} onRetry={reload} />}
        {loading ? <Loading /> : !data?.length ? <Empty>Rien à traiter.</Empty> : (
          <ul className="list">
            {data.map((n) => (
              <li key={n.id} style={{ opacity: n.read_at ? 0.6 : 1 }}>
                <button className="link notif-open" aria-label={`Traiter : ${n.title}`} onClick={() => act.run(async () => { if (!n.read_at) await post(`/notifications/${n.id}/read`); onChange?.(); nav(targetOf(n)); })}>
                <Badge tone={SEVERITY[n.severity] ?? 'neutral'}>{n.severity === 'critical' ? 'Critique' : n.severity === 'warning' ? 'Attention' : 'Info'}</Badge>{' '}
                <strong>{n.title}</strong>{!n.read_at && <> <Badge tone="info">Nouveau</Badge></>}
                {n.body && <div className="muted">{n.body}</div>}
                <small className="muted">{dateTime(n.created_at)}</small>
                </button>{' '}
                {!n.read_at && <button className="btn btn-small btn-secondary" onClick={() => act.run(async () => { await post(`/notifications/${n.id}/read`); done(); })}>Écarter</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
