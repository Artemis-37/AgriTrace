# Conseils d'advisors IA (vendored)

Copies des dépôts suivants (licence MIT), sans leur historique git :

| Dossier | Source | Lancer |
|---|---|---|
| `roast-room/` | https://github.com/nateherkai/roast-room | `cd tools/advisors/roast-room && claude` puis `/roast-room` |
| `goat/` | https://github.com/cblain100-prog/goat | `cd tools/advisors/goat && claude` puis `/goat` |

Chaque dossier embarque son propre `.claude/` (skill + agents) : ouvrez Claude Code
dans le dossier concerné pour qu'ils soient chargés. La salle web locale se lance
avec `npm start` (Node 20+).
