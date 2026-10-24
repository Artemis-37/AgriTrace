#!/usr/bin/env bash
# Préparation d'un serveur Ubuntu 22.04/24.04 (Hetzner Cloud ou autre) : à exécuter UNE fois, en root.
# Usage : DOMAIN=agritrace.exemple.org ADMIN_EMAIL=vous@exemple.org bash provision.sh
# NON TESTÉ sur un vrai serveur depuis l'environnement de développement : relire avant d'exécuter.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Exécuter en root"; exit 1; }
: "${DOMAIN:?nom de domaine du portail}"; : "${ADMIN_EMAIL:?e-mail pour le certificat}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades rclone openssl

# Docker (dépôt officiel)
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi

# Pare-feu : SSH, HTTP, HTTPS seulement (doubler avec le pare-feu du cloud Hetzner)
ufw default deny incoming; ufw default allow outgoing
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban unattended-upgrades

# SSH : clé uniquement (vérifier que votre clé fonctionne AVANT de couper les mots de passe)
if [ -s /root/.ssh/authorized_keys ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd
else
  echo "ATTENTION : aucune clé SSH dans /root/.ssh/authorized_keys, l'accès par mot de passe est conservé."
fi

# Dossiers
mkdir -p /opt/agritrace /var/backups/agritrace /etc/agritrace
chmod 700 /var/backups/agritrace /etc/agritrace
echo "$DOMAIN" > /etc/agritrace/domain
echo "$ADMIN_EMAIL" > /etc/agritrace/admin_email
echo "OK. Étape suivante : cloner le dépôt dans /opt/agritrace puis suivre docs/DEPLOIEMENT_HETZNER.md §4."
