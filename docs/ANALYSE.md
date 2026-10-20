# AgriTrace — Analyse du cahier des charges v2.0

Date : 20 octobre 2026

## 1. Synthèse

AgriTrace est une plateforme multi-coopératives (Android hors ligne, portail web, API centrale) couvrant producteurs, parcelles, collecte, pesée, stocks, traçabilité et finances. Le cahier des charges est cohérent et prudent sur les points sensibles (hors ligne, finances, isolation). Il est réalisable par phases (P0 à P5). Ce lot livre **P0 : le socle**.

## 2. Points forts

- Isolation par organisation exigée côté serveur et en base (RLS).
- Idempotence et accusés de réception explicites pour la synchronisation.
- Historique immuable des prix, transactions et mouvements.
- Hors ligne = enregistrement local, jamais validation.

## 3. Lacunes et ambiguïtés à lever

| # | Sujet | Risque | Proposition |
|---|-------|--------|-------------|
| 1 | Règles de calcul des montants (sacs ↔ kg, tare, qualité) | Montants faux | Table de conversions configurable par filière, décision métier avant P1 |
| 2 | Référentiel comptable (SYSCOHADA ?) | Écritures non conformes | Valider avec un comptable ; P4 |
| 3 | Moyens de paiement (Mobile Money, banque) | Intégration bloquante | Choisir les opérateurs avant P4 |
| 4 | Volumes (producteurs, appareils) | Dimensionnement | Estimer avant P2 |
| 5 | Soldes partagés hors ligne | Dépassement de plafond | Réservation centrale ou plafond local par collecteur (§14.9) |
| 6 | Résolution de conflits de synchro par entité | Perte de données | Matrice par type d'entité (brouillon fusionnable, validé immuable) |
| 7 | Protection des données personnelles (loi ivoirienne 2013-450, autres pays UEMOA) | Conformité | Registre de traitements, durée de conservation |
| 8 | Politique de mots de passe / MFA | Sécurité | Argon2id, MFA pour rôles financiers (proposé) |
| 9 | Identifiants lisibles par coopérative (codes producteur) | Collisions | Séquences par organisation |
| 10 | Langues de l'interface | Adoption terrain | Français d'abord, i18n prévu |

## 4. Décisions techniques retenues (P0)

- Backend NestJS + TypeScript, PostgreSQL 16, accès via `pg` avec migrations SQL versionnées (pas de synchronize).
- Identifiants UUID (générables côté client).
- Montants en `numeric(18,4)`, jamais en flottant.
- Mots de passe Argon2id ; JWT court (15 min) + refresh token tourné, stocké haché, révocable par session.
- Permissions sous forme `ressource:action`, rôles par organisation.
- RLS PostgreSQL via `set_config('app.current_org', …, true)` posé à chaque transaction ; contrôle applicatif en plus.
- Journal d'audit en insertion seule (triggers refusant UPDATE/DELETE).
- API sous `/v1`, documentée OpenAPI (`/v1/docs`).

## 5. Périmètre P0 livré

Organisations, utilisateurs, rôles, permissions, appartenances, sessions, appareils, audit, authentification, garde de permissions, isolation par organisation.

## 6. Risques

1. Synchronisation hors ligne : la partie la plus complexe, à prototyper tôt (début P2).
2. Finances hors ligne : à ne pas sous-estimer.
3. Qualité des données terrain (GPS, doublons).
4. Appareils Android partagés ou perdus : chiffrement SQLite, effacement à distance.

## 7. Prochaines étapes

1. Valider les décisions ouvertes (§3, points 1 à 5).
2. P1 : producteurs, collecteurs, campagnes, prix, déclarations, caisse, import Excel.
3. Prototype Flutter + SQLite pour valider le modèle de synchronisation.
