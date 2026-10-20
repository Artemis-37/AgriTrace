import { useCallback, useEffect, useRef, useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { enqueue, onFlushed, useOffline } from '../offline';
import { Badge, Card, ErrorBox, Loading, PageHeader, useAsync } from '../ui';

/** Messagerie entre les postes de la coopérative : canal général et messages directs. Un message écrit hors connexion part dès le retour du serveur. */
export default function Messages({ onChange }: { onChange?: () => void }) {
  const { me, org } = useAuth();
  const off = useOffline();
  const [peer, setPeer] = useState<string>('general');
  const [text, setText] = useState('');
  const [thread, setThread] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const { data: contacts, loading, error, reload } = useAsync(() => get<any>('/messages/contacts'), []);

  const load = useCallback(async () => {
    try {
      const rows = await get<any[]>(`/messages?with=${peer}`);
      setThread(rows); setErr(null);
      if (!off.offline) { await post('/messages/seen', { with: peer }).catch(() => undefined); onChange?.(); }
    } catch (e) { setErr((e as Error).message); }
  }, [peer, off.offline, onChange]);
  useEffect(() => { void load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(reload, 20000); return () => clearInterval(t); }, [reload]);
  useEffect(() => onFlushed(() => { void load(); reload(); }), [load, reload]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [thread.length, off.ops.length]);

  const queued = off.ops.filter((o) => o.type === 'message.send' && o.status === 'pending' && (o.payload.to ?? 'general') === peer);
  const send = async () => {
    const body = text.trim(); if (!body || !org) return;
    setText('');
    await enqueue(org.id, 'message.send', { idempotency_key: idem(), ...(peer !== 'general' && { to: peer }), body, sent_at: new Date().toISOString() }, `Message à ${peer === 'general' ? 'tous' : (contacts?.contacts.find((c: any) => c.id === peer)?.full_name ?? '')}`);
    setTimeout(load, 700);
  };

  if (loading && !contacts) return <Loading />;
  if (error || !contacts) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const title = peer === 'general' ? 'Canal général' : contacts.contacts.find((c: any) => c.id === peer)?.full_name ?? '';
  return (
    <>
      <PageHeader title="Messages" subtitle="Échangez avec les autres postes de la coopérative. Les messages restent sur le serveur de la coopérative." />
      <div className="chat">
        <Card title="Conversations">
          <ul className="list chat-list">
            <li><button className={`link ${peer === 'general' ? 'on' : ''}`} onClick={() => setPeer('general')}>Canal général {contacts.general.unread > 0 && <span className="badge badge-bad">{contacts.general.unread}</span>}</button></li>
            {contacts.contacts.map((c: any) => (
              <li key={c.id}><button className={`link ${peer === c.id ? 'on' : ''}`} onClick={() => setPeer(c.id)}>{c.full_name} {c.unread > 0 && <span className="badge badge-bad">{c.unread}</span>}</button><br /><small className="muted">{c.role}</small></li>
            ))}
          </ul>
        </Card>
        <Card title={title}>
          {err && <ErrorBox message={err} />}
          <div className="chat-thread" aria-live="polite">
            {!thread.length && !queued.length && <p className="empty">Aucun message. Écrivez le premier.</p>}
            {thread.map((m) => (
              <div key={m.id} className={`msg ${m.sender_id === me?.user.id ? 'mine' : ''}`}>
                <div className="msg-meta"><strong>{m.sender_id === me?.user.id ? 'Moi' : m.sender_name}</strong> · {dateTime(m.sent_at ?? m.created_at)}{m.sent_at && Math.abs(Date.parse(m.created_at) - Date.parse(m.sent_at)) > 120000 && <> <Badge tone="info">écrit hors connexion</Badge></>}</div>
                <div>{m.body}</div>
              </div>
            ))}
            {queued.map((o) => (
              <div key={o.id} className="msg mine pending"><div className="msg-meta"><strong>Moi</strong> · <Badge tone="warn">En attente d'envoi</Badge></div><div>{o.payload.body}</div></div>
            ))}
            <div ref={bottom} />
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input aria-label="Votre message" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={off.offline ? 'Hors connexion : le message partira au retour du serveur' : 'Écrire un message…'} />
            <button className="btn" disabled={!text.trim()}>Envoyer</button>
          </form>
        </Card>
      </div>
    </>
  );
}
