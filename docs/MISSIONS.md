# Missions et tâches de terrain (CDC §11)

- **Création** : permission `tasks:create` (attribution : `tasks:assign`). Une mission ouverte exige un responsable. Un coach (`tasks:request`) fait une *demande* (`/task-requests`) ; elle ne devient une mission officielle qu'après décision de `tasks:decide_requests` (+ `tasks:create`).
- **Instructions officielles** : modifiables uniquement avec `tasks:update` et un motif, jusqu'à la soumission ; l'ancien contenu est tracé dans l'audit.
- **Statuts** : brouillon → ouverte → en cours → soumise → (à corriger → en cours) → validée → terminée → clôturée ; annulée (motif obligatoire). `pending_sync` est l'état local de l'appareil. Chaque changement est historisé (`task_history`, immuable) et audité.
- **Exécution** : seul le responsable ou son équipe saisit observations, résultats, positions GPS, photos et documents (`/tasks/:id/entries`, idempotent, date de saisie d'origine conservée). Soumission impossible sans au moins un résultat. La vérification doit être faite par une autre personne que l'exécutant ; le coach ne clôture pas.
- **Mission de cartographie** : le détail indique l'action (`create_parcel`, `complete_polygon`, `view_existing`) pour éviter tout doublon accidentel.
- **Hors connexion** : opérations `task.start`, `task.entry`, `task.submit` via `/sync/batch` ; flux `tasks` dans `/sync/changes` (jamais les brouillons ni les missions d'autrui).
- **Tableau de bord** : `GET /tasks/dashboard` (urgentes, en retard, terminées, producteurs à visiter, non cartographiés, parcelles sans polygone ou à valider, anomalies).
- Pas encore d'écran web/mobile pour les missions (API et synchronisation seulement).
