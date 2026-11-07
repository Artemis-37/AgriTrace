# AgriTrace sur Supabase (base PostgreSQL hébergée)

Supabase ne sert ici que de **base PostgreSQL**. L'API NestJS, le web et le mobile restent inchangés ; les documents (photos, PDF) restent sur le disque du serveur de l'API (volume `documents`).

## 1. Créer le projet
Supabase > New project. Choisir la région la plus proche (Europe de l'Ouest pour la Côte d'Ivoire). Noter le mot de passe de la base.

## 2. Créer le rôle applicatif
Éditeur SQL > coller `01-roles.sql` (après avoir remplacé `MOT_DE_PASSE_APP`) > Run.
Le rôle `agritrace_app` n'a pas `BYPASSRLS` : c'est lui qui garantit l'isolation entre coopératives. L'API ne doit **jamais** utiliser le rôle `postgres`.

## 3. Appliquer les migrations (rôle postgres)
Utiliser la chaîne **Session pooler** (port 5432 du pooleur, compatible IPv4) :

```
cd backend
DATABASE_URL='postgres://postgres.<REF>:<MDP_POSTGRES>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
DATABASE_SSL=require npm run migrate
```
Puis exécuter `02-verrouiller.sql` dans l'éditeur SQL.
PostGIS : si l'extension s'active (Database > Extensions > postgis), la migration l'utilise, sinon le calcul se fait dans l'application (repli prévu).

## 4. Brancher l'API (rôle agritrace_app)
Utiliser la chaîne **Transaction pooler** (port 6543) avec le rôle applicatif :

```
DATABASE_URL=postgres://agritrace_app.<REF>:<MOT_DE_PASSE_APP>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_SSL=require
DATABASE_POOL_MAX=10
```
L'API ouvre une transaction par requête et fixe `app.current_org` avec `set_config(..., true)` : cela fonctionne en mode transaction. Aucune requête préparée nommée n'est utilisée.

## 5. Sécurité à vérifier
- Settings > API : désactiver l'API de données (Data API) ; `02-verrouiller.sql` retire déjà les droits de `anon` et `authenticated`.
- Ne jamais publier la clé `service_role`. AgriTrace n'en a pas besoin.
- Sauvegardes : activer les sauvegardes quotidiennes (plan Pro) ; sauvegarder aussi `DOCUMENTS_KEY` et `SECRETS_KEY` à part.
- Mettre `DATABASE_URL` uniquement dans les secrets de l'hébergeur de l'API (Render, Fly, Hetzner), jamais dans le dépôt.
