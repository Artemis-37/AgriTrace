import { useEffect, useRef, useState } from 'react';
import { get, post } from './api';
import { useAuth } from './auth';
import { dateTime } from './format';
import { flush, useOffline } from './offline';

type Level = 'ok' | 'warn' | 'bad' | 'busy' | 'off';
const COLOR: Record<Level, string> = { ok: '#16a34a', warn: '#d97706', bad: '#c0392b', busy: '#2563eb', off: '#8a8f87' };

const Wifi = ({ c }: { c: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 9a15 15 0 0 1 20 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19.5" r="1" fill={c} /></svg>;
const Cloud = ({ c }: { c: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18z" /></svg>;
const Monitor = ({ c }: { c: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;

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

  const link: { level: Level; text: string } = o.offline ? { level: 'warn', text: 'Hors connexion : le serveur de la coopérative est injoignable. Vous pouvez continuer à travailler.' }
    : o.failed > 0 ? { level: 'bad', text: `${o.failed} opération(s) à traiter` }
    : o.flushing ? { level: 'busy', text: 'Envoi du travail en cours…' }
    : o.pending > 0 ? { level: 'warn', text: `${o.pending} opération(s) en attente d'envoi` }
    : { level: 'ok', text: 'Connecté au serveur de la coopérative' };

  const c = d?.central;
  const central: { level: Level; text: string } | null = !c ? null
    : !c.linked ? { level: 'off', text: 'Serveur central : non relié (la coopérative travaille seule)' }
    : c.error ? { level: 'bad', text: 'Serveur central : dernière synchronisation en échec' }
    : c.pending_rows > 0 ? { level: 'warn', text: `Serveur central : ${c.pending_rows} enregistrement(s) en attente d'envoi` }
    : { level: 'ok', text: `Serveur central : synchronisé ${ago(c.last_ok_at) ?? ''}`.trim() };
  const n = d?.stations?.length ?? 0;
  const worst = [link.level, central?.level].includes('bad') ? 'bad' : [link.level, central?.level].includes('warn') ? 'warn' : link.level;

  return (
    <div className="conn" ref={box}>
      <button className="conn-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`État de la connexion : ${link.text}`} title={link.text}>
        <span className={link.level === 'busy' ? 'conn-spin' : ''}><Wifi c={COLOR[link.level]} /></span>
        {central && <Cloud c={COLOR[central.level]} />}
        {n > 0 && <span className="conn-n"><Monitor c={COLOR.ok} />{n}</span>}
        <span className="conn-dot" style={{ background: COLOR[worst] }} />
      </button>
      {open && (
        <div className="conn-panel" role="dialog" aria-label="État de la connexion">
          <ul>
            <li><Wifi c={COLOR[link.level]} /><span>{link.text}</span></li>
            {central && <li><Cloud c={COLOR[central.level]} /><span>{central.text}</span></li>}
            <li><Monitor c={n ? COLOR.ok : COLOR.off} /><span>{n ? `${n} poste(s) connecté(s)` : 'Aucun autre poste connecté'}</span></li>
          </ul>
          {n > 0 && <ul className="conn-st">{d.stations.map((s: any, i: number) => <li key={i}>{s.name} <small className="muted">· {s.user}</small></li>)}</ul>}
          {!o.offline && o.pending > 0 && <button className="btn btn-small" onClick={() => void flush()}>Envoyer maintenant</button>}
        </div>
      )}
    </div>
  );
}
