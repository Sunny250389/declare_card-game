# Declare

Declare is a card game for two to six players: lowest hand wins, and a match ends at 100 points. It runs in any
modern browser and installs to your home screen on Android and iPhone, with no app store needed.

## Features

- Play on one device against AI players (easy, medium, hard), or with friends online.
- Online rooms with a shareable six-character code. Each device sees only its own cards.
- Accounts with email verification, sign-in protection, password reset, and sessions that stay signed in.
- An unfinished local match can be resumed. Each account keeps its own.
- Works offline for the app itself once it has been opened once (installed app only).

## How to play

Each turn has two steps:

1. **Discard** one or more cards of the same rank. The turn does not end yet.
2. **Pick up** one card, either from the draw pile or the card that was on top of the discard pile before your discard.
   Picking up ends your turn.

A round starts with one card already on the discard pile. Before you discard, you may **declare** if your hand is 15
points or less. A declare ends the round and scores it:

- Someone with a lower hand: you score 50 and they score 0.
- A tie: you score double your hand, and the tied players score 0.
- Your hand is all one rank: you score -25.
- Otherwise: you score 0 and everyone else scores their hand value.

## Architecture

| Part | Location | Notes |
| --- | --- | --- |
| Web app (PWA) | `src/`, `index.html`, `public/` | React and Vite. Installable, with an offline app shell. |
| Game rules | `src/engine/` | Pure JavaScript, no framework. Used by the app and the tests. |
| Shared rules | `shared/rules.json` | Limits, ranks, and suits. Read by the JavaScript engine and the Python backend. |
| Online backend | `backend/app.py`, `backend/store.py`, `backend/mailer.py` | FastAPI with WebSockets. Data in SQLite. |
| Container | `Dockerfile` | Runs the backend on any host with a persistent volume. |

The backend keeps rooms in memory on a single process, so it must run as one long-lived service. Serverless hosts
cannot keep the WebSocket connections that rooms need.

## Run the app on this computer

```bash
npm install
npm run dev
```

Open http://localhost:5173. The app reaches the backend on port 8000 of the same host.

## Run the backend

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Without email set up, codes are shown on screen only when `ALLOW_DEVELOPMENT_CODES=true`.

## Use it on a phone on the same Wi-Fi

1. Start the backend and the web app on this computer. `npm run dev` already listens on all network addresses.
2. Allow inbound connections on ports 5173 and 8000 in Windows Firewall. Set the Wi-Fi to **Private** first, or add a rule
   for the Private profile.
3. On the phone, open `http://YOUR-COMPUTER-IP:5173`. The app uses `http://YOUR-COMPUTER-IP:8000` for the backend.

Installing to the home screen needs a secure connection (HTTPS), so for a permanent install, host the app (see below).

- **Android (Chrome):** menu → **Install app**.
- **iPhone (Safari):** share button → **Add to Home Screen**.

## Install on a phone from a hosted site

Host the built app over HTTPS, then open that address in Chrome or Safari and use the install steps above.

```bash
VITE_API_URL=https://your-backend.example.com npm run build
```

This creates `dist/`. Upload it to any static host (for example Netlify, Cloudflare Pages, GitHub Pages, or your own server).
`VITE_API_URL` must point to the public HTTPS address of the backend, because it is built into the app.

## Tests

```bash
npm test                  # engine rules, helpers, and component tests (Vitest)
npm run test:backend      # backend API, rooms over WebSocket, and email (pytest)
```

## Set up email

Verification and password-reset codes are sent by email. Any SMTP provider works (Gmail, Brevo, Mailgun, Amazon SES,
SendGrid, and others). Set the `SMTP_*` variables from `.env.example` on the backend server, then check them:

```bash
python D:\Projects\declare_card-game\backend\send_test.py you@example.com
```

It prints either the successful send or the exact reason it failed, such as a rejected login. Gmail needs an app
password, not your normal password.

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

## Deploy the backend

1. Deploy the root `Dockerfile` on Render, Railway, or Fly.io.
2. Add a persistent volume mounted at `/data`. The database lives at `/data/declare.sqlite3`.
3. Set the environment variables from `.env.example`, at minimum the `SMTP_*` settings. Leave `ALLOW_DEVELOPMENT_CODES` unset.
4. Check that `https://YOUR-BACKEND/health` returns `{"status":"ok"}`.

Run only one backend instance. Rooms and WebSocket connections are held by the process that owns them.
