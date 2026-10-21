# Scénario de la vidéo de présentation d'AgriTrace : narration (voix de synthèse française) + images (cartes, captures, enregistrements réels du portail).
# Usage : python3 scenario.py  → écrit scenario.json (lu par tts.py, record.mjs et compose.py).
import json

CAP = '../captures'
M = f'{CAP}/mobile'
S = []

def scene(id, title, narration, visual):
    S.append({'id': id, 'title': title, 'narration': ' '.join(narration.split()), 'visual': visual})

def card(kind, **kw): return {'type': 'card', 'kind': kind, **kw}
def live(role, steps): return {'type': 'live', 'role': role, 'steps': steps}
def phones(*imgs, captions=None): return {'type': 'phones', 'images': [f'{M}/{i}.png' for i in imgs], 'captions': captions or []}
def stills(*imgs): return {'type': 'stills', 'images': [f'{CAP}/{i}' for i in imgs]}

scene('intro', 'Présentation', """
Bienvenue dans Agri Trace, la plateforme intégrée de gestion agricole, de traçabilité et de gestion financière des coopératives.
Dans cette présentation, nous parcourons l'outil de bout en bout : ce que voit chaque profil, sur ordinateur comme sur téléphone,
depuis la parcelle du producteur jusqu'à la comptabilité, et jusqu'à l'exportateur.""",
  card('title', title='AgriTrace', subtitle='Gestion agricole · Traçabilité · Gestion financière des coopératives', note='Présentation de l\'outil'))

scene('architecture', 'Les quatre briques', """
Agri Trace repose sur quatre briques. D'abord un serveur, avec une base de données PostgreSQL qui isole strictement les données de chaque coopérative.
Ensuite un portail web, pour le travail de bureau. Puis une application Android, pensée pour fonctionner sans réseau dans les villages.
Enfin une application Windows, qui peut servir de serveur local à la coopérative, ou de simple poste client.
Tout se synchronise, sans doublon, dès que le réseau revient.""",
  card('arch'))

scene('connexion', 'Connexion et association', """
On se connecte avec son adresse électronique et son mot de passe, sur le portail comme sur le téléphone.
Un poste de bureau, ou un téléphone, doit être associé une première fois à la coopérative grâce à un code de huit caractères remis par l'administrateur.
Au premier accès avec un mot de passe temporaire, l'application impose d'en choisir un nouveau.
Si un compte est suspendu, la session est coupée, et le téléphone efface les données de la coopérative.""",
  {'type': 'mix', 'left': f'{CAP}/connexion.png', 'phones': [f'{M}/connexion.png']})

scene('profils', 'Qui utilise quoi', """
Chaque utilisateur a un profil, et le menu s'adapte à ses droits. L'administrateur de la coopérative crée les comptes en un clic à partir de dix-huit rôles types :
direction, responsables de traçabilité, de cartographie, de magasin, financier, qualité et logistique, magasinier, caissier, comptable, cartographe, Administrateur de groupe, auditeur, acheteur, exportateur,
et les trois profils de terrain : collecteur, agent de terrain et coach, qui se connectent uniquement par l'application mobile.""",
  card('profils'))

scene('dashboard', 'Tableau de bord', """
Voici le portail, vu par l'administrateur de la coopérative. Le tableau de bord rassemble l'essentiel : commandes, créances, missions en retard, anomalies de cartographie.
En haut à droite, la messagerie et la cloche de notifications avec leurs compteurs, et l'indicateur de synchronisation.
Le logo de la coopérative figure sur ses reçus imprimés. L'affichage est volontairement sobre, avec un seul thème, doux pour les yeux.""",
  live('coop_admin', [{'goto': '/', 'w': 2}, {'scroll': 500, 'w': 2}, {'scroll': -500, 'w': 1}]))

scene('equipe', 'Équipe, rôles et profil', """
Dans Équipe, l'administrateur crée les comptes, choisit le rôle, suspend ou réactive un accès, révoque les sessions et réinitialise un mot de passe.
Les rôles types se créent en un clic, puis s'ajustent permission par permission ; certains droits sensibles exigent une seconde approbation.
Le profil de la coopérative donne son adresse et sa devise, repris en en-tête des reçus, ainsi que le code C C C, qui sert de préfixe aux numéros de connaissement des convois.""",
  live('coop_admin', [{'goto': '/equipe', 'w': 2}, {'scroll': 600, 'w': 3}, {'scroll': 700, 'w': 3}, {'scroll': 700, 'w': 2}]))

scene('producteurs', 'Producteurs', """
Le registre des producteurs : fiches, statuts, village, section. La recherche est instantanée, par nom ou par code.
L'administrateur peut importer une liste Excel ou C S V avec une prévisualisation avant validation, et un rapport d'import indique ce qui est créé, mis à jour ou en erreur.
Les codes à zéros initiaux sont conservés. Les coachs retrouvent les mêmes producteurs sur leur téléphone, avec recherche et filtre par section.""",
  live('coop_admin', [{'goto': '/producteurs', 'w': 2}, {'type': ['input[type=search], input[placeholder*="echerch"]', 'KONÉ'], 'w': 3}, {'scroll': 300, 'w': 2}, {'wait': True, 'w': 1}]))

scene('parcelles', 'Parcelles et statuts', """
Chaque producteur a ses parcelles, avec leur superficie, leur tracé et leur statut : déclarée, contrôlée, puis vérifiée.
Un tracé relevé au G P S sur le terrain ne devient jamais une superficie à partir d'un simple point : le téléphone calcule la surface en marchant autour de la parcelle.
Les versions successives du tracé sont conservées, et ne peuvent plus être modifiées.""",
  live('responsable_cartographie', [{'goto': '/parcelles', 'w': 3}, {'scroll': 500, 'w': 3}, {'scroll': -500, 'w': 1}]))

scene('cartographie', 'Cartographie et conformité', """
La cartographie affiche les parcelles sur un fond neutre, un plan ou une image satellite. Les anomalies sont détectées automatiquement : chevauchements entre parcelles,
superposition avec une zone protégée. Une anomalie bloquante empêche la validation de la parcelle : on la corrige, ou on accepte une exception motivée, qui est tracée.
On peut importer des tracés au format GeoJSON, K M L, K M Z, Shapefile ou GeoPackage, et les exporter, ce qui prépare les dossiers de conformité comme le règlement européen contre la déforestation.""",
  live('responsable_cartographie', [{'goto': '/cartographie', 'w': 3}, {'tab': 'Anomalies', 'w': 3}, {'tab': 'Zones protégées', 'w': 2}, {'tab': 'Importer', 'w': 2}, {'tab': 'Exporter', 'w': 2}]))

scene('collecteur', 'Le collecteur sur son téléphone', """
Le collecteur travaille uniquement sur son téléphone, même sans réseau. Il choisit le producteur, saisit l'achat : quantité, unité, nombre de sacs.
Puis il crée son convoi : chauffeur, camion, sacs et poids annoncés. Le numéro de connaissement n'est pas saisi : le logiciel le fabrique,
avec le code C C C de la coopérative, l'année, les trois premières lettres du nom du collecteur et un numéro d'ordre. Par exemple : S C zéro zéro zéro zéro zéro zéro, 2026, S Y L, 1.
Le collecteur suit aussi son stock et sa fiche de compte.""",
  phones('collecteur-accueil', 'collecteur-nouvel-achat', 'collecteur-convoi', 'collecteur-fiche',
         captions=['Accueil et file d\'envoi', 'Saisie de l\'achat', 'Création du convoi', 'Fiche de compte']))

scene('chaine', 'La chaîne d\'achat', """
Voici la chaîne d'achat. Le collecteur déclare ses achats et crée son convoi. Le magasinier réceptionne et pèse. Le caissier règle le collecteur au prix du jour.
Le comptable passe l'écriture, la direction suit les résultats. À chaque étape, la personne suivante est notifiée, et chaque geste est tracé.""",
  card('flow', title='De l\'achat au règlement', nodes=['Collecteur\nachat + convoi', 'Magasinier\nréception + pesée', 'Caissier\nrèglement', 'Comptable\nécriture + pointage', 'Direction\nsuivi'],
       foot='Chaque étape notifie la suivante · rien n\'est jamais supprimé, tout s\'annule par écriture inverse'))

scene('declarations', 'Traçabilité : déclarations d\'achat', """
Côté traçabilité, le responsable reçoit les déclarations d'achat des collecteurs. Il les met en vérification, puis les valide ou demande une correction avec un motif.
Le collecteur voit alors l'achat marqué à corriger dans son application. Les reçus sont numérotés, et chaque déclaration est rattachée à un producteur, une filière et une campagne.""",
  live('responsable_tracabilite', [{'goto': '/declarations', 'w': 3}, {'scroll': 400, 'w': 3}, {'goto': '/missions', 'w': 2}]))

scene('convois', 'Réception au magasin', """
Le magasinier voit les convois en route. Il ouvre un convoi arrivé, pèse en brut, déduit la tare, obtient le poids net, et constate les écarts avec le poids annoncé.
Si l'écart dépasse la tolérance, il doit être approuvé. Il réceptionne en totalité ou en partie ; le stock est mis à jour, et le convoi passe à reçu, en caisse.""",
  live('magasinier', [{'goto': '/convois', 'w': 3}, {'scroll': 400, 'w': 3}, {'tab': 'Réception', 'w': 3}]))

scene('stocks', 'Stocks, lots et inventaire', """
Les stocks se suivent par magasin et par lot, avec la généalogie des lots : division, fusion, transfert, chargement, perte, déclassement, quarantaine.
Pour l'inventaire, on saisit le comptage, et l'inventaire doit être approuvé par une autre personne. Il n'y a aucune suppression : seulement des ajustements tracés.""",
  live('magasinier', [{'goto': '/stocks', 'w': 3}, {'scroll': 400, 'w': 2}, {'goto': '/inventaire', 'w': 3}]))

scene('caisse', 'Caisse et règlements', """
Le caissier règle les convois reçus : il saisit le prix unitaire du jour, le montant égale le poids reçu fois le prix, et les avances non soldées sont déduites automatiquement.
Chaque caissier ouvre sa propre session de caisse, enregistre les mouvements, puis clôture en comptant l'espèce ; l'écart entre le compté et l'attendu est calculé et conservé.""",
  live('caissier', [{'goto': '/convois', 'w': 3}, {'scroll': 300, 'w': 2}, {'goto': '/finances', 'w': 3}, {'scroll': 400, 'w': 2}]))

scene('compta', 'Comptabilité et rapprochement bancaire', """
Le comptable tient les comptes : plan comptable, écritures, prêts aux producteurs, paiements. Le rapprochement bancaire importe le relevé de la banque en C S V,
l'utilisateur choisit les colonnes, simule, puis importe. Les lignes qui correspondent à une seule opération sont pointées d'office ; les autres se pointent à la main.
Les opérations du compte absentes du relevé sont listées pour être expliquées. Cet onglet est réservé aux profils habilités, comme l'administrateur de la coopérative.""",
  live('coop_admin', [{'goto': '/finances', 'w': 3}, {'tab': 'Comptabilité', 'w': 3}, {'scroll': 400, 'w': 2}, {'tab': 'Rapprochement bancaire', 'w': 4}, {'scroll': 400, 'w': 2}]))

scene('prefinancement', 'Préfinancement et direction', """
La direction suit les finances en lecture et décide des demandes. Le préfinancement permet de suivre les avances accordées, leurs échéances et leurs remboursements,
et l'approbation est réservée aux profils habilités. Le responsable financier supervise la caisse, les comptes et les prêts.""",
  live('direction', [{'goto': '/prefinancement', 'w': 3}, {'scroll': 400, 'w': 3}, {'goto': '/finances', 'w': 3}]))

scene('annulations', 'Annulations : le principe des deux personnes', """
Une règle protège toute la chaîne : on ne supprime rien. Le magasinier, le caissier ou le comptable peut demander l'annulation d'une opération, avec un motif.
L'opération n'est pas annulée tout de suite : l'administrateur, la direction ou le responsable financier est notifié, et approuve ou refuse. Le demandeur ne peut jamais approuver sa propre demande.
Une annulation passe par une écriture inverse. On peut aussi imprimer le reçu : toute impression est tracée, et la deuxième porte la mention duplicata.""",
  live('magasinier', [{'goto': '/operations', 'w': 4}, {'scroll': 400, 'w': 3}, {'wait': True, 'w': 1}]))

scene('qualite', 'Qualité, certificats et commerce', """
Le responsable qualité gère les contrôles, les inspections et les certificats, avec des alertes d'échéance. La logistique planifie les transports et les expéditions,
et un acheteur partenaire ne voit que ses propres commandes, expéditions et documents. Les rapports d'achats, de finance, de stock et de qualité s'exportent en Excel.""",
  live('responsable_qualite', [{'goto': '/qualite', 'w': 4}, {'scroll': 400, 'w': 3}]))

scene('commerce', 'L\'acheteur partenaire', """
Voici la vue d'un acheteur partenaire : uniquement ses commandes et ses documents. Le reste de la coopérative lui est invisible.""",
  live('acheteur', [{'goto': '/commerce', 'w': 3}, {'scroll': 300, 'w': 2}]))

scene('missions', 'Missions et tâches de terrain', """
L'Administrateur de groupe met en place les missions des coachs : titre, catégorie, priorité, échéance, producteur, coach assigné, instructions et critères de validation.
Le coach exécute et joint ses preuves ; l'Administrateur de groupe relit puis valide, ou demande une correction. Une fois la tâche terminée et validée, elle est grisée et n'est plus cliquable,
puis elle disparaît de la liste après le délai fixé par l'Administrateur de groupe, sept jours par défaut. Une case permet de revoir les tâches masquées.""",
  live('adg', [{'goto': '/missions', 'w': 3}, {'scroll': 350, 'w': 3}, {'click': 'text=Afficher aussi les missions terminées masquées', 'w': 3}, {'scroll': 300, 'w': 2}]))

scene('coach', 'Le coach sur le terrain', """
Le coach utilise l'application mobile. Il choisit un producteur, avec recherche par nom, code ou téléphone, et filtre par section. La fiche du producteur donne ses tâches, ses parcelles et ses informations.
Il enregistre un nouveau producteur, relève une parcelle, et ajoute des photos. Tout reste sur le téléphone, puis part à la synchronisation. Le bandeau de l'accueil indique ce qui attend d'être envoyé.""",
  phones('coach-accueil', 'coach-producteurs', 'coach-producteur-taches', 'coach-producteur-infos',
         captions=['Accueil du coach', 'Producteurs par section', 'Tâches du producteur', 'Informations et parcelles']))

scene('releves', 'Relevés : formations, infrastructures, distributions', """
Le coach saisit des relevés de terrain : un registre de formation, avec thème, module, photo, participants et scores de zéro à cent ; une infrastructure sociale avec sa position ;
et une distribution de biens et services, où l'on choisit la catégorie, le groupe et les articles du catalogue, puis les bénéficiaires. L'Administrateur de groupe adapte les modèles de saisie, puis les déploie.""",
  phones('coach-formation', 'coach-infrastructure', 'coach-distribution-articles', 'coach-distribution-verifier',
         captions=['Registre de formation', 'Infrastructure sociale', 'Distribution : articles', 'Distribution : vérification']))

scene('modules', 'Bibliothèque de modules de formation', """
Une bibliothèque de modules de formation agricole est préchargée, liée aux certifications, avec le cacao en priorité, puis le café : vingt-six modules.
Les coachs la lisent sur leur téléphone, avec une copie gardée pour travailler sans réseau. L'Administrateur de groupe relit chaque module et choisit : conserver tel quel, modifier, ou supprimer.
Le contenu fourni est un socle général : il doit être adapté au cahier des charges de la certification visée.""",
  live('adg', [{'goto': '/modules-formation', 'w': 3}, {'scroll': 500, 'w': 3}, {'type': ['input[type=search]', 'fermentation'], 'w': 3}, {'wait': True, 'w': 1}]))

scene('modules-mobile', 'Les modules sur le téléphone', """
Sur le téléphone, le coach filtre les modules par culture ou par thème, puis ouvre un module : objectifs, points à enseigner, erreurs à éviter, questions pour vérifier la compréhension.""",
  phones('coach-modules-formation', 'coach-module-exportateur', captions=['Bibliothèque de modules', 'Lecture d\'un module']))

scene('circuit', 'Le circuit exportateur', """
Les exportateurs peuvent eux aussi proposer des modules de formation. Voici le circuit. L'exportateur propose un module à l'Administrateur de groupe. L'Administrateur de groupe le transmet aux coachs, d'un simple clic, sans le modifier.
Les coachs dispensent la formation et saisissent leurs résultats. Les résultats arrivent d'abord à l'Administrateur de groupe, qui les transmet à l'exportateur, toujours d'un clic, sans aucune modification.""",
  card('flow', title='Le circuit des modules d\'exportateur', nodes=['Exportateur\npropose un module', 'ADG\nnature + cible, 1 clic', 'Coachs\ndispensent + saisissent', 'ADG\ntransmet (1 clic)', 'Exportateur\nreçoit les résultats'],
       foot='Contenu et résultats figés par la base de données · l\'Administrateur de groupe (ADG) ne peut rien modifier · chaque étape notifie et est tracée'))

scene('exp-propose', 'L\'exportateur propose un module', """
Voici l'espace de l'exportateur. À l'accueil, il retrouve ses indicateurs : propositions en attente, transmises aux coachs, non retenues, et résultats reçus.
Il ne voit que ses propres propositions et les résultats que l'Administrateur de groupe lui a transmis. Il clique sur proposer un module : titre, thème, résumé, objectifs, sections avec leurs points.
Une fois envoyé, le module n'est plus modifiable. L'Administrateur de groupe est aussitôt notifié.""",
  live('exportateur', [{'goto': '/', 'w': 3}, {'goto': '/modules-exportateurs', 'w': 2}, {'click': 'text=Proposer un module', 'w': 2},
        {'type': ['.modal input[maxlength="200"]', 'Taille et entretien du cacaoyer'], 'w': 3}, {'type': ['.modal textarea >> nth=0', 'Module proposé par l\'exportateur de démonstration (fictif).'], 'w': 2},
        {'type': ['.modal textarea >> nth=1', 'Réaliser une taille de formation\nReconnaître les gourmands'], 'w': 3},
        {'type': ['input[aria-label="Titre de la section 1"]', 'La taille de formation'], 'w': 2}, {'type': ['textarea[aria-label="Points de la section 1"]', 'Choisir trois à quatre branches charpentières\nCouper net, sans déchirer l\'écorce'], 'w': 3},
        {'click': '.modal button:has-text("Envoyer"), .modal button:has-text("Enregistrer")', 'w': 2}, {'wait': True, 'w': 2}]))

scene('exp-adg', 'L\'Administrateur de groupe transmet aux coachs', """
Du côté de l'Administrateur de groupe, la proposition apparaît dans l'onglet propositions, avec le nom de l'exportateur. L'Administrateur de groupe lit le module, puis clique sur transmettre aux coachs.
Une fenêtre lui demande alors deux choses. D'abord la nature de l'élément : module de formation, distribution ou tâche. Ensuite la cible : tous les producteurs, ou certains seulement, qu'il retrouve par nom, par code ou par section.
Il peut ajouter une échéance et une consigne. L'élément s'ajoute au profil de chaque producteur concerné, et les coachs sont prévenus. Le contenu du module reste exactement celui de l'exportateur, il n'est ni modifiable ni supprimable.
Il peut aussi décliner la proposition, avec un motif facultatif.""",
  live('adg', [{'goto': '/modules-exportateurs', 'w': 3}, {'click': 'tr:has-text("Taille et entretien du cacaoyer") button:has-text("Transmettre aux coachs")', 'w': 3},
               {'select': ['select[aria-label="Nature"]', 'Module de formation'], 'w': 3}, {'select': ['select[aria-label="Cible"]', 'Certains producteurs'], 'w': 3},
               {'click': '.modal input[type=checkbox] >> nth=0', 'w': 2}, {'click': '.modal input[type=checkbox] >> nth=1', 'w': 2}, {'click': '.modal input[type=checkbox] >> nth=2', 'w': 2},
               {'type': ['.modal textarea', 'À dispenser avant la récolte principale.'], 'w': 4}, {'click': '.modal .modal-foot button:has-text("Transmettre aux coachs")', 'w': 3}, {'wait': True, 'w': 2},
               {'goto': '/modules-formation', 'w': 2}, {'type': ['input[type=search]', 'exportateur'], 'w': 3}]))

scene('exp-affectations', 'Affecter un modèle aux producteurs', """
L'Administrateur de groupe peut aussi implémenter lui-même un modèle. Dans l'onglet affectations aux producteurs, il clique sur affecter un modèle, choisit la nature, ici une distribution,
donne un intitulé, et cible tous les producteurs. Le tableau indique ensuite, pour chaque affectation, la nature, la cible, l'échéance et l'avancement : combien de producteurs l'ont fait, sur combien.""",
  live('adg', [{'goto': '/modules-exportateurs', 'w': 2}, {'tab': 'Affectations aux producteurs', 'w': 3}, {'click': 'button:has-text("Affecter un modèle")', 'w': 3},
               {'select': ['select[aria-label="Nature"]', 'Distribution'], 'w': 3}, {'type': ['.modal input[placeholder^="Ex. Distribution"]', 'Distribution de sacs de jute'], 'w': 4},
               {'click': '.modal .modal-foot button:has-text("Affecter")', 'w': 3}, {'wait': True, 'w': 3}]))

scene('exp-profil', 'Dans le profil du producteur', """
Dans la liste des producteurs, un clic sur le nom ouvre son profil. On y trouve, sous formations, distributions et tâches, tout ce que l'Administrateur de groupe a ajouté : la nature, l'intitulé, la consigne, l'échéance et l'état.
Le coach peut marquer un élément comme fait.""",
  live('adg', [{'goto': '/producteurs', 'w': 3}, {'click': 'table tbody tr:first-child td:nth-child(2) button', 'w': 4}, {'scroll': 200, 'w': 4}]))

scene('affect-coach', 'Sur le téléphone du coach', """
Sur l'application, la fiche du producteur affiche, dans la liste des tâches, les formations, distributions et tâches ajoutées par l'Administrateur de groupe, avec la consigne et l'échéance.
Une fois la séance ou la distribution réalisée, le coach touche fait, avec du réseau, et l'élément est grisé.""",
  phones('coach-producteur-taches', captions=['Éléments ajoutés au profil du producteur']))

scene('exp-coach', 'Le coach saisit les résultats', """
Le coach dispense la formation. Ensuite, sur le module marqué proposé par l'exportateur, il touche saisir les résultats : date de la séance, village, nombre de participants, score moyen et observations.
L'envoi demande une connexion. Les résultats vont à l'Administrateur de groupe et ne sont plus modifiables ; le coach voit, dans la liste, s'ils ont été transmis à l'exportateur.""",
  phones('coach-module-exportateur', 'coach-module-resultats', captions=['Module d\'exportateur et résultats saisis', 'Saisie des résultats']))

scene('exp-resultats', 'L\'Administrateur de groupe transmet les résultats', """
Les résultats arrivent dans l'onglet résultats de l'Administrateur de groupe : coach, module, exportateur, village, participants, score moyen, observations. L'Administrateur de groupe clique sur transmettre à l'exportateur,
et les résultats partent tels que le coach les a saisis.""",
  live('adg', [{'goto': '/modules-exportateurs', 'w': 2}, {'tab': 'Résultats', 'w': 3}, {'click': 'tr:has-text("Zégban") button:has-text("Transmettre à l\'exportateur")', 'w': 3}, {'wait': True, 'w': 2}]))

scene('exp-recoit', 'L\'exportateur reçoit les résultats', """
L'exportateur est notifié, par la cloche en haut à droite, et voit les résultats de ses propres modules, uniquement ceux que l'Administrateur de groupe a transmis. Il ne voit jamais le reste des données de la coopérative.""",
  live('exportateur', [{'goto': '/modules-exportateurs', 'w': 3}, {'scroll': 300, 'w': 3}, {'click': 'button[aria-label^="Notifications"]', 'w': 3}]))

scene('rapports', 'Rapports et envoi automatique', """
Les rapports d'achats, de finance, de stock et de qualité se filtrent et s'exportent en Excel. L'administrateur peut aussi programmer un envoi automatique :
il choisit le rapport, la fréquence, quotidienne, hebdomadaire ou mensuelle, l'heure et les destinataires. Chacun reçoit une notification et télécharge le fichier ; l'envoi par courriel est possible si le serveur est configuré pour.""",
  live('coop_admin', [{'goto': '/rapports', 'w': 3}, {'scroll': 300, 'w': 2}, {'tab': 'Envoi automatique', 'w': 4}]))

scene('horsligne', 'Hors connexion et synchronisation', """
Sur le téléphone, tout ce qui est saisi est gardé sur l'appareil, puis envoyé au retour du réseau, sans doublon : chaque opération porte une clé unique. Le bandeau de l'accueil indique l'état :
synchronisé, hors connexion, éléments en attente, ou éléments à corriger, avec le motif du refus du serveur. Des fonds de carte peuvent être téléchargés en Wi-Fi pour travailler sans réseau.
Si l'accès d'un utilisateur est retiré, les données de la coopérative sont effacées du téléphone.""",
  card('bullets', title='Travailler sans réseau', items=['Saisie conservée sur l\'appareil, envoi au retour du réseau', 'Clé d\'idempotence : jamais de doublon', 'Bandeau d\'état : synchronisé · hors connexion · en attente · à corriger', 'Fonds de carte hors ligne téléchargés en Wi-Fi', 'Bibliothèque de modules lisible sans réseau', 'Compte suspendu : données effacées du téléphone']))

scene('windows', 'L\'application Windows', """
L'application Windows s'installe sur les postes de la coopérative. Au premier démarrage, on choisit : poste unique, serveur local ou poste client. Le serveur local embarque la base de données et l'A P I ;
les autres postes le retrouvent automatiquement sur le réseau. L'installateur affiche le contrat de licence en français, configure le pare-feu pour les réseaux privés, et propose des mises à jour.
Un menu permet de sauvegarder les données sur une clé U S B, et le serveur local réplique vers le serveur central de la coopérative.""",
  card('bullets', title='Application Windows', items=['Poste unique · serveur local · poste client', 'Base PostgreSQL et A P I embarquées', 'Découverte automatique du serveur sur le réseau', 'Installateur : contrat de licence, raccourcis, pare-feu, désinstallation', 'Mises à jour automatiques', 'Sauvegarde sur clé U S B · réplication vers le central']))

scene('securite', 'Sécurité et traçabilité', """
La sécurité est au cœur de l'outil. Chaque coopérative est isolée au niveau de la base de données. Les droits sont vérifiés par le serveur à chaque requête. Le journal d'audit conserve qui a fait quoi, et quand.
Les écritures, les historiques de prix et les versions de tracés sont immuables. Les actions sensibles exigent deux personnes. Les identifiants de connexion sont protégés contre les essais répétés.
Et les comptes de terrain ne se connectent que par le mobile : c'est une règle d'usage de l'interface, les droits restant contrôlés par le serveur.""",
  card('bullets', title='Sécurité et traçabilité', items=['Isolation des coopératives dans la base (RLS)', 'Permissions vérifiées par le serveur à chaque requête', 'Journal d\'audit : qui, quoi, quand', 'Écritures et versions de tracé immuables', 'Demandeur ≠ approbateur', 'Limitation des essais de connexion', 'Comptes de terrain : mobile uniquement']))

scene('limites', 'Ce qui reste à valider', """
Soyons précis sur l'état de l'outil. Il a été éprouvé par des tests automatiques de bout en bout, mais pas encore sur le terrain. L'application Android doit être compilée par le workflow prévu,
puis essayée sur de vrais téléphones. L'installateur Windows doit être testé sur un poste de la coopérative. Le contenu des modules de formation est un socle à relire et à adapter.
Les résultats de formation demandent une connexion pour être envoyés. Ces points sont listés dans le document des défauts connus, avec un plan de recette.""",
  card('bullets', title='Avant la mise en service', items=['Compiler l\'APK (workflow GitHub) et l\'essayer sur de vrais téléphones', 'Tester l\'installateur Windows sur un poste de la coopérative', 'Relire et adapter les modules de formation à la certification visée', 'Faire valider les règles métier par la coopérative', 'Plan de recette : document « Défauts connus et recette »']))

scene('fin', 'Merci', """
Voilà Agri Trace : une chaîne complète, de la parcelle du producteur à la comptabilité et à l'exportateur, sur ordinateur et sur téléphone, avec une traçabilité sans trou. Merci de votre attention.""",
  card('title', title='AgriTrace', subtitle='De la parcelle au marché', note='Guides, démonstration et comptes d\'essai fournis'))

json.dump(S, open('scenario.json', 'w'), ensure_ascii=False, indent=1)
print(len(S), 'scènes ;', sum(len(s['narration'].split()) for s in S), 'mots')
