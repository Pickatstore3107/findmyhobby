#!/usr/bin/env bash
# Releases the latest code. Run on the server as root: bash /srv/fmh/app/deploy/deploy.sh
set -euo pipefail
cd /srv/fmh/app
sudo -u fmh git pull --ff-only
# Only what the server needs (API + admin); the phone app is built separately.
sudo -u fmh pnpm install --frozen-lockfile --filter @fmh/api... --filter @fmh/admin...
# Database changes are applied in order before the new code starts.
DB_URL=$(grep '^DATABASE_URL=' /etc/fmh/api.env | cut -d= -f2-)
(cd api && sudo -u fmh env DATABASE_URL="$DB_URL" DB_SSL=require pnpm db:migrate)
sudo -u fmh pnpm --filter @fmh/admin build
rsync -a --delete --exclude console website/ /srv/fmh/www/
rsync -a --delete admin/dist/ /srv/fmh/www/console/
chown -R fmh:fmh /srv/fmh/www
install -m 644 deploy/fmh-api.service /etc/systemd/system/fmh-api.service
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --quiet fmh-api
systemctl restart fmh-api
systemctl reload caddy
sleep 3 && curl -fsS http://127.0.0.1:4000/health && echo "  ✓ API is up"
