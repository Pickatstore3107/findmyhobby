# Deploying FindMyHobby

```
Internet ──HTTPS──► Caddy on the DigitalOcean server (Bangalore, 168.144.26.158)
                     ├─ findmyhobby.in        → website pages (/srv/fmh/www)
                     │   ├─ /console          → admin panel (static build)
                     │   └─ /api/*            → API (for the admin panel)
                     └─ api.findmyhobby.in    → API (phone app, payment page, Razorpay webhooks)
                                                 └─ Node API (127.0.0.1:4000) ──TLS──► Supabase PostgreSQL (Mumbai)
```

- Firewall allows only SSH (keys only, no passwords), HTTP and HTTPS. fail2ban and daily security updates are on.
- The API listens on 127.0.0.1 only; the outside world reaches it through Caddy.
- The server reads the private GitHub repo with a read-only deploy key.

## First-time server setup

```bash
scp deploy/server-setup.sh fmh:/root/ && ssh fmh 'bash /root/server-setup.sh'
```

## Settings on the server: `/etc/fmh/api.env` (owner root, group fmh, chmod 640)

| Name | Value |
|---|---|
| `NODE_ENV` | `production` (also disables the development email sign-in) |
| `HOST` / `PORT` | `127.0.0.1` / `4000` |
| `TRUST_PROXY` | `1` |
| `DATABASE_URL` | Supabase session pooler URL (password URL-encoded) |
| `DB_SSL` | `require` |
| `OWNER_EMAILS` | owner's Google email(s) |
| `GOOGLE_CLIENT_IDS` | web, Android and iOS OAuth client IDs, comma-separated |
| `ADMIN_ORIGIN` | `https://findmyhobby.in` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | test keys first, live after KYC |
| `UPI_ID` / `UPI_NAME` | optional manual-UPI fallback |

## Releasing a new version

```bash
ssh fmh 'bash /srv/fmh/app/deploy/deploy.sh'
```

Pulls the code, installs packages, applies database migrations, builds the admin panel, publishes the
website, restarts the API and checks `/health`.

## Database changes

Change `api/src/db/schema.ts`, run `pnpm --dir api db:generate`, commit the new file in `api/drizzle/`.
The next deploy applies it. Never edit a migration that has already been deployed.
