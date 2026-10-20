# Application de bureau, serveur local et serveur central

AgriTrace s'utilise de trois façons qui partagent le même code :

| Où | Rôle | Données |
|---|---|---|
| **Navigateur** | Portail web d'un serveur (local ou central) | sur le serveur |
| **Application Windows** | Même portail dans une fenêtre dédiée ; peut **héberger** le serveur de la coopérative | sur le poste serveur |
| **Mobile Android** | Collecte hors connexion | sur le téléphone, synchronisée avec le serveur |

## Deux modes de serveur

`AGRITRACE_MODE=local` (serveur de coopérative) ou `central` (valeur par défaut).

* **Serveur local** : autonome. Il n'a pas besoin d'Internet pour travailler. Il garde les données de **sa** coopérative et les envoie au central quand la liaison est disponible.
* **Serveur central** : reçoit les données de toutes les coopératives et les consolide. La liaison est à **sens unique** (local → central) : pour une coopérative gérée par un serveur local, le central est en **lecture seule** (écritures refusées, bandeau dans le portail). Chaque coopérative a une seule source de vérité, donc aucun conflit de fusion n'est possible.

### Comment les changements voyagent

1. Des déclencheurs PostgreSQL copient chaque insertion, modification ou suppression des tables de la coopérative dans `sync_outbox` (uniquement si le serveur est jumelé).
2. Toutes les 30 s (`REPLICATION_INTERVAL_MS`) ou à la demande, le serveur local envoie les lots au central (`POST /v1/replication/push`, jeton propre au site). Le curseur avance **par transaction terminée**, pas par numéro de ligne : une transaction longue ne peut pas faire sauter une ligne.
3. Le central applique le lot dans une seule transaction, ignore ce qu'il a déjà reçu (curseur par site) et refuse toute ligne d'une autre coopérative, toute table non répliquée, tout fichier dont l'empreinte ne correspond pas.
4. Le local supprime de sa file ce que le central a confirmé. Panne réseau ou suspension du site : rien n'est perdu, tout repart au retour de la liaison.

Les pièces jointes (PDF, photos) partent avec leur ligne. Les comptes des membres sont copiés **sans mot de passe** (connexion impossible au central avec un compte local). Les deux serveurs doivent avoir la **même version de schéma** : sinon le central répond 409 et le local affiche l'incident.

### Jumelage

1. Administrateur de plateforme, console du central → *Ajouter une coopérative* → **code de jumelage** (`AGT1-…`, contient le secret du site).
2. Sur le serveur local : soit à l'installation (*Premier démarrage* → « déjà déclarée au central »), soit plus tard dans *Synchronisation* (la coopérative locale doit alors avoir été déclarée au central avec son **identifiant**, affiché sur cette page).
3. L'état existant est mis en file et envoyé : le central rattrape tout l'historique.

Le code se renouvelle depuis la console (*Nouveau code*) ; l'ancien jeton cesse de fonctionner.

### Exigence côté central

La réception désactive les déclencheurs le temps d'appliquer un lot (`session_replication_role = replica`). Le rôle applicatif doit en avoir le droit : la migration 012 exécute `GRANT SET ON PARAMETER session_replication_role TO agritrace_app` (PostgreSQL 15+) et signale en `NOTICE` si elle n'a pas pu (rôle sans super-utilisateur) : à faire alors une fois à la main.

## Application Windows

Au premier lancement : **serveur de la coopérative** ou **poste client** (adresse du serveur).

* **Poste serveur** : PostgreSQL embarqué (port 54329, local au poste), API et portail sur le port **3000**, accessibles aux autres postes du réseau local. Données dans `%APPDATA%\AgriTrace\server`. Fermer la fenêtre ne coupe pas le serveur (icône dans la zone de notification) ; menu *Fichier* : sauvegarde, adresses pour les autres postes, démarrage avec Windows. L'installateur ouvre le port 3000 dans le pare-feu pour les réseaux **privés et de domaine** uniquement.
* **Poste client** : ouvre le portail du serveur indiqué.
* **Sauvegarde** : copie complète de la base et des pièces jointes vers un dossier choisi (clé USB, disque externe). Le serveur est arrêté quelques secondes pendant la copie. Une sauvegarde qui reste sur le même disque ne protège pas d'une panne du disque.
* PostgreSQL refuse de tourner avec des droits d'administrateur : lancer l'application normalement, pas « en tant qu'administrateur ».
* Le trafic sur le réseau local est en HTTP (pas de TLS). Acceptable sur un réseau de bureau de confiance ; pas pour un Wi-Fi ouvert.

### Construire l'installateur

L'installateur Windows se construit sur Windows : workflow GitHub **Application Windows** (`desktop-windows.yml`, lancement manuel, ou étiquette `desktop-vX.Y.Z` pour publier une release). Hors CI : builds de `backend/` et `web/`, puis dans `desktop/` : `npm ci && node scripts/prepare-payload.js && npx electron-builder --win nsis --x64`.

### Ce qui est vérifié, et ce qui ne l'est pas

Vérifié automatiquement (CI) : la réplication à trois serveurs (`backend/scripts/e2e-replication.js`), l'orchestration du serveur local sous Node (PostgreSQL embarqué → migrations → API + portail → premier démarrage → sauvegarde → redémarrage), le premier démarrage dans Chromium, la console centrale. L'application Electron a aussi été lancée avec succès sous Linux (écran virtuel) et a démarré le serveur complet.

**Non vérifié** : l'installateur `.exe` lui-même, le pare-feu Windows, le comportement de PostgreSQL embarqué sous Windows, l'icône (provisoire) et l'absence de signature de code (Windows SmartScreen affichera un avertissement tant que l'installateur n'est pas signé). À essayer sur un vrai poste avant de déployer.

## Limites connues

* Un seul sens : local → central. Pas de diffusion du central vers les locaux (référentiels communs, par exemple).
* Pas de mode « plusieurs serveurs locaux pour une même coopérative ».
* Une coopérative déjà créée au central (avec ses rôles) ne peut pas être reliée à un serveur local : le central refuse les rôles en conflit. Créer le site depuis la console, qui crée la coopérative vide.
* Le journal d'audit est répliqué avec le reste ; sa taille croît avec l'activité.
* Les notifications et les sessions ne sont pas répliquées.
