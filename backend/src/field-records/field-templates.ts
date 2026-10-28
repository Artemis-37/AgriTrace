export type Question = { key: string; label: string; type: 'text' | 'number' | 'select'; required: boolean; options: string[] };

const yn = ['Oui', 'Non'];
const q = (key: string, label: string, type: Question['type'] = 'text', required = true, options: string[] = []): Question => ({ key, label, type, required, options });

/** Modèles proposés au départ : l'ADG les charge, les adapte à sa coopérative puis les déploie. */
export const DEFAULT_INFRASTRUCTURES: Record<string, Question[]> = {
  'École primaire': [
    q('nom', "Nom de l'école"), q('niveau', 'Niveau académique', 'select', true, ['Maternelle', 'Primaire']),
    q('type', "Type d'école", 'select', true, ['Publique', 'Privée', 'Communautaire']), q('capacite', 'Capacité totale', 'number'),
    q('genre', 'Genre', 'select', true, ['Mixte', 'Filles', 'Garçons']), q('classes', 'Nombre de classes', 'number'),
    q('inscrits_garcons', "Nombre d'étudiants inscrits", 'number'), q('inscrites_filles', "Nombre d'étudiantes inscrites", 'number'),
    q('enseignants', "Nombre d'enseignants", 'number'), q('frais', 'Frais de scolarité par an', 'number'),
    q('cantine', "L'école dispose-t-elle d'une cantine opérationnelle ?", 'select', true, yn), q('latrines', "L'école dispose-t-elle des latrines fonctionnelles ?", 'select', true, yn),
    q('pct_classe_suivante', "Pourcentage d'élèves ayant passé à la classe suivante (au cours de la dernière année scolaire)", 'number'),
    q('pct_examen', "Pourcentage d'élèves ayant passé l'examen CM2 ou ayant passé au lycée (au cours de la dernière année scolaire)", 'number'),
    q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn), q('annee_ouverture', "Année d'ouverture", 'number'), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  Collège: [
    q('nom', 'Nom du collège'), q('type', 'Type de collège', 'select', true, ['Public', 'Privé', 'Communautaire']), q('genre', 'Genre', 'select', true, ['Mixte', 'Filles', 'Garçons']),
    q('capacite', 'Capacité totale', 'number'), q('classes', 'Nombre de classes', 'number'), q('inscrits_garcons', 'Nombre de garçons inscrits', 'number'), q('inscrites_filles', 'Nombre de filles inscrites', 'number'),
    q('enseignants', "Nombre d'enseignants", 'number'), q('frais', 'Frais de scolarité par an', 'number', false), q('internat', 'Le collège dispose-t-il d\'un internat ?', 'select', true, yn),
    q('cantine', 'Le collège dispose-t-il d\'une cantine opérationnelle ?', 'select', true, yn), q('latrines', 'Le collège dispose-t-il de latrines fonctionnelles ?', 'select', true, yn),
    q('eau', "Le collège dispose-t-il d'un point d'eau potable ?", 'select', true, yn), q('distance', 'Distance moyenne parcourue par les élèves (km)', 'number', false),
    q('pct_classe_suivante', "Pourcentage d'élèves ayant passé à la classe suivante (dernière année scolaire)", 'number'), q('pct_bepc', "Pourcentage de réussite au BEPC (dernière année scolaire)", 'number', false),
    q('annee_ouverture', "Année d'ouverture", 'number', false), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  Lycée: [
    q('nom', 'Nom du lycée'), q('type', 'Type de lycée', 'select', true, ['Public', 'Privé', 'Communautaire']), q('filiere', 'Filières enseignées', 'select', true, ['Enseignement général', 'Enseignement technique', 'Enseignement professionnel', 'Général et technique']),
    q('genre', 'Genre', 'select', true, ['Mixte', 'Filles', 'Garçons']), q('capacite', 'Capacité totale', 'number'), q('classes', 'Nombre de classes', 'number'),
    q('inscrits_garcons', 'Nombre de garçons inscrits', 'number'), q('inscrites_filles', 'Nombre de filles inscrites', 'number'), q('enseignants', "Nombre d'enseignants", 'number'),
    q('frais', 'Frais de scolarité par an', 'number', false), q('internat', "Le lycée dispose-t-il d'un internat ?", 'select', true, yn), q('laboratoire', "Le lycée dispose-t-il d'un laboratoire ?", 'select', false, yn),
    q('bibliotheque', "Le lycée dispose-t-il d'une bibliothèque ou d'une salle informatique ?", 'select', false, yn), q('latrines', 'Latrines fonctionnelles ?', 'select', true, yn), q('eau', "Point d'eau potable ?", 'select', true, yn),
    q('pct_classe_suivante', "Pourcentage d'élèves ayant passé à la classe suivante (dernière année scolaire)", 'number'), q('pct_bac', 'Pourcentage de réussite au baccalauréat (dernière année scolaire)', 'number', false),
    q('annee_ouverture', "Année d'ouverture", 'number', false), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  Église: [
    q('nom', "Nom de l'église"), q('confession', 'Confession', 'select', true, ['Catholique', 'Méthodiste', 'Assemblées de Dieu', 'Harriste', 'Évangélique', 'Autre']), q('capacite', 'Capacité (fidèles)', 'number'),
    q('electricite', "L'église dispose-t-elle de l'électricité ?", 'select', true, yn), q('eau', "Point d'eau sur place ?", 'select', true, yn), q('latrines', 'Latrines sur place ?', 'select', true, yn),
    q('etat', 'État du bâtiment', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']), q('annee', 'Année de construction', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  Mosquée: [
    q('nom', 'Nom de la mosquée'), q('capacite', 'Capacité (fidèles)', 'number'), q('ablutions', "Point d'eau pour les ablutions ?", 'select', true, yn), q('latrines', 'Latrines sur place ?', 'select', true, yn),
    q('electricite', 'Électricité ?', 'select', true, yn), q('ecole_coranique', 'École coranique rattachée ?', 'select', false, yn), q('etat', 'État du bâtiment', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']),
    q('annee', 'Année de construction', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  'Centre de santé': [
    q('nom', 'Nom du centre de santé'), q('type', 'Type de structure', 'select', true, ['Dispensaire rural', 'Centre de santé communautaire', 'Maternité', 'Pharmacie villageoise', 'Case de santé']),
    q('lits', 'Nombre de lits', 'number', false), q('personnel', 'Personnel soignant en poste', 'number'), q('consultations', 'Consultations par mois (moyenne)', 'number', false),
    q('electricite', "Le centre dispose-t-il de l'électricité ?", 'select', true, yn), q('eau', "Le centre dispose-t-il de l'eau courante ?", 'select', true, yn),
    q('ambulance', "Le centre dispose-t-il d'un moyen d'évacuation (ambulance, moto-ambulance) ?", 'select', false, yn), q('etat', 'État du bâtiment', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']),
    q('annee_ouverture', "Année d'ouverture", 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  "Point d'eau potable": [
    q('nom', "Nom du point d'eau"), q('type', "Type d'ouvrage", 'select', true, ['Forage à pompe manuelle', 'Pompe villageoise améliorée', 'Puits aménagé', "Adduction d'eau villageoise", "Château d'eau", 'Borne-fontaine']),
    q('fonctionnel', "Le point d'eau est-il fonctionnel ?", 'select', true, yn), q('menages', 'Nombre de ménages desservis', 'number'), q('profondeur', 'Profondeur (mètres)', 'number', false),
    q('comite', "Un comité de gestion de l'eau existe-t-il ?", 'select', true, yn), q('cotisation', "Les usagers cotisent-ils pour l'entretien ?", 'select', false, yn),
    q('analyse', "L'eau a-t-elle été analysée (potabilité) ?", 'select', false, yn), q('annee', "Année d'installation", 'number', false),
    q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  'Latrines et assainissement': [
    q('nom', "Nom ou emplacement de l'ouvrage"), q('lieu', 'Lieu', 'select', true, ['École primaire', 'Collège', 'Lycée', 'Centre de santé', 'Marché', 'Village', 'Église', 'Mosquée', 'Magasin de la coopérative']),
    q('type', 'Type de latrines', 'select', true, ['Latrines à fosse ventilée (VIP)', 'Latrines à chasse', 'Latrines écologiques (ECOSAN)', 'Fosse simple']), q('cabines', 'Nombre de cabines', 'number'),
    q('separees', 'Cabines séparées filles / garçons ?', 'select', true, yn), q('lave_mains', 'Dispositif de lavage des mains présent ?', 'select', true, yn),
    q('fonctionnelles', 'Les latrines sont-elles fonctionnelles ?', 'select', true, yn), q('annee', 'Année de construction', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  'Magasin de stockage': [
    q('nom', 'Nom du magasin ou de la structure'), q('type', 'Type', 'select', true, ['Magasin communautaire', 'Aire de séchage', 'Hangar de fermentation', 'Magasin de la coopérative', 'Magasin d\'intrants']),
    q('capacite_t', 'Capacité de stockage (tonnes)', 'number'), q('surface', 'Surface (m²)', 'number', false), q('palettes', 'Stockage sur palettes ?', 'select', true, yn),
    q('aeration', 'Bonne aération et toiture étanche ?', 'select', true, yn), q('etat', 'État', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']),
    q('annee', 'Année de construction', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  'Piste rurale et ouvrage de franchissement': [
    q('nom', 'Nom de la piste ou du pont'), q('type', 'Type', 'select', true, ['Piste rurale', 'Pont', 'Dalot / buse', 'Passage submersible']), q('longueur', 'Longueur (km pour une piste, mètres pour un pont)', 'number'),
    q('etat', 'État actuel', 'select', true, ['Bon', 'Moyen', 'Dégradé', 'Impraticable']), q('toute_annee', 'Praticable toute l\'année ?', 'select', true, yn),
    q('villages', 'Nombre de villages desservis', 'number', false), q('annee', 'Année de réalisation ou de réhabilitation', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  'Marché et hangar commercial': [
    q('nom', 'Nom du marché ou du hangar'), q('type', 'Type', 'select', true, ['Marché hebdomadaire', 'Marché permanent', 'Hangar commercial', 'Étals couverts']), q('jours', 'Jours de marché', 'text', false),
    q('etals', "Nombre d'étals ou de boutiques", 'number'), q('point_eau', "Point d'eau sur place ?", 'select', true, yn), q('latrines', 'Latrines sur place ?', 'select', true, yn),
    q('electricite', 'Électricité / éclairage ?', 'select', true, yn), q('etat', 'État', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']), q('annee', 'Année de construction', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  'Salle communautaire': [
    q('nom', 'Nom de la salle ou du foyer'), q('type', 'Type', 'select', true, ['Salle de réunion', 'Foyer des jeunes', 'Foyer des femmes', 'Centre culturel', 'Salle polyvalente']), q('capacite', 'Capacité (personnes)', 'number'),
    q('electricite', 'Électricité ?', 'select', true, yn), q('mobilier', 'Mobilier (bancs, tables) disponible ?', 'select', true, yn), q('usage', 'Utilisée par', 'select', false, ['Coopérative', 'Village', 'Groupement de femmes', 'Jeunes', 'Plusieurs usagers']),
    q('etat', 'État', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']), q('annee', 'Année de construction', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  'Crèche et garderie': [
    q('nom', 'Nom de la structure'), q('capacite', "Capacité d'accueil (enfants)", 'number'), q('enfants', "Nombre d'enfants accueillis", 'number'), q('personnel', "Nombre d'encadrantes", 'number'),
    q('age', "Tranche d'âge accueillie", 'select', true, ['0 à 3 ans', '3 à 6 ans', '0 à 6 ans']), q('repas', 'Repas servis aux enfants ?', 'select', true, yn), q('eau_latrines', 'Eau potable et latrines sur place ?', 'select', true, yn),
    q('annee', "Année d'ouverture", 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  'Cantine scolaire': [
    q('nom', "Nom de l'école concernée"), q('couverts', 'Repas servis par jour', 'number'), q('jours', 'Jours de service par semaine', 'number'), q('cuisine', 'Cuisine et réfectoire aménagés ?', 'select', true, yn),
    q('stock', 'Stock de vivres suffisant pour le trimestre ?', 'select', true, yn), q('comite', 'Comité de gestion de la cantine ?', 'select', true, yn), q('origine', 'Origine des vivres', 'select', false, ['Programme national', 'Partenaire', 'Parents', 'Coopérative', 'Jardin scolaire']),
    q('annee', "Année de mise en service", 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  'Centre de formation et d\'alphabétisation': [
    q('nom', 'Nom du centre'), q('type', 'Type', 'select', true, ['Centre d\'alphabétisation', 'Centre de formation professionnelle', 'Champ-école', 'Bibliothèque communautaire']), q('apprenants', "Nombre d'apprenants", 'number'),
    q('femmes', "Dont femmes", 'number', false), q('formateurs', 'Nombre de formateurs', 'number'), q('cycle', 'Durée du cycle (mois)', 'number', false), q('materiel', 'Matériel pédagogique disponible ?', 'select', true, yn),
    q('annee', "Année d'ouverture", 'number', false), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
  'Électrification et éclairage': [
    q('nom', 'Nom du site ou du village'), q('type', "Type d'installation", 'select', true, ['Extension du réseau électrique', 'Kit solaire communautaire', 'Lampadaires solaires', 'Mini-réseau solaire', 'Groupe électrogène']),
    q('menages', 'Nombre de ménages raccordés', 'number', false), q('points', "Nombre de points lumineux", 'number', false), q('fonctionnel', "L'installation est-elle fonctionnelle ?", 'select', true, yn),
    q('maintenance', "Un responsable de l'entretien est-il désigné ?", 'select', false, yn), q('annee', "Année d'installation", 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn), q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn),
  ],
  'Terrain de sport et aire de jeux': [
    q('nom', 'Nom du terrain'), q('type', 'Type', 'select', true, ['Terrain de football', 'Terrain polyvalent', 'Aire de jeux pour enfants', 'Terrain de handball ou de basket']), q('eclairage', 'Éclairage ?', 'select', false, yn),
    q('vestiaires', 'Vestiaires ou sanitaires ?', 'select', false, yn), q('etat', 'État', 'select', true, ['Bon', 'Moyen', 'À réhabiliter']), q('annee', 'Année de réalisation', 'number', false), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
};

export const DEFAULT_TRAINING_THEMES: Record<string, string[]> = {
  'Agriculture régénératrice': [
    'Actions paysagères', 'Agroforesterie et arbres à la ferme', "Conservation de l'eau après la récolte", "Conservation de l'eau avant la récolte",
    "Contrôle de l'érosion des sols", 'Correction du sol', 'Couverture permanente du sol', 'Cultures intercalaires et rotations des cultures',
    'Gestion des eaux usées', 'Gestion des résidus de récolte et des déchets',
  ],
  'Alimentation saine et nutrition': [], 'Collecte de documents et tenue de registres': [], 'Culture commerciale et financière': [], Diversification: [],
  'Eau, assainissement, et hygiène': [], "Entreprise responsable et droits de l'homme": [], 'Genre, jeunesse, et inclusion': [], 'Gestion des récoltes et des produits': [],
  'Gouvernance coopérative': [], 'Maladies transmissibles et non transmissibles': [], 'Normes et réglementations de certification': [], 'Santé et sécurité au travail': [],
  'Santé générale': [], 'Santé maternelle et reproductive': [],
};

/** Vérifie et normalise une définition ; renvoie un message d'erreur ou la définition propre. */
export function cleanDefinition(kind: string, d: any): { error?: string; value?: any } {
  if (!d || typeof d !== 'object') return { error: 'Définition manquante' };
  if (kind === 'training_theme') {
    const mods = Array.isArray(d.modules) ? d.modules.map((m: any) => String(m).trim()).filter(Boolean) : null;
    if (!mods) return { error: 'La liste des modules est requise (elle peut être vide)' };
    if (mods.length > 100 || mods.some((m: string) => m.length > 200)) return { error: 'Trop de modules ou module trop long' };
    return { value: { modules: [...new Set<string>(mods)] } };
  }
  if (!Array.isArray(d.questions) || d.questions.length < 1 || d.questions.length > 60) return { error: 'Entre 1 et 60 questions sont requises' };
  const keys = new Set<string>();
  const out: Question[] = [];
  for (const x of d.questions) {
    const key = String(x?.key ?? '').trim(), label = String(x?.label ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return { error: `Identifiant de question invalide : « ${key} » (minuscules, chiffres et _ ; 40 caractères)` };
    if (keys.has(key)) return { error: `Identifiant en double : ${key}` };
    if (!label || label.length > 300) return { error: `Libellé invalide pour « ${key} »` };
    if (!['text', 'number', 'select'].includes(x.type)) return { error: `Type invalide pour « ${key} »` };
    const options = Array.isArray(x.options) ? [...new Set<string>(x.options.map((o: any) => String(o).trim()).filter(Boolean))] : [];
    if (x.type === 'select' && (options.length < 2 || options.length > 30)) return { error: `« ${label} » : une liste de choix demande 2 à 30 options` };
    keys.add(key);
    out.push({ key, label, type: x.type, required: x.required !== false, options: x.type === 'select' ? options : [] });
  }
  return { value: { questions: out } };
}
