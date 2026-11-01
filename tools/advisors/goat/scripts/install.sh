#!/usr/bin/env bash
# Makes /goat available in every folder you open Claude Code in, not only in this repo:
# links the skill into ~/.claude/skills/goat and the four seats into ~/.claude/agents/.
# Links, not copies: a `git pull` here updates them. Never overwrites a file that is not one of these links.
#   bash scripts/install.sh            install
#   bash scripts/install.sh --remove   remove the links
set -euo pipefail
GOAT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="$HOME/.claude/skills"
AGENTS="$HOME/.claude/agents"
mkdir -p "$SKILLS" "$AGENTS"

link() { # link <target> <link path>
  local target="$1" dest="$2"
  if [ -L "$dest" ]; then ln -sfn "$target" "$dest"
  elif [ -e "$dest" ]; then echo "  déjà présent, laissé tel quel : $dest"; return
  else ln -s "$target" "$dest"; fi
  echo "  $dest"
}
unlink_ours() { [ -L "$1" ] && [[ "$(readlink "$1")" == "$GOAT"* ]] && rm "$1" && echo "  retiré : $1" || true; }

if [ "${1:-}" = "--remove" ]; then
  unlink_ours "$SKILLS/goat"
  for f in "$GOAT"/.claude/agents/goat-*.md; do unlink_ours "$AGENTS/$(basename "$f")"; done
  exit 0
fi

echo "GOAT : $GOAT"
link "$GOAT/.claude/skills/goat" "$SKILLS/goat"
for f in "$GOAT"/.claude/agents/goat-*.md; do link "$f" "$AGENTS/$(basename "$f")"; done
[ -f "$GOAT/mon-business.md" ] || echo "Astuce : copie mon-business.exemple.md en mon-business.md pour brancher ton second cerveau."
echo "C'est prêt. Redémarre Claude Code, puis tape /goat suivi de ta décision, dans n'importe quel dossier."
