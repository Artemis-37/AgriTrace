# Guide utilisateur AgriTrace

*Les captures du portail web montrent l'application avec des données fictives. Celles du téléphone sont le rendu des vrais écrans de l'application Android avec des données fictives (pas une photo d'un appareil : l'aspect exact dépend du modèle de téléphone).*

Ce guide présente chaque utilisateur **sur ordinateur** (portail web dans le navigateur, ou application de bureau Windows) et **sur téléphone** (application Android). Le menu affiché dépend des droits du compte : si une page manque, c'est que le rôle ne la donne pas (voir la matrice des rôles). Un compte ne voit jamais les données d'une autre coopérative.

## Qui utilise quoi
| Utilisateur | Ordinateur (portail / bureau) | Téléphone (Android) |
|---|---|---|
| Délégué | — (**mobile uniquement** : connexion refusée sur le portail) | **Outil principal** : achats, convois, stock, fiche de compte, hors connexion |
| Coach / agent de terrain | — (**mobile uniquement** : connexion refusée sur le portail) | **Outil principal** : producteurs (recherche et filtre par section), éléments de leur liste de tâches, modules de formation, relevé de parcelle, photos |
| Exportateur (partenaire) | **Outil principal** : proposer des modules, lire les résultats transmis | — |
| Administrateur de groupe (ADG) | **Outil principal** : cartographie, qualité, rapports, modules de formation | Consultation (parcelles) |
| Magasinier | **Outil principal** : convois, stocks, inventaire | — |
| Caissier | **Outil principal** : convois, caisse, finances | — |
| Administrateur de coopérative | **Outil principal** : équipe, rôles, référentiels, producteurs | — |

## Pour tous

### Connexion
- **Ordinateur** : adresse électronique et mot de passe ; un poste de bureau demande en plus, la première fois, le code d'association de 8 caractères remis par l'administrateur.
- **Téléphone** : mêmes identifiants ; « Associer ce téléphone à la coopérative (code) » pour entrer le code d'association. La première connexion demande Internet.

![Portail : écran de connexion](captures/connexion.png)
*Portail : écran de connexion*

<table class="phones"><tr><td><img src="captures/mobile/connexion.png" alt="Téléphone : connexion"><br><em>Téléphone : connexion</em></td></tr></table>

### Mot de passe
- **Changer le mien** : portail › icône de profil (en haut à droite) › « Mon profil » ; l'ancien mot de passe est demandé, 10 caractères minimum, et vos autres sessions sont fermées.
- **Double authentification** (recommandée, obligatoire si votre coopérative l'impose) : portail › icône de profil › « Mon profil » › « Activer la double authentification ». Ajoutez la clé affichée dans une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…), saisissez le code à 6 chiffres, puis **notez les 8 codes de secours** (chacun ne sert qu'une fois, affichés une seule fois). À chaque connexion, portail ou téléphone, un code vous est ensuite demandé. Téléphone perdu : utilisez un code de secours, ou demandez à l'administrateur « Retirer sa double authentification » (Équipe).
- **Mot de passe oublié ou réinitialisé** : l'administrateur de la coopérative utilise « Réinitialiser le mot de passe » dans Équipe ; il vous communique un mot de passe temporaire. À la première connexion (portail ou téléphone), l'application vous demande d'en choisir un nouveau avant tout le reste.

### Hors connexion
- **Téléphone** : tout ce qui est saisi est gardé sur l'appareil puis envoyé au retour du réseau, sans doublon. Le bandeau en haut de l'accueil indique l'état : « Synchronisé », « Hors connexion », « n en attente », « n à corriger ».
- **Synchronisation** : elle est **manuelle** (appui sur l'icône en haut de l'accueil), sauf à la **connexion** où le téléphone fait une synchronisation complète. Une boîte de dialogue montre chaque étape et **le nom de chaque élément** envoyé ou reçu. Les synchronisations suivantes sont **sélectives** : le téléphone ne reçoit que ce qui est nouveau ou modifié depuis la dernière fois (et n'envoie que ce qui a changé) ; s'il n'y a rien de nouveau, elle se termine aussitôt. Le téléphone ne reçoit que ce qui concerne le **profil** de l'utilisateur (un délégué ne reçoit pas ce que reçoit un coach). **Tant qu'il reste des éléments à soumettre, la synchronisation est refusée** : l'utilisateur les soumet lui-même, un par un ou par groupe, depuis « Éléments à soumettre », puis relance la synchronisation. Hors connexion, on peut ajouter une saisie ou une photo, marquer un élément du profil « fait », saisir les résultats d'une séance de formation, enregistrer achats, convois, producteurs, parcelles et relevés : tout est conservé sur l'appareil, listé « en attente », et envoyé sans doublon. Un refus du serveur apparaît dans les éléments « à corriger ». Chaque utilisateur a sa propre base chiffrée sur le téléphone : sur un téléphone partagé, les saisies d'un utilisateur ne partent jamais sous le compte d'un autre.
- **Ordinateur** : un poste client enregistre les achats et les messages hors connexion, rejoués au retour du serveur. Validation, paiements et stocks demandent le serveur.

### Accès retiré
Si l'administrateur suspend le compte, le **téléphone efface les données de la coopérative** à la prochaine tentative de connexion ; seules les saisies jamais envoyées sont gardées. Sur ordinateur, la session est coupée et la connexion refusée.

### Notifications et messages
- **Ordinateur** : en haut à droite, une enveloppe (messages) et une cloche (notifications) avec leur compteur ; elles se balancent quand un nouvel élément arrive. Ces deux entrées ne figurent plus dans le menu de gauche : la cloche ouvre un aperçu avec le lien « Voir l'historique ».
- **Téléphone** : la cloche de l'accueil affiche le nombre de notifications non lues. Pas de messagerie sur le téléphone.
- Les notifications ne s'affichent qu'avec du réseau.

<table class="phones"><tr><td><img src="captures/mobile/notifications.png" alt="Téléphone : notifications"><br><em>Téléphone : notifications</em></td></tr></table>

![Portail : tableau de bord (commandes, créances, anomalies)](captures/tableau-de-bord.png)
*Portail : tableau de bord (commandes, créances, anomalies)*

## Délégué

### Sur téléphone
1. **Déclarer un achat** : sur l'accueil (en-tête vert avec date, nom, coopérative, zone et nombre d'achats du jour ; la cloche des notifications est en haut, à côté de l'icône réseau), bouton « Acheter du produit ». Choisir le producteur (recherche par nom ou code) : une fiche « Informations du producteur » s'affiche (nom, prénoms, matricule, contact, localité, section) ; « Continuer » ouvre la saisie : filière, quantité (sacs ou kg), **numéro du reçu d'achat dès la saisie** s'il est exigé, photo du reçu (facultative), date. Le prix vient du barème en vigueur : il ne change pas après coup.
2. **Suivre** : chaque ligne de l'accueil a une icône d'état (confirmé, en attente d'envoi, à corriger). Une déclaration « à corriger » se rouvre ; le motif est affiché. Un numéro de reçu déjà utilisé est signalé comme conflit.
3. **Convoi** : regrouper ses achats dans un convoi (chauffeur, camion, sacs et poids annoncés). Le **n° de connaissement est attribué par le logiciel** : `code CCC de la coopérative`-`année`-`3 premières lettres du nom du délégué`-`n° d'ordre`, par exemple `SC000000-2026-OUM-1` pour le 1er convoi de 2026 d'Oumarou. Hors connexion, le numéro définitif est attribué à l'envoi. Il est envoyé dès que le réseau revient ; le magasinier le réceptionne ensuite.
4. **Historique, Mon stock, Ma fiche de compte** : achats passés avec filtre par état, quantités achetées / en route / livrées, et fiche de suivi du compte (report, financements, livraisons, solde). La fiche et le stock demandent le réseau.

<table class="phones"><tr><td><img src="captures/mobile/délégué-accueil.png" alt="Accueil délégué"><br><em>Accueil délégué</em></td><td><img src="captures/mobile/délégué-info-producteur.png" alt="Informations du producteur"><br><em>Informations du producteur</em></td><td><img src="captures/mobile/délégué-nouvel-achat.png" alt="Saisie de l'achat"><br><em>Saisie de l'achat</em></td></tr></table>

<table class="phones"><tr><td><img src="captures/mobile/délégué-mon-stock.png" alt="Mon stock"><br><em>Mon stock</em></td><td><img src="captures/mobile/délégué-fiche.png" alt="Ma fiche de compte"><br><em>Ma fiche de compte</em></td><td><img src="captures/mobile/délégué-convoi.png" alt="Déclarer un convoi"><br><em>Déclarer un convoi</em></td></tr></table>

### Sur ordinateur
Aucun accès : le compte délégué se connecte **uniquement par l'application mobile** (le portail refuse la connexion avec un message clair). Stock, historique et fiche de compte se consultent sur le téléphone.

## Coach (agent de terrain)

### Sur téléphone
- **Accueil en tuiles** : « Ajouter un nouveau producteur et une exploitation agricole », « Producteurs et enquêtes », « Ajouter une infrastructure sociale », « Télécharger les données », « Distribution et services », « Enregistrer une formation ». En dessous, « Éléments à soumettre » (nombre d'éléments en attente) avec **la liste de ces éléments** : chacun a son bouton d'envoi, et un élément refusé par le serveur est signalé « À corriger » avec son motif. La cloche est en haut.
- **Ajouter un nouveau producteur** (hors connexion possible) : nom, prénoms, genre, photo, date de naissance, pièce d'identité (type et numéro, ou « aucun identifiant applicable »), téléphone (+225), localité, coopérative et section, puis **déclaration de consentement** à lire et valider et **signature** au doigt. Le producteur est utilisable tout de suite sur le téléphone (relevé de parcelle, formation) ; le serveur lui attribue son code à l'envoi. Le numéro de pièce d'identité n'est visible que des profils autorisés à voir les données sensibles.
- **Ajouter une infrastructure sociale** : pour une école, la position GPS est prise automatiquement puis le formulaire en 17 questions (niveau, type, effectifs, enseignants, frais, cantine, latrines, résultats, année d'ouverture, financements).
- **Distribution et services** : on choisit la catégorie (Finance, Intrants et Outils, Services et Dépistages) et le groupe ; la liste des articles vient du catalogue tenu par l'administrateur (le dernier catalogue reçu reste disponible hors connexion) ; on coche les articles (ils apparaissent en pastilles), on vérifie la devise de chacun (unités, FCFA, euro, dollar), on choisit les bénéficiaires (recherche, section), puis pour chaque bénéficiaire on saisit la quantité, on prend la photo de preuve et on recueille sa signature ; une page de révision précède l'enregistrement (un dossier par bénéficiaire, envoyé à la synchronisation).
- **Enregistrer une formation** : « Dossiers de formation » (liste), puis le registre : thème, module, photo, participants (agriculteurs principaux choisis parmi les producteurs, parties prenantes saisies à la main) et scores de 0 à 100.
- **Producteurs et enquêtes** : on choisit d'abord le producteur (recherche par nom, code ou téléphone, hors connexion). Des pastilles **Section** sous la barre de recherche réduisent la liste aux producteurs d'une section (touchez de nouveau la pastille pour retirer le filtre). Sa fiche a deux onglets :
  - **Liste des tâches** : les éléments affectés à ce producteur (formations, distributions, inspections, services ; en retard signalés en rouge). On ouvre un élément pour saisir les résultats (texte, coordonnées, photos) et le soumettre, ou on le marque « fait ».
  - **Informations sur le producteur** : téléphone, code, localité, section, **nombre de parcelles capturées** avec la taille de chacune, bouton **Relever une parcelle** (le producteur est déjà choisi) et bouton **Ouvrir la carte**. Chaque parcelle permet d'ajouter une photo et, avec le droit de modification, de reprendre le tracé ; un nouveau tracé en attente d'envoi est signalé.
- **Modules de formation** (tuile de l'accueil) : bibliothèque agricole préchargée (cacao en priorité, puis café) liée aux certifications. Filtrer par culture ou par thème, ouvrir un module (objectifs, points à enseigner, erreurs à éviter, questions de vérification). Lecture seule ; le contenu est géré par l'ADG. Une copie reste sur le téléphone pour la lecture sans réseau (ouvrir l'écran une première fois avec du réseau).
- **Tâches terminées** : une tâche terminée et validée par l'ADG apparaît grisée et ne s'ouvre plus ; elle disparaît de la liste après le délai fixé par l'ADG.
- **Module d'exportateur** : un module marqué « Proposé par … » affiche le bouton **Saisir les résultats** (date, village, participants, score moyen, observations). Les résultats sont envoyés à l'ADG (réseau requis), ne sont plus modifiables, et la liste *Mes résultats saisis* indique s'ils ont été transmis à l'exportateur.
- **Relevé de parcelle** : marcher autour de la parcelle avec le GPS ; le téléphone calcule la superficie (distincte de la superficie déclarée). Un point GPS seul ne donne jamais de superficie.
- **Fond de carte** : il s'affiche quand on consulte la carte depuis la fiche du producteur (« Ouvrir la carte ») et pendant le relevé : plan OpenStreetMap ou satellite quand le réseau est là, fond hors ligne téléchargé en Wi-Fi depuis « Télécharger les données ».

<table class="phones"><tr><td><img src="captures/mobile/coach-accueil.png" alt="Accueil du coach"><br><em>Accueil du coach</em></td><td><img src="captures/mobile/coach-producteurs.png" alt="Sélection du producteur"><br><em>Sélection du producteur</em></td></tr></table>

<table class="phones"><tr><td><img src="captures/mobile/coach-ajout-producteur.png" alt="Ajouter un producteur"><br><em>Ajouter un producteur</em></td><td><img src="captures/mobile/coach-infrastructure.png" alt="Infrastructure sociale"><br><em>Infrastructure sociale</em></td><td><img src="captures/mobile/coach-distribution-articles.png" alt="Distribution et services"><br><em>Distribution et services</em></td></tr></table>

<table class="phones"><tr><td><img src="captures/mobile/coach-formations.png" alt="Dossiers de formation"><br><em>Dossiers de formation</em></td><td><img src="captures/mobile/coach-formation.png" alt="Registre de formation"><br><em>Registre de formation</em></td></tr></table>

<table class="phones"><tr><td><img src="captures/mobile/coach-modules-formation.png" alt="Bibliothèque de modules"><br><em>Bibliothèque de modules</em></td><td><img src="captures/mobile/coach-module-exportateur.png" alt="Module proposé par un exportateur"><br><em>Module d'exportateur et résultats saisis</em></td><td><img src="captures/mobile/coach-module-resultats.png" alt="Saisie des résultats"><br><em>Saisie des résultats</em></td></tr></table>

<table class="phones"><tr><td><img src="captures/mobile/coach-producteur-taches.png" alt="Fiche : liste des tâches"><br><em>Fiche : liste des tâches</em></td><td><img src="captures/mobile/coach-producteur-infos.png" alt="Fiche : informations sur le producteur"><br><em>Fiche : informations sur le producteur</em></td></tr></table>

### Sur ordinateur
Aucun accès : le compte coach se connecte **uniquement par l'application mobile**. L'ADG suit son travail depuis le portail (relevés de terrain, modules de formation).

## Administrateur de groupe (ADG)
Responsable de la conformité et de la certification.

### Sur ordinateur
- **Modules de formation** : bibliothèque préchargée (cacao puis café, liée aux certifications). Pour chaque module : *Conserver* (validé tel quel), *Modifier* ou *Supprimer* ; *Rétablir les modules par défaut* ne rajoute que ceux qui ont été supprimés. Le contenu fourni est un socle général, sans chiffres réglementaires précis : à adapter à votre cahier des charges de certification avant de s'en servir en formation.
- **Modules des exportateurs** (l'exportateur arrive sur un tableau de bord à quatre indicateurs : propositions en attente, transmises, non retenues, résultats reçus ; l'ADG voit en plus le nombre de modules et de résultats à transmettre) : un exportateur partenaire propose des modules ; l'ADG (Administrateur de groupe) les lit puis clique **Transmettre aux coachs** (ou **Décliner**) ; une fenêtre lui demande la **nature** de l'élément (module de formation, distribution ou tâche) et sa **cible** (tous les producteurs ou certains, par recherche et section) : il s'ajoute au profil de chacun, où le coach le voit et le marque *Fait*. L'onglet **Affectations aux producteurs** permet la même chose avec un modèle de la bibliothèque, une distribution ou une tâche libre, et affiche l'avancement. Les coachs dispensent la formation et saisissent leurs résultats sur l'application ; l'ADG clique **Transmettre à l'exportateur**. À aucun moment l'ADG ne modifie le contenu ou les résultats (ils sont figés à l'enregistrement), et un module d'exportateur n'est ni modifiable ni supprimable dans la bibliothèque. Chaque étape notifie le destinataire et est tracée dans le journal d'audit.

![Modules des exportateurs (ADG)](captures/formation/adg-modules-exportateurs.png)

![Affectations aux producteurs (ADG)](captures/formation/adg-affectations.png)

![Résultats à transmettre (ADG)](captures/formation/adg-resultats-exportateurs.png)

![Espace de l'exportateur](captures/formation/exportateur-modules-exportateurs.png)
- **Comptes mobile uniquement** : les rôles standard *délégué*, *agent de terrain* et *coach* (créés depuis *Équipe*) sont « mobile uniquement ». Leurs titulaires se connectent par l'application ; le portail refuse leur connexion avec un message clair. Ce réglage n'a pas encore d'écran pour les rôles personnalisés (il se pose à la création du rôle par l'API). C'est une règle d'usage de l'interface, pas une barrière de sécurité.
- **Cartographie** : onglets Carte (fond neutre, plan ou satellite), Anomalies, Zones protégées, Importer, Exporter, Tolérances.
  - Une anomalie bloquante empêche la validation de la parcelle : la corriger, ou accepter une **exception motivée** (tracée). « Corrigée » est refusée tant que le problème existe.
  - Doublon : « Remplacer » garde l'historique de l'ancienne parcelle.
  - Zones protégées : charger un fichier GeoJSON ou GeoPackage ; vérifier la licence du jeu de données avant de le charger. Le blocage ou non des parcelles concernées se règle dans Tolérances.
  - Import : GeoJSON, KML, KMZ, Shapefile, GeoPackage ; WGS84 ou UTM sur WGS84 (converti avec avertissement).
- **Parcelles** : contrôler puis vérifier (déclarée → contrôlée → vérifiée).
- **Qualité et conformité** : certificats, inspections, alertes d'échéance. **Rapports** : achats, finance, stock, qualité, avec filtres et export Excel.


![Portail : carte, les parcelles avec anomalie ouverte sont cerclées de rouge](captures/cartographie-carte.png)
*Portail : carte, les parcelles avec anomalie ouverte sont cerclées de rouge*

![Portail : anomalies (chevauchement, parcelle en zone protégée)](captures/cartographie-anomalies.png)
*Portail : anomalies (chevauchement, parcelle en zone protégée)*

![Portail : zones protégées](captures/cartographie-zones.png)
*Portail : zones protégées*

![Portail : rapports d’achats avec filtres et export Excel](captures/rapports.png)
*Portail : rapports d’achats avec filtres et export Excel*

![Portail : qualité et conformité](captures/qualite.png)
*Portail : qualité et conformité*

### Sur téléphone
Consultation des parcelles (mêmes écrans que le coach, selon les droits du compte). Le travail de supervision se fait sur ordinateur.

## Magasinier (ordinateur)
- **Convois** : ouvrir un convoi arrivé, peser (brut, tare, net), constater les écarts, réceptionner en totalité ou en partie.
- **Stocks et lots** : mouvements (entrée, transfert, sortie, chargement, perte, déclassement, quarantaine), lots et leur généalogie.
- **Inventaire** : saisir le comptage ; l'inventaire doit être **approuvé par une autre personne**. Aucune suppression : seulement des ajustements tracés.
- Pas d'accès à la caisse, aux finances ni à la cartographie.

![Portail : stocks et lots](captures/stocks-lots.png)
*Portail : stocks et lots*

![Portail : convois](captures/convois.png)
*Portail : convois*

![Portail : inventaire](captures/inventaire.png)
*Portail : inventaire*

## Magasinier, caissier(e) et comptable : reçus et demandes d'annulation (ordinateur)
- **Mes opérations** (menu de gauche) : la liste de ce que **vous** avez fait (réceptions de convois, règlements, mouvements de caisse, écritures comptables, mouvements de stock), selon vos droits.
- **Imprimer le reçu** : **bulletin de pesée** (réception d'un convoi), reçu de règlement, reçu de caisse, pièce comptable ou bon de mouvement, avec l'en-tête de la coopérative (logo, adresse, téléphone), les lignes de l'opération et deux cases de signature. Toute impression est tracée ; à partir de la deuxième, la pièce porte la mention **DUPLICATA n°…**.
- **Demander l'annulation** : indiquez le motif (5 caractères minimum). L'opération n'est **pas** annulée tout de suite : l'administrateur de la coopérative (ou tout titulaire du droit d'approbation, par exemple la direction ou le responsable financier) reçoit une notification, approuve ou refuse (refus motivé). Le demandeur est averti de la décision. On ne peut pas approuver sa propre demande.
- **Ce qu'une annulation fait** : rien n'est effacé de l'historique. Un mouvement de caisse ou de stock reçoit une écriture inverse ; une écriture comptable est contre-passée ; une réception non réglée est retirée (le convoi redevient « en transit ») ; un règlement est annulé (écritures inversées, la réception revient dans la file de la caisse pour être réglée à nouveau).
- **Ce qui ne s'annule pas directement** : une écriture déjà d'annulation, une opération déjà annulée, une écriture générée par un document (annulez le document d'origine), une réception déjà réglée (la caisse demande d'abord l'annulation du règlement), un règlement dont le montant a déjà été payé au délégué (solde insuffisant).

![Portail : mes opérations, reçus et demandes d'annulation](captures/operations.png)
*Portail : mes opérations, reçus et demandes d'annulation*

## Caissier (ordinateur)
- **Convois** : traiter les convois reçus et régler les délégués ; les avances non soldées sont déduites automatiquement.
- **Caisse** : ouvrir sa caisse (chaque caissier a sa session), enregistrer les mouvements, clôturer en comptant l'espèce ; l'écart entre le compté et l'attendu est calculé et conservé.
- **Finances** : consultation des comptes et de la comptabilité selon les droits.

![Portail : finances](captures/finances.png)
*Portail : finances*

## Administrateur de coopérative (ordinateur)
- **Équipe** : créer les comptes, choisir le rôle, suspendre, réactiver, révoquer les sessions, **réinitialiser un mot de passe** (le mot de passe temporaire n'est affiché qu'une fois), **retirer la double authentification** d'un collègue qui a perdu son téléphone, consulter l'historique d'accès.
- **Profil de la coopérative** (Équipe) : nom commercial, adresse, téléphone, e-mail, devise, langue par défaut ; repris en en-tête des reçus. Le **code CCC** de la coopérative y est saisi une fois : il sert de préfixe au numéro de connaissement des convois (sans code, le délégué saisit le numéro à la main). Changer le code n'affecte que les convois futurs. Deux délégués dont les noms commencent par les mêmes 3 lettres partagent le même compteur : leurs numéros restent distincts.
- **Rôles types** : 17 modèles prêts (direction, responsables de traçabilité / cartographie / magasin / financier / qualité / logistique, cartographe, agent de terrain, magasinier, caissier, comptable, délégué, coach, ADG, auditeur, acheteur ou partenaire) à créer en un clic, puis à ajuster.
- **Rapprochement bancaire** (Finances › Rapprochement bancaire) : importer le relevé de la banque en CSV, choisir les colonnes, simuler, importer ; les lignes correspondant à une seule opération du compte sont pointées d'office, les autres se pointent à la main ou s'ignorent avec une note ; les opérations du compte absentes du relevé sont listées pour être expliquées.
- **Rapports automatiques** (Rapports › Envoi automatique) : choisir le rapport, la fréquence (jour, semaine, mois), l'heure et les destinataires ; chacun reçoit une notification et télécharge le fichier Excel ; envoi par e-mail si le serveur est configuré pour.
- **Annulations** : traiter les demandes dans « Mes opérations » › « Demandes d'annulation ».
- **Rôles** : créer des rôles en combinant les permissions ; certains droits sensibles peuvent exiger une seconde approbation.
- **Référentiels** : filières, campagnes, prix (chaque modification crée une version datée).
- **Producteurs** : fiches, statuts, import Excel ou CSV avec prévisualisation, création/mise à jour/erreurs, rapport d'import. Les codes à zéros initiaux sont conservés.
- **Synchronisation** (si le serveur local est utilisé) : état de la réplication vers le central, association des postes.
- **Bureau Windows** : poste unique, serveur ou client au premier démarrage ; menu « Sauvegarder maintenant… » (dossier de destination au choix, clé USB par exemple) ; la restauration se teste avec `scripts/restore-test.sh` (voir `EXPLOITATION.md`).

![Portail : équipe](captures/equipe.png)
*Portail : équipe*

![Portail : producteurs](captures/producteurs.png)
*Portail : producteurs*

![Portail : parcelles](captures/parcelles.png)
*Portail : parcelles*

## En cas de problème
| Constat | Sur téléphone | Sur ordinateur |
|---|---|---|
| « Hors connexion » alors que le réseau est là | Vérifier le réseau, revenir à l'accueil pour relancer la synchronisation | Vérifier le serveur (icônes en haut à droite) |
| Déclaration « à corriger » | Ouvrir la ligne, lire le motif, corriger, renvoyer | Même chose depuis « Mes achats » |
| Numéro de reçu en conflit | Le même numéro a déjà servi : saisir le bon ou joindre la photo du reçu | Idem |
| « Accès refusé » | Se reconnecter ; sinon contacter l'administrateur (compte suspendu ou droit retiré) | Idem |
| Page absente du menu | Le rôle n'en donne pas l'accès : demander à l'administrateur | Idem |

### Données de terrain (portail web)

Le menu **Données de terrain** (droit `field_records:read`) liste les distributions, formations et infrastructures sociales saisies par les coachs ; un clic ouvre le détail (articles et quantités, participants et scores, réponses) avec les photos et signatures jointes. L'onglet **Catalogue des articles** permet à l'administrateur (droit `field_records:manage`) d'ajouter ou de retirer les articles que les coachs peuvent distribuer ; un article retiré reste visible dans les distributions déjà enregistrées.

### Logo de la coopérative

![Carte de réglage du logo](captures/equipe.png)

Chaque coopérative peut ajouter son logo : **Équipe › Logo de la coopérative** (droit `org:branding`, donné à l'administrateur de coopérative). Image PNG ou JPEG de 1 Mo maximum. Le logo n'est plus affiché dans l'interface (menu du portail, accueil mobile) ; il reste enregistré pour les rapports et documents imprimés. Les SVG sont refusés pour des raisons de sécurité. « Supprimer » retire le logo.

### Modèles de saisie : l'ADG adapte, puis déploie (portail web › Données de terrain › Modèles de saisie)

L'outil sert plusieurs coopératives : ce que les coachs doivent renseigner ne doit pas être figé. L'**ADG** (droit `field_templates:manage`) rédige pour sa coopérative :

- les **catégories d'infrastructure** (École, Centre de santé, Point d'eau…) avec leur questionnaire : intitulé, type de réponse (texte, nombre, liste de choix), caractère obligatoire, ordre ;
- les **thèmes de formation** et leurs modules ;
- le **catalogue des articles** (catégories, groupes et articles distribuables, ajoutés librement).

Un modèle enregistré reste un **brouillon** : rien ne change pour les coachs. Le bouton **Déployer** le publie (numéro de version) ; les coachs le reçoivent dès qu'ils ouvrent l'écran concerné avec du réseau, puis il reste disponible hors connexion. Le portail signale « Modifié, à redéployer » quand le brouillon diffère de la version déployée. **Retirer** masque le modèle aux coachs sans toucher aux enregistrements déjà faits. « Charger les modèles de départ » insère en brouillon le modèle École et les 15 thèmes de formation, à adapter.

Tant qu'aucun modèle n'est déployé, l'application utilise ses modèles intégrés (École et thèmes de formation), pour que les coachs ne soient jamais bloqués.

**Catégories et groupes de distribution.** Ils ne sont plus figés : ils sont ceux du catalogue de la coopérative. Une catégorie ou un groupe naît en ajoutant un premier article avec ce nom ; l'ADG peut ensuite les **renommer** ou les **retirer** d'un coup (onglet Catalogue des articles). Tant que le catalogue est vide, l'application propose Finance (Bourses, Crédit, Primes, Prêts, Subventions), Intrants et Outils, et Services et Dépistages.


## Fiches d'accompagnement (responsable de traçabilité et exportateur)
**Responsable de traçabilité** — menu **Opérations › Fiches d'accompagnement** : *Convois pesés* → **Consulter** (producteurs du convoi) ou **Exporter (Excel)** (modèle de la coopérative). Pour un chargement : cochez les convois, **Créer la fiche**, complétez l'en-tête (chauffeur, camion, remorque, LOT ID DSE, connaissement, date de départ, type de cacao, certifications). **Importer une fiche (Excel)** reprend une fiche déjà remplie ; **Transmettre à l'exportateur** la fige et la lui envoie.
**Exportateur** — menu **Fiches d'accompagnement** : fiches transmises à son compte, consultation des producteurs et téléchargement Excel.


## Nouveautés de cette version

- **Paiement d'un délégué** (Convois › « Payer un délégué ») : en **espèces** (choix de la caisse) ou par **chèque** (choix de la banque / du compte bancaire et n° du chèque). Le compte du délégué est débité et l'écriture passe en caisse ou en banque.
- **Fiche de compte du délégué** : le solde est en **rouge** quand le délégué doit à la coopérative et en **bleu** quand la coopérative lui doit.
- **Cartes (mobile et portail)** : une **croix de visée** au centre (quatre traits séparés et un point au milieu) indique le point visé ; sa **latitude et sa longitude** s'affichent en bas à droite et suivent le déplacement de la carte. Fond de carte **OpenStreetMap** ; le fond **Google Maps** est proposé quand une clé Google Maps Platform est fournie à l'installation.
- **Mobile** : le profil d'un producteur liste **toutes ses parcelles**, y compris celles **importées** (rattachées au producteur par son code). La liste des accès mémorisés s'affiche en touchant le champ e-mail de la connexion et remplit l'e-mail et le mot de passe.
- **Sécurité des données** : base du téléphone chiffrée, photos en attente chiffrées sur l'appareil (AES-256-GCM, clé dans le Keystore Android), pièces jointes chiffrées sur le serveur, serveur Windows avec clé de chiffrement propre.
- **Retrait des « missions »** : la rubrique n'existe plus ; le travail du terrain passe par la liste des tâches du producteur (formations, distributions, inspections, services).

## Cycle d'une traite (Paramètres › Traites)

- **Clôture automatique** : à la date de fin, la traite passe à « Clôturée » (vérification toutes les heures) et son bilan est figé. Une fois clôturée, plus aucun achat ne peut y être déclaré.
- **Ouverture automatique** : une traite « Planifiée » s'ouvre seule à sa date de début.
- **Alerte** : l'administrateur reçoit une notification chaque jour dans les 15 derniers jours de la traite (réglable par `CAMPAIGN_ALERT_DAYS`), puis lors de l'ouverture et de la clôture.
- **Reprendre les prix** : à la création d'une traite, le champ « Reprendre les produits et les prix de » copie ceux de la traite choisie ; ils restent modifiables.
- **Bilan** : le bouton « Bilan » affiche, par produit, les poids, sacs et montants réglés, les achats acceptés et les prix de fin de traite (provisoire tant que la traite est en cours).

## Distribution et services : catalogue

Chaque coopérative reçoit un catalogue de départ (catégories Finance, Intrants et Outils, Services et Dépistages, avec leurs groupes et articles). Sur le téléphone : Distribution et services › catégorie › groupe › cases à cocher. L'administrateur ajoute, renomme ou retire des groupes et des articles depuis l'application.

## Tâches de l'exportateur

Comme pour ses modules de formation, l'exportateur peut créer une tâche (un questionnaire) : menu « Modules des exportateurs » › onglet « Tâches » › « Créer une tâche ». L'ADG la transmet aux coachs en un clic en choisissant les producteurs et l'échéance (elle s'ajoute au profil des producteurs). Les coachs répondent sur le téléphone ; l'ADG transmet ensuite les réponses à l'exportateur, qui peut les consulter et les exporter en CSV. L'ADG ne modifie ni les questions ni les réponses.

## Modèle d'import des producteurs (mis à jour)

Le modèle Excel téléchargeable (Producteurs → Importer) suit la fiche « Ajouter un producteur » du téléphone : Code, Nom, Prénoms, Téléphone, Région, **Département**, **Sous-préfecture**, Section, **Village**, Superficie (ha), Estimation (kg), Filières, Date d'adhésion, Sexe, **Date de naissance**, **Type de pièce d'identité**, **Numéro de la pièce d'identité**. Une feuille « Instructions » explique chaque colonne. Les anciens fichiers avec « Quartier », « Lieu », « Département » et « Village » sont toujours acceptés. Test : `backend/scripts/e2e-import-modele.js`.

## Localités de Côte d'Ivoire préchargées (téléphone)

L'application contient la liste des 31 régions, des districts d'Abidjan et de Yamoussoukro, de leurs départements et de leurs sous-préfectures (fichier `mobile/assets/ci-geo.json`). Elle est disponible sans connexion ; les localités déjà enregistrées par la coopérative s'y ajoutent. Le village se saisit à la main (liste officielle des villages non préchargée).

## Code producteur : défini par la coopérative

Le serveur n'attribue plus de code producteur de sa propre initiative. Dans **Paramètres → Société → Codes des producteurs**, la coopérative choisit son format (préfixe, nombre de chiffres, premier numéro ; exemple `SOC-0100`). Si le format est activé, le code est attribué automatiquement à chaque nouveau producteur (téléphone, portail, import Excel). Sinon le code reste **vide** et se saisit à la main : à la création (champ « Code du producteur » sur le téléphone et le portail), ou plus tard sur un producteur qui n'a pas encore de code. Un code déjà attribué ne se modifie pas et reste unique dans la coopérative. Les coopératives qui utilisaient déjà les codes `P00001` gardent ce format (activé par la migration 085). Test : `backend/scripts/e2e-code-producteur.js`.

## Inspections internes : calcul automatique, approbation et reprise

- **Non-conformités relevées** : renseignées automatiquement d'après les réponses « Non conforme » (numéro de l'exigence et constat). Le coach n'a rien à saisir.
- **Approbation** : le score de conformité = conformes ÷ (conformes + non conformes), les « Non applicable » étant exclus. À **100 %**, l'inspection est approuvée automatiquement (décision « Approuvé » quand la fiche en comporte une). Cela s'applique à **toutes** les fiches d'inspection interne : Rainforest Alliance, Fairtrade, Fairtrade USA et fiche unique (les points « oui / non » et « conforme / partiel » comptent comme conformes / non conformes).
- **Moins de 100 %** : le questionnaire reste à faire, marqué « À reprendre » dans le profil du producteur avec le motif, et le coach qui l'a saisi reçoit une notification pour le reprendre (ses réponses sont conservées). La fiche en reprise peut être exportée en PDF / Word avec ses non-conformités et mesures correctives.
- **Croquis de l'exploitation** : à l'export PDF, il est généré automatiquement avec les polygones des parcelles du producteur (surfaces, périmètres, échelle). Les voisins, cours d'eau, magasin phytosanitaire et habitations ne sont pas connus du logiciel : à noter dans « Remarques additionnelles ».

## Export et import de toutes les tâches

- Onglet Affectations : **Exporter toutes les tâches** (Excel, une ligne par producteur avec statut, date et score) et **Importer des tâches** (modèle fourni : titre, type, questionnaire ou module, échéance, consignes, codes producteurs ; vide = tous).
- Questionnaires : bouton **Exporter** par questionnaire, au format du modèle d'importation (modifiable puis réimportable).

La fiche d'inspection Rainforest Alliance s'exporte aussi en **Word (.docx)**, avec la même mise en page que le PDF (bouton « Exporter (Word) » dans la fiche renseignée).

## Observations proposées par exigence (fiche Rainforest Alliance)

Sous chaque point évalué (Conforme / Non conforme / Non applicable), le coach choisit une **observation** dans une liste déroulante adaptée à l'exigence et au résultat (65 exigences, plusieurs choix chacune), ou saisit la sienne avec « Autre (saisir)… ». L'observation choisie apparaît dans la colonne Observations du PDF et du Word, et sert de constat dans « Non-conformités relevées ». Changer le résultat d'une exigence efface l'observation choisie.

Les mêmes listes d'observations existent pour les fiches **Fairtrade**, **Fairtrade USA** et la **fiche unique** : pour un point répondu « Oui » (ou Conforme), l'observation proposée est de conformité ; pour « Non » (ou Partiel), elle décrit le manquement. Elles figurent aussi dans le PDF de ces fiches.

## Mesures correctives proposées

Pour chaque point **non conforme**, une liste « Mesure corrective (avec délai) » propose 2 mesures adaptées à l'exigence (par exemple « Faire signer le contrat avec la coopérative et en remettre un exemplaire au producteur — sous 1 mois »). Le champ « Mesures correctives pour l'année en cours » (ou « Actions correctives demandées » sur les autres fiches) est **composé automatiquement** : une ligne par point non conforme, avec la mesure choisie. **Si le coach n'en choisit pas, la première mesure proposée est retenue.** Dans le PDF et le Word de la fiche Rainforest Alliance, chaque non-conformité est face à sa mesure.
