# Declare

Declare is a cross-platform iOS, Android, and web card game built with Expo React Native.

## What is included

- Local pass-and-play match flow for 2-6 players, with human and AI players (easy, medium, hard).
- Full rule engine for draw, discard, declare, round scoring, same-rank bonus, and match end at 100 points.
- Online rooms that work over the internet: share a six-character room code and anyone with the app can join.
- Server-authoritative online play: every device receives only its own cards during a match.
- Accounts with email verification, login protection, password reset, and session restore.

## Architecture

| Part | Location | Notes |
| --- | --- | --- |
| Mobile and web app | `App.js`, `src/engine/` | Expo SDK 54. Local games run entirely on the device. |
| Shared rules | `shared/rules.json` | Limits, ranks, and suits. Read by both the JS engine and the backend. |
| Online backend | `backend/app.py`, `backend/store.py` | FastAPI with WebSockets. Accounts, rooms, and matches are stored in SQLite. |
| Container | `Dockerfile` | Runs the backend on any host with a persistent volume (Render, Railway, Fly.io, a VPS). |

The web build is a static site and can be deployed to Vercel. The backend must run as a long-lived service, because
Vercel serverless functions cannot hold the WebSocket connections that rooms use.

## Run the app locally

```bash
npm install
npm start
```

Open the app with Expo on iOS or Android, or press `w` for the web version.

## Run the backend locally

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Point the app at `http://localhost:8000` (web) or `http://YOUR-COMPUTER-IP:8000` (phone on the same Wi-Fi).
Without SMTP configured, codes are only shown in the app when `ALLOW_DEVELOPMENT_CODES=true`.

## Deploy the backend so anyone can join

1. Deploy from this repository with the root `Dockerfile` (on Render, Railway, or Fly.io, choose "Docker").
2. Add a persistent volume mounted at `/data`. The database lives at `/data/declare.sqlite3`.
3. Set environment variables from `.env.example`: at minimum the `SMTP_*` settings. Leave `ALLOW_DEVELOPMENT_CODES` unset.
4. Check `https://YOUR-BACKEND/health` returns `{"status":"ok"}`.

Run only one backend instance. Rooms and WebSocket connections are held by the process that owns them, so
scaling out to several instances needs a shared message bus (for example Redis pub/sub) first.

## Deploy the web app

1. Create a Vercel project from this repository. Use the **Other** framework preset. The root `vercel.json` builds the Expo web app into `dist`.
2. Set `EXPO_PUBLIC_API_URL` to your backend URL (for example `https://declare-api.example.com`) before building.
3. Deploy. The app will reach your backend from any network.

For mobile builds, set `EXPO_PUBLIC_API_URL` in your EAS production environment and publish a new build.
Players can also type the server URL on the login screen.

## Set up email

Verification and password-reset codes are sent by email. Any SMTP provider works (Gmail, Brevo, Mailgun, Amazon SES, SendGrid, and others). Set the `SMTP_*` variables from `.env.example` on the backend server, then check them before going live:

```bash
python -m backend.send_test you@example.com
```

It prints either the successful send or the exact reason it failed, such as a rejected login. Gmail needs an app password, not your normal password.

## Accounts

- Passwords must be 15 to 128 characters. Passphrases, spaces, and symbols are allowed. Common passphrases are rejected.
- New accounts verify a six-digit email code before they can sign in. Codes expire after 15 minutes and lock after five wrong attempts.
- Sign-in locks for 15 minutes after five failed attempts. Code emails can be requested once per minute.
- Sessions last 30 days. Resetting a password signs out every other device.

## Room rules

- A room holds 2 to 6 players. The host starts the match once two or more players have joined.
- Players can join or leave while the room is idle. Joining is blocked while a match is in progress, and leaving is blocked until it finishes.
- If the host leaves, the next player becomes host. The room is removed when the last player leaves.
- Reconnecting after a dropped connection restores the current state automatically.

## Verify the engine

```bash
npm run test:engine
```

## Run backend tests

```bash
python -m pytest backend/tests -q
```
