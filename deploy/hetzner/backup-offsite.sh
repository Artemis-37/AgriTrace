#!/usr/bin/env bash
# Sauvegarde nocturne : base + documents, chiffrées, puis copie HORS du serveur avec rclone.
# Prérequis : /etc/agritrace/backup.pass (phrase secrète, 600), remote rclone nommé "offsite" (rclone config).
# Le remote doit être chez UN AUTRE fournisseur que le serveur (ex. stockage objet S3 compatible).
# Usage (cron/systemd) : cd /opt/agritrace && bash deploy/hetzner/backup-offsite.sh
set -euo pipefail
cd /opt/agritrace
DIR=/var/backups/agritrace; PASS=/etc/agritrace/backup.pass
REMOTE="${RCLONE_REMOTE:-offsite:agritrace-sauvegardes}"
[ -s "$PASS" ] || { echo "Phrase de chiffrement absente : $PASS"; exit 1; }
set -a; . ./.env; set +a
ts=$(date -u +%Y%m%dT%H%M%SZ); umask 077; mkdir -p "$DIR"
C="docker compose -f docker-compose.prod.yml"
# Base : pg_dump dans le conteneur db
$C exec -T db pg_dump -U agritrace_owner --format=custom --no-owner agritrace > "$DIR/db-$ts.dump"
# Documents : archive du volume
$C exec -T api tar -C /data/documents -czf - . > "$DIR/docs-$ts.tar.gz" 2>/dev/null || echo "(documents : archive vide ou illisible)"
for f in "$DIR/db-$ts.dump" "$DIR/docs-$ts.tar.gz"; do
  [ -s "$f" ] && openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$PASS" -in "$f" -out "$f.enc"
  rm -f "$f"
done
( cd "$DIR" && sha256sum db-$ts.dump.enc $( ls docs-$ts.tar.gz.enc 2>/dev/null ) > "manifest-$ts.sha256" )
rclone copy "$DIR" "$REMOTE" --include "*-$ts.*"
find "$DIR" -type f -mtime +14 -delete          # copie locale : 14 jours
echo "Sauvegarde $ts envoyée vers $REMOTE"
