#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 server (DigitalOcean). Run as root: bash server-setup.sh
# Safe to run again: every step checks whether it is already done.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "== System updates"
apt-get update -q && apt-get -yq upgrade
apt-get install -yq ufw fail2ban unattended-upgrades git curl rsync ca-certificates gnupg \
  debian-keyring debian-archive-keyring apt-transport-https
# Install security updates automatically every day.
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

echo "== Firewall: only SSH, HTTP and HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== SSH: keys only (no passwords), and fail2ban against repeated attempts"
cat > /etc/ssh/sshd_config.d/00-findmyhobby.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh
systemctl enable --now fail2ban

echo "== 2 GB swap, so installs and builds don't run out of memory on 1 GB RAM"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl -q -p /etc/sysctl.d/99-swappiness.conf

echo "== Node.js 24 LTS and pnpm"
if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi
corepack enable
corepack prepare pnpm@10.26.2 --activate

echo "== Caddy web server (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

echo "== App user and folders"
id fmh >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/fmh --shell /bin/bash fmh
mkdir -p /srv/fmh/www /etc/fmh
chown fmh:fmh /srv/fmh /srv/fmh/www
chown root:fmh /etc/fmh && chmod 750 /etc/fmh

echo "== Done: $(node -v), pnpm $(pnpm -v), $(caddy version | cut -d' ' -f1)"
