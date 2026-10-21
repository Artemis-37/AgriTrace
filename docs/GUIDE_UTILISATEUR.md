# Guide utilisateur AgriTrace

*Les captures du portail web montrent l'application avec des données fictives. Celles du téléphone sont le rendu des vrais écrans de l'application Android avec des données fictives (pas une photo d'un appareil : l'aspect exact dépend du modèle de téléphone).*

Ce guide présente chaque utilisateur **sur ordinateur** (portail web dans le navigateur, ou application de bureau Windows) et **sur téléphone** (application Android). Le menu affiché dépend des droits du compte : si une page manque, c'est que le rôle ne la donne pas (voir la matrice des rôles). Un compte ne voit jamais les données d'une autre coopérative.

## Qui utilise quoi
| Utilisateur | Ordinateur (portail / bureau) | Téléphone (Android) |
|---|---|---|
| Collecteur (délégué) | Mes achats, stock, historique, convois (portail simplifié) | **Outil principal** : achats, convois, stock, fiche de compte, hors connexion |
| Coach (agent de terrain) | Missions et parcelles en consultation | **Outil principal** : missions, relevé de parcelle, photos |
| Administrateur de groupe (ADG) | **Outil principal** : missions, cartographie, qualité, rapports | Consultation (missions, parcelles) |
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

### Hors connexion
- **Téléphone** : tout ce qui est saisi est gardé sur l'appareil puis envoyé au retour du réseau, sans doublon. Le bandeau en haut de l'accueil indique l'état : « Synchronisé », « Hors connexion », « n en attente », « n à corriger ».
- **Ordinateur** : un poste client enregistre les achats et les messages hors connexion, rejoués au retour du serveur. Validation, paiements et stocks demandent le serveur.

### Accès retiré
Si l'administrateur suspend le compte, le **téléphone efface les données de la coopérative** à la prochaine tentative de connexion ; seules les saisies jamais envoyées sont gardées. Sur ordinateur, la session est coupée et la connexion refusée.

### Notifications et messages
- **Ordinateur** : en haut à droite, une enveloppe (messages) et une cloche (notifications) avec leur compteur ; elles se balancent quand un nouvel élément arrive.
- **Téléphone** : la cloche de l'accueil affiche le nombre de notifications non lues. Pas de messagerie sur le téléphone.
- Les notifications ne s'affichent qu'avec du réseau.

<table class="phones"><tr><td><img src="captures/mobile/notifications.png" alt="Téléphone : notifications"><br><em>Téléphone : notifications</em></td></tr></table>

![Portail : tableau de bord (commandes, créances, missions en retard, anomalies)](captures/tableau-de-bord.png)
*Portail : tableau de bord (commandes, créances, missions en retard, anomalies)*

## Collecteur (délégué)

### Sur téléphone
1. **Déclarer un achat** : sur l'accueil (en-tête vert avec date, nom, coopérative, zone et total des achats du jour), bouton « Acheter du produit ». Choisir le producteur (recherche par nom ou code) : une fiche « Informations du producteur » s'affiche (nom, prénoms, matricule, contact, localité, section) ; « Continuer » ouvre la saisie : filière, quantité (sacs ou kg), **numéro du reçu d'achat dès la saisie** s'il est exigé, photo du reçu (facultative), date. Le prix vient du barème en vigueur : il ne change pas après coup.
2. **Suivre** : chaque ligne de l'accueil a une icône d'état (confirmé, en attente d'envoi, à corriger). Une déclaration « à corriger » se rouvre ; le motif est affiché. Un numéro de reçu déjà utilisé est signalé comme conflit.
3. **Convoi** : regrouper ses achats dans un convoi (n° de connaissement, chauffeur, camion). Il est envoyé dès que le réseau revient ; le magasinier le réceptionne ensuite.
4. **Historique, Mon stock, Ma fiche de compte** : achats passés avec filtre par état, quantités achetées / en route / livrées, et fiche de suivi du compte (report, financements, livraisons, solde). La fiche et le stock demandent le réseau.

<table class="phones"><tr><td><img src="captures/mobile/collecteur-accueil.png" alt="Accueil collecteur"><br><em>Accueil collecteur</em></td><td><img src="captures/mobile/collecteur-info-producteur.png" alt="Informations du producteur"><br><em>Informations du producteur</em></td><td><img src="captures/mobile/collecteur-nouvel-achat.png" alt="Saisie de l'achat"><br><em>Saisie de l'achat</em></td></tr></table>

<table class="phones"><tr><td><img src="captures/mobile/collecteur-mon-stock.png" alt="Mon stock"><br><em>Mon stock</em></td><td><img src="captures/mobile/collecteur-fiche.png" alt="Ma fiche de compte"><br><em>Ma fiche de compte</em></td><td><img src="captures/mobile/collecteur-convoi.png" alt="Déclarer un convoi"><br><em>Déclarer un convoi</em></td></tr></table>

### Sur ordinateur
« Mes achats », « Mon stock » et « Historique » du portail montrent les mêmes informations. Un collecteur ne voit que ses propres opérations et ne peut pas exporter vers Excel.

![Portail : Mes achats (vue collecteur)](captures/collecteur-mes-achats.png)
*Portail : Mes achats (vue collecteur)*

## Coach (agent de terrain)

### Sur téléphone
- **Missions** : liste des tâches données par l'ADG (en retard signalées en rouge) ; démarrer, saisir les résultats (texte, coordonnées, photos), soumettre. Le coach ne modifie pas les instructions : il peut **demander une nouvelle mission**, que l'ADG accepte ou refuse.
- **Relevé de parcelle** : marcher autour de la parcelle avec le GPS ou poser les sommets sur la carte ; le téléphone calcule la superficie (distincte de la superficie déclarée). Un point GPS seul ne donne jamais de superficie. La liste « Mes parcelles » permet aussi d'ajouter une photo et signale un nouveau tracé en attente d'envoi.
- **Fond de carte** : plan OpenStreetMap ou satellite quand le réseau est là ; fond hors ligne téléchargé en Wi-Fi depuis la page « Fond de carte ».

<table class="phones"><tr><td><img src="captures/mobile/coach-accueil.png" alt="Accueil du coach"><br><em>Accueil du coach</em></td><td><img src="captures/mobile/coach-missions.png" alt="Mes missions"><br><em>Mes missions</em></td><td><img src="captures/mobile/coach-parcelles.png" alt="Mes parcelles"><br><em>Mes parcelles</em></td></tr></table>

### Sur ordinateur
Consultation des missions et des parcelles dans le portail ; la saisie de terrain se fait sur le téléphone.

## Administrateur de groupe (ADG)
Responsable de la conformité et de la certification.

### Sur ordinateur
- **Missions** : créer les tâches des coachs, les assigner, relire les résultats, clôturer, décider des demandes.
- **Cartographie** : onglets Carte (fond neutre, plan ou satellite), Anomalies, Zones protégées, Importer, Exporter, Tolérances.
  - Une anomalie bloquante empêche la validation de la parcelle : la corriger, ou accepter une **exception motivée** (tracée). « Corrigée » est refusée tant que le problème existe.
  - Doublon : « Remplacer » garde l'historique de l'ancienne parcelle.
  - Zones protégées : charger un fichier GeoJSON ou GeoPackage ; vérifier la licence du jeu de données avant de le charger. Le blocage ou non des parcelles concernées se règle dans Tolérances.
  - Import : GeoJSON, KML, KMZ, Shapefile, GeoPackage ; WGS84 ou UTM sur WGS84 (converti avec avertissement).
- **Parcelles** : contrôler puis vérifier (déclarée → contrôlée → vérifiée).
- **Qualité et conformité** : certificats, inspections, alertes d'échéance. **Rapports** : achats, finance, stock, qualité, avec filtres et export Excel.

![Portail : missions des coachs](captures/missions.png)
*Portail : missions des coachs*

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
Consultation des missions et des parcelles (mêmes écrans que le coach, selon les droits du compte). Le travail de supervision se fait sur ordinateur.

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

## Caissier (ordinateur)
- **Convois** : traiter les convois reçus et régler les collecteurs ; les avances non soldées sont déduites automatiquement.
- **Caisse** : ouvrir sa caisse (chaque caissier a sa session), enregistrer les mouvements, clôturer en comptant l'espèce ; l'écart entre le compté et l'attendu est calculé et conservé.
- **Finances** : consultation des comptes et de la comptabilité selon les droits.

![Portail : finances](captures/finances.png)
*Portail : finances*

## Administrateur de coopérative (ordinateur)
- **Équipe** : créer les comptes, choisir le rôle, suspendre, réactiver, révoquer les sessions, consulter l'historique d'accès.
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
