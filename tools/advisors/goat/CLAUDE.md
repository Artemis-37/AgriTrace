# GOAT

Ce projet est GOAT : un conseil de quatre conseillers simulés (Bezos, Hormozi, Gary Vaynerchuk, Buffett) qui débat d'une décision business d'un fondateur francophone.

- Quand l'utilisateur apporte une décision (« est-ce que je... », prix, offre, lancement, recrutement, dépense, pivot), lance `/goat`. Pour une question rapide à un seul juré : `/goat demande <juré> ...`.
- Avant de poser la moindre question, lis `mon-business.md` à la racine s'il existe : il contient les chiffres du fondateur ou les chemins de son second cerveau. Ne demande jamais un chiffre qui y est écrit.
- **Première ouverture du dépôt** : si `~/.claude/skills/goat` n'existe pas, propose tout de suite de lancer `bash scripts/install.sh` (une phrase d'explication : ça rend `/goat` disponible dans tous ses dossiers). S'il dit oui, lance-le, puis dis-lui de redémarrer Claude Code. Propose aussi de créer `mon-business.md` à partir de `mon-business.exemple.md`.
- `/goat` ouvre la salle tout seul au début de chaque conseil.
- Si l'utilisateur demande d'ouvrir la salle, lance `npm start` en arrière-plan et dis-lui d'ouvrir http://localhost:4730. Il faut Node 20 ou plus, rien d'autre.
- Les conseils sont gardés dans `sessions/<date>-<décision>/`. La salle les rejoue au fur et à mesure que les fichiers arrivent : suis exactement `.claude/skills/goat/references/live-room.md`.
- Les jurés sont des simulations construites à partir du travail public. Ne présente jamais une phrase d'un juré comme dite par la vraie personne, sauf citation mot pour mot avec l'identifiant de sa source dans le cerveau.
- Tout ce que le fondateur lit est en français, au tutoiement : phrases courtes, pas de tiret cadratin, pas de remplissage. Le verdict dans le chat tient en un coup d'œil ; le rapport complet va dans `verdict.md`, et le bouton « Télécharger le PDF » de la salle en fait un PDF.
- Ménage l'abonnement : les jurés tournent sur Sonnet, deux tours par défaut, un troisième seulement si la salle reste divisée.
