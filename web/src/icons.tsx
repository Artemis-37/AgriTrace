import type { ReactNode } from 'react';

/** Icônes SVG (tracé de type Lucide, trait 2) pour les rubriques ; remplacent les emojis. Couleur = couleur du texte. */
const P: Record<string, ReactNode> = {
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.4" /><path d="M17 14.2c2.4 0 4 1.8 4 4.3" /></>,
  sprout: <><path d="M12 21v-9" /><path d="M12 12c0-4 2.5-6 7-6 0 4-2.5 6-7 6z" /><path d="M12 14c0-3-2-5-6-5 0 3 2 5 6 5z" /></>,
  tree: <><path d="M12 22v-6" /><path d="M7 16a4.5 4.5 0 0 1-1-8.8A5.5 5.5 0 0 1 17 6.5 4.5 4.5 0 0 1 17 16z" /></>,
  handshake: <><path d="M3 12l4-4 4 2 3-2 4 3 3-1" /><path d="M7 8l-4 4 6 6 2-1 2 1 3-3" /><path d="M21 11l-5 5" /></>,
  wheat: <><path d="M12 22V8" /><path d="M12 8c-2-.3-3.5-1.8-3.5-4 2 .3 3.5 1.8 3.5 4zM12 8c2-.3 3.5-1.8 3.5-4-2 .3-3.5 1.8-3.5 4z" /><path d="M12 14c-2-.3-3.5-1.8-3.5-4 2 .3 3.5 1.8 3.5 4zM12 14c2-.3 3.5-1.8 3.5-4-2 .3-3.5 1.8-3.5 4z" /></>,
  scale: <><path d="M12 3v18M7 21h10" /><path d="M5 7h14" /><path d="M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z" /></>,
  truck: <><path d="M2 6h11v10H2z" /><path d="M13 9h4l4 4v3h-8" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
  coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M15 10.5c3 .2 6 1.3 6 2.9v3.6c0 1.7-2.7 3-6 3-2.5 0-4.6-.8-5.5-1.8" /></>,
  bank: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 21h18" /></>,
  calc: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8" /><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>,
  box: <><path d="M21 8l-9-5-9 5 9 5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-8" /></>,
  folder: <><path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" /></>,
  map: <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  swap: <><path d="M4 8h14l-3-3M20 16H6l3 3" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  pie: <><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  sync: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M9 12h6M9 16h4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  cap: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5" /></>,
  ship: <><path d="M3 17l2 4h14l2-4z" /><path d="M5 17V11h14v6" /><path d="M9 11V7h6v4M12 3v4" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  piggy: <><path d="M12 3v9h9" /><circle cx="12" cy="12" r="9" /></>,
};

const BY_PATH: Record<string, string> = {
  '/': 'grid', '/mes-achats': 'plus', '/mon-stock': 'box', '/historique': 'history', '/producteurs': 'sprout', '/parcelles': 'tree', '/cartographie': 'map',
  '/commerce': 'swap', '/partenaires': 'handshake', '/parametres': 'gear', '/delegues': 'users', '/pesees': 'scale', '/caisse': 'coins', '/mise-en-compte': 'piggy',
  '/comptabilite': 'calc', '/convois': 'truck', '/inventaire': 'list', '/prefinancement': 'bank', '/synchronisation': 'sync', '/declarations': 'edit',
  '/fiches-accompagnement': 'clipboard', '/livraisons': 'truck', '/audits': 'search', '/organisations-liees': 'link', '/operations': 'receipt', '/terrain': 'layers',
  '/modules-formation': 'cap', '/questionnaires': 'edit', '/modules-exportateurs': 'ship', '/stocks': 'box', '/rapports': 'chart', '/finances': 'bank', '/qualite': 'check',
};
const BY_GROUP: Record<string, string> = { acteurs: 'users', achats: 'scale', ventes: 'truck', finances: 'coins', stock: 'box', terrain: 'compass', rapports: 'chart', autres: 'folder' };

const Svg = ({ k }: { k: string }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{P[k]}</svg>
);

/** Icône d'une rubrique (par chemin) ; retombe sur le texte d'origine si le chemin est inconnu. */
export function RouteIcon({ to, fallback }: { to: string; fallback?: string }) {
  const k = BY_PATH[to];
  return k ? <Svg k={k} /> : <>{fallback ?? ''}</>;
}
/** Icône d'une famille de rubriques de l'accueil. */
export function GroupIcon({ id, fallback }: { id: string; fallback?: string }) {
  const k = BY_GROUP[id];
  return k ? <Svg k={k} /> : <>{fallback ?? ''}</>;
}
