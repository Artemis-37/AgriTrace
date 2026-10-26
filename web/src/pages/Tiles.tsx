import { useContext, useEffect, useState } from 'react';
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

/** Regroupement des rubriques par nature : l'accueil montre quelques grandes familles, un clic ouvre les rubriques de la famille. */
const GROUPS: { id: string; label: string; icon: string; hint: string; paths: string[] }[] = [
  { id: 'acteurs', label: 'Acteurs', icon: '👥', hint: 'Délégués, producteurs, plantations, partenaires', paths: ['/delegues', '/producteurs', '/parcelles', '/partenaires', '/organisations-liees'] },
  { id: 'achats', label: 'Achats et pesées', icon: '⚖️', hint: 'Pesées, convois, déclarations d\'achat', paths: ['/pesees', '/convois', '/declarations', '/mes-achats', '/mon-stock', '/historique', '/operations'] },
  { id: 'ventes', label: 'Ventes et livraisons', icon: '🚚', hint: 'Ventes, livraisons, fiches d\'accompagnement', paths: ['/commerce', '/livraisons', '/fiches-accompagnement', '/modules-exportateurs'] },
  { id: 'finances', label: 'Caisse et finances', icon: '💰', hint: 'Caisse, trésorerie, comptabilité, mise en compte', paths: ['/caisse', '/finances', '/comptabilite', '/mise-en-compte', '/prefinancement'] },
  { id: 'stock', label: 'Stock et produits', icon: '📦', hint: 'Produits, stock, inventaire, qualité', paths: ['/parametres', '/stocks', '/inventaire', '/qualite'] },
  { id: 'terrain', label: 'Terrain et suivi', icon: '🧭', hint: 'Cartographie, missions, questionnaires (tâches), audits, formation', paths: ['/cartographie', '/missions', '/questionnaires', '/terrain', '/audits', '/modules-formation'] },
  { id: 'rapports', label: 'Rapports', icon: '📊', hint: 'Rapports et indicateurs', paths: ['/rapports'] },
];

/** Accueil par familles de rubriques, selon les droits de la personne. */
export function Tiles() {
  const { can, me } = useAuth();
  const nav = useContext(NavItemsContext);
  // La famille ouverte est mémorisée : « Retour » depuis une rubrique ramène à la famille, pas à l'accueil nu.
  const [open, setOpenState] = useState<string | null>(() => { try { return sessionStorage.getItem('agritrace.home.group'); } catch { return null; } });
  useEffect(() => { const h = () => setOpenState(null); window.addEventListener('agritrace:home', h); return () => window.removeEventListener('agritrace:home', h); }, []);
  const setOpen = (g: string | null) => { setOpenState(g); try { g ? sessionStorage.setItem('agritrace.home.group', g) : sessionStorage.removeItem('agritrace.home.group'); } catch { /* ignoré */ } };
  const known = TILES.filter((t) => t.perm.some((p) => can(p)) && (!t.notFor || me?.account_kind !== t.notFor)).map((t) => ({ to: t.to, label: t.label, icon: t.icon }));
  const all = [...known];
  for (const i of nav) if (i.to !== '/' && !all.some((t) => t.to === i.to) && !SETTINGS_PATHS.has(i.to)) all.push({ to: i.to, label: i.label, icon: i.icon });
  const used = new Set<string>();
  const groups = GROUPS.map((g) => ({ ...g, items: g.paths.map((p) => all.find((t) => t.to === p)).filter(Boolean) as typeof all })).filter((g) => g.items.length);
  groups.forEach((g) => g.items.forEach((i) => used.add(i.to)));
  const rest = all.filter((t) => !used.has(t.to));
  if (rest.length) groups.push({ id: 'autres', label: 'Autres', icon: '🗂️', hint: '', paths: [], items: rest });
  if (!groups.length) return null;
  const cur = groups.find((g) => g.id === open);
  if (cur) {
    return (
      <nav className="home-tiles-wrap" aria-label={cur.label}>
        <button type="button" className="home-back" onClick={() => setOpen(null)}>← Accueil</button>
        <h2 className="home-group-title"><span aria-hidden="true">{cur.icon}</span> {cur.label}</h2>
        <div className="home-tiles">{cur.items.map((i) => <Link key={i.to} to={i.to} className="home-tile"><span aria-hidden="true">{i.icon}</span><strong>{i.label}</strong></Link>)}</div>
      </nav>
    );
  }
  return (
    <nav className="home-tiles home-groups" aria-label="Modules">
      {groups.map((g) => g.items.length === 1
        ? <Link key={g.id} to={g.items[0].to} className="home-tile home-group"><span aria-hidden="true">{g.icon}</span><strong>{g.label}</strong></Link>
        : <button key={g.id} type="button" className="home-tile home-group" onClick={() => setOpen(g.id)}><span aria-hidden="true">{g.icon}</span><strong>{g.label}</strong><small>{g.items.slice(0, 4).map((i) => i.label).join(', ')}{g.items.length > 4 ? '…' : ''}</small></button>)}
    </nav>
  );
}
