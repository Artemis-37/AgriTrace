import type { Question } from './questionnaires.controller';

type T = [label: string, type: Question['type'], required?: boolean, options?: string[]];
const mk = (rows: T[]): Question[] => rows.map(([label, type, required, options], i) => ({ id: `q${i + 1}`, label, type, required: !!required, ...(options ? { options } : {}) }));
const OUI_NON = ['Oui', 'Non'];

/** Questionnaires types livrés avec chaque coopérative. Textes génériques : l'ADG les adapte à sa coopérative. */
export const QUESTIONNAIRE_TEMPLATES: { code: string; title: string; description: string; questions: Question[] }[] = [
  {
    code: 'coaching', title: 'Visite de coaching', description: 'Suivi d\'une visite du coach chez le producteur : constats, conseils donnés et prochain rendez-vous.',
    questions: mk([
      ['Date de la visite', 'date', true], ['Durée de la visite (minutes)', 'number'],
      ['État général de la plantation', 'choice', true, ['Bon', 'Moyen', 'Mauvais']],
      ['Entretien des parcelles (désherbage, taille)', 'choice', true, ['Régulier', 'Irrégulier', 'Absent']],
      ['Maladies ou ravageurs observés', 'multi', false, ['Pourriture brune', 'Swollen shoot', 'Mirides', 'Aucun', 'Autre']],
      ['Le producteur applique-t-il les conseils précédents ?', 'yesno', true],
      ['Thèmes abordés avec le producteur', 'multi', false, ['Taille', 'Fertilisation', 'Récolte', 'Fermentation et séchage', 'Tenue du carnet', 'Sécurité au travail']],
      ['Difficultés exprimées par le producteur', 'text'], ['Engagements pris par le producteur', 'text'],
      ['Date du prochain rendez-vous', 'date'], ['Observations du coach', 'text'],
    ]),
  },
  {
    code: 'clmrs', title: 'CLMRS — Observation et remédiation du travail des enfants', description: 'Système d\'observation et de remédiation : repérage des enfants à risque dans le ménage et suivi des actions.',
    questions: mk([
      ['Date de la visite', 'date', true], ['Nombre d\'enfants de moins de 18 ans dans le ménage', 'number', true],
      ['Nombre d\'enfants de 5 à 17 ans scolarisés', 'number', true],
      ['Des enfants aident-ils sur l\'exploitation ?', 'yesno', true],
      ['Tâches effectuées par les enfants', 'multi', false, ['Aucune', 'Ramassage des cabosses', 'Écabossage', 'Séchage', 'Transport de charges lourdes', 'Pulvérisation de produits', 'Utilisation de machette', 'Défrichage']],
      ['Un enfant de moins de 15 ans travaille-t-il sur l\'exploitation ?', 'yesno', true],
      ['Un enfant effectue-t-il des travaux dangereux ?', 'yesno', true],
      ['Un enfant est-il non scolarisé en âge d\'aller à l\'école ?', 'yesno', true],
      ['Cas identifié', 'choice', false, ['Aucun cas', 'Cas à risque', 'Cas de travail des enfants', 'Cas de travail dangereux']],
      ['Mesure de remédiation proposée', 'multi', false, ['Sensibilisation des parents', 'Inscription à l\'école', 'Kit scolaire', 'Extrait de naissance', 'Activité génératrice de revenus', 'Suivi renforcé']],
      ['Date du prochain suivi', 'date'], ['Observations', 'text'],
    ]),
  },
  {
    code: 'enquete-base', title: 'Enquête de base', description: 'Profil du producteur, de son ménage et de son exploitation, à renseigner une première fois.',
    questions: mk([
      ['Date de l\'enquête', 'date', true], ['Âge du producteur', 'number', true],
      ['Niveau d\'instruction', 'choice', false, ['Aucun', 'Primaire', 'Secondaire', 'Supérieur']],
      ['Situation matrimoniale', 'choice', false, ['Célibataire', 'Marié(e)', 'Veuf(ve)', 'Autre']],
      ['Nombre de personnes à charge', 'number', true], ['Nombre d\'années d\'expérience en agriculture', 'number'],
      ['Nombre de parcelles exploitées', 'number', true], ['Superficie totale exploitée (hectares)', 'number', true],
      ['Statut foncier', 'choice', true, ['Propriétaire', 'Héritage familial', 'Location', 'Métayage', 'Autre']],
      ['Cultures pratiquées', 'multi', false, ['Cacao', 'Café', 'Hévéa', 'Palmier à huile', 'Anacarde', 'Vivriers']],
      ['Autres sources de revenus', 'multi', false, ['Aucune', 'Commerce', 'Élevage', 'Salariat', 'Autre culture']],
      ['Utilise-t-il un compte bancaire ou mobile money ?', 'yesno'], ['Est-il membre d\'un groupe d\'épargne ?', 'yesno'],
      ['Principale difficulté', 'choice', false, ['Maladies', 'Manque de main-d\'œuvre', 'Prix', 'Accès aux intrants', 'Financement', 'Autre']],
    ]),
  },
  {
    code: 'travail-enfants', title: 'Travail des enfants — sensibilisation', description: 'Séance de sensibilisation au travail des enfants et engagement du producteur.',
    questions: mk([
      ['Date de la séance', 'date', true], ['La séance a-t-elle eu lieu avec le conjoint présent ?', 'yesno'],
      ['Le producteur connaît-il l\'âge minimum d\'admission au travail ?', 'yesno', true],
      ['Distingue-t-il travaux légers et travaux dangereux ?', 'yesno', true],
      ['Connaît-il les risques pour la santé et l\'école des enfants ?', 'yesno'],
      ['Les enfants du ménage sont-ils tous scolarisés ?', 'yesno', true],
      ['Le producteur s\'engage-t-il à ne pas employer d\'enfants pour des travaux dangereux ?', 'yesno', true],
      ['Supports remis', 'multi', false, ['Affiche', 'Dépliant', 'Boîte à images', 'Aucun']],
      ['Besoins exprimés', 'text'], ['Observations du coach', 'text'],
    ]),
  },
  {
    code: 'bonnes-pratiques', title: 'Bonnes pratiques agricoles', description: 'Contrôle des pratiques sur la plantation : entretien, fertilisation, récolte et post-récolte.',
    questions: mk([
      ['Date du contrôle', 'date', true], ['Taille d\'entretien réalisée dans l\'année ?', 'yesno', true],
      ['Désherbage', 'choice', true, ['Manuel', 'Chimique', 'Mixte', 'Aucun']],
      ['Utilisation d\'engrais ou de fumure organique ?', 'yesno'], ['Produits phytosanitaires utilisés', 'text'],
      ['Récolte à bonne maturité', 'choice', true, ['Toujours', 'Souvent', 'Rarement']],
      ['Fermentation', 'choice', true, ['Pratiquée ≥ 5 jours', 'Pratiquée < 5 jours', 'Non pratiquée']],
      ['Séchage', 'choice', true, ['Sur claies ou bâches', 'Sur le sol', 'Séchoir']],
      ['Stockage des fèves', 'choice', false, ['Sacs sur palettes', 'Sacs au sol', 'Vrac']],
      ['Tient-il un carnet de récolte ?', 'yesno'], ['Humidité estimée des fèves (%)', 'number'], ['Observations', 'text'],
    ]),
  },
  {
    code: 'sante-securite', title: 'Santé, sécurité et équipements de protection', description: 'Sécurité au travail du producteur et de sa main-d\'œuvre.',
    questions: mk([
      ['Date de la visite', 'date', true], ['Équipements de protection disponibles', 'multi', false, ['Gants', 'Bottes', 'Masque', 'Lunettes', 'Combinaison', 'Aucun']],
      ['Pulvérise-t-il des produits phytosanitaires ?', 'yesno', true],
      ['Stockage des produits chimiques', 'choice', false, ['Local fermé', 'Dans la maison', 'À l\'air libre', 'Sans objet']],
      ['Emballages vides de produits : devenir', 'choice', false, ['Collectés', 'Brûlés', 'Réutilisés', 'Jetés', 'Sans objet']],
      ['Trousse de premiers secours disponible ?', 'yesno'], ['Accès à l\'eau potable ?', 'yesno'],
      ['Accident ou intoxication dans l\'année ?', 'yesno', true], ['Distance au centre de santé (km)', 'number'], ['Observations', 'text'],
    ]),
  },
  {
    code: 'environnement', title: 'Environnement et zéro déforestation', description: 'Agroforesterie, protection des forêts et conformité aux exigences de traçabilité.',
    questions: mk([
      ['Date de la visite', 'date', true], ['Nombre d\'arbres d\'ombrage par hectare (estimation)', 'number'],
      ['Les parcelles sont-elles hors des forêts classées et aires protégées ?', 'yesno', true],
      ['Une parcelle a-t-elle été étendue sur une forêt depuis 2020 ?', 'yesno', true],
      ['Les limites des parcelles sont-elles matérialisées ?', 'yesno'],
      ['Pratiques de protection des sols', 'multi', false, ['Paillage', 'Couverture végétale', 'Compost', 'Aucune']],
      ['Gestion des déchets de cabosses', 'choice', false, ['Compostés', 'Laissés sur place', 'Brûlés']],
      ['A-t-il reçu des plants d\'arbres de la coopérative ?', 'yesno'], ['Observations', 'text'],
    ]),
  },
  {
    code: 'besoins-formation', title: 'Besoins en formation et satisfaction', description: 'Attentes du producteur vis-à-vis de la coopérative et thèmes de formation souhaités.',
    questions: mk([
      ['Date de l\'entretien', 'date', true],
      ['Thèmes de formation souhaités', 'multi', true, ['Taille et entretien', 'Fertilisation', 'Lutte contre les maladies', 'Fermentation et séchage', 'Gestion financière', 'Tenue du carnet', 'Sécurité au travail']],
      ['Satisfaction vis-à-vis de la coopérative', 'choice', true, ['Très satisfait', 'Satisfait', 'Peu satisfait', 'Insatisfait']],
      ['Les prix et paiements sont-ils clairs ?', 'yesno'], ['Les délais de paiement sont-ils respectés ?', 'yesno'],
      ['Services souhaités', 'multi', false, ['Crédit', 'Intrants', 'Plants', 'Transport', 'Assistance technique']],
      ['Suggestions', 'text'],
    ]),
  },
];
