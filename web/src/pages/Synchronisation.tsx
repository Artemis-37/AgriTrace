import { useRef, useState } from 'react';
import { api, get, post, postForm } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, PageHeader, Stat, useAction, useAsync } from '../ui';
import { Confirm } from './Declarations';

/** Réglages de la synchronisation d'un serveur local avec le serveur central (sens unique : local → central). */
export default function Synchronisation() {
  const { org } = useAuth();
  const { data: s, loading, error, reload } = useAsync(() => get<any>('/replication/status'), []);
  const act = useAction();
  const [code, setCode] = useState('');
  const [unlink, setUnlink] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error || !s) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  if (s.mode === 'central') {
    return (
      <>
        <PageHeader title="Synchronisation" subtitle="Serveur central" />
        <Card><p>Ce serveur est le <strong>serveur central</strong> : il reçoit les données des serveurs locaux des coopératives. Les sites se gèrent depuis la console de l'administrateur de plateforme.</p></Card>
      </>
    );
  }
  const state = !s.linked ? ['Non reliée', 'neutral'] : s.last_error ? ['En erreur', 'bad'] : s.pending_rows ? ['En attente d\'envoi', 'warn'] : ['À jour', 'ok'];
  return (
    <>
      <PageHeader title="Synchronisation" subtitle="Ce serveur fonctionne seul ; il envoie ses données au serveur central, qui les consolide avec les autres coopératives."
        actions={s.linked && <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { const r = await post<any>('/replication/sync-now'); setMsg(r.error ? null : `${r.sent} ligne(s) envoyée(s).`); reload(); })}>{act.busy ? 'Envoi…' : 'Synchroniser maintenant'}</button>} />
      {act.error && <ErrorBox message={act.error} />}
      {msg && <p className="notice" role="status">{msg}</p>}
      <div className="grid">
        <Stat label="État" value={state[0]} tone={state[1] as any} />
        <Stat label="Lignes en attente" value={s.pending_rows} tone={s.pending_rows ? 'warn' : 'ok'} hint={s.oldest_pending_at ? `Depuis ${dateTime(s.oldest_pending_at)}` : undefined} />
        <Stat label="Dernier envoi réussi" value={s.last_ok_at ? dateTime(s.last_ok_at) : '—'} />
        <Stat label="Lignes envoyées" value={s.rows_sent} />
      </div>
      {s.last_error && <Card title="Dernier incident"><p><Badge tone="bad">Erreur</Badge> {s.last_error}</p><p className="muted">Rien n'est perdu : les changements restent en file et repartent dès que le central répond.</p></Card>}
      {s.linked ? (
        <Card title="Serveur central">
          <p>Relié au <strong>serveur central</strong> (connexion automatique).</p>
          <button className="btn btn-secondary" onClick={() => setUnlink(true)}>Dissocier ce serveur du central</button>
          {unlink && <Confirm title="Dissocier du serveur central" intro="Les données déjà envoyées restent au central. Les prochains changements ne seront plus envoyés tant que le serveur n'est pas relié de nouveau." onClose={() => setUnlink(false)}
            onSubmit={async () => { await post('/replication/unlink'); setUnlink(false); reload(); }} />}
        </Card>
      ) : (
        <Card title="Relier au serveur central">
          <p>Demandez à l'administrateur du serveur central de créer votre site avec les informations ci-dessous, puis collez le <strong>code de jumelage</strong> reçu.</p>
          <dl className="kv">
            <dt>Coopérative</dt><dd>{s.organization?.name} ({s.organization?.code})</dd>
            <dt>Identifiant à communiquer</dt><dd><code>{s.organization?.id ?? org?.id}</code></dd>
          </dl>
          <Field label="Code de jumelage"><textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="AGT1-…" /></Field>
          <button className="btn" disabled={act.busy || code.trim().length < 10} onClick={() => act.run(async () => { await post('/replication/link', { pairing_code: code.trim() }); setCode(''); await post('/replication/sync-now'); reload(); })}>Relier et envoyer les données existantes</button>
        </Card>
      )}
      <AppUpdateCard />
      <MapPackCard />
    </>
  );
}

/** Mise à jour de l'application de bureau : l'administrateur dépose le nouvel installateur, les postes le reçoivent sur le réseau local. */
function AppUpdateCard() {
  const { can } = useAuth();
  const { data, reload } = useAsync(() => get<any>('/app/update?current=0.0.0'), []);
  const act = useAction();
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const valid = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version);
  return (
    <Card title="Mise à jour de l'application de bureau">
      <p>{data?.available
        ? <>Version mise à disposition des postes : <strong>{data.version}</strong> ({Math.max(1, Math.round(data.size_bytes / 1048576))} Mo, déposée le {dateTime(data.uploaded_at)}). Chaque poste la propose à son utilisateur et l'installe après vérification de l'empreinte du fichier.</>
        : 'Aucune version déposée pour le moment.'}</p>
      {can('settings:manage') && (
        <>
          <p className="muted">Déposez le fichier d'installation Windows (.exe) d'une version plus récente. Les postes le téléchargent depuis ce serveur, sans Internet. L'installateur n'est pas signé numériquement : ne déposez que le fichier fourni par votre équipe AgriTrace.</p>
          {act.error && <ErrorBox message={act.error} />}
          {done && <p className="notice" role="status">{done}</p>}
          <Field label="Numéro de version (ex. 0.2.0)"><input value={version} onChange={(e) => setVersion(e.target.value.trim())} maxLength={14} /></Field>
          <Field label="Installateur (.exe)"><input ref={file} type="file" accept=".exe" /></Field>
          <Field label="Nouveautés (facultatif)"><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
          <button className="btn" disabled={act.busy || !valid} onClick={() => act.run(async () => {
            const f = file.current?.files?.[0];
            if (!f) throw new Error('Choisissez le fichier d\'installation');
            const form = new FormData(); form.append('file', f); form.append('version', version); if (notes.trim()) form.append('notes', notes.trim());
            const r = await postForm<any>('/app/releases', form);
            setDone(`Version ${r.version} déposée : les postes la proposeront à leurs utilisateurs.`); setVersion(''); setNotes(''); if (file.current) file.current.value = ''; reload();
          })}>Mettre à disposition des postes</button>
        </>
      )}
    </Card>
  );
}

/** Fond de carte hors ligne des téléphones : l'administrateur dépose un paquet de tuiles (MBTiles), les téléphones le téléchargent sur le Wi-Fi de la coopérative. */
function MapPackCard() {
  const { can } = useAuth();
  const manage = can('settings:manage');
  const { data: cur, reload } = useAsync(() => get<any>('/map-packs/current'), []);
  const { data: list, reload: reloadList } = useAsync(() => (manage ? get<any[]>('/map-packs') : Promise.resolve([])), [manage]);
  const act = useAction();
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const mb = (b: number) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} Mo`;
  const refresh = () => { reload(); reloadList(); };
  return (
    <Card title="Fond de carte hors ligne des téléphones">
      <p>{cur?.available
        ? <>Fond de carte proposé aux téléphones : <strong>{cur.name}</strong> ({mb(cur.size_bytes)}, déposé le {dateTime(cur.uploaded_at)}). Chaque téléphone le télécharge une fois sur le Wi-Fi de la coopérative, puis l'affiche sans connexion.</>
        : 'Aucun fond de carte déposé : sur les téléphones, le plan du tracé s\'affiche sans fond.'}</p>
      {manage && (
        <>
          <p className="muted">Déposez un paquet de tuiles raster au format MBTiles (.mbtiles), préparé par exemple avec QGIS à partir d'une source dont la licence autorise le stockage (les serveurs publics d'OpenStreetMap interdisent le téléchargement en masse). Les téléphones disposent déjà, une fois connectés, des couches Plan (OpenStreetMap) et Satellite, gardées sur l'appareil au fil des consultations ; ce paquet sert à couvrir une zone à l'avance. Limitez la zone et le niveau de détail à ce dont les techniciens ont besoin : un paquet de quelques dizaines de Mo suffit pour une zone de coopérative.</p>
          {act.error && <ErrorBox message={act.error} />}
          {done && <p className="notice" role="status">{done}</p>}
          <Field label="Nom (facultatif)"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Paquet de tuiles (.mbtiles)"><input ref={file} type="file" accept=".mbtiles" /></Field>
          <button className="btn" disabled={act.busy} onClick={() => act.run(async () => {
            const f = file.current?.files?.[0];
            if (!f) throw new Error('Choisissez le fichier .mbtiles');
            const form = new FormData(); form.append('file', f); if (name.trim()) form.append('name', name.trim());
            const r = await postForm<any>('/map-packs', form);
            setDone(`Fond de carte « ${r.name} » déposé : les téléphones le téléchargeront sur le Wi-Fi.`); setName(''); if (file.current) file.current.value = ''; refresh();
          })}>{act.busy ? 'Envoi…' : 'Mettre à disposition des téléphones'}</button>
          {!!list?.length && (
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Nom</th><th>Taille</th><th>Déposé le</th><th></th></tr></thead>
              <tbody>{list.map((p: any, i: number) => (
                <tr key={p.id}><td>{p.name} {i === 0 && <Badge tone="ok">En service</Badge>}</td><td>{mb(p.size_bytes)}</td><td>{dateTime(p.uploaded_at)}</td>
                  <td><button className="btn secondary" onClick={() => setRemoving(p)}>Retirer</button></td></tr>
              ))}</tbody>
            </table>
          )}
          {removing && (
            <Confirm title={`Retirer « ${removing.name} » ?`} intro="Les téléphones qui l'ont déjà téléchargé le gardent ; les nouveaux ne pourront plus le recevoir."
              onClose={() => setRemoving(null)} onSubmit={async () => { await api('DELETE', `/map-packs/${removing.id}`); setRemoving(null); refresh(); }} />
          )}
        </>
      )}
    </Card>
  );
}
