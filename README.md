# Declare

Declare is a cross-platform iOS and Android card game built with Expo React Native.

## What is included

- Local pass-and-play match flow for 2-6 players.
- Human and AI players with easy, medium, and hard decision strategies.
- Full core rule engine for draw, discard, declare, round scoring, same-rank bonus, and match end at 100 points.
- Mobile screens for home, setup, gameplay, round result, match result, statistics, settings, and online lobby entry.
- Server-authoritative online multiplayer: every device receives only its own cards during play.
- Email-verified registration, login, password visibility toggle, and password-reset codes.

## Run the mobile app

Install dependencies with Node.js and npm, then run:

```bash
npm install
npm start
```

Use Expo to open the app on iOS or Android.

## Remote rooms on phones

Start the backend so phones on your network can reach it:

```bash
pip install -r requirements.txt
uvicorn backend:app --host 0.0.0.0 --port 8000
```

Find your computer's local IP address, then enter this in the app login screen:

```text
http://YOUR-COMPUTER-IP:8000
```

For friends outside your Wi-Fi network, expose the backend with a public tunnel or deploy it to a server, then use that public URL in the app.

## Deploy the API with Vercel

The repository exports its FastAPI application from `api/index.py`, which Vercel detects automatically. Import `Sunny250389/declare_card-game` at [Vercel](https://vercel.com/new) and deploy from the repository root. Set the SMTP variables below in the Vercel project's Production environment.

After Vercel gives you an HTTPS URL, add it with `/api` as `EXPO_PUBLIC_API_URL` in your Expo/EAS production environment, then publish a new mobile build or update. The mobile app can also enter the Vercel API URL manually in the login screen while testing.

The current room, account, and WebSocket connection maps are stored in process memory. This is suitable for a local server but not a durable multi-instance Vercel deployment. Before relying on Vercel for remote multiplayer, move that shared state to Redis or another database and use a Vercel-compatible realtime transport.

## Accounts and email verification

New accounts must verify a six-digit code before they can sign in. Passwords must be 15 to 128 characters; passphrases, spaces, and symbols are supported, while common passwords are rejected. Passwords are salted and hashed by the server.

For real email delivery, configure your SMTP provider before starting Uvicorn:

```powershell
$env:SMTP_HOST = "smtp.example.com"
$env:SMTP_PORT = "587"
$env:SMTP_FROM = "no-reply@example.com"
$env:SMTP_USERNAME = "smtp-user"
$env:SMTP_PASSWORD = "smtp-password"
uvicorn backend:app --host 0.0.0.0 --port 8000
```

When SMTP is not configured, the app displays a development-only code so you can test registration and password reset locally. Vercel disables this fallback by default; never enable `ALLOW_DEVELOPMENT_CODES` on a public deployment.

## Verify the engine

```bash
npm run test:engine
```

## Online backend scaffold

The local backend entry point is `backend.py`.

```bash
pip install -r requirements.txt
uvicorn backend:app --reload
```
