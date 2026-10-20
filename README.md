# AgriTrace — P0 (socle)

La traçabilité agricole, de la parcelle au marché.

## Contenu

- `docs/ANALYSE.md` : analyse du cahier des charges, lacunes, décisions, risques.
- `backend/` : API NestJS (`/v1`), PostgreSQL, migrations SQL.
- `brand/` : charte graphique et couleurs (`tokens.json`).

## Démarrage

```bash
docker compose up -d db
cd backend
cp .env.example .env          # puis changer JWT_SECRET
npm install
export $(grep -v '^#' .env | xargs)
npm run migrate
ADMIN_PASSWORD='<12+ caractères>' node scripts/create-platform-admin.js admin@exemple.ci "Nom"
npm run build && npm start     # docs : http://localhost:3000/v1/docs
```

## Règles d'accès

- Toute route (hors `/auth/login` et `/auth/refresh`) exige un jeton.
- Les routes métier exigent l'en-tête `X-Organization-Id`, l'appartenance de l'utilisateur à cette organisation et les permissions du rôle.
- En production, l'API doit se connecter avec un rôle PostgreSQL **non propriétaire et non superutilisateur**, sinon les politiques RLS sont contournées.

## Tests

`npm test` (unitaires). Un test d'intégration (isolation entre organisations, rotation des sessions, audit immuable) a été exécuté manuellement ; à automatiser en P1.

## P1 — collecte et finances de base (livré)

Filières et conversions d'unités, campagnes, barèmes de prix versionnés (immuables), producteurs (recherche, doublons signalés, import Excel en simulation puis confirmation), collecteurs et affectations, déclarations d'achat (hors ligne, idempotentes, montant calculé par le serveur), comptes, caisses et sessions, transactions idempotentes, écritures compensatoires, rôles personnalisés.

Test de bout en bout (34 vérifications) : démarrer l'API puis
`API=http://localhost:3000/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run test:e2e`.

Hypothèses à valider avec la coopérative : conversion sac → kg configurée par filière (table `unit_conversions`), arrondi du montant à 4 décimales, un collecteur doit avoir une affectation pour déclarer.

## P2 — mobile hors connexion et synchronisation (livré, mobile non compilé)

- **Serveur (testé)** : `POST /v1/sync/batch` (≤ 100 opérations, résultat explicite par opération : `accepted`, `rejected`, `to_correct`, `conflict`, `pending_validation` ; même clé d'idempotence avec contenu différent = conflit) et `GET /v1/sync/changes` (curseur, `has_more`, permissions courantes).
- **Mobile Flutter (`mobile/`)** : base SQLite chiffrée, file d'attente persistante, synchronisation, saisie de déclarations hors ligne. **Code écrit mais non compilé ni testé** (pas de SDK Flutter dans l'environnement) : voir `mobile/README.md`.

## P3 — réception, pesée, stocks et lots (livré)

- Pesée avec conversion d'unités, seuil d'écart configurable (`org_settings.weighing_variance_pct`, 2 % par défaut), justification obligatoire au-delà, approbation par un utilisateur différent de l'opérateur.
- Reçu numéroté `RC-AAAA-NNNNN` (PDF), lots, entrepôts, mouvements de stock immuables (corrections par écriture inverse), fractionnement/fusion de lots, traçabilité JSON et PDF avec signalement des informations manquantes.

## Tests

```bash
cd backend && npm test          # 13 tests unitaires
npm run test:e2e                # e2e P1 (34 contrôles) + e2e P2/P3 (42 contrôles), base PostgreSQL requise
```

## Limites connues

Déclarations brouillon non modifiables (annuler et recréer) ; expéditions, parcelles et qualité non développées ; soldes producteur/collecteur pouvant être négatifs (seules les caisses sont bloquées) ; révocation d'appareil non implémentée ; e2e non branchés en CI.
