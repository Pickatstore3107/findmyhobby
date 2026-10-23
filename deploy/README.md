# Deploying FindMyHobby

One small EC2 server (Amazon Linux 2023, ARM) runs everything behind Caddy, next to a private RDS MySQL database.

```
Internet ──HTTPS──► Caddy (:443, automatic certificates)
                     ├─ yourdomain        → website pages (/srv/fmh/www)
                     │   ├─ /console      → admin panel (static build)
                     │   └─ /api/*        → API (for the admin panel)
                     └─ api.yourdomain    → API (phone app, payment page, Razorpay webhooks)
                                             └─ Node API (:4000, local only) ──► RDS MySQL (private)
```

- No SSH port is open. Connect with **AWS Systems Manager → Session Manager**.
- Secrets live in **Parameter Store** under `/findmyhobby/prod/`, are decrypted with the server's IAM role,
  and are written only to `/run/fmh/api.env` (memory) when the API starts.

## Parameter Store values (`/findmyhobby/prod/…`, type SecureString)

| Name | Example / notes |
|---|---|
| `NODE_ENV` | `production` (also disables the development email sign-in) |
| `PORT` | `4000` |
| `TRUST_PROXY` | `1` |
| `DATABASE_URL` | `mysql://fmh_app:PASSWORD@<rds-endpoint>:3306/findmyhobby` |
| `DB_SSL` | `rds` (encrypted connection, certificate checked against Amazon RDS authorities) |
| `OWNER_EMAILS` | owner's Google email(s), comma-separated |
| `GOOGLE_CLIENT_IDS` | web, Android and iOS OAuth client IDs, comma-separated |
| `ADMIN_ORIGIN` | `https://yourdomain` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | test keys first, live keys after KYC |
| `RAZORPAY_WEBHOOK_SECRET` | set when creating the webhook in Razorpay |
| `UPI_ID` / `UPI_NAME` | optional manual-UPI fallback |
| `S3_BUCKET` / `AWS_REGION` / `IMAGE_BASE_URL` | photo uploads and CloudFront address |

## Releasing a new version

```bash
sudo bash /srv/fmh/app/deploy/deploy.sh
```

It pulls the code, installs packages, applies database migrations in order, builds the admin panel,
publishes the website, restarts the API and checks `/health`.

## Database changes

Change `api/src/db/schema.ts`, then on your Mac run `pnpm --dir api db:generate` and commit the new file in `api/drizzle/`.
The next deploy applies it. Never edit a migration that has already been deployed.
