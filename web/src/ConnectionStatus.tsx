import { useEffect, useRef, useState } from 'react';
import { get, post } from './api';
import { useAuth } from './auth';
import { dateTime } from './format';
import { flush, useOffline } from './offline';

type St = 'ok' | 'ko' | 'warn' | 'na';
const PATHS: Record<string, string> = {
  net: 'M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  srv: 'M4 3h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 14h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM6 6.5h.01M6 17.5h.01',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  sync: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
};
const Icon = ({ k }: { k: string }) => <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[k]} /></svg>;
const LAMP: Record<St, string> = { ok: '🟢', ko: '🔴', warn: '🟠', na: '⚪' };

const stationId = () => { try { let id = localStorage.getItem('agritrace.station'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('agritrace.station', id); } return id; } catch { return 'poste-' + Math.random().toString(36).slice(2); } };
const ago = (iso: string | null) => { if (!iso) return null; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : dateTime(iso); };

/** Icônes de connexion : ce poste ↔ serveur de la coopérative, serveur de la coopérative ↔ serveur central, postes connectés. */
export default function ConnectionStatus() {
  const { org } = useAuth();
  const o = useOffline();
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!org) return;
    let stop = false;
    const name = (window as any).agritrace?.stationName ?? 'Navigateur';
    const tick = async () => {
      if (o.offline) return;
      await post('/connection/heartbeat', { station: stationId(), name }).catch(() => undefined);
      const r = await get<any>('/connection').catch(() => null);
      if (!stop && r) setD(r);
    };
    void tick(); const t = setInterval(tick, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [org?.id, o.offline]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const [net, setNet] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => { const u = () => setNet(true), d = () => setNet(false); window.addEventListener('online', u); window.addEventListener('offline', d); return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); }; }, []);

  const c = d?.central;
  const waiting = o.pending, bad = o.failed;
  const items: { k: string; st: St; label: string; n?: number }[] = [
    { k: 'net', st: net ? 'ok' : 'ko', label: net ? 'Réseau : connecté' : 'Réseau : hors ligne' },
    { k: 'srv', st: o.offline ? 'ko' : 'ok', label: o.offline ? 'Serveur de la coopérative : injoignable (mode hors connexion)' : 'Serveur de la coopérative : connecté' },
    ...(c ? [{ k: 'cloud', st: (!c.linked ? 'na' : c.error ? 'ko' : c.pending_rows > 0 ? 'warn' : 'ok') as St,
      label: !c.linked ? 'Serveur central : non relié (la coopérative travaille seule)' : c.error ? 'Serveur central : dernière synchronisation en échec' : c.pending_rows > 0 ? `Serveur central : ${c.pending_rows} enregistrement(s) en attente d'envoi` : `Serveur central : synchronisé ${ago(c.last_ok_at) ?? ''}`.trim() }] : []),
    { k: 'sync', st: bad ? 'ko' : waiting || o.flushing ? 'warn' : 'ok', n: bad || waiting || undefined,
      label: bad ? `${bad} opération(s) refusée(s) : à traiter` : o.flushing ? 'Envoi en cours…' : waiting ? `${waiting} opération(s) en attente de synchronisation` : 'Synchronisation à jour' },
  ];
  const n = d?.stations?.length ?? 0;

  return (
    <div className="conn-icons" ref={box}>
      {items.map((it) => (
        <button key={it.k} type="button" className={`ci ci-${it.st}`} title={it.label} aria-label={it.label} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon k={it.k} />{it.n ? <b className="ci-n">{it.n}</b> : null}
        </button>
      ))}
      {open && (
        <div className="conn-panel" role="dialog" aria-label="Synchronisation">
          <h3>Synchronisation</h3>
          <ul>
            {items.map((it) => <li key={it.k}><span aria-hidden="true">{LAMP[it.st]}</span><span>{it.label}</span></li>)}
            <li><span aria-hidden="true">{n ? '🟢' : '⚪'}</span><span>{n ? `${n} poste(s) connecté(s)` : 'Aucun autre poste connecté'}</span></li>
          </ul>
          {n > 0 && <ul className="conn-st">{d.stations.map((s: any, i: number) => <li key={i}>{s.name} <small className="muted">· {s.user}</small></li>)}</ul>}
          <p className="muted">La synchronisation est automatique : rien à faire, même après une coupure ou un redémarrage.</p>
          {!o.offline && <button className="btn btn-small" onClick={() => void flush()}>Synchroniser maintenant</button>}
        </div>
      )}
    </div>
  );
}
