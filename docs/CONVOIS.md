# Connaissement et convois

## Expéditions vers l'exportateur
Le numéro de connaissement (B/L) est **saisi** par l'opérateur (`POST /shipments/:id/depart`, champs `bill_of_lading_no`, `port`, `exporter_name`). Sans lui le départ est refusé (400) ; une contrainte en base le garantit aussi.

## Convois des collecteurs
1. Le collecteur déclare le convoi (`convoys:create`, hors ligne possible via `convoy.create`) : n° de convoi (unique), chauffeur, camion, sacs/poids annoncés facultatifs.
2. Le magasinier (`convoys:receive`) choisit le collecteur et le n° de convoi, saisit poids total et sacs (`convoy.receive`) ; l'écart avec l'annoncé est calculé.
3. La caisse (`convoys:settle`) voit la file (`GET /convoys/cashier-queue`) et traite : prix au kg → montant exact crédité au compte du collecteur (`financial_accounts`, créé au besoin), écriture immuable liée à la réception, idempotente.
4. Le collecteur consulte son stock et son solde (`GET /convoys/my-stock`, `collector:stock`).

## Nature du compte
`GET /me` → `account_kind` (`collector`, `coach`, `staff`) et `mobile_first`. Collecteurs et coachs utilisent l'application mobile ; le portail leur reste ouvert mais restreint à leurs droits et leur périmètre.

## Comptabilité et paiement en espèces
- Le traitement en caisse poste l'écriture d'achat (journal ACH : débit 601, crédit 401 ou le code du compte du collecteur).
- `POST /convoys/payout` (`convoys:settle` + `cash:operate`) : paiement en espèces au collecteur, session de caisse ouverte requise ; débite le compte du collecteur et la caisse (refus si solde insuffisant) et poste l'écriture CAI (débit 401, crédit 571). Idempotent.

## Fiche de suivi du compte collecteur (modèle papier SOCAHI)
La fiche papier devient le compte du collecteur. Colonnes reprises : A poids, B P.U., C montant brut (A×B), D coût de transport unitaire, E transport total (A×D), F total produit (C+E), retenue (poids × taux au kg), I net à payer (F−retenue), J finance, K solde.
- **Solde (K)** = ce que le collecteur doit à la coopérative = financements − net à payer des livraisons ; négatif = la coopérative lui doit.
- **Livraison** : le règlement en caisse (`POST /convoy-receptions/:id/settle`) prend P.U., transport au kg et retenue au kg (valeurs par défaut dans `POST /convoys/settings`, modifiables à chaque règlement) et porte le net au compte. Écriture : débit 601 (brut) et 605 (transport) ; crédit 401 (net) et 4781 (retenue).
- **Finance cacao** : `POST /convoys/advances` (`kind: advance`) remet un financement en espèces (session de caisse ouverte, pièce, date réelle possible pour reprendre une fiche papier) ; écriture débit 409 / crédit caisse. `kind: carry_forward` reporte le solde de la campagne précédente sans mouvement de caisse.
- **Lecture** : `GET /convoys/statement?collector_id&from&to` renvoie le solde d'ouverture, les lignes avec solde progressif et les totaux ; une période (campagne) reporte automatiquement le solde d'ouverture. Un collecteur ne lit que sa fiche.
- **Limite** : le compte comptable 409 (avances) et 401 (dettes) ne sont pas encore compensés entre eux à chaque livraison.

## Notifications et cloche
- Chaque utilisateur ne reçoit et ne voit que ce qui le concerne : une alerte adressée « par droit » porte ce droit (`permission_code`) et n'est visible, comptée et marquée comme lue que tant que le rôle l'accorde ; une alerte personnelle n'est visible que de son destinataire.
- Événements : convoi en route (→ réception au magasin), réception à traiter (→ caisse) et réception de son convoi (→ collecteur), net à payer porté au compte (→ collecteur), financement remis (→ collecteur) ; s'ajoutent les alertes existantes (missions en retard, factures échues, écarts de pesée, stocks négatifs, échéances de prêt…).
- Portail : cloche en haut de page (compteur, dernières alertes, « tout marquer comme lu », accès à la liste complète, clic = ouverture de la page concernée). Mobile : cloche dans la barre de l'écran d'accueil (nécessite le réseau ; pas de notification poussée).
