#!/bin/sh
# Démarrage sur Render : prépare la base (rôle applicatif), migre, crée l'administrateur, lance l'API.
set -e
export APP_PW=$(printf '%s' "$JWT_SECRET" | sha256sum | cut -c1-32)
node scripts/render-prepare.js
export DATABASE_URL=$(cat /tmp/app-db-url)
echo "[render] migrations"
DATABASE_URL="$OWNER_DATABASE_URL" node scripts/migrate.js
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  DATABASE_URL="$OWNER_DATABASE_URL" node scripts/create-platform-admin.js "$ADMIN_EMAIL" "Administrateur de la plateforme" || true
fi
# Données fictives de démonstration : une seule fois (si aucune organisation n'existe encore) et seulement si SEED_DEMO=1.
if [ "${SEED_DEMO:-0}" = 1 ] && [ -n "${ADMIN_EMAIL:-}" ]; then
  EMPTY=$(DATABASE_URL="$OWNER_DATABASE_URL" node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query(\"SELECT count(*)::int n FROM organizations WHERE kind IS DISTINCT FROM 'platform'\").catch(()=>({rows:[{n:1}]}));await c.end();console.log(r.rows[0].n===0?'1':'0')})()" 2>/dev/null || echo 0)
  if [ "$EMPTY" = 1 ]; then
    ( for i in $(seq 1 90); do node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 2; done
      API="http://127.0.0.1:${PORT:-3000}/v1" DEMO_NO_DOC=1 node scripts/seed-demo-complet.js ) &
  fi
fi
exec node dist/main
