# Essai d'AgriTrace sur Render (offre gratuite)

Render héberge l'API et le portail (une application Docker) et fournit la base PostgreSQL. Le fichier `render.yaml` à la racine du dépôt décrit les deux : un « Blueprint ».

## Limites de l'offre gratuite (à connaître)
D'après la documentation de Render consultée en octobre 2026 (à vérifier, ces conditions changent) :
- l'application **s'endort après 15 minutes** sans visite ; le réveil prend environ **1 minute** ;
- la base gratuite est **supprimée 30 jours après sa création** (14 jours de grâce), sans sauvegarde ;
- **aucun disque persistant** : les documents joints (pièces, bulletins stockés) sont perdus à chaque redémarrage ;
- 512 Mo de mémoire. Render indique que ces offres ne sont pas faites pour la production.
C'est donc **un essai**, pas un déploiement durable. Ne mettez jamais de vraies données.

## Déployer
1. Compte sur render.com (connexion avec GitHub).
2. **New → Blueprint**, choisissez le dépôt `AgriTrace`, branche `main`. Render lit `render.yaml` et propose le service `agritrace` et la base `agritrace-db`.
3. Render demande deux valeurs : `ADMIN_EMAIL` (votre adresse) et `ADMIN_PASSWORD` (12 caractères minimum). Puis **Apply**.
4. Au premier démarrage (3 à 5 minutes avec la construction de l'image) : l'application prépare la base, applique les migrations, crée l'administrateur et, comme `SEED_DEMO=1`, charge les données et comptes **fictifs** de démonstration (une seule fois, tant que la base est vide).
5. Ouvrez l'adresse `https://agritrace-xxxx.onrender.com` affichée en haut du service.

Comptes : `ADMIN_EMAIL` pour la plateforme ; les comptes de démonstration (un par intervenant, `profil@demo.agritrace.test`, mot de passe `Demo-AgriTrace-2026!`) sont dans `docs/COMPTES_DEMO.md`.

## Mobile
Dans l'application, indiquez comme serveur `https://agritrace-xxxx.onrender.com/v1`. Le premier appel après une période d'inactivité peut attendre 1 minute (réveil).

## Remarques
- La sécurité par ligne exige un rôle de base non propriétaire (`agritrace_app`). Le démarrage le crée ; si Render refuse (droits insuffisants), le journal affiche « ATTENTION … sécurité par ligne non garantie » et l'API utilise le compte propriétaire : acceptable pour un essai, jamais pour de vraies données.
- La double authentification est désactivée (`REQUIRE_2FA=false` dans `render.yaml`) pour les comptes de démonstration.
- Ce montage **n'a pas pu être essayé sur Render** (démarrage vérifié seulement hors Docker, sur PostgreSQL local) : prévoyez d'ajuster, et envoyez le journal en cas d'erreur.

## Données d'exemple

La démonstration est remplie pour chaque profil : achats, convois, caisse, comptabilité, ventes (commande, expédition, facture, paiement, réclamation), inventaires, préfinancement, paiements, partenaires, documents, cartographie, relevés de terrain, rapports, messagerie, audit et livraisons chez l'exportateur. Le chargement complet prend quelques minutes ; attendez la ligne `[render] démonstration chargée` avant de vous connecter.
