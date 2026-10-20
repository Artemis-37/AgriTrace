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

## P4a — comptabilité SYSCOHADA, prêts, paiements, rapprochements (livré)

- **Comptabilité** : plan comptable de base SYSCOHADA révisé (à faire valider par un comptable), journaux ACH/CAI/BQ/OD, écritures numérotées `EC-AAAA-NNNNN`, **équilibrées (contrainte en base) et non modifiables** ; correction par écriture inverse ; clôture de période ; grand livre, balance, exports Excel ; comptabilisation d'un achat (602/401) et régularisation des écarts de caisse (658/758) ; contrôle de cohérence finance ↔ comptabilité (`GET /accounting/consistency`).
- **Prêts, avances, préfinancements** : demande → analyse → approbation (par un utilisateur distinct du demandeur) → décaissement → remboursements ; échéancier exact, historique des décisions, correction d'un remboursement. Écritures : créance 409 (avances/préfinancements) ou 271 (prêts) contre caisse/banque. **Intérêts et pénalités non calculés** (spécification complémentaire requise).
- **Paiements** : statuts prévu → initié → en attente → confirmé / échoué / annulé → remboursé. **Aucun connecteur bancaire ou Mobile Money** : la confirmation est toujours « manuelle » et libellée « non confirmée par la banque ou l'opérateur ».
- **Rapprochements** : relevé (ou comptage) comparé au solde du livre ; explication obligatoire en cas d'écart ; historique conservé.
- Hypothèses à valider : numéros de comptes SYSCOHADA utilisés (571, 521, 401, 409, 271, 602, 658, 758…), comptabilisation à la date du jour, compte 401 collectif (pas de comptabilité auxiliaire par producteur).

## P4b — qualité, inspections, documents, certificats, alertes (livré)

- **Règles qualité** configurables par filière et marché (seuils numériques ou oui/non, bloquantes ou non).
- **Inspections** (producteur, collecteur, lot, pesée, magasin) : planifiée → en cours → clôturée. Le serveur évalue chaque résultat contre la règle et conserve les seuils appliqués ; l'issue est calculée (conforme / à examiner / non conforme). Anomalies et **actions correctives** avec échéance et clôture justifiée.
- **Documents** : PDF, JPEG, PNG de 10 Mo maximum, type vérifié sur le contenu (pas sur l'extension), empreinte SHA-256 contrôlée à chaque téléchargement, clé de stockage aléatoire (aucune URL publique), versions successives, documents sensibles réservés à `documents:sensitive`, journal des téléchargements. Stockage sur disque (`DOCUMENTS_DIR`, hors dépôt) : à remplacer par un stockage objet chiffré en production.
- **Certificats** avec validité calculée (valide / expirant sous 60 jours / expiré / révoqué). AgriTrace enregistre des preuves ; il ne remplace pas un organisme officiel de certification.
- **Alertes** (`GET /alerts`) : certificats expirants ou expirés, inspections en retard ou à renouveler, actions correctives en retard, échéances de prêts impayées, pesées à valider. Ce sont des alertes à consulter ; l'envoi de notifications (push, e-mail) n'est pas encore fait.
- Parcelles non développées : le module parcelles du cahier des charges reste à faire (les inspections ciblent pour l'instant producteurs, lots, pesées, magasins).

## Parcelles (livré)

- Parcelle rattachée à un producteur et une filière : code `PC-NNNNN`, superficie déclarée, point GPS et/ou polygone GeoJSON (la surface mesurée est **calculée par le serveur**).
- Trois niveaux de données distincts : **déclarée → contrôlée → vérifiée**. Le contrôle exige des coordonnées et une surface cohérente (écart ≤ 20 %) ; la vérification exige une **inspection de terrain conforme postérieure à la dernière modification**. Toute modification des données repasse la parcelle à « déclarée ». Historique complet non modifiable.
- Contrôles (`GET /parcels/checks`) : coordonnées manquantes, doublons potentiels (moins de 50 m), superficies incohérentes, inspections à renouveler. Création refusée en cas de doublon probable sauf confirmation explicite.
- Photos et documents via le module documents (`subject_type=parcel`). Rapport de traçabilité d'un lot : parcelles du producteur pour la filière du lot et inspections qualité du lot ; le lien exact déclaration → parcelle n'est pas encore saisi (signalé comme tel). Calculs géométriques sans PostGIS (projection locale) : à remplacer par PostGIS pour les chevauchements.
- Pas encore fait : saisie des parcelles sur le mobile, détection de chevauchement de polygones, import KML/KMZ.

## Tests

```bash
cd backend && npm test          # 18 tests unitaires
npm run test:e2e                # e2e P1 (34) + P2/P3 (42) + P4a (83) + P4b (55) + parcelles (39 contrôles), base PostgreSQL requise
```

## Limites connues

Fonds de caisse d'ouverture et opérations libres non comptabilisés automatiquement (signalé par le contrôle de cohérence) ; déclarations brouillon non modifiables (annuler et recréer) ; expéditions non développées ; soldes producteur/collecteur pouvant être négatifs (seules les caisses sont bloquées) ; révocation d'appareil non implémentée ; e2e non branchés en CI.
