/** Modèles préchargés de distributions et de services : l'ADG les choisit à l'envoi, puis adapte l'intitulé, les consignes, l'échéance et les producteurs. Textes génériques. */
export type AssignmentTemplate = { code: string; kind: 'distribution' | 'service'; title: string; description: string; instructions: string; articles?: string[] };

export const ASSIGNMENT_TEMPLATES: AssignmentTemplate[] = [
  // ── Distributions
  { code: 'dist-plants-cacao', kind: 'distribution', title: 'Distribution de plants de cacaoyers', description: 'Plants améliorés pour la replantation et la régénération des vergers.',
    instructions: 'Retrait au magasin de la section sur présentation de la carte du producteur. Noter le nombre de plants remis, signer le bordereau et photographier la remise.', articles: ['Plants de cacaoyers améliorés'] },
  { code: 'dist-ombrage', kind: 'distribution', title: 'Distribution d\'arbres d\'ombrage et d\'agroforesterie', description: 'Arbres d\'ombrage et d\'essences locales pour les parcelles.',
    instructions: 'Remise des plants par lots ; rappeler la densité à respecter (arbres par hectare) et les distances de plantation.', articles: ['Plants d\'arbres d\'ombrage', 'Plants d\'essences locales'] },
  { code: 'dist-engrais', kind: 'distribution', title: 'Distribution d\'engrais et de compost', description: 'Engrais minéraux ou organiques selon les besoins relevés au diagnostic.',
    instructions: 'Quantité selon la superficie en production du producteur. Rappeler la dose, la période d\'application et le port des équipements de protection.', articles: ['Engrais (sac de 50 kg)', 'Compost'] },
  { code: 'dist-phyto', kind: 'distribution', title: 'Distribution de produits phytosanitaires homologués', description: 'Produits de la liste homologuée uniquement, avec les équipements de protection.',
    instructions: 'Ne remettre que des produits homologués et recommandés par la coopérative. Remettre avec les équipements de protection, rappeler le stockage sécurisé et le lavage des contenants.', articles: ['Fongicide homologué', 'Insecticide homologué', 'Pulvérisateur'] },
  { code: 'dist-epi', kind: 'distribution', title: 'Distribution de kits d\'équipements de protection (EPI)', description: 'Gants, bottes, masque, lunettes et combinaison pour le traitement.',
    instructions: 'Un kit par producteur formé à l\'application des produits. Faire essayer et vérifier la taille ; noter les kits remis.', articles: ['Gants', 'Bottes', 'Masque', 'Lunettes', 'Combinaison'] },
  { code: 'dist-outils', kind: 'distribution', title: 'Distribution d\'outils de taille et de récolte', description: 'Sécateurs, scies de taille, machettes et échenilloirs.',
    instructions: 'Remise contre signature. Rappeler l\'entretien des outils et la taille sanitaire (retrait des cabosses malades).', articles: ['Sécateur', 'Scie de taille', 'Échenilloir'] },
  { code: 'dist-sacs', kind: 'distribution', title: 'Distribution de sacs de jute et de bâches de séchage', description: 'Matériel de conditionnement et de séchage pour garder la qualité des fèves.',
    instructions: 'Remise par producteur selon la production attendue. Rappeler le séchage sur bâche ou claie, jamais au sol.', articles: ['Sacs de jute', 'Bâche de séchage'] },
  { code: 'dist-fermentation', kind: 'distribution', title: 'Distribution de matériel de fermentation', description: 'Caisses de fermentation et claies pour une fermentation et un séchage réguliers.',
    instructions: 'Remise accompagnée d\'une démonstration de la fermentation (durée, brassage) et du séchage.', articles: ['Caisse de fermentation', 'Claie de séchage'] },
  // ── Services
  { code: 'serv-assistance-technique', kind: 'service', title: 'Service d\'assistance technique : visite conseil', description: 'Visite d\'un conseiller agricole sur l\'exploitation.',
    instructions: 'Visiter l\'exploitation, relever les points à améliorer (taille, ombrage, maladies, séchage) et noter les conseils donnés. Reporter la date de la prochaine visite.' },
  { code: 'serv-preffinancement', kind: 'service', title: 'Service de préfinancement des intrants', description: 'Avance en nature ou en espèces remboursée sur les livraisons de la campagne.',
    instructions: 'Vérifier l\'éligibilité du producteur, établir le plan de remboursement avec lui et enregistrer l\'avance. Rappeler que le remboursement se fait sur les livraisons.' },
  { code: 'serv-traitement-groupe', kind: 'service', title: 'Service de traitement phytosanitaire groupé', description: 'Application des produits par une équipe formée, avec équipements de protection.',
    instructions: 'Équipe d\'applicateurs formés. Respecter les produits homologués, les doses et les zones de non-application ; tenir le registre des applications.' },
  { code: 'serv-taille-groupee', kind: 'service', title: 'Service de taille et d\'entretien groupés', description: 'Taille de formation et sanitaire, égourmandage, entretien des parcelles.',
    instructions: 'Intervention par parcelle avec l\'équipe d\'entretien. Noter la superficie traitée et les observations sanitaires.' },
  { code: 'serv-transport', kind: 'service', title: 'Service de transport des récoltes', description: 'Collecte et transport des sacs jusqu\'au magasin de la coopérative.',
    instructions: 'Planifier la tournée avec le délégué ; noter le nombre de sacs enlevés par producteur et l\'heure de passage.' },
  { code: 'serv-mobile-money', kind: 'service', title: 'Service d\'épargne et de paiement par mobile money', description: 'Ouverture du compte et accompagnement pour recevoir les paiements.',
    instructions: 'Aider le producteur à ouvrir son compte, vérifier le numéro et expliquer la réception des paiements et l\'épargne.' },
  { code: 'serv-certification', kind: 'service', title: 'Service d\'appui à la certification', description: 'Préparation du producteur à l\'inspection interne et à l\'audit externe.',
    instructions: 'Passer en revue les exigences avec le producteur, aider à tenir les registres, planifier l\'inspection interne et le suivi des non-conformités.' },
  { code: 'serv-sante', kind: 'service', title: 'Service de santé et de sécurité au travail', description: 'Sensibilisation aux premiers secours et à la sécurité des travailleurs.',
    instructions: 'Vérifier la boîte de premiers secours, l\'eau potable et les équipements de protection ; rappeler les gestes de premiers secours.' },
];
