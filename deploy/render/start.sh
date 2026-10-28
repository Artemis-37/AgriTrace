#!/bin/sh
# Démarrage sur Render : prépare la base (rôle applicatif), migre, crée l'administrateur, charge la démonstration (si SEED_DEMO=1), lance l'API.
set -e
export APP_PW=$(printf '%s' "$JWT_SECRET" | sha256sum | cut -c1-32)

SEED=0
if [ "${SEED_DEMO:-0}" = 1 ] && [ -z "${DEMO_PASSWORD:-}" ]; then echo "[render] ATTENTION : DEMO_PASSWORD absent, les comptes de démonstration utiliseraient le mot de passe par défaut, public dans le dépôt. Ajoutez DEMO_PASSWORD (12 caractères minimum) dans l'onglet Environment."; fi
if [ "${SEED_DEMO:-0}" = 1 ] && [ -n "${ADMIN_EMAIL:-}" ]; then
  ST=$(node scripts/render-state.js)
  if [ "$ST" = partial ] || [ "$ST" = outdated ]; then
    echo "[render] démonstration interrompue ou d'une ancienne version : base remise à zéro puis rechargée"
    node scripts/render-state.js reset
    ST=empty
  fi
  [ "$ST" = empty ] && SEED=1
fi

node scripts/render-prepare.js
export DATABASE_URL=$(cat /tmp/app-db-url)
echo "[render] migrations"
DATABASE_URL="$OWNER_DATABASE_URL" node scripts/migrate.js
if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "[render] ATTENTION : ADMIN_EMAIL et/ou ADMIN_PASSWORD absents (onglet Environment) : aucun administrateur ni démonstration"
elif [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
  echo "[render] ATTENTION : ADMIN_PASSWORD fait ${#ADMIN_PASSWORD} caractères, il en faut au moins 12 : aucun administrateur créé"
else
  echo "[render] administrateur : $ADMIN_EMAIL (mot de passe de ${#ADMIN_PASSWORD} caractères)"
  RESET_PASSWORD=1 DATABASE_URL="$OWNER_DATABASE_URL" node scripts/create-platform-admin.js "$ADMIN_EMAIL" "Administrateur de la plateforme" || true
fi

if [ "$SEED" = 1 ]; then
  # Le chargement ouvre une session par compte : limites de débit relevées jusqu'au prochain redémarrage.
  export LOGIN_THROTTLE_LIMIT=100000 THROTTLE_LIMIT=100000
  (
    for i in $(seq 1 90); do node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 2; done
    # Render endort le service sans visite extérieure : on s'appelle par l'adresse publique pendant le chargement.
    KA=""
    if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
      ( while true; do sleep 45; node -e "fetch(process.env.RENDER_EXTERNAL_URL+'/v1/health').catch(()=>{})"; done ) &
      KA=$!
    fi
    if API="http://127.0.0.1:${PORT:-3000}/v1" DEMO_NO_DOC=1 node scripts/seed-demo-complet.js; then node scripts/render-state.js mark; echo "[render] démonstration chargée"; else echo "[render] ÉCHEC du chargement de la démonstration (voir plus haut)"; fi
    [ -n "$KA" ] && kill $KA 2>/dev/null
    true
  ) &
fi
exec node dist/main
