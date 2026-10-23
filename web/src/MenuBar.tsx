import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export interface MenuItem { to: string; label: string; icon: string }
const GROUP_OF: Record<string, string> = {
  '/producteurs': 'Fichier', '/parcelles': 'Fichier', '/delegues': 'Fichier', '/partenaires': 'Fichier', '/parametres': 'Paramètres',
  '/mes-achats': 'Opérations', '/mon-stock': 'Opérations', '/historique': 'Opérations', '/pesees': 'Opérations', '/convois': 'Opérations', '/caisse': 'Opérations', '/commerce': 'Opérations', '/declarations': 'Opérations', '/operations': 'Opérations', '/missions': 'Opérations', '/terrain': 'Opérations',
  '/comptabilite': 'Comptabilité', '/finances': 'Comptabilité', '/prefinancement': 'Comptabilité',
  '/stocks': 'Stock', '/inventaire': 'Stock', '/qualite': 'Stock',
  '/cartographie': 'Suivi', '/rapports': 'Suivi', '/modules-formation': 'Suivi', '/modules-exportateurs': 'Suivi',
  '/equipe': 'Administration', '/synchronisation': 'Administration',
};
const ORDER = ['Fichier', 'Opérations', 'Comptabilité', 'Stock', 'Suivi', 'Paramètres', 'Administration', 'Autres'];
const LABEL: Record<string, string> = { '/parcelles': 'Plantations (parcelles)' };

/** Barre de menus à la manière d'un logiciel de bureau (Fichier, Opérations, Comptabilité…), aux couleurs AgriTrace. */
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
  const home = items.find((i) => i.to === '/');
  return (
    <nav ref={ref} className={`menubar ${open ? 'open' : ''}`} aria-label="Menus">
      {home && <NavLink to="/" end className="menu-top" onClick={onNavigate}><span aria-hidden="true">🏠</span> Accueil</NavLink>}
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
