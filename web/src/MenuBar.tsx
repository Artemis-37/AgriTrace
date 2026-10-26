import { ReactNode, createContext, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export interface MenuItem { to: string; label: string; icon: string }
const GROUP_OF: Record<string, string> = {
  '/producteurs': 'Fichier', '/parcelles': 'Fichier', '/delegues': 'Fichier', '/partenaires': 'Fichier', '/parametres': 'Paramètres',
  '/mes-achats': 'Opérations', '/mon-stock': 'Opérations', '/historique': 'Opérations', '/pesees': 'Opérations', '/convois': 'Opérations', '/caisse': 'Opérations', '/commerce': 'Opérations', '/declarations': 'Opérations', '/fiches-accompagnement': 'Opérations', '/livraisons': 'Opérations', '/organisations-liees': 'Fichier', '/operations': 'Opérations', '/terrain': 'Opérations',
  '/comptabilite': 'Comptabilité', '/mise-en-compte': 'Comptabilité', '/finances': 'Comptabilité', '/prefinancement': 'Comptabilité',
  '/audits': 'Suivi', '/stocks': 'Stock', '/inventaire': 'Stock', '/qualite': 'Stock',
  '/cartographie': 'Suivi', '/rapports': 'Suivi', '/modules-formation': 'Suivi', '/questionnaires': 'Suivi', '/modules-exportateurs': 'Suivi',
  '/equipe': 'Paramètres', '/synchronisation': 'Paramètres',
};
/** Rubriques accessibles à l'utilisateur (déjà filtrées par ses droits) : l'accueil en fait des tuiles. */
export const NavItemsContext = createContext<MenuItem[]>([]);
/** Pages ouvertes par l'icône Paramètres (et non par des tuiles de l'accueil). */
export const SETTINGS_PATHS = new Set(['/parametres', '/equipe', '/synchronisation']);
const ORDER = ['Fichier', 'Opérations', 'Comptabilité', 'Stock', 'Suivi', 'Autres']; // « Paramètres » (et l'ancienne « Administration ») : icône en haut à droite
const LABEL: Record<string, string> = { '/parcelles': 'Plantations (parcelles)' };

const IconHome = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>;
const IconGear = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;

/** Accueil et Paramètres (avec l'ancienne rubrique Administration : équipe et accès, synchronisation) : deux icônes en haut, près de la connexion. */
export function TopIcons({ items, onNavigate }: { items: MenuItem[]; onNavigate: () => void }) {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, []);
  const home = items.find((i) => i.to === '/');
  const settings = items.filter((i) => GROUP_OF[i.to] === 'Paramètres');
  return (
    <div className="top-icons" ref={ref}>
      {home && <NavLink to="/" end className="top-ico" title="Accueil" aria-label="Accueil" onClick={() => { try { sessionStorage.removeItem('agritrace.home.group'); } catch { /* ignoré */ } window.dispatchEvent(new Event('agritrace:home')); onNavigate?.(); }}><IconHome /></NavLink>}
      {settings.length > 0 && (
        <div className={`menu ${open ? 'on' : ''}`}>
          <button className="top-ico" title="Paramètres" aria-label="Paramètres" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}><IconGear /></button>
          <ul className="menu-drop menu-drop-right" role="menu" hidden={!open}>
            {settings.map((i) => <li key={i.to} role="none"><NavLink role="menuitem" to={i.to} onClick={onNavigate}><span aria-hidden="true">{i.icon}</span>{LABEL[i.to] ?? i.label}</NavLink></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Menus Fichier, Opérations, Comptabilité, Stock, Suivi : dans la barre du haut, à côté du nom de la coopérative. */
export function MenuBar({ items, open, onNavigate }: { items: MenuItem[]; open: boolean; onNavigate: () => void }) {
  const loc = useLocation();
  const [cur, setCur] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { setCur(null); }, [loc.pathname]);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setCur(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCur(null); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, []);
  const groups = ORDER.map((g) => [g, items.filter((i) => i.to !== '/' && (GROUP_OF[i.to] ?? 'Autres') === g)] as [string, MenuItem[]]).filter(([, l]) => l.length);
  return (
    <nav ref={ref} className={`menubar ${open ? 'open' : ''}`} aria-label="Menus">
      {groups.map(([g, list]) => (
        <div key={g} className={`menu ${cur === g ? 'on' : ''}`} onMouseEnter={() => { if (cur && window.innerWidth > 900) setCur(g); }}>
          <button className="menu-top" aria-haspopup="true" aria-expanded={cur === g} onClick={() => setCur(cur === g ? null : g)}>{g}</button>
          {(
            <ul className="menu-drop" role="menu" hidden={cur !== g}>
              {list.map((i) => <li key={i.to} role="none"><NavLink role="menuitem" to={i.to} onClick={onNavigate}><span aria-hidden="true">{i.icon}</span>{LABEL[i.to] ?? i.label}</NavLink></li>)}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}
export const StatusBar = ({ children }: { children: ReactNode }) => <footer className="statusbar">{children}</footer>;
