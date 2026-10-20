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
| Métier | Connaissement et convois | N° de connaissement (B/L) saisi, obligatoire au départ des expéditions vers le port ; convois des collecteurs (n° de convoi, chauffeur, camion) → réception au magasin central (poids total, sacs) → file de la caisse → crédit du compte du collecteur (014–015) ; voir `CONVOIS.md` |
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
- Web : écrans livrés pour Missions, Cartographie (anomalies, remplacement de doublon, import simulé puis confirmé, export, tolérances), Commerce (commandes, expéditions, factures et paiements, acheteurs), Inventaire, Préfinancement, Notifications (avec badge de non-lus), Équipe (suspension, rôle, révocation, historique) et statut producteur. Vérifiés par compilation, build, tests unitaires et un parcours Chromium sans erreur ; le parcours de vente est aussi versionné comme test de navigateur (`npm run test:ui` dans `web/`, exécuté par la CI, non encore vu passer sur GitHub). Création de contrats de vente, de transporteurs/véhicules/chauffeurs et d'expéditions disponible dans l'interface (création de transporteur et de contrat essayée dans le navigateur ; le parcours complet commande → réservation → expédition → chargement → affectation véhicule/chauffeur → départ → livraison avec écart → preuve → validation → facture → paiements est couvert par ce test de navigateur). Le téléversement et le téléchargement contrôlé de documents sont disponibles pour les expéditions, commandes, factures, réclamations et missions (composant commun, PDF/JPEG/PNG, 10 Mo). Réclamations clients disponibles (onglet Commerce). Carte des parcelles disponible (onglet Carte de Cartographie : rendu vectoriel, zoom et déplacement, couleur par niveau de vérification, anomalies en rouge, fiche de parcelle ; fond neutre sans tuiles, donc utilisable hors ligne). Non couverts : fond de carte satellite ou routier, dessin ou édition d'un polygone à la souris.
- Mobile : écrans ajoutés — Mes achats, Historique, Ma fiche de compte, Mon stock, Convoi, Notifications, Missions (liste, démarrage, saisies texte/coordonnées, soumission), association du téléphone ; **écrits mais compilés seulement par la CI**. Les missions et la fiche exigent le réseau (pas de file hors connexion pour les missions). Toujours absents : carte, relevé de polygone au GPS, photos. Le flux `/sync/changes` et les opérations `task.*` sont prêts côté serveur. À la suspension d'un compte l'appareil est bloqué (401/403) mais **les données locales ne sont pas encore purgées**. L'APK n'a pas été compilé ici (la compilation Gradle est bloquée dans l'environnement) : elle est vérifiée par la CI.

**Géographie**
- Pas de PostGIS : boîtes englobantes (index GiST) puis calcul exact en Node. Suffisant pour quelques dizaines de milliers de parcelles ; à remplacer par PostGIS au-delà.
- Seul WGS84 est accepté : pas de reprojection (UTM, etc.).
- GeoPackage via `node:sqlite`, encore expérimental dans Node 22.
- Pas de versions de géométrie en table dédiée : l'historique des modifications garde l'ancienne et la nouvelle géométrie.

**Commerce et finance**
- Paiements des acheteurs : comptabilisés (compte financier crédité + écriture 411/banque ou caisse) lorsqu'un compte de réception est choisi ; sans choix, le paiement reste enregistré seul (comportement antérieur conservé).
- Pas d'avoir, pas de retour de stock après chargement (un incident est enregistré), pas d'accès externe pour acheteurs/partenaires.
- Le préfinancement reçu n'est pas relié à un compte financier ni à des écritures.

**Notifications**
- Persistées, consultables et filtrées selon les droits ; cloche sur le portail et le mobile ; aucune poussée distante (FCM) ni courriel (le mobile ne les reçoit qu'avec du réseau). Alertes « documents manquants » (expédition partie ou livrée sans pièce jointe, prêt approuvé sans justificatif) et « à approuver » (prêts/préfinancements, inventaires, achats en attente depuis plus de 2 jours) générées par la recherche d'alertes, une fois par jour et par destinataire selon ses droits.

**Tableaux de bord et rapports (§26)**
- **Rapports d'achats livrés** : page Rapports (`reports:read`), filtres période/section/collecteur/filière, regroupements, totaux, export Excel. Non couvert : rapports financiers, stock ou qualité unifiés ; envoi automatique.
- **Rapports d'achats (§26) livrés** : page Rapports (permission `reports:read`) filtrable par période, section, collecteur et filière, regroupée par section, village, collecteur, filière ou jour, avec totaux et export Excel (`e2e-recus` 53 contrôles, `parcours-rapports`). Non couvert : rapports financiers, de stock ou de qualité unifiés, et planification/envoi automatique des rapports.
- Le tableau de bord web présente maintenant commandes, créances (dont échues), missions en retard, anomalies de cartographie et préfinancement à rembourser ; l'état de la synchronisation avec le serveur central y figure désormais (serveur local). Pas de rapports filtrables par période/section/agent unifiés.

**Exigences non techniques**
- Validation juridique des données personnelles, sauvegardes et tests de restauration en production, audit de sécurité indépendant, tests de charge (§32) : non réalisés. Les avis `npm audit` sur des dépendances transitives de NestJS restent à suivre.

## Serveur local / central et application de bureau
- Livré : modes local et central, réplication à sens unique avec jumelage, reprise après panne, central en lecture seule pour les coopératives gérées en local, vue consolidée (producteurs, parcelles, quantités, facturé), console du central dans le portail, écran de premier démarrage, page Synchronisation et indicateur au tableau de bord. Application Electron pour Windows hébergeant le serveur (PostgreSQL embarqué) ou en poste client, sauvegarde, pare-feu à l'installation.
- Vérifié : e2e à trois serveurs (78 contrôles), orchestration du serveur local sous Node, application lancée sous Linux, parcours Chromium (premier démarrage, console centrale).
- **Non vérifié** : l'installateur `.exe` et le comportement sous Windows (construit seulement par le workflow GitHub, jamais exécuté ici) ; signature de code absente.
- Livré en plus : poste unique / serveur / client, recherche réseau automatique (balise UDP + balayage), icônes de connexion, association des postes par code (jeton révocable, règle obligatoire) — voir `CONVOIS.md`.
- Non couvert : sens central → local, plusieurs serveurs locaux pour une même coopérative, rattachement d'une coopérative déjà peuplée au central, TLS sur le réseau local, mise à jour automatique de l'application.
- Postes clients : fonctionnement hors connexion (achat et messages rejoués au retour du serveur, session conservée au redémarrage), messagerie interne, thèmes doux et nuit, nom et rôle du poste choisis à l'installation. Non couvert : validation, paiements et stocks hors connexion ; messages poste à poste sans serveur ; lecture hors connexion d'un écran jamais ouvert en ligne.

## Convois, connaissement et espaces par nature de compte
- Livré : B/L obligatoire au départ ; convois, réception, caisse, compte du collecteur (écriture immuable, montant exact poids × prix) ; `/me` renvoie la nature du compte (collecteur, coach, personnel) ; le collecteur ne voit que ses convois, ses achats, ses producteurs (filières affectées) et son stock ; menus « Mes achats / Mon stock / Historique » du portail.
- Vérifié : e2e convois (36 contrôles), parcours navigateur (collecteur, magasinier, caisse), mobile non compilé ici (**écran de convoi Flutter écrit mais jamais compilé ni exécuté**).
- Non couvert : liaison d'un convoi à des déclarations précises, écart de poids bloquant, écrans mobiles de stock/historique du collecteur, périmètre des coachs limité aux missions déjà existantes.
