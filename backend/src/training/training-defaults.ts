/**
 * Modules de formation chargés par défaut dans chaque coopérative : cacao en priorité, café ensuite.
 * Contenu de départ rédigé de façon générale : l'ADG le relit, le conserve, l'adapte au cahier des charges de la certification visée
 * et à la réglementation en vigueur (elles évoluent), ou le supprime. Aucun chiffre réglementaire précis n'est donné quand il peut changer.
 */
export type TrainingContent = {
  objectifs: string[];
  sections: { titre: string; points: string[] }[];
  a_eviter: string[];
  verifier: string[];
  materiel: string[];
};
export type DefaultModule = {
  code: string; theme: string; title: string; summary: string; crops: ('cacao' | 'cafe')[]; certifications: string[];
  level: 'base' | 'intermediaire' | 'avance'; duration_min: number; content: TrainingContent;
};

const m = (code: string, theme: string, title: string, summary: string, crops: ('cacao' | 'cafe')[], certifications: string[], level: DefaultModule['level'], duration_min: number,
  objectifs: string[], sections: [string, string[]][], a_eviter: string[], verifier: string[], materiel: string[] = []): DefaultModule => ({
  code, theme, title, summary, crops, certifications, level, duration_min,
  content: { objectifs, sections: sections.map(([titre, points]) => ({ titre, points })), a_eviter, verifier, materiel },
});

const RA = 'Rainforest Alliance', FT = 'Fairtrade', EUDR = 'EUDR', CLMRS = 'Suivi du travail des enfants', BASE = 'Toutes certifications';
const C: ('cacao')[] = ['cacao'], K: ('cafe')[] = ['cafe'], CK: ('cacao' | 'cafe')[] = ['cacao', 'cafe'];

export const DEFAULT_TRAINING_MODULES: DefaultModule[] = [
  // ───────────────────────── Normes et réglementations de certification
  m('cacao-panorama-certifications', 'Normes et réglementations de certification', 'Comprendre les certifications du cacao',
    'À quoi servent les certifications, ce qu\'elles demandent au producteur et à la coopérative, et ce qu\'elles ne garantissent pas.', C, [RA, FT, BASE], 'base', 60,
    ['Expliquer en mots simples ce qu\'est une certification et qui la contrôle', 'Distinguer le prix du cacao, la prime et le coût de la mise en conformité', 'Citer ce que le producteur doit faire au quotidien pour rester conforme'],
    [['Ce qu\'est une certification', ['Une norme écrite (bonnes pratiques agricoles, droits humains, environnement) vérifiée par un organisme indépendant lors d\'audits.', 'La coopérative est certifiée en groupe : chaque producteur membre est concerné, et l\'audit vérifie un échantillon de producteurs et le système interne de contrôle.', 'Le certificat appartient à la coopérative ; un producteur qui ne respecte pas les règles peut être suspendu du programme.']],
     ['Ce que le producteur doit faire', ['Être enregistré (fiche producteur) et avoir ses parcelles localisées.', 'Appliquer les bonnes pratiques agricoles et utiliser les produits autorisés de façon sûre.', 'Ne pas faire travailler d\'enfants à des tâches dangereuses ; respecter les travailleurs.', 'Ne pas défricher la forêt ni cultiver en zone protégée.', 'Vendre par les circuits de la coopérative pour que le cacao reste tracé.']],
     ['Prix, prime, bénéfices', ['La prime est un supplément versé pour le cacao certifié vendu comme tel ; son montant et son usage sont décidés selon les règles du programme et de la coopérative.', 'Une certification ne garantit pas à elle seule un meilleur revenu : la qualité, la productivité et les volumes comptent autant.', 'La coopérative doit rendre compte de l\'usage de la prime aux membres (assemblée générale).']],
     ['Rôle du coach', ['Expliquer ces règles lors des visites, relever les écarts, aider à les corriger, et faire remonter les cas graves à l\'ADG.']]],
    ['Promettre un revenu ou une prime précise avant de la connaître', 'Présenter la certification comme une obligation « du bureau » sans en expliquer l\'intérêt', 'Cacher un écart constaté au lieu de le signaler pour le corriger'],
    ['Qui contrôle la coopérative et comment ?', 'Que se passe-t-il si un producteur emploie un enfant à un travail dangereux ?', 'Pourquoi vendre en dehors de la coopérative pose-t-il un problème de traçabilité ?'], ['Fiches producteurs', 'Affiche des règles de base']),

  m('cacao-rainforest-alliance', 'Normes et réglementations de certification', 'Rainforest Alliance : ce que le producteur doit appliquer',
    'Les grands blocs de la norme d\'agriculture durable Rainforest Alliance appliqués à l\'exploitation de cacao.', C, [RA], 'intermediaire', 90,
    ['Présenter les grands blocs de la norme : gestion, traçabilité, revenu, droits humains, environnement', 'Relier chaque bloc à une pratique concrète sur la parcelle', 'Préparer le producteur à répondre aux questions d\'un auditeur'],
    [['Les grands blocs', ['Gestion et planification : connaître son exploitation, faire un plan simple d\'amélioration et le suivre.', 'Traçabilité : le cacao certifié reste identifié du champ à la coopérative.', 'Revenu et moyens d\'existence : productivité, diversification, accès aux services.', 'Droits humains et sociaux : pas de travail forcé, pas de travail des enfants dangereux, pas de discrimination, conditions de travail sûres.', 'Environnement : protection des forêts et des écosystèmes, arbres d\'ombrage, gestion de l\'eau et des sols, usage raisonné des pesticides.']],
     ['Ce que l\'auditeur regarde', ['Registres tenus à jour (achats d\'intrants, main-d\'œuvre, récolte, ventes).', 'Parcelles localisées et cohérentes avec les superficies déclarées.', 'Stockage correct des produits phytosanitaires, équipements de protection disponibles.', 'Entretiens avec des travailleurs et des producteurs, y compris les femmes.']],
     ['Bonnes habitudes', ['Avoir toujours sur soi la fiche du producteur et le carnet de l\'exploitation.', 'Corriger vite les écarts relevés lors du contrôle interne : un écart corrigé et documenté pèse moins qu\'un écart ignoré.']]],
    ['Utiliser un produit interdit « parce que le voisin le fait »', 'Défricher une zone boisée pour agrandir la parcelle', 'Laisser des enfants manipuler des produits ou des machettes'],
    ['Quels sont les cinq blocs de la norme ?', 'Quels documents le producteur doit-il pouvoir montrer ?', 'Que faire d\'un écart constaté lors d\'une visite ?'], ['Carnet d\'exploitation', 'Fiche de contrôle interne']),

  m('cacao-fairtrade', 'Normes et réglementations de certification', 'Fairtrade : prix minimum, prime et démocratie',
    'Les principes Fairtrade pour une organisation de producteurs de cacao : prix minimum, prime de développement, gouvernance.', C, [FT], 'intermediaire', 75,
    ['Expliquer le principe du prix minimum et de la prime de développement', 'Décrire le rôle de l\'assemblée et du comité de gestion de la prime', 'Savoir répondre aux questions des membres sur l\'usage de la prime'],
    [['Principes', ['Un prix minimum garanti protège le producteur quand les cours mondiaux baissent ; quand le marché est plus haut, le prix du marché s\'applique.', 'Une prime de développement s\'ajoute au prix et finance des projets décidés collectivement.', 'L\'organisation est démocratique : un membre, une voix ; transparence des comptes.']],
     ['La prime', ['Un comité élu propose un plan d\'utilisation (écoles, santé, eau, matériel, services aux producteurs) ; l\'assemblée générale l\'approuve.', 'Chaque dépense est justifiée, enregistrée et présentée aux membres.', 'La prime ne remplace pas le prix payé au producteur et ne sert pas à des dépenses personnelles.']],
     ['Conditions sociales et environnementales', ['Mêmes principes de fond : pas de travail forcé, pas de travail des enfants dangereux, non-discrimination, sécurité au travail, protection de l\'environnement.', 'Les produits dangereux de la liste Fairtrade sont interdits ou strictement encadrés.']]],
    ['Annoncer un montant de prime avant décision de l\'assemblée', 'Utiliser la prime sans vote ni justificatif', 'Écarter les femmes ou les jeunes des décisions'],
    ['Que se passe-t-il pour le prix quand le marché est supérieur au minimum ?', 'Qui décide de l\'usage de la prime ?', 'Quelle pièce justifie une dépense de prime ?'], ['Compte rendu d\'assemblée (modèle)']),

  m('cacao-eudr', 'Normes et réglementations de certification', 'Règlement européen sur la déforestation (EUDR)',
    'Ce que le règlement de l\'Union européenne exige pour le cacao qui y est vendu et ce que cela change sur le terrain.', C, [EUDR], 'intermediaire', 75,
    ['Expliquer pourquoi la localisation précise des parcelles est exigée', 'Citer les exigences principales : absence de déforestation après la date de référence, légalité, diligence raisonnée', 'Faire correctement le relevé d\'une parcelle'],
    [['L\'essentiel', ['Le cacao vendu dans l\'Union européenne ne doit pas provenir de terres déboisées ou dégradées après le 31 décembre 2020, et doit être produit légalement.', 'L\'opérateur européen doit prouver l\'origine jusqu\'à la parcelle : géolocalisation, traçabilité, évaluation des risques (déclaration de diligence raisonnée).', 'Les dates d\'application et les détails (taille des opérateurs, classement des pays) ont évolué : l\'ADG tient à jour le calendrier officiel en vigueur.']],
     ['Ce que cela change pour le producteur', ['Chaque parcelle doit avoir un tracé fiable : polygone relevé à pied autour de la parcelle pour les plus grandes, point pour les plus petites selon la règle applicable.', 'Aucune extension en forêt, en forêt classée ou en aire protégée.', 'Les documents de propriété ou d\'usage de la terre sont recueillis quand ils existent.']],
     ['Relevé GPS : bonnes pratiques', ['Attendre un signal stable, marcher le long de la limite de la parcelle, fermer le polygone, vérifier la précision.', 'Un relevé par parcelle, rattaché au bon producteur.', 'Signaler les chevauchements avec d\'autres parcelles ou avec une zone protégée : ils sont traités par la cellule de cartographie, pas cachés.']],
     ['Dans AgriTrace', ['Les anomalies géographiques (chevauchement, zone protégée) sont détectées et suivies ; l\'historique des versions du tracé est conservé.']]],
    ['Relever un point loin de la parcelle (au bord de la route) à la place du contour', 'Déplacer une limite pour éviter une zone protégée', 'Mélanger le cacao de parcelles non conformes avec le cacao tracé'],
    ['Quelle est la date de référence de non-déforestation ?', 'Pourquoi le simple village ne suffit-il pas comme localisation ?', 'Que faire si la parcelle touche une forêt classée ?'], ['Téléphone avec GPS chargé', 'Fiche de relevé']),

  m('cacao-tracabilite', 'Normes et réglementations de certification', 'Traçabilité : du producteur au magasin',
    'Comment le cacao reste identifié du champ jusqu\'à l\'exportation : déclaration d\'achat, convoi, pesée, reçu, lot.', C, [RA, FT, EUDR, BASE], 'base', 60,
    ['Suivre le trajet d\'un sac de cacao et dire quel document le décrit à chaque étape', 'Expliquer le numéro de connaissement d\'un convoi', 'Reconnaître les erreurs qui cassent la traçabilité'],
    [['Les étapes', ['Achat chez le producteur : le délégué déclare l\'achat (producteur, quantité, date) et remet un reçu.', 'Convoi : les achats sont regroupés dans un convoi qui porte un numéro de connaissement unique.', 'Réception au magasin : pesée, comparaison avec le poids annoncé, écart expliqué.', 'Règlement et lot : le convoi est réglé, puis le cacao entre dans un lot suivi (stock, qualité, expédition).']],
     ['Le numéro de connaissement', ['Format : code CCC de la coopérative – année – 3 premières lettres du nom du délégué – numéro d\'ordre.', 'Attribué automatiquement ; il accompagne le convoi sur le papier et dans le logiciel.']],
     ['Ce qui casse la traçabilité', ['Mélanger du cacao de producteurs ou de parcelles non conformes.', 'Un achat non déclaré ou déclaré au mauvais producteur.', 'Un convoi sans numéro ou modifié après coup (les corrections se font par demande d\'annulation approuvée, jamais par effacement).']]],
    ['Réécrire un reçu au lieu de demander une annulation', 'Charger dans un convoi des sacs d\'un autre délégué', 'Peser sans noter le poids'],
    ['Quel document décrit l\'achat chez le producteur ?', 'À quoi sert le numéro de connaissement ?', 'Comment corrige-t-on une erreur de saisie ?']),

  m('cacao-registres-exploitation', 'Collecte de documents et tenue de registres', 'Tenir le carnet de l\'exploitation',
    'Les registres simples que le producteur doit tenir : intrants, main-d\'œuvre, récoltes, ventes.', C, [RA, FT, BASE], 'base', 45,
    ['Montrer un carnet d\'exploitation minimal', 'Aider un producteur peu lettré à garder des preuves simples', 'Savoir quoi vérifier lors d\'une visite'],
    [['Ce qu\'on note', ['Achat et usage des intrants : produit, date, parcelle, quantité, personne qui l\'a appliqué.', 'Main-d\'œuvre : qui travaille, quelle tâche, quel âge pour les jeunes, paiement.', 'Récolte et ventes : date, quantité, acheteur, numéro de reçu.', 'Visites et formations reçues.']],
     ['Conseils pratiques', ['Un cahier avec une page par parcelle et une par campagne ; une date à chaque ligne.', 'Garder les reçus et les factures dans une pochette plastique.', 'Pour les producteurs qui n\'écrivent pas : un proche de confiance, ou des photos datées prises par le coach.']]],
    ['Remplir le carnet la veille de l\'audit', 'Inventer des quantités', 'Laisser les enfants noter à la place de l\'adulte pour une tâche dangereuse'],
    ['Où trouve-t-on la date du dernier traitement ?', 'Que montre-t-on pour prouver une vente ?'], ['Carnet', 'Pochette']),

  m('cacao-cartographie-parcelles', 'Collecte de documents et tenue de registres', 'Cartographier les parcelles',
    'Relever, vérifier et corriger le tracé d\'une parcelle de cacao ; éviter les chevauchements et les zones protégées.', C, [EUDR, RA], 'intermediaire', 60,
    ['Relever un polygone propre avec le téléphone', 'Comparer la superficie relevée et la superficie déclarée', 'Réagir à une anomalie (chevauchement, zone protégée)'],
    [['Préparer', ['Charger complètement le téléphone, activer le GPS haute précision, télécharger les cartes hors connexion.', 'Rencontrer le producteur et faire désigner les limites avec lui et ses voisins.']],
     ['Relever', ['Marcher le long de la limite, sans couper les coins ; fermer le polygone au point de départ.', 'Photographier les repères (arbres, ruisseaux, bornes).', 'Si la parcelle est très étendue ou boisée, relever en plusieurs passages et signaler la difficulté.']],
     ['Contrôler', ['La superficie relevée est comparée à la superficie déclarée : un écart important est expliqué ou corrigé.', 'Les chevauchements avec d\'autres parcelles sont signalés au responsable de la cartographie.', 'Une parcelle qui touche une aire protégée n\'est pas déplacée : elle est signalée.']]],
    ['Relever depuis la route ou depuis le véhicule', 'Redessiner à la main un polygone pour supprimer un chevauchement', 'Oublier de rattacher la parcelle au bon producteur'],
    ['Pourquoi marcher le long de la limite ?', 'Que faire d\'un chevauchement avec le voisin ?'], ['Téléphone avec GPS', 'Cartes hors connexion']),

  // ───────────────────────── Agriculture régénératrice / bonnes pratiques
  m('cacao-creation-entretien-cacaoyere', 'Agriculture régénératrice', 'Créer et entretenir une cacaoyère',
    'Choix du terrain et des plants, plantation, entretien des jeunes plants, regarnissage et rajeunissement.', C, [RA, BASE], 'base', 90,
    ['Choisir un terrain et des plants adaptés', 'Planter et entretenir les jeunes cacaoyers', 'Décider quand regarnir ou rajeunir une vieille parcelle'],
    [['Choisir le terrain et les plants', ['Sol profond, bien drainé, à l\'abri des vents forts ; ne jamais défricher la forêt pour planter.', 'Utiliser des plants améliorés, vigoureux, issus de pépinières ou de vergers à graines reconnus (par exemple fournis par les services agricoles).', 'Prévoir l\'ombrage temporaire (bananier, manioc) et les arbres d\'ombrage permanents avant ou avec la plantation.']],
     ['Planter', ['Écartement régulier (par exemple environ 3 m × 3 m, soit autour de 1 100 plants par hectare ; suivre les conseils locaux).', 'Trou assez grand, planter en début de saison des pluies, tasser légèrement, arroser si nécessaire.']],
     ['Entretenir', ['Désherber autour des jeunes plants sans abîmer l\'écorce ; pailler.', 'Remplacer les plants morts la première ou la deuxième année (regarnissage).', 'Sur une vieille parcelle peu productive : rajeunir par taille ou greffage plutôt que replanter sur une nouvelle zone de forêt.']]],
    ['Planter trop serré ou sans ombrage', 'Brûler la parcelle sans précaution', 'Utiliser des graines de pieds malades'],
    ['Pourquoi ne pas défricher pour planter ?', 'Quand regarnit-on ?'], ['Machette propre', 'Cordeau', 'Plants améliorés']),

  m('cacao-taille', 'Agriculture régénératrice', 'La taille du cacaoyer',
    'Taille de formation, d\'entretien et sanitaire : pourquoi, quand et comment tailler pour augmenter et sécuriser la production.', C, [RA, BASE], 'base', 75,
    ['Distinguer taille de formation, d\'entretien et sanitaire', 'Tailler proprement et sans blesser l\'arbre', 'Reconnaître les branches à supprimer'],
    [['Pourquoi tailler', ['Donner à l\'arbre une forme basse et équilibrée, facile à récolter et à traiter.', 'Faire entrer la lumière et l\'air : moins de maladies, plus de cabosses saines.', 'Retirer le bois mort ou malade.']],
     ['Comment', ['Outils propres et bien affûtés (sécateur, scie, croissant) ; coupe nette et légèrement inclinée.', 'Supprimer les gourmands, les branches mortes, croisées ou trop basses ; garder les branches charpentières bien réparties.', 'Désinfecter l\'outil entre deux arbres malades.']],
     ['Quand', ['De préférence en fin de saison des pluies ou après la grande récolte, sans surcharger l\'arbre en une seule fois.', 'Tailler en même temps que la régulation de l\'ombrage.']]],
    ['Tailler fortement en pleine floraison', 'Laisser les chicots (moignons) qui pourrissent', 'Laisser les branches malades au pied de l\'arbre'],
    ['Quels sont les trois types de taille ?', 'Pourquoi désinfecter l\'outil ?'], ['Sécateur', 'Scie à main', 'Gants']),

  m('cacao-agroforesterie-ombrage', 'Agriculture régénératrice', 'Agroforesterie et arbres d\'ombrage',
    'Intégrer des arbres dans la cacaoyère : ombrage, sol, biodiversité, revenus complémentaires.', C, [RA, EUDR], 'intermediaire', 75,
    ['Expliquer pourquoi des arbres dans la cacaoyère aident le cacaoyer', 'Choisir des espèces utiles et adaptées', 'Régler l\'ombrage selon l\'âge de la plantation'],
    [['Pourquoi', ['L\'ombre régulée protège les jeunes cacaoyers et limite le stress des fortes chaleurs.', 'Les arbres enrichissent et protègent le sol, abritent des auxiliaires, stockent du carbone.', 'Certains arbres donnent aussi du bois, des fruits ou des médicaments : revenu supplémentaire.']],
     ['Comment', ['Conserver les grands arbres utiles déjà présents lors de la création de la parcelle (selon la réglementation sur les arbres et le permis éventuel).', 'Planter des espèces variées plutôt qu\'une seule ; éviter les espèces qui concurrencent trop le cacaoyer ou hébergent des maladies.', 'Viser un ombrage plus fort pour les jeunes plants, plus léger pour les arbres adultes productifs (suivre le seuil indiqué par la certification visée).']],
     ['Règles à connaître', ['Les arbres d\'ombrage plantés sur la parcelle ne sont pas coupés sans autorisation si leur statut est protégé.', 'La régénération d\'arbres sert la preuve environnementale demandée par certaines normes.']]],
    ['Abattre tous les grands arbres pour « donner de la lumière »', 'Planter un seul type d\'arbre partout', 'Couper un arbre protégé sans autorisation'],
    ['Quels arbres conserver ?', 'Quand réduire l\'ombrage ?'], ['Liste d\'espèces locales (à compléter par l\'ADG)']),

  m('cacao-fertilite-sol', 'Agriculture régénératrice', 'Fertilité du sol, compost et couverture',
    'Maintenir un sol vivant : litière, paillage, compost, fertilisation raisonnée, lutte contre l\'érosion.', C, [RA], 'intermediaire', 75,
    ['Expliquer pourquoi le sol s\'appauvrit sans apport', 'Fabriquer du compost simple', 'Limiter l\'érosion sur les pentes'],
    [['Principes', ['Le sol nourrit l\'arbre : feuilles, branches et coques de cabosses doivent retourner au sol.', 'Une couverture permanente (litière, paillage) garde l\'humidité, freine les mauvaises herbes et l\'érosion.', 'La fertilisation s\'adapte au sol et au rendement visé : observer, demander conseil, éventuellement faire analyser.']],
     ['Pratiques', ['Compost de coques de cabosses et de déchets végétaux, retourné régulièrement.', 'Sur les pentes : lignes d\'arbres ou de plantes de couverture perpendiculaires à la pente.', 'Engrais minéraux : seulement les produits recommandés, dosés correctement, jamais près des cours d\'eau.']],
     ['Santé du sol', ['Ne pas laisser le sol nu pendant la saison sèche.', 'Éviter de brûler les résidus de récolte quand on peut les composter.']]],
    ['Laisser les coques de cabosses près des troncs sans traitement (risque de maladies)', 'Appliquer un engrais au hasard', 'Cultiver sur forte pente sans protection'],
    ['Pourquoi garder une litière au sol ?', 'Où ne faut-il jamais épandre d\'engrais ?'], ['Fourche', 'Brouette']),

  m('cacao-ravageurs-maladies', 'Agriculture régénératrice', 'Ravageurs et maladies du cacaoyer : lutte intégrée',
    'Reconnaître la pourriture brune, le swollen shoot, les mirides et appliquer d\'abord les méthodes préventives.', C, [RA, FT], 'intermediaire', 90,
    ['Reconnaître les principaux problèmes sanitaires', 'Appliquer la lutte intégrée : prévention, observation, traitement en dernier recours', 'Savoir quand alerter l\'encadrement'],
    [['Principaux problèmes', ['Pourriture brune des cabosses (Phytophthora) : taches brunes qui envahissent la cabosse, favorisée par l\'humidité.', 'Swollen shoot (virus transmis par des cochenilles) : gonflements des rameaux, feuilles marbrées, déclin de l\'arbre ; maladie grave dont les foyers doivent être signalés.', 'Mirides (capsides) : piqûres sur cabosses et jeunes rameaux, dessèchement des pousses.']],
     ['Lutte intégrée', ['Prévenir : taille, ombrage régulé, drainage, récolte fréquente et élimination des cabosses malades.', 'Observer : passer régulièrement dans la parcelle et noter ce qu\'on voit.', 'Traiter en dernier recours, avec un produit autorisé, au bon moment et en suivant la notice.']],
     ['Swollen shoot', ['Ne pas déplacer de plants ou de rameaux d\'une zone atteinte.', 'Signaler les arbres suspects au service agricole ou à l\'encadrement : l\'élimination des arbres atteints et le remplacement par des plants tolérants suivent la procédure officielle.']]],
    ['Laisser les cabosses malades pourrir sous l\'arbre', 'Traiter sans avoir identifié le problème', 'Déplacer des plants d\'une parcelle contaminée'],
    ['Comment reconnaît-on la pourriture brune ?', 'Qui alerter en cas de suspicion de swollen shoot ?'], ['Fiche illustrée des maladies (à ajouter)']),

  m('cacao-produits-phytosanitaires', 'Santé et sécurité au travail', 'Utiliser les produits phytosanitaires en sécurité',
    'Produits autorisés et interdits, équipement de protection, préparation, application, stockage et gestion des emballages.', C, [RA, FT, BASE], 'base', 75,
    ['Utiliser uniquement des produits autorisés', 'Se protéger et protéger les autres', 'Stocker et éliminer correctement'],
    [['Avant d\'acheter', ['Lire l\'étiquette ; n\'utiliser que des produits homologués pour le cacao dans le pays.', 'Respecter la liste des produits interdits ou très dangereux de la certification visée.']],
     ['Appliquer', ['Équipement : gants, bottes, combinaison ou vêtements couvrants, masque, lunettes.', 'Ne pas traiter par grand vent ni sous la pluie ; ne pas manger, boire ni fumer pendant le traitement.', 'Les femmes enceintes ou allaitantes et les moins de 18 ans ne manipulent pas ces produits.', 'Ne pas traiter près des cours d\'eau, des habitations ou des écoles.']],
     ['Stocker et éliminer', ['Local fermé à clé, à l\'écart des habitations, des aliments et de l\'eau, produits dans leur emballage d\'origine.', 'Rincer trois fois les bidons vides, les percer, ne jamais les réutiliser pour l\'eau ou la nourriture.', 'Noter chaque traitement dans le carnet.']]],
    ['Réutiliser un emballage de produit', 'Traiter avec les mains nues ou en sandales', 'Laisser un enfant remplir le pulvérisateur'],
    ['Quel équipement avant de traiter ?', 'Où stocke-t-on les produits ?', 'Que fait-on des bidons vides ?'], ['Gants', 'Masque', 'Bottes', 'Combinaison']),

  // ───────────────────────── Gestion des récoltes et des produits
  m('cacao-recolte-ecabossage', 'Gestion des récoltes et des produits', 'Récolte et écabossage',
    'Récolter les cabosses mûres, les ouvrir proprement et trier les fèves avant la fermentation.', C, [RA, FT, BASE], 'base', 60,
    ['Reconnaître une cabosse mûre', 'Récolter et écabosser sans abîmer l\'arbre ni les fèves', 'Écarter les cabosses malades ou abîmées'],
    [['Récolter', ['Cueillir les cabosses mûres seulement (changement de couleur) ; couper le pédoncule sans blesser le coussinet floral.', 'Passer souvent dans la parcelle pour ne pas laisser de cabosses trop mûres (germination) ou malades.']],
     ['Écabosser', ['Ouvrir avec un bâton ou un outil émoussé, sans entailler les fèves ; ne pas utiliser de machette tranchante près des mains.', 'Écabosser le plus tôt possible après la récolte, idéalement dans les cinq jours.', 'Retirer le placenta, les fèves germées, plates, abîmées ou malades.']],
     ['Hygiène', ['Plan de travail propre, sacs et bâches propres, mains propres ; éloigner animaux et carburants.', 'Coques de cabosses : les composter loin des troncs plutôt que les laisser en tas.']]],
    ['Écabosser sur la terre nue', 'Mélanger les fèves de cabosses malades avec les bonnes', 'Laisser les enfants manier la machette'],
    ['Comment sait-on qu\'une cabosse est mûre ?', 'Pourquoi trier avant la fermentation ?'], ['Bâton d\'écabossage', 'Bâche propre']),

  m('cacao-fermentation', 'Gestion des récoltes et des produits', 'Fermentation du cacao',
    'Fermenter correctement pour développer les arômes et réduire l\'amertume : durée, brassage, caisses ou tas.', C, [BASE], 'intermediaire', 60,
    ['Expliquer à quoi sert la fermentation', 'Conduire une fermentation régulière en caisse ou en tas', 'Reconnaître une fermentation ratée'],
    [['Principe', ['La pulpe sucrée qui entoure les fèves se transforme sous l\'action de micro-organismes ; la chaleur tue le germe et déclenche les réactions qui donnent les précurseurs d\'arôme.']],
     ['Conduite', ['Quantité suffisante (au moins quelques centaines de kilos) pour garder la chaleur ; fond drainant pour évacuer le jus.', 'Couvrir de feuilles de bananier propres.', 'Brasser (retourner) après environ 48 heures, puis régulièrement ; durée courante de cinq à six jours selon la variété et la météo, à ajuster avec les conseils de la coopérative.', 'Ne pas mélanger des lots de dates différentes.']],
     ['Signes d\'une mauvaise fermentation', ['Odeur de pourri ou de fumée ; fèves violettes à l\'intérieur après séchage (sous-fermentées) ; fèves moisies ou à goût de fumier (sur-fermentées).']]],
    ['Faire fermenter sur la terre nue', 'Ajouter des fèves fraîches à un tas en cours de fermentation', 'Arrêter la fermentation trop tôt'],
    ['Pourquoi brasser ?', 'Combien de temps dure en général la fermentation ?'], ['Caisse de fermentation', 'Feuilles de bananier']),

  m('cacao-sechage-stockage', 'Gestion des récoltes et des produits', 'Séchage et stockage du cacao',
    'Sécher sur claies ou aire propre, tester le taux d\'humidité et stocker à l\'abri pour garder la qualité.', C, [BASE], 'base', 60,
    ['Sécher les fèves sans contamination', 'Vérifier le séchage avec des moyens simples', 'Stocker sans moisissure ni odeur étrangère'],
    [['Séchage', ['Étaler en couche mince sur claies surélevées ou bâches propres, jamais sur le sol, la route ou du béton sale ; remuer régulièrement.', 'Protéger de la pluie et de la rosée ; éloigner les animaux.', 'Séchage au feu : éviter la fumée, qui laisse un goût indésirable dans le cacao.']],
     ['Vérifier', ['Cible usuelle d\'humidité autour de 7 à 8 %, la référence de qualité étant souvent 7,5 % ; la règle de la coopérative (module Qualité) fait foi.', 'Test simple : une poignée de fèves doit craquer sans être friable, la fève se casse avec un bruit sec.']],
     ['Stocker', ['Sacs propres sur palettes, à distance des murs, dans un local sec, aéré, éloigné des carburants, produits chimiques et fumées.', 'Ne pas mélanger cacao sec et cacao humide dans le même sac.']]],
    ['Sécher sur la route', 'Ensacher un cacao encore humide', 'Stocker avec de l\'essence ou des pesticides'],
    ['Quel taux d\'humidité vise-t-on ?', 'Pourquoi ne pas sécher au sol ?'], ['Claies ou bâches', 'Testeur d\'humidité (si disponible)']),

  m('cacao-qualite-defauts', 'Gestion des récoltes et des produits', 'Qualité du cacao et défauts courants',
    'Reconnaître les défauts (moisi, ardoisé, mité, germé) et faire le test de coupe pour apprécier un lot.', C, [BASE], 'intermediaire', 60,
    ['Citer les principaux défauts et leurs causes', 'Faire un test de coupe', 'Relier chaque défaut à une étape du travail'],
    [['Défauts courants', ['Fèves moisies : séchage insuffisant ou stockage humide.', 'Fèves ardoisées (grises) : fermentation insuffisante.', 'Fèves mitées ou attaquées par des insectes : stockage long ou non protégé.', 'Fèves germées ou plates : cabosses trop mûres ou mauvais tri.', 'Odeur de fumée : séchage au feu mal conduit.']],
     ['Test de coupe', ['Prélever un échantillon représentatif du lot, couper les fèves en deux dans le sens de la longueur et observer la couleur intérieure.', 'Compter les fèves défectueuses ; comparer au seuil fixé par la coopérative ou l\'acheteur.']],
     ['Dans AgriTrace', ['Les règles qualité (par exemple l\'humidité) et les inspections sont enregistrées par lot ; un lot non conforme est bloqué avant expédition.']]],
    ['Mélanger un lot déclassé avec des lots conformes', 'Cacher un défaut pour obtenir un meilleur prix'],
    ['Quelle cause pour une fève ardoisée ?', 'Comment prélève-t-on un échantillon ?'], ['Couteau', 'Plateau de comptage']),

  // ───────────────────────── Droits de l'homme, santé et sécurité
  m('cacao-travail-enfants', "Entreprise responsable et droits de l'homme", 'Prévenir le travail des enfants',
    'Distinguer l\'aide familiale acceptable du travail dangereux ; système de suivi et de remédiation.', C, [RA, FT, CLMRS], 'base', 90,
    ['Distinguer les travaux autorisés et interdits aux enfants', 'Expliquer le principe de suivi et de remédiation', 'Savoir réagir à un cas sans stigmatiser la famille'],
    [['Cadre', ['Les enfants peuvent aider à des tâches légères adaptées à leur âge, sans nuire à leur santé ni à leur scolarité.', 'Les tâches dangereuses (machette, pulvérisation de produits, port de charges lourdes, brûlis) sont interdites aux moins de 18 ans.', 'L\'âge minimum d\'admission à l\'emploi et les travaux interdits sont fixés par la loi du pays (vérifier le texte en vigueur auprès de l\'ADG ou des autorités du travail).']],
     ['Suivi et remédiation', ['Sensibiliser les ménages, identifier les situations à risque, enregistrer les cas, accompagner les familles (scolarisation, extrait de naissance, activités génératrices de revenus).', 'L\'objectif est de protéger l\'enfant, pas de punir la famille ; les cas graves sont transmis à la hiérarchie et, si nécessaire, aux autorités compétentes.']],
     ['Comment en parler', ['Écouter sans accuser ; expliquer les risques ; proposer des alternatives (main-d\'œuvre adulte, groupes d\'entraide).', 'Ne jamais prendre de photo d\'un enfant sans accord d\'un responsable adulte.']]],
    ['Faire travailler un enfant avec une machette ou un pulvérisateur', 'Dénoncer publiquement une famille', 'Ignorer un cas observé'],
    ['Citez trois travaux dangereux pour un enfant.', 'Qui prévenir en cas de cas grave ?'], ['Fiche de signalement']),

  m('cacao-sante-securite-travail', 'Santé et sécurité au travail', 'Santé et sécurité sur l\'exploitation',
    'Prévenir les accidents et maladies : outils, chaleur, eau potable, premiers secours, travailleurs.', CK, [RA, FT], 'base', 60,
    ['Identifier les risques sur la parcelle', 'Équiper et protéger les travailleurs', 'Réagir à un accident léger'],
    [['Risques', ['Coupures (machette, sécateur), morsures de serpent, chutes, chaleur, produits chimiques, charges lourdes.']],
     ['Prévention', ['Outils en bon état, rangés après usage ; bottes, gants, vêtements couvrants.', 'Eau potable et pauses à l\'ombre ; ne pas travailler seul dans les zones isolées si possible.', 'Une trousse de premiers secours avec les numéros d\'urgence et du centre de santé le plus proche.']],
     ['Travailleurs', ['Pas de travail forcé ; paiement à temps ; mêmes règles pour les saisonniers et les femmes.', 'Les mineurs ne font pas les travaux dangereux.']]],
    ['Travailler sans protection pendant le traitement', 'Retarder les soins d\'une plaie'],
    ['Que contient la trousse de premiers secours ?', 'Où est le centre de santé le plus proche ?'], ['Trousse de premiers secours']),

  m('cacao-genre-inclusion', 'Genre, jeunesse, et inclusion', 'Femmes, jeunes et inclusion dans la filière cacao',
    'Reconnaître le rôle des femmes et des jeunes, accès à la terre, à la formation et aux décisions.', CK, [RA, FT], 'base', 60,
    ['Citer les obstacles à la participation des femmes et des jeunes', 'Proposer des actions simples pour y répondre', 'Faire participer chacun aux formations'],
    [['Constat', ['Les femmes assurent une grande partie du travail du cacao mais accèdent moins à la terre, au crédit, à la formation et aux postes de décision.', 'Les jeunes quittent la filière si elle n\'offre pas de perspective de revenu.']],
     ['Actions', ['Inviter les femmes aux formations, choisir des horaires et des lieux adaptés, inscrire leurs noms comme participantes.', 'Appuyer les activités de revenu gérées par les femmes (vivrier, transformation, épargne de groupe).', 'Associer les jeunes aux techniques de taille, de greffage et de gestion de l\'exploitation.']],
     ['Dans les organes de la coopérative', ['Viser des femmes et des jeunes dans les comités (prime, plaintes).']]],
    ['Parler seulement au chef d\'exploitation', 'Fixer les réunions à un horaire impossible pour les femmes'],
    ['Quels freins limitent la participation des femmes ?', 'Quelle action concrète pouvez-vous proposer ?']),

  m('cacao-revenu-diversification', 'Diversification', 'Revenu du producteur et diversification',
    'Améliorer le revenu : productivité, cultures vivrières, activités complémentaires, gestion du budget.', C, [RA, FT], 'intermediaire', 75,
    ['Expliquer les sources de revenu possibles', 'Aider un producteur à faire un budget simple', 'Présenter l\'épargne de groupe'],
    [['Sources', ['Mieux produire sur la même surface (taille, entretien, matériel végétal amélioré) plutôt qu\'étendre la plantation.', 'Cultures vivrières intercalaires, bananier, igname, manioc, volaille, apiculture, produits transformés.', 'Arbres de service donnant bois ou fruits.']],
     ['Budget simple', ['Noter les dépenses annuelles prévisibles (intrants, main-d\'œuvre, scolarité) et les recettes de chaque campagne.', 'Prévoir de l\'épargne pour la période de soudure plutôt que de s\'endetter.']],
     ['Épargne et crédit', ['Groupes d\'épargne villageois ; préfinancement de la coopérative avec échéancier clair remboursé sur la récolte.']]],
    ['S\'endetter pour une dépense non productive', 'Étendre la plantation en forêt'],
    ['Pourquoi ne pas simplement planter plus ?', 'Qu\'est-ce que l\'épargne de groupe ?']),

  m('cacao-gouvernance-cooperative', 'Gouvernance coopérative', 'Gouvernance, transparence et mécanisme de réclamation',
    'Assemblée générale, comités, transparence des comptes et traitement des plaintes.', C, [FT, RA], 'intermediaire', 60,
    ['Expliquer les rôles des organes de la coopérative', 'Décrire comment un membre dépose une plainte', 'Rendre compte de l\'usage de la prime'],
    [['Organes', ['L\'assemblée générale approuve les comptes, le budget, le plan de la prime.', 'Le conseil d\'administration et les comités exécutent et rendent compte.']],
     ['Transparence', ['Comptes, prix payés et primes sont expliqués et affichés ; les décisions sont consignées dans des procès-verbaux.']],
     ['Réclamations', ['Un mécanisme connu de tous : où et comment déposer une plainte, délai de réponse, confidentialité, absence de représailles.', 'Les plaintes sont enregistrées, traitées et clôturées avec une réponse écrite.']]],
    ['Décider sans réunion ni procès-verbal', 'Sanctionner un plaignant'],
    ['Où dépose-t-on une plainte ?', 'Qui approuve le plan de la prime ?']),

  m('cacao-eau-assainissement', 'Eau, assainissement, et hygiène', 'Eau, assainissement et hygiène autour de l\'exploitation',
    'Protéger les sources, gérer les eaux usées et les déchets, hygiène sur le lieu de travail.', CK, [RA], 'base', 45,
    ['Protéger les cours d\'eau et les sources', 'Gérer les eaux usées et les déchets de l\'exploitation', 'Promouvoir l\'hygiène des mains et des latrines'],
    [['Protéger l\'eau', ['Laisser une bande végétale le long des cours d\'eau ; pas de produits chimiques près de l\'eau ; ne pas laver les pulvérisateurs dans la rivière.']],
     ['Déchets', ['Collecter et brûler uniquement ce qui doit l\'être, loin des cultures ; trier les emballages ; composter les coques.']],
     ['Hygiène', ['Se laver les mains avant de manipuler les fèves fermentées et séchées ; latrines utilisées et entretenues.']]],
    ['Jeter les bidons dans la rivière', 'Évacuer le jus de fermentation directement dans un cours d\'eau'],
    ['Quelle distance minimale du cours d\'eau pour traiter ?', 'Pourquoi se laver les mains avant le séchage ?']),

  // ───────────────────────── Café (second plan)
  m('cafe-panorama-certifications', 'Normes et réglementations de certification', 'Café : panorama des certifications et traçabilité',
    'Rainforest Alliance, Fairtrade, 4C et exigences de traçabilité appliquées au café.', K, [RA, FT, EUDR], 'base', 60,
    ['Présenter les principales certifications du café', 'Expliquer la traçabilité et la géolocalisation des parcelles de café', 'Relier les règles aux gestes du producteur'],
    [['Certifications', ['Les certifications du café reprennent les mêmes grands principes que celles du cacao : pratiques agricoles durables, droits humains, environnement, groupe de producteurs contrôlé.', 'Le café est aussi concerné par le règlement européen sur la déforestation : localisation des parcelles et absence de déforestation après la date de référence.']],
     ['Traçabilité', ['Café cerise ou parche : chaque achat est enregistré avec producteur, date, poids ; les lots restent séparés selon l\'origine et la certification.']]],
    ['Mélanger du café de parcelles non conformes avec des lots certifiés', 'Acheter sans reçu'],
    ['Pourquoi tracer le café comme le cacao ?']),

  m('cafe-recolte-post-recolte', 'Gestion des récoltes et des produits', 'Café : récolte sélective et traitement post-récolte',
    'Cueillir les cerises mûres, trier, traiter par voie sèche ou humide et sécher correctement.', K, [BASE], 'intermediaire', 75,
    ['Récolter des cerises à maturité', 'Choisir et conduire la voie de traitement', 'Sécher sans moisissure'],
    [['Récolte', ['Cueillir sélectivement les cerises rouges mûres ; plusieurs passages ; éviter les cerises vertes, sèches ou tombées.', 'Trier par flottation et enlever les corps étrangers.']],
     ['Traitement', ['Voie sèche : sécher les cerises entières sur claies, en les remuant.', 'Voie humide : dépulper le jour même, fermenter brièvement, laver, puis sécher la parche.', 'Sécher lentement et régulièrement à l\'abri de la pluie, jusqu\'au taux d\'humidité demandé par l\'acheteur.']],
     ['Stockage', ['Sacs propres sur palettes, local sec et aéré, à l\'écart de toute odeur (carburants, fumée).']]],
    ['Mélanger des cerises de maturités différentes', 'Sécher sur le sol'],
    ['Quand dépulpe-t-on en voie humide ?', 'Pourquoi trier les cerises ?'], ['Claies', 'Bassin de lavage']),

  m('cafe-entretien-rouille-scolyte', 'Agriculture régénératrice', 'Café : entretien, rouille orangée et scolyte',
    'Taille, ombrage et lutte intégrée contre la rouille orangée et le scolyte du café.', K, [RA, BASE], 'intermediaire', 75,
    ['Reconnaître la rouille orangée et le scolyte', 'Appliquer la taille et la gestion de l\'ombrage', 'Mettre en œuvre la prévention avant le traitement'],
    [['Reconnaître', ['Rouille orangée : taches jaunes puis poudre orangée sous les feuilles, chute des feuilles.', 'Scolyte des fruits : petit trou à l\'extrémité de la cerise, galeries dans le grain.']],
     ['Prévenir', ['Taille pour aérer, ombrage régulé, fertilisation équilibrée, variétés tolérantes.', 'Récolter toutes les cerises (y compris les restes) pour couper le cycle du scolyte.']],
     ['Traiter', ['En dernier recours, produit autorisé, équipement de protection, dose et délai de la notice.']]],
    ['Laisser des cerises sèches sur l\'arbre après la récolte', 'Traiter sans observation préalable'],
    ['Quelle maladie fait de la poudre orangée sous la feuille ?', 'Comment réduire le scolyte sans traiter ?']),
];
