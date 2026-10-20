# Synchronisation hors ligne (résumé)

- Le mobile écrit dans une file locale (`outbox`) ; chaque opération porte une clé d'idempotence stable. Envoi par lots (≤ 50) vers `POST /v1/sync/batch` ; résultat par opération : `accepted`, `rejected`, `to_correct`, `conflict`, `pending_validation`. Un renvoi identique renvoie le même résultat sans doublon.
- Réception via `GET /v1/sync/changes?cursor=…` ; le curseur n'avance qu'après application locale.
- Le serveur reste seul juge : montants définitifs, prix, permissions. Le mobile n'affiche que des estimations tant qu'une opération n'est pas confirmée.
- **Limite** : le côté serveur est testé de bout en bout ; l'application Flutter n'a jamais été compilée (le job `mobile` de la CI le révélera).
- Non couvert : résolution de conflit d'édition de la même déclaration depuis deux appareils (l'opération est signalée `conflict`), pièces jointes hors ligne, pesée sur mobile.
