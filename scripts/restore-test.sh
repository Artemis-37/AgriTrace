#!/usr/bin/env bash
# Vérifie qu'une sauvegarde est restaurable : restaure dans une base JETABLE puis contrôle l'intégrité comptable.
# ADMIN_PGURL doit pointer sur la base « postgres » d'un compte pouvant créer une base.
# Usage : ADMIN_PGURL=postgres://superuser@host/postgres BACKUP_FILE=/sauvegardes/db-XXXX.dump ./scripts/restore-test.sh
set -euo pipefail
: "${ADMIN_PGURL:?}"; : "${BACKUP_FILE:?}"
name="agritrace_restore_test_$$"
target=$(printf "%s" "$ADMIN_PGURL" | sed "s#/postgres\([?]\|\$\)#/$name\1#")
[ "$target" != "$ADMIN_PGURL" ] || { echo "ADMIN_PGURL doit se terminer par /postgres (base d'administration)"; exit 1; }
psql "$ADMIN_PGURL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $name"
trap 'psql "$ADMIN_PGURL" -c "DROP DATABASE IF EXISTS $name" >/dev/null' EXIT
pg_restore --no-owner --dbname "$target" "$BACKUP_FILE"
psql "$target" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'migrations appliquées : ' || count(*) FROM schema_migrations;
SELECT 'organisations : ' || count(*) FROM organizations;
SELECT 'écritures comptables déséquilibrées : ' || count(*) FROM (
  SELECT entry_id FROM accounting_lines GROUP BY entry_id HAVING sum(debit) <> sum(credit)) t;
SQL
echo "Restauration vérifiée (base jetable supprimée)."
