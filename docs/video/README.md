# Vidéo de présentation d'AgriTrace

Deux films : la présentation complète et « Du terrain à l'exportateur » (`VID=-terrain python3 …`, scénario `scenario_terrain.py`, sortie `out/AgriTrace_Presentation-terrain.mp4`).

La vidéo (`out/AgriTrace_Presentation.mp4`, ≈ 15 minutes, sous-titres `.srt` fournis) est fabriquée automatiquement : narration en français (voix de synthèse Piper), enregistrements réels du portail piloté pas à pas sur la démonstration, captures de l'application mobile, cartes explicatives.

Pour la refaire après une évolution de l'outil :

1. Démarrer la démo : base PostgreSQL migrée, API, `node backend/scripts/seed-demo-complet.js` (écrit `/tmp/demo-accounts.json`), puis le portail (`cd web && VITE_API_PROXY=http://localhost:3111 npx vite --port 4173`).
2. `python3 scenario.py` (texte et étapes de chaque scène) puis `python3 tts.py` (voix : `pip install piper-tts`, modèle `fr_FR-siwis-medium` à télécharger ; variable `PIPER_VOICE`).
3. `python3 cards.py` (cartes et planches de téléphones), `node record.mjs` (enregistrements du portail ; relancer la démo avant, car les scènes « exportateur » modifient les données), `python3 compose.py` (montage).

Pour changer un passage : modifier la scène dans `scenario.py`, relancer les étapes 2 et 3 pour cette scène (`tts.py <id>`, `record.mjs <id>`, `compose.py <id>`).
