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
uvicorn main:app --host 0.0.0.0 --port 8000
```

Find your computer's local IP address, then enter this in the app login screen:

```text
http://YOUR-COMPUTER-IP:8000
```

For friends outside your Wi-Fi network, expose the backend with a public tunnel or deploy it to a server, then use that public URL in the app.

## Accounts and email verification

New accounts must verify a six-digit code before they can sign in. Passwords must be 15 to 128 characters; passphrases, spaces, and symbols are supported, while common passwords are rejected. Passwords are salted and hashed by the server.

For real email delivery, configure your SMTP provider before starting Uvicorn:

```powershell
$env:SMTP_HOST = "smtp.example.com"
$env:SMTP_PORT = "587"
$env:SMTP_FROM = "no-reply@example.com"
$env:SMTP_USERNAME = "smtp-user"
$env:SMTP_PASSWORD = "smtp-password"
uvicorn main:app --host 0.0.0.0 --port 8000
```

When SMTP is not configured, the app displays a development-only code so you can test registration and password reset locally. Never use that fallback on a public deployment.

## Verify the engine

```bash
npm run test:engine
```

## Online backend scaffold

The backend entry point is `main.py`.

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```
