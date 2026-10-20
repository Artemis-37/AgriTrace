import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from './api';
import { SEVERITY, dateTime } from './format';

/** Page ouverte par type de notification (le serveur ne renvoie que celles qui concernent l'utilisateur selon ses droits). */
const TARGET: Record<string, string> = {
  convoy: '/convois', collector: '/convois', task: '/missions', invoice: '/commerce', shipment: '/commerce', lot: '/stocks',
  weighing: '/stocks', loan: '/finances', parcel: '/parcelles', producer: '/producteurs', message: '/messages',
};

/** Cloche de notifications : compteur, aperçu des dernières, marquage comme lu. */
export default function Bell({ unread, onChange }: { unread: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const load = () => get<any[]>('/notifications?limit=8').then((r) => { setItems(r); setErr(''); }).catch((e) => setErr(e?.message ?? 'Chargement impossible'));
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
    if (!n.read_at) await post(`/notifications/${n.id}/read`).catch(() => undefined);
    onChange(); setOpen(false);
    const to = TARGET[n.entity_type ?? ''];
    nav(to ?? '/notifications');
  };
  return (
    <div className="bell" ref={box}>
      <button className="bell-btn" aria-label={unread > 0 ? `Notifications : ${unread} non lue(s)` : 'Notifications'} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <span aria-hidden="true">🔔</span>{unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head"><strong>Notifications</strong>
            <button className="btn btn-small btn-secondary" disabled={!unread} onClick={readAll}>Tout marquer comme lu</button></div>
          {err && <p className="notice">{err}</p>}
          {!items ? <p className="muted">Chargement…</p> : !items.length ? <p className="muted">Rien de nouveau.</p> : (
            <ul>{items.map((n) => (
              <li key={n.id} className={n.read_at ? 'is-read' : ''}>
                <button onClick={() => openOne(n)}>
                  <span className={`dot dot-${SEVERITY[n.severity] ?? 'info'}`} aria-hidden="true" />
                  <span><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}<small>{dateTime(n.created_at)}</small></span>
                </button>
              </li>))}</ul>
          )}
          <button className="bell-all" onClick={() => { setOpen(false); nav('/notifications'); }}>Voir toutes les notifications</button>
        </div>
      )}
    </div>
  );
}
