#!/usr/bin/env bash
# Releases the latest code. Run on the server as root: bash /srv/fmh/app/deploy/deploy.sh
set -euo pipefail
# Everything is inside main(), so bash reads the whole script before `git pull` can change it.
main() {
  cd /srv/fmh/app
  sudo -u fmh git pull --ff-only
  # Only what the server needs (API + admin); the phone app is built separately.
  sudo -u fmh pnpm install --frozen-lockfile --filter @fmh/api... --filter @fmh/admin...
  # Database changes are applied in order before the new code starts.
  # The env file is read inside the app user's shell, so the database password never appears in the process list.
  (cd api && sudo -u fmh bash -c 'set -a && . /etc/fmh/api.env && set +a && DB_SSL=require pnpm db:migrate')
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
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1 && { echo "✓ API is up"; exit 0; }; sleep 1; done
  echo "✗ API did not start: journalctl -u fmh-api -n 50"; exit 1
}
main "$@"
