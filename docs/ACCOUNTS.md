# Accounts and services

Where each part of FindMyHobby lives and which account controls it.
**No passwords or keys belong in this file.** Keep those in a password manager. Turn on 2-step verification everywhere.

| Service | Used for | Account | 2-step / secure sign-in |
|---|---|---|---|
| GoDaddy | Domain `findmyhobby.in` (DNS) | Krishna Onguru's GoDaddy account | ☐ check |
| DigitalOcean | Server `findmyhobby-api`, 168.144.26.158, Bangalore (project "findmyhobby") | Team email krishna@pickatstore.io | ☐ **Secure Sign-In disabled – enable** |
| Supabase | PostgreSQL database `findmyhobby`, Mumbai (Free plan; upgrade to Pro before launch) | GitHub login Pickatstore3107 (krishna@pickatstore.in) | ☐ check (GitHub 2FA protects it) |
| GitHub | Private code repo `Pickatstore3107/findmyhobby` (server reads it with a read-only deploy key) | Pickatstore3107 | ☐ check |
| Google Cloud | Project "FindMyHobby": Google sign-in (OAuth web client; Android client to add) | krishnaonguru4@gmail.com | ☐ check |
| Razorpay | Payments (test mode now; KYC pending) | Bouroju Akshay | ☐ check |
| Google Play Console | Publishing the Android app (shared with Pickatstore) | Pickatstore developer account | ☐ check |
| Apple Developer | Publishing the iOS app (shared with Pickatstore, later) | Pickatstore developer account | ☐ check |
| Expo (EAS) | Building the phone app | not created yet | – |
| AWS | **Not used any more** (earlier experiment; security groups and IAM role only, no cost) | Bouroju Akshay ("Hello World") | ✅ |

## Admin panel roles

- Owner (full access, set on the server in `OWNER_EMAILS`): krishnaonguru4@gmail.com
- Other staff get roles from the admin panel → People.

## Where secrets live (never in git)

- Server settings: `/etc/fmh/api.env` on the DigitalOcean server (readable by root and the app user only).
- Local development settings: `api/.env` on the developer's Mac.
- Server SSH key: `~/.ssh/findmyhobby_ed25519` on the developer's Mac (passphrase in the macOS Keychain).
