#!/usr/bin/env bash
# Run on the server as root to release the latest code: bash /srv/fmh/app/deploy/deploy.sh
set -euo pipefail
cd /srv/fmh/app
sudo -u fmh git pull --ff-only
sudo -u fmh pnpm install --frozen-lockfile
/srv/fmh/app/deploy/load-secrets.sh
# Database changes are applied in order before the new code starts.
DB_URL=$(grep '^DATABASE_URL=' /run/fmh/api.env | cut -d= -f2-)
(cd api && sudo -u fmh env DATABASE_URL="$DB_URL" DB_SSL=rds pnpm db:migrate)
sudo -u fmh pnpm --filter @fmh/admin build
rsync -a --delete website/ /srv/fmh/www/ --exclude console
rsync -a --delete admin/dist/ /srv/fmh/www/console/
systemctl restart fmh-api
sleep 2 && curl -fsS http://127.0.0.1:4000/health && echo " ✓ API is up"
