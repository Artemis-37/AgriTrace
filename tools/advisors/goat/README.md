# GOAT

Ton conseil d'administration IA, dans Claude Code.

Tu apportes une décision business. Quatre conseillers IA la débattent, puis te rendent un verdict noté et un PDF en un clic. Les quatre sièges : **Jeff Bezos**, **Alex Hormozi**, **Gary Vaynerchuk** et **Warren Buffett**, chacun construit à partir de son travail public (lettres, conférences, vidéos, livres tels qu'il les enseigne). Le conseil tourne dans Claude Code, et une petite application locale les montre autour d'une table en train d'en débattre.

| Juré | Pilier | La question qu'il porte |
|---|---|---|
| Jeff Bezos | Stratégie et décisions | Est-ce le bon pari, et peut-on revenir en arrière ? |
| Alex Hormozi | Offre, prix et vente | Les gens vont-ils payer, combien, et comment on vend ? |
| Gary Vaynerchuk | Marketing et attention | D'où vient l'attention, et est-elle sous-évaluée ? |
| Warren Buffett | Argent et capital | Qu'est-ce que ça fait à la trésorerie, au risque et à la valeur à long terme ? |

## Ce qu'il te faut

- [Claude Code](https://claude.com/claude-code). Ton abonnement Claude suffit, pas besoin de clé API.
- [Node.js](https://nodejs.org) 20 ou plus, pour la salle. Rien d'autre à installer.

## Installation

Le plus simple : ouvre Claude Code n'importe où et colle cette phrase.

```
Clone https://github.com/cblain100-prog/goat dans mon dossier Apps, puis lance bash scripts/install.sh dedans.
```

Claude récupère le dépôt et lance l'installation. `/goat` devient alors disponible dans **tous** tes dossiers (ton second cerveau, tes autres projets). Redémarre Claude Code, c'est prêt.

À la main, c'est pareil :

```bash
git clone https://github.com/cblain100-prog/goat.git
cd goat
bash scripts/install.sh
```

L'installation crée des liens vers le skill dans `~/.claude/skills/goat` et vers les quatre jurés dans `~/.claude/agents/`. Un `git pull` les met à jour. Pour les retirer : `bash scripts/install.sh --remove`. Sans installation, `/goat` marche seulement quand tu ouvres Claude Code dans le dossier `goat`.

## Branche ton second cerveau (recommandé)

Le conseil est aussi bon que ce qu'il sait de ta boîte. Copie `mon-business.exemple.md` en `mon-business.md` et remplis-le : soit tes chiffres directement, soit les chemins des fichiers de ton second cerveau qui les contiennent (offre, prix, clients, chiffre d'affaires). Le président les lit avant chaque conseil : tu n'as plus rien à réexpliquer. Ce fichier reste sur ta machine, il n'est jamais envoyé sur GitHub.

## Lancer un conseil

1. Ouvre Claude Code dans n'importe quel dossier et tape `/goat` suivi de ta décision.
2. La salle s'ouvre toute seule dans ton navigateur (http://localhost:4730) et montre le conseil en direct.
3. Réponds aux questions du président s'il lui manque quelque chose, puis regarde le conseil débattre.
4. Quand le verdict tombe, clique sur **Télécharger le PDF**, ou ouvre `rapport.html` pour voir qui a dit quoi.

Tu as aussi un verdict court dans Claude Code, et deux fichiers dans `sessions/<date>-<décision>/` :

- `rapport.html` : une page à ouvrir dans ton navigateur, sans serveur, qui montre qui a dit quoi, qui a contredit qui, qui a changé d'avis, et le verdict. Pour la refaire à la main : `npm run rapport -- sessions/<date>-<décision>`.
- `verdict.md` : le rapport écrit du président.

## Ce qu'il faut mettre dans ta question

- **La décision**, en une phrase.
- **Tes options**, deux ou trois. « Ne rien changer » compte.
- **Tes chiffres** : chiffre d'affaires, trésorerie, taille de l'équipe (inutile s'ils sont dans ton second cerveau).
- **Tes limites** : délai, heures, budget.
- **À quoi ressemble la réussite**, et pour quand.
- **De quel côté tu penches**, et pourquoi. Le conseil teste ton penchant au lieu de te donner raison.

Exemple :

```
/goat Je suis coach, 12 clients à 1 500 € par mois. Est-ce que je passe à 2 500 € pour tout le monde,
seulement pour les nouveaux, ou je garde 1 500 € ? J'ai 20 000 € de trésorerie et je signe un client
sur deux en appel. Objectif : 25 000 € par mois d'ici juin. Je penche pour tout le monde, je suis sous-payé.
```

Autres façons de le lancer :

- `/goat --rapide ...` : trois jurés, deux tours. Pour les petites décisions réversibles.
- `/goat --jures hormozi,buffett ...` : seulement les jurés que tu nommes.
- `/goat demande hormozi ...` : une seule réponse d'un seul juré.

La salle est optionnelle : le conseil tourne pareil dans Claude Code sans elle.

## Ce que ça consomme

Un conseil, c'est 8 lancements de jurés la plupart du temps (4 jurés, 2 tours), 12 au maximum quand la salle reste divisée et qu'un troisième tour est nécessaire. Les jurés tournent sur Sonnet, le modèle le moins gourmand, pour ménager ton abonnement.

## Comment ça marche

- **Le conseil tourne dans Claude Code.** Chaque juré est un sous-agent (`.claude/agents/goat-*.md`) qui lit son propre cerveau (`.claude/skills/goat/brains/<nom>/`) : cadres de pensée, principes, positions, histoires et façon de parler, compilés à partir de sources publiques, chaque citation reliée à sa source. Claude Code joue le président : il mène les tours, tient les scores et écrit le verdict (`.claude/skills/goat/SKILL.md`).
- **Chaque juré note chaque option**, pondérée par l'importance de son pilier pour ta décision. Le président plafonne le verdict quand un juré voit un risque de ruine, et force un vrai débat quand tout le monde tombe d'accord trop vite.
- **La salle ne fait que regarder.** Le président écrit chaque étape dans `sessions/`, et l'application les rejoue. Elle ne fait aucun appel à une IA.
- **Chaque conseil est gardé** dans `sessions/`. « Conseils passés » rejoue n'importe lequel et télécharge son PDF.

## Ce qu'il y a dedans

| Chemin | Quoi |
|---|---|
| `.claude/skills/goat/` | Le skill : protocole, prompts, notation, modèle de rapport, et les quatre cerveaux |
| `.claude/agents/` | Les quatre jurés |
| `app/` | La salle : un serveur Node sans dépendance, la page web et le générateur de PDF |
| `sessions/` | Tes conseils (gardés hors de GitHub) |
| `mon-business.exemple.md` | Le modèle pour brancher ton second cerveau |

## À propos des conseillers

Ce sont des simulations construites à partir du travail public de chaque personne. Ce ne sont pas ces personnes, ils ne parlent pas en leur nom, et aucune n'est liée à ce projet ni ne le cautionne. Un juré ne cite quelqu'un mot pour mot que si la phrase est dans son cerveau avec sa source, et `python3 .claude/skills/goat/scripts/check_quotes.py sessions/<session>` vérifie chaque citation d'un conseil. Le fichier `sources.md` de chaque cerveau liste ce à partir de quoi il a été construit.

Code sous licence MIT, voir `LICENSE`. Le générateur de PDF embarque [jsPDF](https://github.com/parallax/jsPDF) (MIT) et [Montserrat](https://github.com/JulietaUla/Montserrat) (SIL Open Font License) ; leurs licences sont à côté d'eux dans `app/public/`.
