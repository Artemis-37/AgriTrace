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
  adg: {
    name: 'Administrateur de groupe (ADG)',
    description: 'Responsable de la conformité et de la certification : suit les certificats, les inspections et la qualité, contrôle et vérifie les parcelles, met en place les missions des coachs et décide de leurs demandes.',
    permissions: [
      'certificates:read', 'certificates:manage', 'inspections:read', 'inspections:perform', 'quality:read', 'quality:manage', 'alerts:read', 'notifications:scan',
      'parcels:read', 'parcels:control', 'parcels:verify', 'geo:anomalies', 'geo:layers', 'geo:export', 'documents:read', 'documents:upload', 'documents:sensitive',
      'tasks:read', 'tasks:read_all', 'tasks:create', 'tasks:update', 'tasks:assign', 'tasks:review', 'tasks:close', 'tasks:decide_requests',
      'producers:read', 'collectors:read', 'value_chains:read', 'campaigns:read', 'reports:read', 'field_records:read', 'field_records:manage', 'field_templates:manage', 'messages:use', 'sync:use',
    ],
    hidden: ['Caisse et comptabilité', 'Finances', 'Convois (réception et règlement)', 'Stocks', 'Préfinancement'],
  },
  coach: {
    name: 'Coach',
    description: 'Agent de terrain suivi par l\'ADG : exécute ses missions, enregistre des producteurs, relève des parcelles, des infrastructures sociales, des formations et des distributions, joint des photos et demande de nouvelles missions.',
    permissions: ['tasks:read', 'tasks:execute', 'tasks:request', 'parcels:create', 'parcels:read', 'producers:read', 'producers:create', 'field_records:create', 'field_records:read', 'inspections:perform', 'documents:upload', 'messages:use', 'sync:use'],
    hidden: ['Caisse et comptabilité', 'Finances', 'Convois', 'Stocks', 'Équipe'],
  },
};
