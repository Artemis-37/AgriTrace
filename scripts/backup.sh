#!/usr/bin/env bash
# Sauvegarde : base (pg_dump format custom) + dossier des documents. Rotation par ancienneté.
# Usage : BACKUP_DIR=/sauvegardes PGURL=postgres://... DOCS_DIR=/data/documents RETENTION_DAYS=30 ./scripts/backup.sh
# BACKUP_PASSPHRASE_FILE=/chemin/phrase.txt chiffre les sauvegardes (openssl AES-256, PBKDF2) ; restaurer avec restore-test.sh (même variable).
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
# Chiffrement des sauvegardes (AES-256) si BACKUP_PASSPHRASE_FILE est défini : fichier contenant la phrase secrète, à conserver HORS du serveur.
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  for f in "$BACKUP_DIR/db-$ts.dump" "$BACKUP_DIR/docs-$ts.tar.gz"; do
    [ -f "$f" ] && openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$f" -out "$f.enc" && rm -f "$f"
  done
fi
( cd "$BACKUP_DIR" && sha256sum db-$ts.dump* $( ls docs-$ts.tar.gz* 2>/dev/null ) > "manifest-$ts.sha256" )
find "$BACKUP_DIR" -type f \( -name 'db-*' -o -name 'docs-*' -o -name 'manifest-*' \) -mtime +"$RETENTION_DAYS" -delete
echo "Sauvegarde $ts terminée dans $BACKUP_DIR"
echo "Rappel : copier hors du serveur (autre site / stockage objet chiffré). Une sauvegarde non restaurée n'est pas une sauvegarde."
