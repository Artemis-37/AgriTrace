import { useState } from 'react';
import { get, post, postForm } from '../api';
import { useAuth } from '../auth';
import { dateTime, kg, money } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Stat, Table, Tabs, useAction, useAsync } from '../ui';

/** Console du serveur central (administrateur de plateforme) : sites reliés et vue consolidée de toutes les coopératives. */
export default function CentralConsole() {
  const { me, signOut } = useAuth();
  const [tab, setTab] = useState<'orgs' | 'sites' | 'conso' | 'transferts'>('orgs');
  return (
    <div className="shell">
      <aside className="sidebar open">
        <div className="brand"><strong>Agri<span>Trace</span></strong><small>Serveur central</small></div>
        <div className="who"><strong>Administrateur de plateforme</strong><br />{me?.user.full_name}
          <div><button className="btn btn-ghost btn-small" onClick={signOut}>Se déconnecter</button></div></div>
      </aside>
      <main className="main">
        <PageHeader title="Serveur central" subtitle="Les coopératives gardent leur serveur local ; leurs données arrivent ici et se consolident." />
        <Tabs tabs={[['orgs', 'Coopératives et exportateurs'], ['sites', 'Sites reliés'], ['conso', 'Vue consolidée'], ['transferts', 'Transferts']]} value={tab} onChange={setTab} />
        {tab === 'orgs' ? <Organisations /> : tab === 'sites' ? <Sites /> : tab === 'conso' ? <Consolidation /> : <Transferts />}
      </main>
    </div>
  );
}

/** Toutes les organisations hébergées : consultation, accès support (intervention avec tous les droits, tracée), suspension, nouvel administrateur. */
function Organisations() {
  const { enterSupport } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/organizations/platform/all'), []);
  const act = useAction();
  const [create, setCreate] = useState(false);
  const [admin, setAdmin] = useState<any | null>(null);
  return (
    <Card title="Organisations">
      <div className="toolbar"><button className="btn" onClick={() => setCreate(true)}>Créer une organisation</button></div>
      <p className="muted">« Ouvrir » vous place dans l'organisation avec tous les droits pour la consulter ou intervenir ; chaque modification est consignée à son journal d'audit. Une organisation gérée par un serveur local reste en lecture seule ici.</p>
      {(error || act.error) && <ErrorBox message={(error ?? act.error)!} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucune organisation." columns={[
        { header: 'Organisation', render: (o) => <><strong>{o.name}</strong><br /><small className="muted">{o.code}</small></> },
        { header: 'Type', render: (o) => o.kind === 'exporter' ? 'Exportateur' : 'Coopérative' },
        { header: 'État', render: (o) => <Badge tone={o.status === 'active' ? 'ok' : 'bad'}>{o.status === 'active' ? 'Active' : 'Suspendue'}</Badge> },
        { header: 'Membres', align: 'right', render: (o) => o.members }, { header: 'Producteurs', align: 'right', render: (o) => o.producers }, { header: 'Délégués', align: 'right', render: (o) => o.delegates },
        { header: 'Administrateur', render: (o) => (o.admins ?? []).length ? (o.admins as any[]).map((a) => <div key={a.email}>{a.full_name}<br /><small className="muted">{a.email}</small></div>) : <span className="muted">Aucun</span> },
        { header: '', render: (o) => <span className="actions">
          <button className="btn btn-small" disabled={o.status !== 'active' || act.busy} onClick={() => act.run(() => enterSupport({ id: o.id, code: o.code, name: o.name, kind: o.kind }))}>Ouvrir</button>
          <button className="btn btn-small btn-secondary" onClick={() => setAdmin(o)}>Administrateur</button>
          <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => { if (o.status !== 'active' || confirm(`Suspendre « ${o.name} » ? Ses utilisateurs ne pourront plus se connecter.`)) act.run(async () => { await post(`/organizations/${o.id}/status`, { status: o.status === 'active' ? 'suspended' : 'active' }); reload(); }); }}>{o.status === 'active' ? 'Suspendre' : 'Réactiver'}</button></span> },
      ]} />}
      {create && <CreateOrg onClose={() => { setCreate(false); reload(); }} />}
      {admin && <OrgAdmin o={admin} onClose={() => { setAdmin(null); reload(); }} />}
    </Card>
  );
}

function OrgAdmin({ o, onClose }: { o: any; onClose: () => void }) {
  const [f, setF] = useState({ full_name: '', email: '', password: '' });
  const [done, setDone] = useState(false);
  const act = useAction();
  return (
    <Modal title={`Administrateur — ${o.name}`} onClose={onClose}>
      {done ? <><p>Administrateur ajouté : il se connecte avec {f.email}.</p><div className="modal-actions"><button className="btn" onClick={onClose}>Fermer</button></div></> : <>
        <Field label="Nom"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Courriel"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Mot de passe provisoire" hint="12 caractères au moins ; un compte déjà existant garde son mot de passe."><input type="password" value={f.password} autoComplete="new-password" onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {act.error && <ErrorBox message={act.error} />}
        <div className="modal-actions"><button className="btn" disabled={act.busy || f.full_name.length < 2 || !f.email.includes('@') || f.password.length < 10} onClick={() => act.run(async () => { await post(`/organizations/${o.id}/admins`, f); setDone(true); })}>Ajouter</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div></>}
    </Modal>
  );
}

const fresh = (s?: number | null) => (s === null || s === undefined ? ['Jamais', 'neutral'] : s < 900 ? ['À jour', 'ok'] : s < 86400 ? ['En retard', 'warn'] : ['Silencieux', 'bad']);

function Sites() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/replication/sites'), []);
  const act = useAction();
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState(false);
  return (
    <Card title="Sites">
      <div className="toolbar"><button className="btn" onClick={() => setCreating(true)}>Ajouter une coopérative</button> <button className="btn btn-secondary" onClick={() => setOrgForm(true)}>Créer une organisation (coopérative ou exportateur)</button></div>
      {(error || act.error) && <ErrorBox message={(error ?? act.error)!} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucun site relié pour l'instant." columns={[
          { header: 'Coopérative', render: (s) => <><strong>{s.organization_name}</strong><br /><small className="muted">{s.organization_code}</small></> },
          { header: 'État', render: (s) => s.status === 'suspended' ? <Badge tone="bad">Suspendu</Badge> : <Badge tone={fresh(s.seconds_since_push)[1] as any}>{fresh(s.seconds_since_push)[0]}</Badge> },
          { header: 'Dernier envoi', render: (s) => dateTime(s.last_push_at) },
          { header: 'Lignes reçues', align: 'right', render: (s) => s.rows_received },
          { header: 'Version', render: (s) => <small>{s.app_version ?? '—'}</small> },
          { header: 'Dernier incident', render: (s) => s.last_error ? <small>{s.last_error}</small> : '—' },
          { header: '', render: (s) => (
            <span className="actions">
              <button className="btn btn-small btn-secondary" onClick={() => act.run(async () => { await post(`/replication/sites/${s.id}/status`, { status: s.status === 'active' ? 'suspended' : 'active' }); reload(); })}>{s.status === 'active' ? 'Suspendre' : 'Réactiver'}</button>{' '}
              <button className="btn btn-small btn-secondary" onClick={() => act.run(async () => { const r = await post<any>(`/replication/sites/${s.id}/rotate-token`); setCode(r.pairing_code); })}>Nouveau code</button>
            </span>) },
        ]} />
      )}
      {creating && <CreateSite onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); setCode(c); reload(); }} />}
      {orgForm && <CreateOrg onClose={() => setOrgForm(false)} />}
      {code && <PairingCode code={code} onClose={() => setCode(null)} />}
    </Card>
  );
}

function Transferts() {
  const imps = useAsync(() => get<any[]>('/replication/transfer/imports'), []); const act = useAction(); const [res, setRes] = useState<any>(null);
  return <>
    <Card title="Importer un fichier de transfert">
      <p>Fichier <code>.atx</code> exporté par un serveur local sans internet. L'import vérifie la signature, ignore ce qui est déjà reçu et <strong>n'efface jamais rien</strong> au central : une suppression venue du local est archivée.</p>
      <input type="file" accept=".atx" disabled={act.busy} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setRes(null); act.run(async () => { const fd = new FormData(); fd.append('file', f); setRes(await postForm('/replication/transfer/import', fd)); imps.reload(); }); e.target.value = ''; }} />
      {res && <p role="status"><strong>{res.site}</strong> : {res.applied} ligne(s) appliquée(s), {res.skipped} déjà reçue(s). <strong>Dernier numéro à confirmer au serveur local : <code>{res.last_txid}</code></strong></p>}
      {act.error && <p className="error" role="alert">{act.error}</p>}
    </Card>
    <Card title="Fichiers importés">
      {imps.loading ? <Loading /> : !(imps.data ?? []).length ? <p className="empty">Aucun import.</p> :
        <table><thead><tr><th>Date</th><th>Coopérative</th><th>Fichier</th><th className="num">Lignes</th><th className="num">Appliquées</th><th className="num">Dernier n°</th></tr></thead>
          <tbody>{imps.data!.map((i) => <tr key={i.id}><td>{new Date(i.imported_at).toLocaleString('fr-FR')}</td><td>{i.organization_name}</td><td>{i.file_name}</td><td className="num">{i.rows_total}</td><td className="num">{i.rows_applied}</td><td className="num">{i.last_txid}</td></tr>)}</tbody></table>}
    </Card></>;
}

function PairingCode({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <Modal title="Code de jumelage" onClose={onClose}>
      <p>À saisir une seule fois sur le serveur local de la coopérative. Il contient le secret du site : ne le partagez pas en clair.</p>
      <textarea readOnly rows={5} value={code} onFocus={(e) => e.currentTarget.select()} />
      <div className="modal-actions"><button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(code)}>Copier</button><button className="btn" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

function CreateSite({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [f, setF] = useState({ organization_code: '', organization_name: '', organization_id: '', public_url: '' });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Ajouter une coopérative" onClose={onClose}>
      <Field label="Code" hint="Majuscules, chiffres, - ou _"><input value={f.organization_code} onChange={set('organization_code')} /></Field>
      <Field label="Nom de la coopérative"><input value={f.organization_name} onChange={set('organization_name')} /></Field>
      <Field label="Identifiant de la coopérative (si déjà installée en local)" hint="Affiché dans Synchronisation sur le serveur local. Laisser vide pour une nouvelle installation."><input value={f.organization_id} onChange={set('organization_id')} /></Field>
      <details><summary>Options techniques</summary>
        <Field label="Adresse de ce serveur" hint="Remplie automatiquement ; à modifier seulement si le serveur est joint par une autre adresse."><input value={f.public_url} onChange={set('public_url')} /></Field>
      </details>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !f.organization_code || f.organization_name.length < 2} onClick={() => act.run(async () => {
          const body: any = { organization_code: f.organization_code, organization_name: f.organization_name };
          if (f.organization_id.trim()) body.organization_id = f.organization_id.trim();
          if (f.public_url.trim()) body.public_url = f.public_url.trim();
          const r = await post<any>('/replication/sites', body); onCreated(r.pairing_code);
        })}>Créer et obtenir le code</button></div>
    </Modal>
  );
}

function Consolidation() {
  const { data, loading, error, reload } = useAsync(() => get<any>('/replication/consolidation'), []);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const t = data.totals;
  return (
    <>
      <div className="grid">
        <Stat label="Coopératives" value={data.sites.length} />
        <Stat label="Producteurs actifs" value={t.producers} />
        <Stat label="Parcelles" value={t.parcels} hint={`${t.area_ha.toFixed(1)} ha déclarés`} />
        <Stat label="Quantité achetée" value={kg(t.declared_quantity)} />
        <Stat label="Facturé" value={money(t.invoiced_total)} />
      </div>
      <Card title="Par coopérative">
        <Table rows={data.sites} columns={[
          { header: 'Coopérative', render: (s: any) => <strong>{s.name}</strong> },
          { header: 'Producteurs', align: 'right', render: (s: any) => s.producers },
          { header: 'Parcelles', align: 'right', render: (s: any) => s.parcels },
          { header: 'Déclarations', align: 'right', render: (s: any) => s.declarations },
          { header: 'Quantité', align: 'right', render: (s: any) => kg(s.declared_quantity) },
          { header: 'Facturé', align: 'right', render: (s: any) => money(s.invoiced_total) },
          { header: 'Dernier envoi', render: (s: any) => dateTime(s.last_push_at) },
        ]} />
      </Card>
    </>
  );
}

/** Crée une organisation hébergée sur ce serveur (coopérative ou exportateur) et son premier administrateur. */
function CreateOrg({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ code: '', name: '', kind: 'exporter', email: '', admin: '', password: '' });
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Créer une organisation" onClose={onClose}>
      {done ? <><p>{done}</p><div className="modal-actions"><button className="btn" onClick={onClose}>Fermer</button></div></> : <>
        <Field label="Type"><select value={f.kind} onChange={set('kind')}><option value="exporter">Exportateur (pont bascule, analyse, coopératives fournisseuses)</option><option value="cooperative">Coopérative</option></select></Field>
        <Field label="Code" hint="Majuscules, chiffres, - ou _ : les autres organisations s'en servent pour proposer un lien"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Nom"><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Premier administrateur : nom"><input value={f.admin} onChange={set('admin')} /></Field>
        <Field label="Courriel"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mot de passe provisoire" hint="12 caractères au moins ; à transmettre par un autre canal que le courriel"><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        {act.error && <ErrorBox message={act.error} />}
        <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn" disabled={act.busy || f.code.length < 2 || f.name.length < 2 || !f.email || f.admin.length < 2 || f.password.length < 10} onClick={() => act.run(async () => {
            const o = await post<any>('/organizations', { code: f.code, name: f.name, kind: f.kind });
            await post(`/organizations/${o.id}/admins`, { email: f.email, full_name: f.admin, password: f.password });
            setDone(`« ${f.name} » est créée (${f.kind === 'exporter' ? 'exportateur' : 'coopérative'}). L'administrateur se connecte avec ${f.email}.`);
          })}>Créer</button></div></>}
    </Modal>
  );
}
