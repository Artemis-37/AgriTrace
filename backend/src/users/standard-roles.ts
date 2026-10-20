// Rôles types proposés aux coopératives. Chaque rôle n'accorde que ce dont le poste a besoin : les menus et les données
// non listés ici restent invisibles (le portail et les API se règlent sur les permissions, jamais sur le nom du rôle).
export const STANDARD_ROLES: Record<string, { name: string; description: string; permissions: string[]; hidden: string[] }> = {
  magasinier: {
    name: 'Magasinier',
    description: 'Réceptionne et pèse les convois au magasin central, tient les stocks et l\'inventaire.',
    permissions: ['convoys:read', 'convoys:receive', 'warehouses:read', 'lots:read', 'receipts:create', 'stock:move', 'stock:count', 'messages:use', 'sync:use'],
    hidden: ['Conformité / qualité', 'Cartographie', 'Caisse et comptabilité', 'Finances', 'Équipe', 'Missions', 'Préfinancement'],
  },
  caissier: {
    name: 'Caissier',
    description: 'Traite les convois reçus, règle les collecteurs, tient la caisse et les comptes des collecteurs.',
    permissions: ['convoys:read', 'convoys:settle', 'cash:operate', 'finance:read', 'accounting:read', 'messages:use', 'sync:use'],
    hidden: ['Cartographie', 'Conformité / qualité', 'Équipe', 'Missions', 'Stocks'],
  },
  collecteur: {
    name: 'Collecteur (délégué)',
    description: 'Déclare ses achats chez les producteurs et ses convois, voit son stock, son historique et sa fiche de compte.',
    permissions: ['declarations:create', 'declarations:read', 'producers:read', 'convoys:create', 'convoys:read', 'collector:stock', 'documents:upload', 'messages:use', 'sync:use'],
    hidden: ['Tout ce qui concerne les autres collecteurs', 'Caisse', 'Comptabilité', 'Équipe'],
  },
};
