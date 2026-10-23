import { Link } from 'react-router-dom';
import { useAuth } from '../auth';

const TILES: { to: string; label: string; icon: string; perm: string[]; notFor?: 'collector' }[] = [
  { to: '/equipe', label: 'Membres', icon: '👥', perm: ['users:read'] },
  { to: '/producteurs', label: 'Producteurs', icon: '🌱', perm: ['producers:read'] },
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
  if (!list.length) return null;
  return (
    <nav className="home-tiles" aria-label="Modules">
      {list.map((t) => <Link key={t.to} to={t.to} className="home-tile"><span aria-hidden="true">{t.icon}</span><strong>{t.label}</strong></Link>)}
    </nav>
  );
}
