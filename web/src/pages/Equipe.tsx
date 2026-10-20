import { useState } from 'react';
import { get, post, put } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';
import { dateTime } from '../format';
import { Confirm } from './Declarations';

const ACTIONS: Record<string, string> = { suspend: 'Suspension', reactivate: 'Réactivation', revoke_sessions: 'Sessions révoquées', role_change: 'Changement de rôle' };

export default function Equipe() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ users: await get<any[]>('/users'), roles: can('users:change_role') || can('users:create') ? await get<any[]>('/roles') : [], templates: can('roles:manage') ? await get<any[]>('/roles/templates') : [] }), []);
  const [ask, setAsk] = useState<{ u: any; what: 'suspend' | 'reactivate' | 'revoke-sessions' } | null>(null);
  const [role, setRole] = useState<any | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const mk = useAction();
  return (
    <>
      <PageHeader title="Équipe" subtitle="Accès des utilisateurs : suspension, rôles et historique. Tout changement prend effet immédiatement." />
      {can('users:create') && <div className="toolbar"><button className="btn" onClick={() => setAdding(true)}>Ajouter un utilisateur</button></div>}
      {can('roles:manage') && (data?.templates?.length ?? 0) > 0 && (
        <Card title="Rôles types">
          <p className="muted">Chaque rôle ne donne accès qu'à ce dont le poste a besoin ; le reste du menu reste invisible.</p>
          <Table rows={data!.templates} empty="" columns={[
            { header: 'Rôle', render: (t: any) => <strong>{t.name}</strong> }, { header: 'Fonction', render: (t: any) => t.description },
            { header: 'Ne voit pas', render: (t: any) => t.hidden.join(', ') },
            { header: '', render: (t: any) => t.created ? <Badge tone="ok">Créé</Badge> : <button className="btn btn-small" disabled={mk.busy} onClick={() => mk.run(async () => { await post('/roles/standard', { code: t.code }); reload(); })}>Créer ce rôle</button> },
          ]} />
          {mk.error && <ErrorBox message={mk.error} />}
        </Card>
      )}
      {can('workstations:manage') && <Postes />}
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
      {adding && <AddUser roles={data?.roles ?? []} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {hist && <History u={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function Postes() {
  const { data, loading, error, reload } = useAsync(() => get<any>('/workstations'), []);
  const [creating, setCreating] = useState(false);
  const [revoke, setRevoke] = useState<any | null>(null);
  const act = useAction();
  return (
    <Card title="Postes de travail">
      <p className="muted">Chaque ordinateur ou tablette est associé à la coopérative par un code à 8 caractères (valable 15 minutes, à usage unique) et reçoit un jeton propre, révocable. Poste volé ou perdu : « Révoquer », l'effet est immédiat.</p>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data && (
        <>
          <div className="toolbar">
            <button className="btn" onClick={() => setCreating(true)}>Associer un poste</button>
            <label className="check"><input type="checkbox" checked={data.required} disabled={act.busy} onChange={(e) => act.run(async () => { await put('/workstations/policy', { required: e.target.checked }); reload(); })} /> Rendre l'association obligatoire (un appareil inconnu ou révoqué ne peut plus se connecter, même avec un bon mot de passe)</label>
          </div>
          {act.error && <ErrorBox message={act.error} />}
          <Table rows={data.workstations} empty="Aucun poste associé." columns={[
            { header: 'Poste', render: (w: any) => <strong>{w.name}</strong> }, { header: 'Fonction', render: (w: any) => w.function_label ?? '—' },
            { header: 'Dernière activité', render: (w: any) => (w.last_seen_at ? dateTime(w.last_seen_at) : '—') },
            { header: 'État', render: (w: any) => <Badge tone={w.status === 'active' ? 'ok' : 'bad'}>{w.status === 'active' ? 'Actif' : 'Révoqué'}</Badge> },
            { header: '', render: (w: any) => w.status === 'active' ? <button className="btn btn-small btn-secondary" onClick={() => setRevoke(w)}>Révoquer</button> : <span className="muted">{w.revoked_reason ?? ''}</span> },
          ]} />
        </>
      )}
      {creating && <NewCode onClose={() => { setCreating(false); reload(); }} />}
      {revoke && <Confirm title={`Révoquer le poste « ${revoke.name} »`} reason label="Motif" onClose={() => setRevoke(null)} intro="Ce poste ne pourra plus se connecter tant qu'il n'est pas réassocié." onSubmit={async (reason) => { await post(`/workstations/${revoke.id}/revoke`, { reason }); setRevoke(null); reload(); }} />}
    </Card>
  );
}

function NewCode({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', function_label: '' });
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const { busy, error, run } = useAction();
  return (
    <Modal title="Associer un poste" onClose={onClose}>
      {!code ? (
        <>
          <Field label="Nom du poste" hint="Par exemple Caisse 01, Magasin central, Bureau du directeur."><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Fonction (facultatif)"><input value={f.function_label} onChange={(e) => setF({ ...f, function_label: e.target.value })} /></Field>
          {error && <ErrorBox message={error} />}
          <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button className="btn" disabled={busy || f.name.trim().length < 2} onClick={() => run(async () => setCode(await post('/workstations/pairing-codes', f)))}>Générer le code</button></div>
        </>
      ) : (
        <>
          <p>Sur le poste « {f.name} », écran de connexion → <em>Associer ce poste à la coopérative</em>, puis saisissez :</p>
          <p style={{ fontSize: '2rem', letterSpacing: '.2em', fontWeight: 700, textAlign: 'center' }} aria-live="polite">{code.code}</p>
          <p className="muted">Valable 15 minutes (jusqu'à {dateTime(code.expires_at)}), utilisable une seule fois.</p>
          <div className="modal-foot"><button className="btn" onClick={onClose}>Terminé</button></div>
        </>
      )}
    </Modal>
  );
}

function AddUser({ roles, onClose, onDone }: { roles: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ full_name: '', email: '', password: '', role_id: '' });
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Ajouter un utilisateur" onClose={onClose}>
      <Field label="Nom et prénoms"><input value={f.full_name} onChange={set('full_name')} /></Field>
      <Field label="E-mail (identifiant de connexion)"><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Mot de passe provisoire" hint="10 caractères au minimum. L'utilisateur pourra le changer."><input type="text" value={f.password} onChange={set('password')} /></Field>
      <Field label="Rôle"><select value={f.role_id} onChange={set('role_id')}><option value="">—</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      {roles.length === 0 && <p className="muted">Aucun rôle : créez d'abord un rôle type ci-dessus.</p>}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !f.full_name.trim() || !f.email.includes('@') || f.password.length < 10 || !f.role_id} onClick={() => run(async () => { await post('/users', f); onDone(); })}>Créer le compte</button></div>
    </Modal>
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
