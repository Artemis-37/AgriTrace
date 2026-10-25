# Essai d'AgriTrace sur Fly.io

Deux applications Fly : **la base** (PostgreSQL + PostGIS, réseau privé, volume) et **l'application** (API + portail, HTTPS public). Fly.io demande en général une carte bancaire et facture à l'usage : vérifiez la tarification actuelle avant de commencer. Ce dossier **n'a pas pu être essayé** sur un vrai compte Fly ni construit avec Docker dans l'environnement de développement : prévoyez d'ajuster.

## Préparation (PowerShell, une fois)
```powershell
winget install Fly-io.flyctl      # ou : iwr https://fly.io/install.ps1 -useb | iex
fly auth login
cd <dossier du dépôt>             # la racine (là où se trouvent backend, web, deploy)
```
Les fichiers sont prêts pour deux applications nommées `agritrace` (le `fly.toml` à la racine du dépôt) et `agritrace-db` (`deploy/fly/fly.db.toml`). Si un nom est déjà pris sur Fly, changez-le dans le fichier correspondant et dans les variables ci-dessous. L'application peut aussi être déployée depuis le tableau de bord Fly (« Launch from GitHub ») : il trouve le `Dockerfile` et le `fly.toml` à la racine ; **mais il faut d'abord créer la base (étape 1) et saisir les secrets (étape 2)**, sinon la migration échoue.

Mots de passe et clés (à garder dans un coffre, surtout `DOCUMENTS_KEY` et `SECRETS_KEY` : sans elles, documents et secrets sont perdus) :
```powershell
function Cle($n){ $b = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) }
$APP="agritrace"; $DB="agritrace-db"
$OWNER=(Cle 24).Replace("+","A").Replace("/","B").Replace("=","")
$APPPW=(Cle 24).Replace("+","A").Replace("/","B").Replace("=","")
```

## 1. La base
```powershell
fly apps create $DB
fly volumes create pgdata --app $DB --region cdg --size 1 -y
fly secrets set --app $DB POSTGRES_PASSWORD=$OWNER APP_DB_PASSWORD=$APPPW --stage
fly deploy --config deploy/fly/fly.db.toml --app $DB --ha=false
```

## 2. L'application
```powershell
fly apps create $APP   # inutile si l'application existe déjà (créée depuis le tableau de bord)
fly volumes create documents --app $APP --region cdg --size 1 -y
fly secrets set --app $APP `
  DATABASE_URL="postgres://agritrace_app:$APPPW@$DB.internal:5432/agritrace" `
  OWNER_DATABASE_URL="postgres://agritrace_owner:$OWNER@$DB.internal:5432/agritrace" `
  JWT_SECRET="$(Cle 48)" DOCUMENTS_KEY="$(Cle 32)" SECRETS_KEY="$(Cle 32)" `
  CORS_ORIGINS="https://$APP.fly.dev" BOOTSTRAP_TOKEN="$(Cle 24)" --stage
fly deploy --app $APP --ha=false
```
Le déploiement lance les migrations (« release command ») avant de démarrer l'API. Adresse : `https://agritrace.fly.dev`.

## 3. Premier compte et données fictives
```powershell
fly ssh console --app $APP -C "sh -c 'ADMIN_PASSWORD=ChangezMoi-2026! DATABASE_URL=$OWNER_DATABASE_URL node scripts/create-platform-admin.js admin@exemple.test Administrateur'"
fly ssh console --app $APP -C "sh -c 'API=http://127.0.0.1:3000/v1 ADMIN_EMAIL=admin@exemple.test ADMIN_PASSWORD=ChangezMoi-2026! DEMO_NO_DOC=1 node scripts/seed-demo-complet.js'"
```
Choisissez votre propre mot de passe (12 caractères minimum). Les comptes de démonstration (un par profil) et leur mot de passe sont ceux de `docs/COMPTES_DEMO.md` (domaine `demo.agritrace.test`). **Ne jamais mettre de vraies données sur cet essai.**

## Pièges probables
- Les mots de passe contiennent des caractères spéciaux : gardez les guillemets, ou utilisez les versions sans `+/=` ci-dessus.
- `fly ssh console` : si `$OWNER_DATABASE_URL` n'est pas développée, ouvrez une session (`fly ssh console --app $APP`) et saisissez les commandes à l'intérieur ; la variable y existe déjà comme secret.
- L'application s'éteint quand elle n'est pas utilisée (`auto_stop_machines`) : le premier chargement peut prendre quelques secondes.
- Sauvegarde : `fly volumes snapshots list --app $DB` (instantanés automatiques de Fly) ; pour un export SQL : `fly ssh console --app $DB -C "pg_dump -U agritrace_owner agritrace"`.
- Mobile : indiquer `https://<APP>.fly.dev/v1` comme adresse du serveur dans l'application.
