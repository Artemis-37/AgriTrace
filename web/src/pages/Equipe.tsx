import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';
import { dateTime } from '../format';
import { Confirm } from './Declarations';

const ACTIONS: Record<string, string> = { suspend: 'Suspension', reactivate: 'Réactivation', revoke_sessions: 'Sessions révoquées', role_change: 'Changement de rôle' };

export default function Equipe() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ users: await get<any[]>('/users'), roles: can('users:change_role') ? await get<any[]>('/roles') : [] }), []);
  const [ask, setAsk] = useState<{ u: any; what: 'suspend' | 'reactivate' | 'revoke-sessions' } | null>(null);
  const [role, setRole] = useState<any | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  return (
    <>
      <PageHeader title="Équipe" subtitle="Accès des utilisateurs : suspension, rôles et historique. Tout changement prend effet immédiatement." />
      <Card>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Table rows={data?.users ?? []} empty="Aucun utilisateur." columns={[
            { header: 'Nom', render: (u) => <strong>{u.full_name}</strong> }, { header: 'E-mail', render: (u) => u.email }, { header: 'Rôle', render: (u) => u.role_code },
            { header: 'Accès', render: (u) => <Badge tone={u.membership_status === 'active' ? 'ok' : 'bad'}>{u.membership_status === 'active' ? 'Actif' : 'Suspendu'}</Badge> },
            { header: '', render: (u) => (
              <div className="row-actions">
                {can('users:suspend') && u.id !== me?.user.id && (u.membership_status === 'active'
                  ? <button className="btn btn-small btn-secondary" onClick={() => setAsk({ u, what: 'suspend' })}>Suspendre</button>
                  : <button className="btn btn-small btn-secondary" onClick={() => setAsk({ u, what: 'reactivate' })}>Réactiver</button>)}
                {can('users:suspend') && <button className="btn btn-small btn-secondary" onClick={() => setAsk({ u, what: 'revoke-sessions' })}>Révoquer les sessions</button>}
                {can('users:change_role') && u.id !== me?.user.id && <button className="btn btn-small btn-secondary" onClick={() => setRole(u)}>Rôle</button>}
                <button className="btn btn-small btn-ghost" onClick={() => setHist(u)}>Historique</button>
              </div>) },
          ]} />
        )}
      </Card>
      {ask && <Confirm title={ask.what === 'suspend' ? `Suspendre ${ask.u.full_name}` : ask.what === 'reactivate' ? `Réactiver ${ask.u.full_name}` : `Révoquer les sessions de ${ask.u.full_name}`} reason label="Motif" onClose={() => setAsk(null)}
        intro={ask.what === 'suspend' ? 'L\'accès cesse immédiatement sur cette coopérative, web et mobile. Les données saisies sont conservées.' : undefined}
        onSubmit={async (reason) => { await post(`/users/${ask.u.id}/${ask.what}`, { reason }); setAsk(null); reload(); }} />}
      {role && <ChangeRole u={role} roles={data?.roles ?? []} onClose={() => setRole(null)} onDone={() => { setRole(null); reload(); }} />}
      {hist && <History u={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function ChangeRole({ u, roles, onClose, onDone }: { u: any; roles: any[]; onClose: () => void; onDone: () => void }) {
  const [roleId, setRoleId] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Rôle de ${u.full_name}`} onClose={onClose}>
      <p className="muted">Rôle actuel : {u.role_code}</p>
      <Field label="Nouveau rôle"><select value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">—</option>{roles.filter((r) => r.code !== u.role_code).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Motif"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !roleId || reason.trim().length < 3} onClick={() => run(async () => { await post(`/users/${u.id}/role`, { role_id: roleId, reason }); onDone(); })}>Changer le rôle</button></div>
    </Modal>
  );
}

function History({ u, onClose }: { u: any; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => get<any[]>(`/users/${u.id}/access-history`), [u.id]);
  return (
    <Modal title={`Historique d'accès — ${u.full_name}`} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}
      {data && <Table rows={data} empty="Aucun événement." columns={[{ header: 'Date', render: (e: any) => dateTime(e.created_at) }, { header: 'Action', render: (e: any) => ACTIONS[e.action] ?? e.action }, { header: 'Par', render: (e: any) => e.actor_name ?? '—' }, { header: 'Motif', render: (e: any) => e.reason ?? '—' }]} />}
    </Modal>
  );
}
