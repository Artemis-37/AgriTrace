# Déploiement sur Hetzner (plusieurs coopératives)

> **État** : préparé mais **non exécuté** : je n'ai ni compte Hetzner ni serveur. Les scripts de `deploy/hetzner/` ont seulement été relus et vérifiés pour leur syntaxe ; les images Docker n'ont jamais été construites dans l'environnement de développement (la CI les construit). **Faire un premier essai sur un petit serveur jetable** avant la production. Les noms d'offres, régions et prix Hetzner sont à confirmer sur leur site.

Ce guide applique `DEPLOIEMENT_MULTI_COOPERATIVES.md` à Hetzner. Architecture : **un serveur cloud Hetzner** qui exécute Docker Compose (base PostGIS, migrations, API, portail) + **Caddy** pour le HTTPS ; sauvegardes chiffrées copiées **chez un autre fournisseur**.

## 1. Ce que vous faites vous-même (je n'ai pas accès à votre compte)
1. Créer un compte sur Hetzner Cloud (vérification d'identité et moyen de paiement) et un **projet** (ex. « AgriTrace »).
2. Ajouter votre **clé SSH publique** au projet (*Security → SSH keys*). Sans clé : `ssh-keygen -t ed25519` sur votre poste.
3. Créer un **serveur cloud** :
   * image **Ubuntu 24.04** ; type : 2 vCPU / 4 Go / 80 Go pour 1 à 5 coopératives, 4 vCPU / 8 Go pour 5 à 20 (gamme « partagée » ou « dédiée » selon le budget : comparer sur leur site) ;
   * emplacement : **le plus proche des utilisateurs** parmi ceux proposés (Europe : Allemagne ou Finlande) ; la latence depuis l'Afrique de l'Ouest est correcte pour une application de saisie, à valider par un essai ;
   * activer **IPv4**, votre clé SSH, et l'option de **sauvegarde/instantané** Hetzner (en plus, pas à la place, de la sauvegarde ci-dessous) ;
   * créer un **pare-feu cloud** : entrées TCP 22, 80, 443 seulement, rattaché au serveur.
4. **Nom de domaine** : enregistrement `A` de `agritrace.votredomaine.org` vers l'IPv4 du serveur (le certificat HTTPS en dépend).
5. **Stockage hors site** : un stockage objet compatible S3 **chez un autre fournisseur** que Hetzner (pour survivre à la perte du compte ou du datacenter). Noter l'accès, la clé et le secret.

## 2. Préparer le serveur
```
ssh root@IP_DU_SERVEUR
apt-get update && apt-get install -y git
git clone <URL-du-dépôt> /opt/agritrace && cd /opt/agritrace
DOMAIN=agritrace.votredomaine.org ADMIN_EMAIL=vous@exemple.org bash deploy/hetzner/provision.sh
```
Le script met le système à jour, installe Docker, fail2ban, mises à jour de sécurité automatiques, active le pare-feu (22/80/443), coupe l'accès SSH par mot de passe **si** une clé est présente. Garder une seconde session SSH ouverte pendant l'opération.

## 3. Configurer
`cp .env.example .env` puis remplacer **toutes** les valeurs :
```
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # DOCUMENTS_KEY, SECRETS_KEY, mots de passe de base, METRICS_TOKEN
```
Ajouter dans `.env` : `WEB_PORT=127.0.0.1:8080`, `DOMAIN=...`, `ADMIN_EMAIL=...`, `REQUIRE_2FA=true`. `chmod 600 .env`.
**Sauvegarder aussitôt `JWT_SECRET`, `DOCUMENTS_KEY`, `SECRETS_KEY` dans un gestionnaire de mots de passe, hors du serveur.** Sans `DOCUMENTS_KEY`, les documents sauvegardés sont illisibles.

## 4. Démarrer
```
docker compose -f docker-compose.prod.yml -f deploy/hetzner/docker-compose.caddy.yml up -d --build
docker compose -f docker-compose.prod.yml logs migrate     # doit finir sans erreur
curl -s https://agritrace.votredomaine.org/v1/ready
```
Puis créer l'administrateur de plateforme (`DEPLOIEMENT.md`, étape 3) et activer sa double authentification. Ne jamais lancer `seed-demo.js`.

## 5. Sauvegardes automatiques hors site
1. `openssl rand -base64 32 > /etc/agritrace/backup.pass && chmod 600 /etc/agritrace/backup.pass` ; **copier cette phrase hors du serveur**.
2. `rclone config` : créer un remote nommé `offsite` (stockage objet S3 de l'autre fournisseur) ; créer le dossier/bucket `agritrace-sauvegardes`.
3. Essai : `bash deploy/hetzner/backup-offsite.sh` puis vérifier la présence des fichiers `.enc` sur le remote.
4. Planifier chaque nuit :
```
cp deploy/hetzner/agritrace-backup.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now agritrace-backup.timer
systemctl list-timers | grep agritrace
```
5. **Test de restauration** au moins chaque mois (`scripts/restore-test.sh` ou restauration manuelle sur un serveur jetable) : déchiffrer avec `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:… -in … -out …`, puis `pg_restore`. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

## 6. Ouvrir les coopératives
Suivre la liste du §4 de `DEPLOIEMENT_MULTI_COOPERATIVES.md` (création de la coopérative, premier administrateur, vérification de l'isolation).

## 7. Mises à jour et surveillance
* Mise à jour : sauvegarde manuelle, `git pull`, relancer la commande du §4, contrôler `/v1/ready`.
* Système : les mises à jour de sécurité sont automatiques ; redémarrer le serveur si demandé (`/var/run/reboot-required`), hors heures de travail.
* Surveillance : sonde externe sur `https://…/v1/health` avec alerte e-mail/SMS ; disque (`df -h`, volume `documents`, sauvegardes locales) ; `docker compose ps`.
* Quand la charge augmente : agrandir le type de serveur (redimensionnement Hetzner) ou séparer la base sur un second serveur en réseau privé.

## 8. Points de vigilance
* `TRUST_PROXY=2` correspond à Caddy + nginx du portail ; si vous changez la chaîne, ajuster, sinon l'IP du journal d'audit est fausse.
* Ne pas exposer le port 8080 ni 5432 : `WEB_PORT=127.0.0.1:8080`, la base n'est pas publiée.
* Hébergement hors du pays : vérifier les règles de localisation des données et prévoir le contrat d'hébergement avec chaque coopérative.
* Les scripts ne remplacent pas un essai : à répéter sur un serveur de test.
