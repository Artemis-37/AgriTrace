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
