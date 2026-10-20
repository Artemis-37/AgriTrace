# Écarts avec le cahier des charges v1.0

État après l'analyse complète du CDC (migrations 001 à 011). « API » = back-end testé de bout en bout ; « écran » = interface web ou mobile utilisable par un agent. Les chiffres de tests sont ceux de `npm run test:e2e` et `npm test`.

## Couvert (API testée)
| CDC | Sujet | Remarque |
|---|---|---|
| §4–5 | Coopératives, utilisateurs, rôles, permissions | Suspension/réactivation, changement de rôle, révocation de sessions, historique d'accès (011) |
| §6 | Producteurs | Statuts du CDC (§6.2) historisés (011) |
| §7 | Filières, campagnes, prix | Prix versionnés |
| §8–10 | Parcelles, import/export 5 formats, doublons, chevauchements, remplacement contrôlé | Code `CODE_PRODUCTEUR-Pn` ; voir `CARTOGRAPHIE.md` |
| §11 | Missions et tâches | Voir `MISSIONS.md` |
| §13–14 | Achats, reçu d'achat (modes physique/généré, conflits, corrections, recherche), pesée, réception | |
| §15 | Magasins, mouvements (réception, entrée, transfert, sortie, chargement, retour, perte, détérioration, déclassement, quarantaine/libération, ajustement), inventaire approuvé par une autre personne | Ajustements, jamais de suppression |
| §16 | Lots, généalogie, traçabilité ascendante **et descendante** | Le lien exact achat → parcelle n'est pas saisi : signalé comme « non disponible » |
| §17–18 | Transport, expéditions, acheteurs, contrats, commandes, factures, paiements reçus, réclamations | Voir `VENTES_TRANSPORT.md` |
| §19–21 | Caisses, sessions, avances/prêts, comptabilité SYSCOHADA, rapprochements | P4 |
| §20.3 | Préfinancement reçu (fonds, conditions, utilisation, justificatifs, remboursements, soldes, rapport) | + prêts/préfinancements aux producteurs (P4) |
| §22–24 | Qualité, conformité, documents, certificats | P4b |
| §25 | Notifications persistées et consultables, alertes calculées (retards, échéances, écarts, stocks négatifs…) | Voir ci-dessous pour les alertes non couvertes |
| §27 | Hors connexion, idempotence, conflits (reçu en doublon), révocation | Missions incluses dans la synchronisation |
| §28 | Sécurité | Voir `SECURITE.md` |

## Écarts connus
**Écrans (le plus gros reste à faire)**
- Web : écrans livrés pour Missions, Cartographie (anomalies, remplacement de doublon, import simulé puis confirmé, export, tolérances), Commerce (commandes, expéditions, factures et paiements, acheteurs), Inventaire, Préfinancement, Notifications (avec badge de non-lus), Équipe (suspension, rôle, révocation, historique) et statut producteur. Vérifiés par compilation, build, tests unitaires et un parcours Chromium sans erreur (pas de test de bout en bout automatisé de l'interface). Création de contrats de vente, de transporteurs/véhicules/chauffeurs et d'expéditions disponible dans l'interface (création de transporteur et de contrat essayée dans le navigateur ; le parcours complet commande → réservation → expédition → chargement → affectation véhicule/chauffeur → départ → livraison avec écart → preuve → validation → facture → paiements a été joué dans le navigateur contre l'API de test). Le téléversement de documents est disponible pour les expéditions seulement. Non couverts : réclamations clients, carte interactive des parcelles.
- Mobile : pas de missions, de carte ni de relevé de polygone ; seulement connexion, déclarations d'achat (avec numéro de reçu) et synchronisation. Le flux `/sync/changes` et les opérations `task.*` sont prêts côté serveur. À la suspension d'un compte l'appareil est bloqué (401/403) mais **les données locales ne sont pas encore purgées**. L'APK n'a pas été compilé ici (la compilation Gradle est bloquée dans l'environnement) : elle est vérifiée par la CI.

**Géographie**
- Pas de PostGIS : boîtes englobantes (index GiST) puis calcul exact en Node. Suffisant pour quelques dizaines de milliers de parcelles ; à remplacer par PostGIS au-delà.
- Seul WGS84 est accepté : pas de reprojection (UTM, etc.).
- GeoPackage via `node:sqlite`, encore expérimental dans Node 22.
- Pas de versions de géométrie en table dédiée : l'historique des modifications garde l'ancienne et la nouvelle géométrie.

**Commerce et finance**
- Les paiements reçus des acheteurs ne sont pas comptabilisés automatiquement (ni en caisse, ni en écritures).
- Pas d'avoir, pas de retour de stock après chargement (un incident est enregistré), pas d'accès externe pour acheteurs/partenaires.
- Le préfinancement reçu n'est pas relié à un compte financier ni à des écritures.

**Notifications**
- Persistées et consultables, mais aucune poussée distante (FCM) ni courriel. Alertes « documents manquants » et « opérations financières à approuver » non générées automatiquement (visibles via les alertes P4b / listes existantes).

**Tableaux de bord et rapports (§26)**
- Le tableau de bord web présente maintenant commandes, créances (dont échues), missions en retard, anomalies de cartographie et préfinancement à rembourser ; l'état des synchronisations n'y figure toujours pas. Pas de rapports filtrables par période/section/agent unifiés.

**Exigences non techniques**
- Validation juridique des données personnelles, sauvegardes et tests de restauration en production, audit de sécurité indépendant, tests de charge (§32) : non réalisés. Les avis `npm audit` sur des dépendances transitives de NestJS restent à suivre.
