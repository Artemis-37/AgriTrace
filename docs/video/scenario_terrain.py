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


scene('intro', 'Du terrain à l\'exportateur', """
Cette présentation suit le chemin d'un lot de cacao, du village jusqu'à l'exportateur, et passe par chaque utilisateur. Sur le terrain, le délégué et le coach, tous deux sur téléphone. Puis, au bureau, l'Administrateur de groupe, la traçabilité, le magasin, la caisse,
la comptabilité et la vente, pour finir chez l'exportateur, et revenir au village avec les formations qu'il propose. À chaque étape, nous voyons qui fait quoi, et ce qui est tracé.""",
  card('title', title='AgriTrace', subtitle='Du terrain à l\'exportateur', note='Le parcours complet d\'un lot', contact=[('Créateur : Dominique N\'Guessan', (40, 'Bold'), (34, 61, 48)), ('Téléphone : 05 05 05 45 63', (36, 'Medium'), (40, 52, 46)), ('E-mail : dominiquenguessan414@gmail.com', (36, 'Medium'), (40, 52, 46))]))

scene('parcours', 'Le parcours en un coup d\'œil', """
Voici le parcours. Sur le terrain, le coach suit les producteurs et le délégué leur achète le cacao, puis déclare son connaissement. L'Administrateur de groupe organise les tâches des coachs. La traçabilité vérifie. Le magasinier pèse et réceptionne. Le caissier règle et met en compte.
Le comptable passe les écritures. Le stock est vendu, et l'exportateur reçoit le lot. L'exportateur pèse, analyse et règle la livraison. Puis les formations qu'il propose redescendent vers les coachs, et les résultats remontent jusqu'à lui.""",
  card('flow', title='Du village à l\'exportateur', nodes=['Terrain\ncoach + délégué', 'Traçabilité\nvérification', 'Magasinier\npesée + stock', 'Caissier\nrèglement + compte', 'Comptable\nécritures', 'Exportateur\nlot + formations'],
       foot='Chaque étape notifie la suivante · rien n\'est jamais supprimé, tout s\'annule par écriture inverse'))

scene('terrain-achat', 'Sur le terrain : l\'achat', """
Tout commence au village, sur le téléphone du délégué, même sans réseau. Il cherche le producteur par son code ou son nom : l'application affiche sa filière et sa campagne.
Il saisit l'achat : poids, nombre de sacs, et numéro du reçu remis au producteur. La date de l'achat est celle du jour, sauf s'il la corrige.
L'achat est enregistré sur le téléphone, puis envoyé dès que le réseau revient, sans doublon.""",
  phones('collecteur-choix-producteur', 'collecteur-achat-saisi', 'collecteur-historique', captions=['Choisir le producteur', 'Saisie de l\'achat', 'Historique des achats']))

scene('terrain-connaissement', 'Sur le terrain : le connaissement', """
Quand le camion est prêt, le délégué déclare son connaissement : chauffeur, camion, nombre de sacs et poids annoncés. Il ne saisit pas le numéro : le logiciel le fabrique,
avec le code C C C de la coopérative, l'année, les trois premières lettres du nom du délégué et un numéro d'ordre. Le délégué consulte aussi son stock et sa fiche de compte, qui retrace ce qu'il a apporté et ce qu'il a reçu.""",
  phones('collecteur-convoi-saisi', 'collecteur-mon-stock', 'collecteur-fiche', captions=['Déclarer le connaissement', 'Mon stock', 'Fiche de compte']))

scene('terrain-coach', 'Sur le terrain : le coach', """
Le coach est l'autre utilisateur du terrain. Sur son téléphone, il retrouve les producteurs de ses sections, par nom, code ou téléphone. La fiche du producteur donne ses tâches, ses parcelles et ses informations.
Il enregistre un nouveau producteur, relève une parcelle, dispense les formations, et saisit ses relevés. Tout reste sur le téléphone, puis part à la synchronisation.""",
  phones('coach-accueil', 'coach-producteurs', 'coach-producteur-taches', 'coach-formation', captions=['Accueil du coach', 'Producteurs par section', 'Tâches du producteur', 'Séance de formation']))

scene('groupe-taches', 'L\'Administrateur de groupe et les tâches', """
Au bureau, l'Administrateur de groupe organise le travail des coachs. Il ajoute aux profils des producteurs des formations, des distributions et des tâches, avec une consigne et une échéance.
Le coach les exécute sur son téléphone, puis l'élément est grisé et disparaît de la liste une fois réalisé.""",
  live('adg', [{'goto': '/modules-formation', 'w': 3}, {'scroll': 350, 'w': 3}, {'scroll': -350, 'w': 1}]))

scene('nouveautes', 'Les dernières évolutions', """
Voici les dernières évolutions. Sur le téléphone, la synchronisation est manuelle : une boîte de dialogue affiche chaque étape, avec le nom de chaque élément envoyé ou reçu.
À la connexion elle est complète, ensuite sélective : seules les nouveautés du profil sont échangées. Les poids et les nombres de sacs sont des nombres entiers.
Sur le portail, un délégué peut être payé en espèces ou par chèque, en choisissant la banque. Sur les cartes, une croix de visée affiche la latitude et la longitude. Et le profil d'un producteur liste toutes ses parcelles, y compris celles importées.""",
  card('bullets', title='Dernières évolutions', items=['Synchronisation manuelle, avec le nom de chaque élément', 'Complète à la connexion, puis seulement les nouveautés du profil', 'Poids et sacs en nombres entiers', 'Paiement d\'un délégué en espèces ou par chèque (banque au choix)', 'Cartes : croix de visée, latitude et longitude', 'Profil producteur : toutes ses parcelles, importées comprises']))

scene('tracabilite', 'La traçabilité vérifie les achats', """
Au bureau, le responsable de traçabilité reçoit les déclarations d'achat. Chaque ligne affiche la fiche du producteur importée par la coopérative : code, nom et prénoms, section, village, téléphone, superficie et estimation.
Il met la déclaration en vérification, puis l'accepte ou demande une correction avec un motif. Le délégué voit aussitôt le résultat sur son téléphone.""",
  live('responsable_tracabilite', [{'goto': '/declarations', 'w': 4}, {'scroll': 350, 'w': 3}, {'scroll': -350, 'w': 2}]))

scene('magasin', 'Le magasin : pesée et réception', """
À l'arrivée du camion, le magasinier ouvre le connaissement, pèse en brut, déduit la tare, et obtient le poids net. L'écart avec le poids annoncé est calculé ; au-delà de la tolérance, il doit être approuvé.
Même un camion non déclaré peut être pesé. Le stock est mis à jour, et le connaissement passe en caisse.""",
  live('magasinier', [{'goto': '/pesees', 'w': 4}, {'scroll': 350, 'w': 3}, {'goto': '/convois', 'w': 3}]))

scene('caisse', 'La caisse : fonds disponible et règlement', """
Le caissier se connecte comme tout utilisateur : sa session de caisse s'ouvre toute seule et se ferme quand il quitte le logiciel. La bande du haut affiche le fonds disponible : les espèces, et chaque compte bancaire.
D'un clic, il ouvre le détail dans une fenêtre liée, sans perdre l'écran où il travaille. Il règle les pesées à traiter au prix du jour ; les avances non soldées sont déduites.""",
  live('caissier', [{'goto': '/caisse', 'w': 4}, {'scroll': 300, 'w': 2}, {'goto': '/pesees', 'w': 4}, {'scroll': 300, 'w': 2}]))

scene('mise-en-compte', 'Le compte du délégué', """
Le caissier suit le solde de chaque délégué, et le clôture quand tout est réglé. Les couleurs aident à lire : en rouge, ce que la coopérative fournit ; en noir, ce que le délégué apporte.
Le solde total est rouge si le délégué doit à la coopérative, et bleu si la coopérative lui doit. Un reversement, lui, demande l'approbation d'une seconde personne.""",
  live('caissier', [{'goto': '/mise-en-compte', 'w': 4}, {'scroll': 350, 'w': 3}, {'scroll': -350, 'w': 1}]))

scene('compta', 'La comptabilité', """
Le comptable retrouve les opérations dans le journal des achats et le journal de caisse, passe les écritures, et rapproche le relevé de la banque.
L'évolution de chaque compte bancaire montre ce qui y est ajouté ou retiré, avec le solde cumulé.""",
  live('coop_admin', [{'goto': '/finances', 'w': 3}, {'tab': 'Comptabilité', 'w': 3}, {'scroll': 400, 'w': 2}, {'tab': 'Rapprochement bancaire', 'w': 3}]))

scene('fiche-transmise', 'La fiche d\'accompagnement part chez l\'exportateur', """
Avant le départ du camion, le responsable de traçabilité prépare la fiche d'accompagnement : les producteurs de chaque connaissement pesé, avec leur code, leur section et leur poids net.
Il l'exporte en Excel, ou l'importe si elle a été remplie ailleurs, puis la transmet à l'exportateur lié à la coopérative. La fiche ne peut plus changer, et devient, chez l'exportateur, une livraison attendue.""",
  live('responsable_tracabilite', [{'goto': '/fiches-accompagnement', 'w': 4}, {'scroll': 300, 'w': 3}, {'scroll': -300, 'w': 1}]))

scene('exp-organisation', 'L\'exportateur : une organisation à part entière', """
L'exportateur a son propre espace, avec ses employés, sa caisse, sa comptabilité et ses stocks, séparés de ceux des coopératives. Il n'a pas d'agents de terrain.
Son écran Coopératives montre, pour chaque coopérative qui lui livre, les livraisons, les poids acceptés ou rejetés, ce qui reste à régler et ce qui est payé. Les liens entre organisations se proposent avec un code, et s'activent quand l'autre les accepte.""",
  live('exp_admin', [{'goto': '/organisations-liees', 'w': 4}, {'tab': 'Liens', 'w': 3}, {'goto': '/', 'w': 2}]))

scene('exp-pont-bascule', 'Le pont bascule', """
Le responsable du pont bascule voit la livraison attendue, avec le camion et le poids déclaré par la coopérative. Camion chargé, il pèse l'entrée : le poids brut.
Une fois le camion déchargé, il pèse la sortie : la tare. Le poids net est calculé, avec l'écart par rapport au poids déclaré, et la coopérative est prévenue.""",
  live('pont_bascule', [{'goto': '/livraisons', 'w': 5}, {'scroll': 250, 'w': 3}]))

scene('exp-analyse', 'L\'analyse et le bulletin de pesée', """
L'analyste saisit les résultats de l'analyse : humidité, grainage, défauts et qualité. Il décide si la livraison est acceptée ou rejetée, avec un motif obligatoire en cas de rejet.
Le bulletin de pesée, appelé bon retour quand le chargement est accepté, est alors produit, avec les deux pesées, le poids net, l'analyse et les signataires. Après cela, les poids ne peuvent plus être modifiés.""",
  live('analyste', [{'goto': '/livraisons', 'w': 5}, {'scroll': 250, 'w': 3}]))

scene('exp-reglement', 'Le règlement de la coopérative', """
Pour une livraison acceptée, la caisse de l'exportateur fixe le prix au kilo : le montant est le poids net multiplié par le prix. Il est communiqué à la coopérative, qui suit chaque étape dans ses livraisons envoyées : poids net, décision, bulletin et règlement.
La même chaîne fonctionne entre deux coopératives, dans un sens ou dans les deux.""",
  live('exp_caissier', [{'goto': '/livraisons', 'w': 5}, {'scroll': 250, 'w': 3}]))

scene('exp-bon-retour', 'Les pièces jointes et le bon retour', """
En transmettant sa fiche, la coopérative peut joindre la fiche d'accompagnement, en Excel ou en PDF, et le connaissement CCC en PDF. L'exportateur les retrouve dans le bouton Pièces de la livraison.
Pour un chargement accepté, le bulletin de pesée est le bon retour. Les deux parties peuvent l'imprimer, ou le télécharger en PDF.""",
  live('pont_bascule', [{'goto': '/livraisons', 'w': 5}, {'scroll': 250, 'w': 3}]))

scene('exp-refoulement', 'Le refoulement d\'un chargement', """
L'exportateur peut refouler un chargement, avec un motif obligatoire. La livraison passe à Refoulée et ne se règle pas.
Le volume revient dans le stock de la coopérative, et ses convois redeviennent disponibles : elle peut les mettre dans un autre chargement. La coopérative est prévenue, et la fiche refusée est marquée comme refoulée.""",
  live('pont_bascule', [{'goto': '/livraisons', 'w': 5}, {'scroll': 250, 'w': 3}]))

scene('exp-audit', 'L\'audit de la coopérative', """
L'exportateur est le supérieur hiérarchique de la coopérative, et l'audite. Il propose d'abord sa supervision, que la coopérative accepte, et peut révoquer quand aucun audit n'est en cours.
Dans le module Audits, il programme une mission, puis chaque partie désigne ses participants et partage des copies figées de ses données, des documents ou des notes. Seuls les participants les voient, et chaque lecture est inscrite dans un journal. L'exportateur saisit ses constats, la coopérative répond avec un plan d'action, et l'audit est clos.""",
  live('exp_admin', [{'goto': '/audits', 'w': 4}, {'tab': 'Supervision', 'w': 4}]))

scene('stock-vente', 'Le stock et la vente', """
Le lot réceptionné rejoint le stock du magasin, suivi par lot. Il est ensuite vendu : l'acheteur partenaire, ici l'exportateur de la chaîne, ne voit que ses propres commandes, expéditions et documents.
Le contrôle qualité et les certificats accompagnent le lot jusqu'au départ.""",
  live('responsable_magasin', [{'goto': '/stocks', 'w': 3}, {'scroll': 350, 'w': 2}, {'goto': '/commerce', 'w': 3}]))

scene('exp-chaine', 'L\'exportateur reçoit le lot', """
Voici la vue de l'acheteur partenaire : uniquement ses commandes et ses documents. La traçabilité remonte de son lot jusqu'au producteur, avec chaque pesée, chaque règlement et chaque validation.""",
  live('acheteur', [{'goto': '/commerce', 'w': 3}, {'scroll': 300, 'w': 3}]))

scene('retour', 'Le retour vers le village', """
La boucle se referme avec les formations. L'exportateur propose un module à l'Administrateur de groupe, qui le transmet aux coachs. Les coachs le dispensent au village et saisissent les résultats,
que l'Administrateur de groupe transmet à l'exportateur. Toujours en un clic, sans rien modifier.""",
  card('flow', title='Le circuit des modules d\'exportateur', nodes=['Exportateur\npropose un module', 'Groupe\nl\'administrateur choisit nature + cible', 'Coachs\ndispensent + saisissent', 'Groupe\nl\'administrateur transmet (1 clic)', 'Exportateur\nreçoit les résultats'],
       foot='Contenu et résultats figés par la base de données · chaque étape notifie et est tracée'))
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


scene('fin', 'Merci', """
Voilà le parcours complet : du village à l\'exportateur, de la parcelle à la comptabilité, sur ordinateur et sur téléphone, avec une traçabilité sans trou, et des formations qui reviennent au village.
Agri Trace a été conçu par Dominique N\'Guessan. Pour toute question, contactez-le : téléphone, zéro cinq, zéro cinq, zéro cinq, quarante-cinq, soixante-trois ; adresse électronique, dominique n guessan quatre cent quatorze, arobase gmail point com. Merci de votre attention.""",
  card('title', title='AgriTrace', subtitle='Du terrain à l\'exportateur', note='Merci de votre attention',
       contact=[('Créateur : Dominique N\'Guessan', (40, 'Bold'), (34, 61, 48)), ('Téléphone : 05 05 05 45 63', (36, 'Medium'), (40, 52, 46)), ('E-mail : dominiquenguessan414@gmail.com', (36, 'Medium'), (40, 52, 46))]))

json.dump(S, open('scenario-terrain.json', 'w'), ensure_ascii=False, indent=1)
print(len(S), 'scènes ;', sum(len(s['narration'].split()) for s in S), 'mots')
