import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { get, post } from './api';
import { SEVERITY, dateTime } from './format';
import { targetOf } from './notifTarget';

/** Vrai pendant ~1,6 s dès que le compteur augmente (nouvelle notification ou nouveau message) : déclenche le balancement. */
export function useRingOnIncrease(count: number): boolean {
  const prev = useRef<number | null>(null);
  const [ring, setRing] = useState(false);
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (before === null || count <= before) return; // pas de balancement au premier affichage
    setRing(true);
    const t = setTimeout(() => setRing(false), 1600);
    return () => clearTimeout(t);
  }, [count]);
  return ring;
}

/** Icône Messages à côté de la cloche : même forme, même compteur, même balancement. */
export function MessageButton({ unread }: { unread: number }) {
  const ring = useRingOnIncrease(unread);
  return (
    <Link className={`bell-btn bell-link${ring ? ' is-ringing' : ''}`} to="/messages" aria-label={unread > 0 ? `Messages : ${unread} non lu(s)` : 'Messages'}>
      <span aria-hidden="true" className="bell-icon">✉</span>{unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}

/** Cloche de notifications : compteur, aperçu des dernières, marquage comme lu. */
export default function Bell({ unread, onChange }: { unread: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const ring = useRingOnIncrease(unread);
  const load = () => get<any[]>('/notifications?unread=true&limit=8').then((r) => { setItems(r); setErr(''); }).catch((e) => setErr(e?.message ?? 'Chargement impossible'));
  useEffect(() => { if (open) void load(); }, [open, unread]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const readAll = async () => { await post('/notifications/read-all').catch(() => undefined); onChange(); void load(); };
  const openOne = async (n: any) => {
    await post(`/notifications/${n.id}/read`).catch(() => undefined);
    setItems((cur) => (cur ? cur.filter((x) => x.id !== n.id) : cur));
    onChange(); setOpen(false);
    nav(targetOf(n));
  };
  return (
    <div className="bell" ref={box}>
      <button className={`bell-btn${ring ? ' is-ringing' : ''}`} aria-label={unread > 0 ? `Notifications : ${unread} non lue(s)` : 'Notifications'} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <span aria-hidden="true" className="bell-icon">🔔</span>{unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head"><strong>Notifications</strong>
            <button className="btn btn-small btn-secondary" disabled={!unread} onClick={readAll}>Tout marquer comme lu</button></div>
          {err && <p className="notice">{err}</p>}
          {!items ? <p className="muted">Chargement…</p> : !items.length ? <p className="muted">Rien à traiter.</p> : (
            <ul>{items.map((n) => (
              <li key={n.id} className={n.read_at ? 'is-read' : ''}>
                <button onClick={() => openOne(n)}>
                  <span className={`dot dot-${SEVERITY[n.severity] ?? 'info'}`} aria-hidden="true" />
                  <span><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}<small>{dateTime(n.created_at)}</small></span>
                </button>
              </li>))}</ul>
          )}
          <button className="bell-all" onClick={() => { setOpen(false); nav('/notifications'); }}>Voir l'historique</button>
        </div>
      )}
    </div>
  );
}
