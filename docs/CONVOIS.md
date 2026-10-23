# Connaissement et convois

## Expéditions vers l'exportateur
Le numéro de connaissement (B/L) est **saisi** par l'opérateur (`POST /shipments/:id/depart`, champs `bill_of_lading_no`, `port`, `exporter_name`). Sans lui le départ est refusé (400) ; une contrainte en base le garantit aussi.

## Convois des délégués
1. Le délégué déclare le convoi (`convoys:create`, hors ligne possible via `convoy.create`) : n° de convoi (unique), chauffeur, camion, sacs/poids déclarés facultatifs.
2. Le magasinier (`convoys:receive`) choisit le délégué et le n° de convoi, saisit poids total et sacs (`convoy.receive`) ; l'écart avec l'annoncé est calculé.
3. La caisse (`convoys:settle`) voit la file (`GET /convoys/cashier-queue`) et traite : prix au kg → montant exact crédité au compte du délégué (`financial_accounts`, créé au besoin), écriture immuable liée à la réception, idempotente.
4. Le délégué consulte son stock et son solde (`GET /convoys/my-stock`, `collector:stock`).

## Nature du compte
`GET /me` → `account_kind` (`collector`, `coach`, `staff`) et `mobile_first`. Délégués et coachs utilisent l'application mobile ; le portail leur reste ouvert mais restreint à leurs droits et leur périmètre.

## Comptabilité et paiement en espèces
- Le traitement en caisse poste l'écriture d'achat (journal ACH : débit 601, crédit 401 ou le code du compte du délégué).
- `POST /convoys/payout` (`convoys:settle` + `cash:operate`) : paiement en espèces au délégué, session de caisse ouverte requise ; débite le compte du délégué et la caisse (refus si solde insuffisant) et poste l'écriture CAI (débit 401, crédit 571). Idempotent.

## Fiche de suivi du compte délégué (modèle papier de la coopérative)
La fiche papier devient le compte du délégué. Colonnes reprises : A poids, B P.U., C montant brut (A×B), D coût de transport unitaire, E transport total (A×D), F total produit (C+E), retenue (poids × taux au kg), I net à payer (F−retenue), J finance, K solde.
- **Solde (K)** = ce que le délégué doit à la coopérative = financements − net à payer des livraisons ; négatif = la coopérative lui doit.
- **Livraison** : le règlement en caisse (`POST /convoy-receptions/:id/settle`) prend P.U., transport au kg et retenue au kg (valeurs par défaut dans `POST /convoys/settings`, modifiables à chaque règlement) et porte le net au compte. Écriture : débit 601 (brut) et 605 (transport) ; crédit 401 (net) et 4781 (retenue).
- **Finance cacao** : `POST /convoys/advances` (`kind: advance`) remet un financement en espèces (session de caisse ouverte, pièce, date réelle possible pour reprendre une fiche papier) ; écriture débit 409 / crédit caisse. `kind: carry_forward` reporte le solde de la campagne précédente sans mouvement de caisse.
- **Lecture** : `GET /convoys/statement?collector_id&from&to` renvoie le solde d'ouverture, les lignes avec solde progressif et les totaux ; une période (campagne) reporte automatiquement le solde d'ouverture. Un délégué ne lit que sa fiche.
- **Netting 409/401** : au règlement (`POST /convoy-receptions/:id/settle`), `net_advance` (omis = maximum automatique, `0` = aucun) impute les avances non soldées sur le net à payer : écriture OD Dr 401 / Cr 409, `advance_netted` et `cash_due` (reste à payer) dans la réponse, `advance_outstanding` sur la fiche. Seules les avances en espèces (409) sont compensées ; un report de campagne n'a pas d'écriture 409.

## Notifications et cloche
- Chaque utilisateur ne reçoit et ne voit que ce qui le concerne : une alerte adressée « par droit » porte ce droit (`permission_code`) et n'est visible, comptée et marquée comme lue que tant que le rôle l'accorde ; une alerte personnelle n'est visible que de son destinataire.
- Événements : convoi en route (→ réception au magasin), réception à traiter (→ caisse) et réception de son convoi (→ délégué), net à payer porté au compte (→ délégué), financement remis (→ délégué) ; s'ajoutent les alertes existantes (missions en retard, factures échues, écarts de pesée, stocks négatifs, échéances de prêt…).
- Portail : cloche en haut de page (compteur, dernières alertes, « tout marquer comme lu », accès à la liste complète, clic = ouverture de la page concernée). Mobile : cloche dans la barre de l'écran d'accueil (nécessite le réseau ; pas de notification poussée).

## Déclaration d'achat par le délégué et export Excel

- Saisie (web et mobile) : recherche du producteur par code ou nom, puis **Poids (kg)**, **Nombre de sacs**, **N° du reçu** (tous obligatoires) et date.
- Export : `GET /purchase-declarations/export/xlsx?from=&to=&status=` (bouton « Exporter vers Excel » dans Déclarations (personnel)). Il reproduit le modèle de la coopérative « Tableau de l'État des achats » (feuille `Feuil1`) : Date | Code Producteur | Nom & Prénoms | Village | N° Reçu | Nbre sacs | Poids Net (format « Kg ») | Prix Unitaire | Montant (format « F CFA »), plus une ligne TOTAL (formules). « Village » = section dans la base de la coopérative. L'export est réservé au personnel de la coopérative : les délégués consultent leurs achats (Mes achats, Historique) sans pouvoir exporter.
- Le **prix unitaire est fixé par l'administration** (barème de la filière, applicable à la date de l'opération) : le délégué ne le saisit jamais ; le montant = poids net × prix unitaire est calculé par le serveur à la soumission.

## Connexion automatique (aucune adresse à saisir)

- Poste de bureau client : le serveur de la coopérative est recherché seul sur le réseau local (`desktop/src/discovery.js`). L'adresse trouvée est mémorisée ; si elle change, le poste retrouve le serveur sans intervention. Aucune adresse http/https n'est affichée aux utilisateurs (saisie manuelle possible seulement dans « Options techniques » pour un technicien).
- Mobile : l'adresse du serveur est intégrée à l'application à la compilation, jamais saisie ni affichée.
- Jumelage coopérative ↔ serveur central : le code de jumelage contient l'adresse du central ; l'écran Synchronisation n'affiche plus d'adresse.
- Limite : la découverte sonde le sous-réseau (port du serveur) ; elle ne traverse pas plusieurs réseaux séparés (dans ce cas, l'option technique reste nécessaire). Testée par `desktop/test/discovery.js` ; non essayée sur un vrai poste Windows.

## Rôles types et cloisonnement

Équipe → « Rôles types » crée en un clic les rôles **Magasinier**, **Caissier** et **Délégué** (`POST /roles/standard`, idempotent). Les menus et les API suivent les permissions, jamais le nom du rôle.
- **Magasinier** : convois (lecture, réception), magasins et lots, mouvements de stock, inventaire, messages. Il ne voit ni qualité/conformité, ni cartographie, ni parcelles, ni caisse, finances ou comptabilité, ni équipe, ni missions (menus absents et API en 403, vérifié par `e2e-roles.js` et le parcours navigateur).
- **Caissier** : convois à traiter, caisse, comptes financiers et comptabilité en lecture ; pas de stocks, d'équipe ni de missions.
- **Délégué** : ses achats, convois, stock et fiche uniquement.
- « Ajouter un utilisateur » (Équipe) crée le compte avec le rôle choisi.

## Poste unique / serveur / client et icônes de connexion (modèle CentriGest)

Rôles d'un ordinateur de bureau, choisis à l'installation et visibles dans Fichier → « Poste et réseau… » :
- **Poste unique** : données sur l'ordinateur, aucun autre poste ne peut s'y connecter (l'API n'écoute que sur ce poste).
- **Serveur** : héberge les données et accepte les postes clients ; répond à la recherche réseau (balise UDP 8099, ouverte par l'installateur en réseau privé).
- **Poste client** : ne garde pas les données ; bouton « Rechercher sur le réseau » (balise UDP puis balayage du sous-réseau), reconnexion automatique si le serveur change d'adresse.

Barre du haut : quatre icônes carrées comme CentriGest, vert = bon, rouge = coupé, orange = en attente, gris = sans objet. **Réseau**, **Serveur de la coopérative**, **Serveur central** (sur un serveur local), **Synchronisation** (pastille = opérations en attente ou refusées). Un clic ouvre le panneau « Synchronisation » (voyants, postes connectés, « Synchroniser maintenant »).

## Association des postes de travail

Équipe → « Postes de travail » : **Associer un poste** donne un code à 8 caractères (valable 15 minutes, à usage unique, seule l'empreinte est conservée). Sur le poste (portail, poste de bureau ou téléphone), écran de connexion → « Associer ce poste à la coopérative » : le code est échangé contre un **jeton propre au poste**, envoyé à chaque requête (`X-Device-Token`).
- **Association obligatoire** (case à cocher) : un appareil inconnu ou révoqué est refusé, même avec un bon mot de passe ; elle ne peut être activée que depuis un poste déjà associé (pas d'auto-verrouillage).
- **Révoquer** : effet immédiat ; le poste doit être réassocié. Dernière activité visible par poste.
- Ces tables restent sur le serveur qui les crée (jamais répliquées vers le central). Testé par `e2e-postes.js` (15 contrôles) et `parcours-postes.mjs` ; l'écran mobile n'est compilé que par la CI.


## Bulletin de pesée (réception au magasin)

À la réception, le magasinier peut renseigner, dans la section « Pesée au pont-bascule », la **double pesée** (entrée camion chargé, sortie camion vide, pont-bascule), la tare des sacs, la réfaction, le grade, la remorque, la provenance, les sacs déchargés/refusés et l'analyse (humidité, déchets). Tout est facultatif.

- Poids brut = entrée − sortie ; **poids net payé = brut − tare des sacs − réfaction**. Ce net devient le poids de la réception : c'est lui que la caisse règle et que l'écart avec le poids déclaré compare. Si la double pesée est fournie, le serveur calcule le net et refuse un `total_kg` incohérent.
- Numéro de bulletin séquentiel par coopérative et par année : `BP-2026-000001`.
- Impression : « Bulletin de pesée » présenté par parties, comme les bulletins d'acheteurs : en-tête (date de pesée, n° de bulletin), **Indication connaissement**, **Analyse** (18 lignes facultatives : humidité, grainage, fèves moisies, etc.), **Livraison produit** (brut, tare, net livré, réfaction, net payé, sacs acceptés/refusés, manquants, écart, poids moyen du sac, classement, QR code), puis trois cases de visa portant uniquement le nom de la personne (magasinier, délégué, responsable ayant validé l’écart, le cas échéant). Les lignes sans donnée ne sont pas imprimées ; mention DUPLICATA dès la deuxième édition et « ÉCART À VALIDER — NON PAYABLE » si la réception est retenue.
- Les poids sont imprimés en **kilogrammes entiers**, avec une espace pour les milliers (`41 780 kg`), sans virgule ni décimales.
- Limite : le QR code encode le texte du bulletin ; il n'existe pas encore de page publique de vérification en ligne.

### Pont-bascule et analyses
- Le pont-bascule est le **magasin central** de la réception : « Pont d'entrée » et « Pont de sortie » affichent le nom du magasin, il n'y a plus de champ à saisir.
- Le magasinier saisit l'analyse (18 lignes facultatives) soit à la réception, soit **après la pesée** dans l'onglet « Analyses » (résultats de laboratoire, correction du grade). Possible tant que la caisse n'a pas réglé ; le poids net n'est jamais modifié. Chaque saisie est tracée dans le journal d'audit (`convoy.analysis`).

### Code intervenant (fournisseur)
Chaque intervenant de la coopérative (délégué, magasinier, caissier, coach, administrateur…) a un **code**, identifiant propre à la coopérative : attribué automatiquement à l'arrivée (`<code coopérative>-0001`, `-0002`…) ou saisi à la création du compte (champ « Code »). Il se modifie dans Équipe → « Code » (droit `users:manage`, unicité contrôlée, tracé dans le journal d'audit). Pour un délégué, ce code est le **code fournisseur** imprimé sur le bulletin de pesée et affiché dans la liste de réception.
- La partie « Indication connaissement » du bulletin reprend : origine, chauffeur, n° camion, n° remorque, poids déclaré, fournisseur, code fournisseur, connaissement, nombre de sacs déclaré, date de réception.
- Les **manquants** (sacs déclarés − déchargés) et l’**écart** (net payé − poids déclaré) sont calculés par le logiciel : affichés en lecture seule au magasinier, refusés par l’API s’ils sont envoyés.
- À la réception, le formulaire du magasinier suit les parties du bulletin : indication connaissement, livraison produit (pesées, tare, réfaction, sacs, grade) et analyse.

### Reprise automatique ou saisie complète (réception)
- **Convoi déclaré par le délégué** : le magasinier choisit le délégué puis le connaissement ; le chauffeur, le camion, le poids et les sacs déclarés sont repris du convoi, ainsi que la **remorque** et la **provenance** (que le délégué peut renseigner en créant le convoi) — ces deux champs restent modifiables à la réception.
- **Connaissement non déclaré** : si le numéro saisi n'existe pas pour ce délégué, le formulaire passe en **saisie complète** : le magasinier saisit chauffeur, camion (obligatoires), sacs et poids déclarés (facultatifs), remorque et provenance ; le convoi est créé à la réception, à son nom (numéro déjà utilisé refusé).

## Navigation inspirée du logiciel de gestion actuel

- **Accueil à tuiles** : le tableau de bord commence par de grandes tuiles (Membres, Producteurs, Pesées, Ventes, Caisse, Trésorerie, Comptabilité, Stock), affichées selon les droits de l'utilisateur.
- **Pesées** (menu *Pesées*, qui remplace l'ancien onglet « Réception au magasin » de *Convois*) : liste des pesées avec filtre *Non traitées / Traitées / Toutes* (traitée = réglée en caisse), recherche par code, nom, connaissement ou bulletin, période, colonnes (bulletin, date, connaissement, sacs, poids brut, réfaction, poids net, prix/kg, net à payer, origine, délégué avec son code, état), totaux *Nombre / Poids net / Traité / Non traité*, bouton **Enregistrer une pesée** (formulaire en blocs) et impression du bulletin. L'onglet *Analyses* reste disponible au magasinier.
- **Caisse** (menu *Caisse*) : menu à gauche en rubriques dépliantes — *Opérations* (traiter une pesée / régler un achat, écarts à valider), *Achats prod. agricole*, *Solde délégué* (fiche de suivi), *Mouvements de caisse* (journal, entrées, sorties). Le journal affiche **solde d'ouverture**, **solde actuel**, les mouvements avec solde cumulé et les totaux entrées / sorties, sur une période (dates ou période prédéfinie), imprimable. API : `GET /v1/convoys/receptions` et `GET /v1/cash-journal`.

- **Délégués** (menu *Délégués*) : liste à gauche (recherche par code ou nom) et fiche à onglets — *Informations personnelles* (code, nom, localité, contact, e-mail, banque, n° de compte), *Pièce d'identité*, *Compte et solde* (fiche de suivi). La fiche se modifie par `PUT /v1/collectors/:id/profile` (droit `collectors:manage`) ; ces données personnelles sont à ajouter au registre des traitements.
- **Comptabilité** (menu *Comptabilité*) : mêmes rubriques dépliantes ; états disponibles : mouvements de caisse, état des dépenses (sorties), journal des achats et état des règlements (`GET /v1/accounting/etats/pesees`), état des prêts (non soldés / soldés / tout), soldes des délégués (`GET /v1/accounting/etats/delegues`), état des exportateurs (reste à rembourser des préfinancements), état des comptes. Chaque rubrique n'apparaît que si le rôle a le droit de lecture correspondant (le rôle comptable standard n'a pas `loans:read` ni `prefinancing:read`).
- **Non repris pour l'instant** : emprunts, prestations, impôts (BIC), fournisseurs, ventes d'autres produits, gestion des produits et des campagnes (prix d'achat / vente au kilo), état du stock par campagne : ces modules n'existent pas encore dans AgriTrace et demandent une spécification.
- **Saisie de pesée** (magasinier), en blocs comme l'ancien logiciel : *Infos délégué* (recherche par code ou par nom, localité reprise du profil), *Infos pesée* (date, magasin), *Infos arrivée (déclaré)* (connaissement, sacs et poids déclarés ; saisis par le magasinier si le délégué n'a pas déclaré le convoi), *Infos pesée* (pesées, tare, réfaction, poids net, sacs, manquants et écart automatiques), *Transporteur* (chauffeur, camion, remorque) et *Analyse (facultatif)*, qui peut aussi être complétée plus tard.
