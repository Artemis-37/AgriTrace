import { useState } from 'react';
import { del, get, post, put } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';
import { dateTime } from '../format';
import { Confirm } from './Declarations';
import { PhotoPick, uploadPhoto } from '../Photo';

const ACTIONS: Record<string, string> = { suspend: 'Suspension', reactivate: 'Réactivation', revoke_sessions: 'Sessions révoquées', role_change: 'Changement de rôle', role_add: 'Rôle ajouté', role_remove: 'Rôle retiré' };

export default function Equipe() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ users: await get<any[]>('/users'), roles: can('users:change_role') || can('users:create') ? await get<any[]>('/roles') : [], templates: can('roles:manage') ? await get<any[]>('/roles/templates') : [] }), []);
  const [ask, setAsk] = useState<{ u: any; what: 'suspend' | 'reactivate' | 'revoke-sessions' } | null>(null);
  const [role, setRole] = useState<any | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [codeFor, setCodeFor] = useState<any | null>(null);
  const [temp, setTemp] = useState<{ email: string; temporary_password: string } | null>(null);
  const mk = useAction();
  const tabs: [string, string][] = [['users', 'Utilisateurs']];
  if (can('roles:manage')) tabs.push(['roles', 'Rôles']);
  if (can('collectors:manage')) tabs.push(['delegues', 'Accès des délégués']);
  if (can('workstations:manage')) tabs.push(['postes', 'Postes de travail']);
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="Utilisateurs et accès" subtitle="Qui peut se connecter, avec quel rôle. Tout changement prend effet immédiatement." />
      {temp && <Modal title="Mot de passe temporaire" onClose={() => setTemp(null)}>
        <p>Communiquez ce mot de passe à <strong>{temp.email}</strong> par un canal sûr. Il ne sera plus affiché ; l'utilisateur devra le remplacer dès sa première connexion.</p>
        <p><code style={{ fontSize: '1.2rem', userSelect: 'all' }}>{temp.temporary_password}</code></p>
        <div className="modal-actions"><button className="btn" onClick={() => setTemp(null)}>J'ai noté le mot de passe</button></div>
      </Modal>}
      <Tabs tabs={tabs as any} value={tab as any} onChange={setTab as any} />
      {tab === 'users' && <>
      {can('users:create') && <div className="toolbar"><button className="btn" onClick={() => setAdding(true)}>Ajouter un utilisateur</button></div>}
      <Card>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Table rows={data?.users ?? []} empty="Aucun utilisateur." columns={[
            { header: 'Code', render: (u) => <code>{u.member_code ?? '—'}</code> }, { header: 'Nom', render: (u) => <strong>{u.full_name}</strong> }, { header: 'E-mail', render: (u) => u.email }, { header: 'Rôles', render: (u) => u.role_name ?? u.role_code },
            { header: 'Accès', render: (u) => <Badge tone={u.membership_status === 'active' ? 'ok' : 'bad'}>{u.membership_status === 'active' ? 'Actif' : 'Suspendu'}</Badge> },
            { header: '', render: (u) => (
              <div className="row-actions"><details className="row-menu" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }}><summary className="btn btn-small btn-secondary">Actions</summary><div className="row-menu-list">
                {can('users:manage') && <button className="row-menu-item" onClick={() => setCodeFor(u)}>Code</button>}
                {can('users:suspend') && u.id !== me?.user.id && (u.membership_status === 'active'
                  ? <button className="row-menu-item" onClick={() => setAsk({ u, what: 'suspend' })}>Suspendre</button>
                  : <button className="row-menu-item" onClick={() => setAsk({ u, what: 'reactivate' })}>Réactiver</button>)}
                {can('users:suspend') && <button className="row-menu-item" onClick={() => setAsk({ u, what: 'revoke-sessions' })}>Révoquer les sessions</button>}
                {can('users:manage') && u.id !== me?.user.id && <button className="row-menu-item" onClick={async () => { if (confirm(`Réinitialiser le mot de passe de ${u.full_name} ? Ses sessions seront fermées.`)) await mk.run(async () => setTemp(await post(`/users/${u.id}/reset-password`))); }}>Réinitialiser le mot de passe</button>}
                {can('users:manage') && u.id !== me?.user.id && <button className="row-menu-item" onClick={async () => { if (confirm(`Retirer la double authentification de ${u.full_name} (téléphone perdu) ? Ses sessions seront fermées ; la personne pourra la reconfigurer.`)) await mk.run(async () => { await post(`/users/${u.id}/reset-2fa`); alert('Double authentification retirée.'); }); }}>Retirer sa double authentification</button>}
                {can('users:change_role') && u.id !== me?.user.id && <button className="row-menu-item" onClick={() => setRole(u)}>Rôles</button>}
                <button className="row-menu-item" onClick={() => setHist(u)}>Historique</button>
              </div></details></div>) },
          ]} />
        )}
      </Card>
      </>}
      {tab === 'roles' && <>
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
      </>}
      {tab === 'delegues' && can('collectors:manage') && <Delegues users={data?.users ?? []} />}
      {tab === 'postes' && can('workstations:manage') && <Postes />}
      {ask && <Confirm title={ask.what === 'suspend' ? `Suspendre ${ask.u.full_name}` : ask.what === 'reactivate' ? `Réactiver ${ask.u.full_name}` : `Révoquer les sessions de ${ask.u.full_name}`} reason label="Motif" onClose={() => setAsk(null)}
        intro={ask.what === 'suspend' ? 'L\'accès cesse immédiatement sur cette coopérative, web et mobile. Les données saisies sont conservées.' : undefined}
        onSubmit={async (reason) => { await post(`/users/${ask.u.id}/${ask.what}`, { reason }); setAsk(null); reload(); }} />}
      {codeFor && <EditCode u={codeFor} onClose={() => setCodeFor(null)} onDone={() => { setCodeFor(null); reload(); }} />}
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

/** Profils des délégués (collecteurs) : code intervenant et provenance habituelle, reprise sur chaque bulletin de pesée. */
function Delegues({ users }: { users: any[] }) {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/collectors'), []);
  const [edit, setEdit] = useState<any | null>(null);
  const [userId, setUserId] = useState('');
  const [origin, setOrigin] = useState('');
  const { busy, error: err, run } = useAction();
  const have = new Set((data ?? []).map((c) => c.user_id));
  const candidates = users.filter((u) => u.membership_status === 'active' && !have.has(u.id));
  return (
    <Card title="Délégués">
      <p className="muted">Le profil d'un délégué porte sa <strong>provenance</strong> (localité ou zone des achats), reprise automatiquement sur les bulletins de pesée. Son code se gère dans la liste des utilisateurs ci-dessous.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucun délégué." columns={[
          { header: 'Code', render: (c: any) => <code>{c.member_code ?? '—'}</code> }, { header: 'Nom', render: (c: any) => <strong>{c.full_name}</strong> },
          { header: 'Provenance', render: (c: any) => c.origin ?? '—' },
          { header: '', render: (c: any) => <button className="btn btn-small btn-secondary" onClick={() => { setEdit(c); setOrigin(c.origin ?? ''); }}>Provenance</button> },
        ]} />
      )}
      <h4>Créer un profil de délégué</h4>
      <Field label="Utilisateur"><select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">—</option>{candidates.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.member_code ? ` (${u.member_code})` : ''}</option>)}</select></Field>
      <Field label="Provenance (localité, zone)"><input value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={80} /></Field>
      {err && <ErrorBox message={err} />}
      <button className="btn" disabled={busy || !userId} onClick={() => run(async () => { await post('/collectors', { user_id: userId, ...(origin.trim() && { origin: origin.trim() }) }); setUserId(''); setOrigin(''); reload(); })}>Créer le profil</button>
      {edit && (
        <Modal title={`Provenance de ${edit.full_name}`} onClose={() => setEdit(null)}>
          <Field label="Provenance" hint="S'applique aux prochains bulletins ; les réceptions passées gardent la leur."><input value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={80} /></Field>
          <div className="modal-foot"><button className="btn btn-secondary" onClick={() => setEdit(null)}>Annuler</button>
            <button className="btn" disabled={busy || !origin.trim()} onClick={() => run(async () => { await put(`/collectors/${edit.id}/origin`, { origin: origin.trim() }); setEdit(null); setOrigin(''); reload(); })}>Enregistrer</button></div>
        </Modal>
      )}
    </Card>
  );
}

function EditCode({ u, onClose, onDone }: { u: any; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(u.member_code ?? '');
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Code de ${u.full_name}`} onClose={onClose}>
      <Field label="Code (identifiant dans la coopérative)" hint="2 à 30 caractères : majuscules, chiffres et tirets. Il figure notamment sur les bulletins de pesée."><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={30} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)} onClick={() => run(async () => { await put(`/users/${u.id}/member-code`, { code }); onDone(); })}>Enregistrer</button></div>
    </Modal>
  );
}

function AddUser({ roles, onClose, onDone }: { roles: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ last_name: '', first_names: '', phone: '', email: '', password: '', member_code: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  // Obligatoires : nom, prénoms, code (et un rôle, qui détermine les droits). L'accès à l'application (e-mail + mot de passe) est facultatif.
  const accessOk = (!f.email.trim() && !f.password) || (f.email.includes('@') && f.password.length >= 10);
  const codeOk = /^[A-Z0-9][A-Z0-9-]{1,29}$/.test(f.member_code.trim());
  const full = `${f.last_name.trim()} ${f.first_names.trim()}`;
  return (
    <Modal title="Ajouter une personne" onClose={onClose}>
      <div className="new-person"><PhotoPick file={photo} onChange={setPhoto} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label="Nom *"><input value={f.last_name} onChange={set('last_name')} maxLength={100} /></Field>
          <Field label="Prénoms *"><input value={f.first_names} onChange={set('first_names')} maxLength={100} /></Field>
          <Field label="Code *" hint="2 à 30 caractères : majuscules, chiffres et tirets."><input value={f.member_code} onChange={(e) => setF({ ...f, member_code: e.target.value.toUpperCase() })} maxLength={30} /></Field>
        </div></div>
      <p className="muted" style={{ margin: '.2rem 0 .6rem' }}>Le reste est facultatif. Sans e-mail ni mot de passe, la personne est enregistrée sans accès à l'application.</p>
      <Field label="Contact (téléphone)"><input inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={30} /></Field>
      <Field label="E-mail (identifiant de connexion)"><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Mot de passe provisoire" hint="10 caractères au minimum, avec l'e-mail. La personne pourra le changer."><input type="text" value={f.password} onChange={set('password')} /></Field>
      <Field label="Rôles *" hint="Cochez un ou plusieurs rôles : les droits s'additionnent et le menu n'affiche que ce qu'ils permettent.">
        <div className="role-pick">{roles.map((r) => <label key={r.id} className="check"><input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name}</label>)}</div></Field>
      {roles.length === 0 && <p className="muted">Aucun rôle : créez d'abord un rôle type ci-dessus.</p>}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !f.last_name.trim() || !f.first_names.trim() || !codeOk || !accessOk || picked.length === 0} onClick={() => run(async () => {
          const hasAccess = !!f.email.trim() && !!f.password;
          const u = await post<any>('/users', { full_name: full, ...(f.phone.trim() && { phone: f.phone.trim() }), ...(hasAccess && { email: f.email.trim(), password: f.password }), role_id: picked[0], role_ids: picked.slice(1), member_code: f.member_code.trim() });
          if (photo) { try { await uploadPhoto('user', u.id, photo); } catch (e: any) { throw new Error(`${full} est enregistré, mais la photo n'a pas été envoyée (${e?.message ?? e}).`); } }
          onDone();
        })}>Enregistrer</button></div>
    </Modal>
  );
}

function ChangeRole({ u, roles, onClose, onDone }: { u: any; roles: any[]; onClose: () => void; onDone: () => void }) {
  const [roleId, setRoleId] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const mine: string[] = u.role_ids ?? [];
  const names = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const ok = reason.trim().length >= 3;
  return (
    <Modal title={`Rôles de ${u.full_name}`} onClose={onClose}>
      <p className="muted">Une personne peut cumuler plusieurs rôles : ses droits sont la somme de ceux de ses rôles, et son menu ne montre que ce qu'ils permettent.</p>
      <div className="role-chips">
        {mine.map((id) => (
          <span key={id} className="chip">{names(id)}
            {mine.length > 1 && <button className="btn btn-small btn-ghost" title="Retirer ce rôle" disabled={busy || !ok} onClick={() => run(async () => { await del(`/users/${u.id}/roles/${id}?reason=${encodeURIComponent(reason)}`); onDone(); })}>Retirer</button>}
          </span>))}
      </div>
      <Field label="Ajouter un rôle"><select value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">—</option>{roles.filter((r) => !mine.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Motif (obligatoire pour ajouter ou retirer)"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Fermer</button>
        <button className="btn" disabled={busy || !roleId || !ok} onClick={() => run(async () => { await post(`/users/${u.id}/roles`, { role_id: roleId, reason }); onDone(); })}>Ajouter le rôle</button></div>
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
