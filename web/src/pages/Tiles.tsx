import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { NavItemsContext, SETTINGS_PATHS } from '../MenuBar';

const TILES: { to: string; label: string; icon: string; perm: string[]; notFor?: 'collector' }[] = [
  { to: '/delegues', label: 'Délégués', icon: '👥', perm: ['collectors:read'] },
  { to: '/producteurs', label: 'Producteurs', icon: '🌱', perm: ['producers:read'] },
  { to: '/parcelles', label: 'Plantations', icon: '🌳', perm: ['parcels:read'] },
  { to: '/partenaires', label: 'Partenaires', icon: '🤝', perm: ['partners:read'] },
  { to: '/parametres', label: 'Produits', icon: '🌾', perm: ['products:read', 'campaigns:read'] },
  { to: '/pesees', label: 'Pesées', icon: '⚖️', perm: ['convoys:read', 'convoys:receive'], notFor: 'collector' },
  { to: '/commerce', label: 'Ventes', icon: '🚚', perm: ['buyers:read', 'logistics:read', 'invoices:read'] },
  { to: '/caisse', label: 'Caisse', icon: '💰', perm: ['convoys:settle', 'finance:read'] },
  { to: '/finances', label: 'Trésorerie', icon: '🏦', perm: ['finance:read'] },
  { to: '/comptabilite', label: 'Comptabilité', icon: '🧮', perm: ['accounting:read'] },
  { to: '/stocks', label: 'Stock', icon: '📦', perm: ['warehouses:read'] },
];

/** Accueil à grandes tuiles, comme le menu du logiciel actuel : une tuile par module, selon les droits. */
export function Tiles() {
  const { can, me } = useAuth();
  const list = TILES.filter((t) => t.perm.some((p) => can(p)) && (!t.notFor || me?.account_kind !== t.notFor));
  // Les autres rubriques (convois, livraisons, audits, rapports…) : une tuile chacune, puisque la barre de menus a été retirée.
  const nav = useContext(NavItemsContext);
  const extra = nav.filter((i) => i.to !== '/' && !SETTINGS_PATHS.has(i.to) && !TILES.some((t) => t.to === i.to));
  if (!list.length && !extra.length) return null;
  return (
    <nav className="home-tiles" aria-label="Modules">
      {list.map((t) => <Link key={t.to} to={t.to} className="home-tile"><span aria-hidden="true">{t.icon}</span><strong>{t.label}</strong></Link>)}
      {extra.map((i) => <Link key={i.to} to={i.to} className="home-tile"><span aria-hidden="true">{i.icon}</span><strong>{i.label}</strong></Link>)}
    </nav>
  );
}
