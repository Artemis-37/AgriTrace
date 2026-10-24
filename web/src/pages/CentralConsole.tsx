import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { dateTime, kg, money } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Stat, Table, Tabs, useAction, useAsync } from '../ui';

/** Console du serveur central (administrateur de plateforme) : sites reliés et vue consolidée de toutes les coopératives. */
export default function CentralConsole() {
  const { me, signOut } = useAuth();
  const [tab, setTab] = useState<'sites' | 'conso'>('sites');
  return (
    <div className="shell">
      <aside className="sidebar open">
        <div className="brand"><strong>Agri<span>Trace</span></strong><small>Serveur central</small></div>
        <div className="who"><strong>Administrateur de plateforme</strong><br />{me?.user.full_name}
          <div><button className="btn btn-ghost btn-small" onClick={signOut}>Se déconnecter</button></div></div>
      </aside>
      <main className="main">
        <PageHeader title="Serveur central" subtitle="Les coopératives gardent leur serveur local ; leurs données arrivent ici et se consolident." />
        <Tabs tabs={[['sites', 'Sites reliés'], ['conso', 'Vue consolidée']]} value={tab} onChange={setTab} />
        {tab === 'sites' ? <Sites /> : <Consolidation />}
      </main>
    </div>
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
