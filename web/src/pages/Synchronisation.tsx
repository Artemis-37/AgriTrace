import { useState } from 'react';
import { get, post } from '../api';
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
          <p>Relié à <strong>{s.central_url}</strong>.</p>
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
    </>
  );
}
