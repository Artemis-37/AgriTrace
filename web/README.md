# AgriTrace Web

Portail web de la coopérative (React + TypeScript + Vite) : connexion, tableau de bord, producteurs, parcelles, déclarations d'achat, stocks et lots (traçabilité, PDF), finances (comptes, paiements, prêts, comptabilité SYSCOHADA), qualité et conformité.

## Lancer

```bash
cd web
npm install
npm run dev        # http://localhost:5173 — relaie /v1 vers l'API (VITE_API_PROXY, défaut http://localhost:3000)
npm test           # tests unitaires (formats, messages d'erreur)
npm run build      # vérification TypeScript + build de production dans dist/
```

Pour explorer avec des données fictives : `backend/scripts/seed-demo.js` (voir l'en-tête du script). Ne jamais l'exécuter en production.

## Principes

- **Le serveur reste seul juge** : le portail masque les menus selon `GET /me` (permissions de l'organisation), mais chaque requête est contrôlée par l'API. Les refus (422, 403…) s'affichent avec le message du serveur.
- **Session** : jeton d'accès en mémoire, jeton de renouvellement dans `sessionStorage` (effacé à la fermeture de l'onglet). Aucun jeton dans une URL ; les PDF se téléchargent par requête authentifiée.
- **Production** : servir `dist/` et l'API sous le même domaine (reverse proxy `/v1`), en HTTPS. Si le portail est sur un autre domaine, lister son origine dans `CORS_ORIGINS` côté API.
- **Mentions honnêtes** : un paiement confirmé est toujours « manuel » tant qu'aucun connecteur bancaire n'existe ; le plan comptable est une base à valider par un comptable ; AgriTrace ne remplace pas un organisme de certification.

## Pas encore fait

Création et édition depuis le portail pour les parcelles, inspections, certificats, prêts (approbation), écritures ; import Excel des producteurs ; gestion des utilisateurs et rôles ; documents (dépôt et téléchargement) ; tests de bout en bout du portail dans la CI ; logos vectoriels (seuls les noms et couleurs de la charte sont repris).
