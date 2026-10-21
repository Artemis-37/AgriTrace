# Guide utilisateur AgriTrace

*Les captures d'écran montrent le portail web avec des données fictives. Les écrans du téléphone suivent la même logique ; leurs captures seront ajoutées après l'installation sur un appareil.*

Guide par rôle (CDC §35). Il décrit ce que chacun voit et fait dans le portail web et sur le téléphone Android. Le menu affiché dépend des droits du compte : si une page manque, c'est que le rôle ne la donne pas (voir `MATRICE_ROLES.md`). Un compte ne voit jamais les données d'une autre coopérative.

## Pour tous


![Tableau de bord : commandes, créances, missions en retard, anomalies de cartographie](captures/tableau-de-bord.png)
*Tableau de bord : commandes, créances, missions en retard, anomalies de cartographie*
- **Connexion** : adresse électronique et mot de passe.

![Écran de connexion](captures/connexion.png)
*Écran de connexion*
 Sur un téléphone ou un poste de bureau, un code d'association de 8 caractères, remis par l'administrateur, est demandé la première fois.
- **Hors connexion** : sur le téléphone, tout ce qui est saisi est gardé sur l'appareil puis envoyé au retour du réseau, sans doublon. La barre en haut de l'écran indique l'état : « Synchronisé », « Hors connexion », « n en attente », « n à corriger ».
- **Accès retiré** : si l'administrateur suspend votre compte, le téléphone efface les données de la coopérative à la prochaine tentative de connexion. Seules les saisies jamais envoyées sont gardées.
- **Notifications** : la cloche indique les alertes (retards, documents manquants, validations attendues). Elles ne s'affichent qu'avec du réseau.
- **Messages** : messagerie interne entre membres de la coopérative.
- **Thème** : bouton en bas du menu (clair, doux, nuit).

## Collecteur (délégué)
Sur le téléphone ou dans « Mes achats » du portail.
1. **Déclarer un achat** : producteur (recherche par nom ou code), filière, quantité (sacs ou kg), **numéro du reçu d'achat dès la saisie** s'il est exigé, photo du reçu (facultative), date. Le prix vient du barème en vigueur : il ne change pas après coup.
2. **Corriger** : une déclaration marquée « à corriger » se rouvre depuis la liste ; le motif du refus est affiché. Un numéro de reçu déjà utilisé est signalé comme conflit.
3. **Convoi** : regrouper ses achats dans un convoi (numéro de convoi, chauffeur, camion). Le magasinier le réceptionne ensuite.
4. **Mon stock, Historique, Ma fiche de compte** : ce qui a été livré, le solde et les avances en cours. Un collecteur ne voit que ses propres opérations et ne peut pas exporter vers Excel.

![Mes achats (vue collecteur dans le portail)](captures/collecteur-mes-achats.png)
*Mes achats : le collecteur ne voit que ses propres opérations*


## Magasinier
- **Convois** : ouvrir un convoi arrivé, peser (brut, tare, net), constater les écarts, réceptionner en totalité ou en partie.
- **Stocks et lots** : mouvements (entrée, transfert, sortie, chargement, perte, déclassement, quarantaine), lots et leur généalogie.
- **Inventaire** : saisir le comptage ; l'inventaire doit être **approuvé par une autre personne**. Aucune suppression : seulement des ajustements tracés.
- Pas d'accès à la caisse, aux finances ni à la cartographie.

![Stocks et lots](captures/stocks-lots.png)
*Stocks et lots : quantités calculées depuis les mouvements, traçabilité et PDF par lot*

![Convois](captures/convois.png)
*Convois : réception au magasin central*


## Caissier
- **Convois** : traiter les convois reçus et régler les collecteurs ; les avances non soldées sont déduites automatiquement.
- **Caisse** : ouvrir sa caisse (chaque caissier a sa session), enregistrer les mouvements, clôturer en comptant l'espèce ; l'écart entre le compté et l'attendu est calculé et conservé.
- **Finances** : consultation des comptes et de la comptabilité selon les droits.

![Finances](captures/finances.png)
*Finances*


## Coach (agent de terrain)
Sur le téléphone.
- **Missions** : liste des tâches données par l'ADG ; démarrer, saisir les résultats (texte, coordonnées, photos), soumettre. Le coach ne modifie pas les instructions : il peut **demander une nouvelle mission**, que l'ADG accepte ou refuse.
- **Relevé de parcelle** : marcher autour de la parcelle avec le GPS ou poser les sommets sur la carte ; le téléphone calcule la superficie (distincte de la superficie déclarée). Un point GPS seul ne donne jamais de superficie.
- **Fond de carte** : plan OpenStreetMap ou satellite quand le réseau est là ; fond hors ligne téléchargé en Wi-Fi depuis la page « Fond de carte ».

## Administrateur de groupe (ADG)
Responsable de la conformité et de la certification.
![Missions](captures/missions.png)
*Missions : tâches des coachs*

- **Missions** : créer les tâches des coachs, les assigner, relire les résultats, clôturer, décider des demandes.
- **Cartographie** : onglets Carte (fond neutre, plan ou satellite), Anomalies (chevauchements, doublons, **parcelles en zone protégée**), Zones protégées (charger une couche), Importer, Exporter, Tolérances.
  - Une anomalie bloquante empêche la validation de la parcelle : la corriger, ou accepter une **exception motivée** (tracée). « Corrigée » est refusée tant que le problème existe.
  - Doublon : « Remplacer » garde l'historique de l'ancienne parcelle.
  - Zones protégées : charger un fichier GeoJSON ou GeoPackage ; vérifier la licence du jeu de données avant de le charger.
![Carte des parcelles : anomalies en rouge](captures/cartographie-carte.png)
*Carte : les parcelles avec anomalie ouverte sont cerclées de rouge ; le choix du fond de carte est en haut*

![Anomalies](captures/cartographie-anomalies.png)
*Anomalies : chevauchement entre deux parcelles et parcelle touchant une zone protégée*

![Zones protégées](captures/cartographie-zones.png)
*Zones protégées : couches chargées et formulaire de chargement*

- **Parcelles** : contrôler puis vérifier (déclarée → contrôlée → vérifiée).
- **Qualité et conformité** : certificats, inspections, alertes d'échéance.
- **Rapports** : achats, finance, stock, qualité, avec filtres et export Excel.

![Rapports](captures/rapports.png)
*Rapports d'achats avec filtres et export Excel*

![Qualité et conformité](captures/qualite.png)
*Qualité et conformité*


## Administrateur de coopérative
![Équipe](captures/equipe.png)
*Équipe : comptes, rôles, suspension*

- **Équipe** : créer les comptes, choisir le rôle, suspendre, réactiver, révoquer les sessions, consulter l'historique d'accès.
- **Rôles** : créer des rôles en combinant les permissions ; certains droits sensibles peuvent exiger une seconde approbation.
- **Référentiels** : filières, campagnes, prix (chaque modification crée une version datée).
- **Producteurs** : fiches, statuts, import Excel ou CSV avec prévisualisation, création/mise à jour/erreurs, rapport d'import. Les codes à zéros initiaux sont conservés.

![Producteurs](captures/producteurs.png)
*Producteurs*

![Parcelles](captures/parcelles.png)
*Parcelles*

- **Synchronisation** (si le serveur local est utilisé) : état de la réplication vers le central, association des postes.

## Bureau (Windows)
- **Poste unique, serveur ou client** au premier démarrage ; les postes clients trouvent le serveur sur le réseau local.
- Hors connexion, un poste client enregistre les achats et les messages, rejoués au retour du serveur. Validation, paiements et stocks demandent le serveur.
- **Sauvegarde** : menu « Sauvegarder maintenant… » de l'application (dossier de destination au choix, clé USB par exemple) ; la restauration se teste avec `scripts/restore-test.sh` (voir `EXPLOITATION.md`).

## En cas de problème
| Constat | Que faire |
|---|---|
| « Hors connexion » alors que le réseau est là | Ouvrir un autre site pour vérifier ; relancer la synchronisation en revenant à l'écran d'accueil |
| Déclaration « à corriger » | Lire le motif, corriger, renvoyer |
| Numéro de reçu en conflit | Vérifier le carnet : le même numéro a déjà servi ; saisir le bon ou joindre la photo du reçu |
| « Accès refusé » | Se reconnecter ; sinon contacter l'administrateur (compte suspendu ou droit retiré) |
| Page absente du menu | Le rôle n'en donne pas l'accès : demander à l'administrateur |
