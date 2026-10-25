#!/bin/bash
# Démarrage « tout-en-un » pour l'essai sur Fly.io : PostgreSQL + API + portail dans une seule machine, données sur le volume /data.
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
export PGDATA=/data/pgdata
SECRETS=/data/secrets.env
mkdir -p /data/documents "$PGDATA"
chown -R postgres:postgres /data
chmod 700 "$PGDATA"
rnd() { head -c "$1" /dev/urandom | base64 -w0 | tr '+/=' 'ABC'; }

# Secrets générés une seule fois et conservés sur le volume (les secrets Fly de même nom, s'il y en a, restent prioritaires).
if [ ! -f "$SECRETS" ]; then
  umask 077
  { echo "OWNER_PW=$(rnd 24)"; echo "APP_PW=$(rnd 24)"; echo "G_JWT_SECRET=$(rnd 48)"; echo "G_DOCUMENTS_KEY=$(rnd 32)"; echo "G_SECRETS_KEY=$(rnd 32)"; echo "G_BOOTSTRAP_TOKEN=$(rnd 24)"; } > "$SECRETS"
fi
set -a; . "$SECRETS"; set +a
export JWT_SECRET="${JWT_SECRET:-$G_JWT_SECRET}" DOCUMENTS_KEY="${DOCUMENTS_KEY:-$G_DOCUMENTS_KEY}" SECRETS_KEY="${SECRETS_KEY:-$G_SECRETS_KEY}" BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-$G_BOOTSTRAP_TOKEN}"
export OWNER_URL="postgres://agritrace_owner:${OWNER_PW}@127.0.0.1:5432/agritrace"
export DATABASE_URL="postgres://agritrace_app:${APP_PW}@127.0.0.1:5432/agritrace"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[start] Initialisation de la base (UTF8)"
  echo "$OWNER_PW" > /tmp/pw && chown postgres /tmp/pw
  gosu postgres "$PGBIN/initdb" -D "$PGDATA" -U agritrace_owner --encoding=UTF8 --locale=C.UTF-8 --auth=scram-sha-256 --pwfile=/tmp/pw >/dev/null
  rm -f /tmp/pw
  FRESH=1
fi
gosu postgres "$PGBIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -c max_connections=60 -c shared_buffers=128MB" -w -t 120 start
export PGPASSWORD="$OWNER_PW"
PSQL=("$PGBIN/psql" -h 127.0.0.1 -U agritrace_owner -v ON_ERROR_STOP=1 -q)
if [ "${FRESH:-0}" = 1 ]; then
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE agritrace ENCODING 'UTF8' TEMPLATE template0"
  "${PSQL[@]}" -d agritrace <<SQL
CREATE ROLE agritrace_app LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE agritrace TO agritrace_app;
GRANT USAGE ON SCHEMA public TO agritrace_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agritrace_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agritrace_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agritrace_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agritrace_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agritrace_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO agritrace_app;
SQL
fi
echo "[start] Migrations"
DATABASE_URL="$OWNER_URL" gosu postgres node scripts/migrate.js

if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  DATABASE_URL="$OWNER_URL" gosu postgres node scripts/create-platform-admin.js "$ADMIN_EMAIL" "Administrateur de la plateforme" || true
fi

SEED_NOW=0
if [ "${SEED_DEMO:-0}" = 1 ] && [ -n "${ADMIN_EMAIL:-}" ] && [ ! -f /data/.demo-seeded ]; then
  SEED_NOW=1
  # Le chargement de la démonstration ouvre une session par compte : limites de débit relevées jusqu'au prochain redémarrage.
  export LOGIN_THROTTLE_LIMIT=100000 THROTTLE_LIMIT=100000
fi
echo "[start] API"
gosu postgres node dist/main &
API=$!
trap 'kill -TERM $API 2>/dev/null || true; wait $API 2>/dev/null || true; gosu postgres "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop || true; exit 0' TERM INT

# Données fictives de démonstration, une seule fois, si SEED_DEMO=1 (et ADMIN_EMAIL / ADMIN_PASSWORD définis).
if [ "$SEED_NOW" = 1 ]; then
  ( for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 2; done
    API=http://127.0.0.1:3000/v1 DEMO_NO_DOC=1 gosu postgres node scripts/seed-demo-complet.js && touch /data/.demo-seeded ) &
fi
wait $API || true
