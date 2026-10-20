#!/usr/bin/env bash
# Sauvegarde : base (pg_dump format custom) + dossier des documents. Rotation par ancienneté.
# Usage : BACKUP_DIR=/sauvegardes PGURL=postgres://... DOCS_DIR=/data/documents RETENTION_DAYS=30 ./scripts/backup.sh
# Avec docker-compose.prod.yml : voir docs/EXPLOITATION.md (exécuter dans le service db / avec le volume documents).
set -euo pipefail
: "${BACKUP_DIR:?}"; : "${PGURL:?}"
DOCS_DIR="${DOCS_DIR:-}"; RETENTION_DAYS="${RETENTION_DAYS:-30}"
ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"; umask 077
pg_dump --format=custom --no-owner "$PGURL" > "$BACKUP_DIR/db-$ts.dump.tmp"
mv "$BACKUP_DIR/db-$ts.dump.tmp" "$BACKUP_DIR/db-$ts.dump"
if [ -n "$DOCS_DIR" ] && [ -d "$DOCS_DIR" ]; then
  tar -C "$DOCS_DIR" -czf "$BACKUP_DIR/docs-$ts.tar.gz.tmp" . && mv "$BACKUP_DIR/docs-$ts.tar.gz.tmp" "$BACKUP_DIR/docs-$ts.tar.gz"
fi
( cd "$BACKUP_DIR" && sha256sum db-$ts.dump $( [ -f docs-$ts.tar.gz ] && echo docs-$ts.tar.gz ) > "manifest-$ts.sha256" )
find "$BACKUP_DIR" -type f \( -name 'db-*' -o -name 'docs-*' -o -name 'manifest-*' \) -mtime +"$RETENTION_DAYS" -delete
echo "Sauvegarde $ts terminée dans $BACKUP_DIR"
echo "Rappel : copier hors du serveur (autre site / stockage objet chiffré). Une sauvegarde non restaurée n'est pas une sauvegarde."
