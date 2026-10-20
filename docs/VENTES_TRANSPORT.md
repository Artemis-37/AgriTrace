# Transport, ventes et facturation (CDC §17, §18)

**Chaîne** : acheteur → contrat → commande → affectation de lots (réservation) → expédition (chargement = mouvement de stock `loading`) → livraison (écarts justifiés) → validation avec preuve → facture (sur le livré validé) → paiements reçus → clôture.

- **Stock** : une affectation réserve le stock disponible (solde − réservations non chargées) ; deux commandes ne peuvent pas réserver le même kilo. Le chargement écrit un mouvement immuable et verrouille le lot.
- **Comparaison** prévu / chargé / livré par ligne ; tout écart exige une justification et un responsable de traitement. Capacité du véhicule contrôlée. Scellés et n° de bon de transport enregistrés.
- **Validation de la livraison** : permission distincte (`shipments:validate`), preuve `proof_of_delivery` obligatoire, aucun incident ouvert.
- **Facturation** : uniquement sur des livraisons validées, jamais plus que le livré non encore facturé ; montants en décimal exact ; numérotation séquentielle ; une facture payée en partie ne peut pas être annulée ; surpaiement refusé ; clôture de commande seulement si tout est livré et soldé.
- **Traçabilité descendante** : `GET /traceability/forward?producer_id|parcel_id|lot_id|declaration_id` (lots issus, expéditions, commandes, factures, acheteurs). Le lien parcelle → achat n'étant pas saisi, une recherche par parcelle passe par le producteur et le dit. Le rapport de traçabilité d'un lot inclut désormais expéditions et factures.

## Limites
- Les paiements reçus ne sont pas encore comptabilisés automatiquement dans le module comptable ni dans une caisse.
- Pas d'avoir (la facture est annulée ou la réclamation traitée hors facture), pas de retour de stock après chargement (incident à la place), pas d'accès externe acheteur, pas d'écran web/mobile.


## Affectation tardive
`POST /shipments/:id/assign` (permission `shipments:manage`) affecte ou change transporteur, véhicule et conducteur tant que l'expédition est planifiée ou chargée. Sans cela, une expédition chargée sans véhicule ni conducteur ne pouvait ni partir ni être annulée.
