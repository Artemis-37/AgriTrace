# Essai d'AgriTrace sur Fly.io (une seule application)

L'application Fly est « tout-en-un » : PostgreSQL 16 + PostGIS, l'API et le portail web tournent dans la même machine, avec leurs données sur un volume (`/data`). Le `Dockerfile` et le `fly.toml` sont à la racine du dépôt, donc le déploiement depuis le tableau de bord Fly (« Launch from GitHub ») fonctionne tel quel.

Au premier démarrage, la machine initialise elle-même la base (UTF8), applique les migrations, génère ses clés secrètes (conservées sur le volume) et crée le compte administrateur si vous avez fourni ses identifiants.

Ce montage convient à **un essai**. Pour une vraie coopérative : base séparée et sauvegardée (voir `docs/DEPLOIEMENT.md` et `deploy/hetzner/`), double authentification activée. Il **n'a pas pu être construit avec Docker** dans l'environnement de développement (seul le script de démarrage a été essayé hors conteneur) : prévoyez d'ajuster.

## 1. Déployer
Dans le tableau de bord Fly, déployez l'application depuis GitHub (branche `main`, dossier = racine du dépôt). Si Fly ne crée pas le volume `data` tout seul, avec `flyctl` :
```
fly volumes create data --app <nom-de-l-application> --region cdg --size 1
```

## 2. Créer le compte administrateur et les données fictives
Dans le tableau de bord (application → **Secrets**), ajoutez :

| Secret | Valeur |
|---|---|
| `ADMIN_EMAIL` | votre adresse (ex. `admin@exemple.test`) |
| `ADMIN_PASSWORD` | un mot de passe de 12 caractères minimum |
| `SEED_DEMO` | `1` pour charger la coopérative et les comptes **fictifs** de démonstration (une seule fois) |

Les secrets redémarrent la machine. Ouvrez ensuite `https://<nom>.fly.dev` et connectez-vous avec `ADMIN_EMAIL`. Les comptes de démonstration (un par profil, domaine `demo.agritrace.test`, mot de passe `Demo-AgriTrace-2026!`) sont décrits dans `docs/COMPTES_DEMO.md`. **Ne mettez jamais de vraies données sur cet essai.**

## 3. Utile
- Journaux : `fly logs --app <nom>`. Premier démarrage : comptez 1 à 2 minutes (initialisation + migrations + données de démonstration).
- Sauvegarde : `fly volumes snapshots list --app <nom>` (instantanés automatiques du volume).
- Mobile : indiquer `https://<nom>.fly.dev/v1` comme adresse du serveur.
- Les secrets `JWT_SECRET`, `DOCUMENTS_KEY`, `SECRETS_KEY` sont générés et gardés dans `/data/secrets.env` ; vous pouvez les définir vous-même comme secrets Fly (ils sont alors prioritaires). Perdre le volume = perdre la base **et** ces clés.
- La double authentification est désactivée (`REQUIRE_2FA=false` dans `fly.toml`) pour pouvoir utiliser les comptes de démonstration : à remettre à `true` ensuite.
