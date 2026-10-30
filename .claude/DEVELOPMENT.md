# Declare: development log

A running record of what was built in this repo, why, and where things stand. Newest changes are at the bottom of
each section. Secrets (passwords, app passwords, signing keys) are never recorded here.

Last updated: 30 October 2026.

## Current state at a glance

- **Product:** Declare, a card game for 2 to 6 players. Lowest hand wins, and a match ends at 100 points.
- **Client:** installable web app (PWA) built with React and Vite. No Expo.
- **Server:** FastAPI backend with WebSockets, SQLite storage, and SMTP email.
- **Branch:** `feature/online-rooms-email-android`, pushed to GitHub (`Sunny250389/declare_card-game`). `main` is unchanged.
- **Latest commits on the branch:** `82d8ac9` (web app rebuild and tests). Later work is uncommitted (see "Open items").
- **Tests:** 66 frontend tests (Vitest) and 20 backend tests (pytest). All pass.
- **Store listing:** Google Play Console already has the developer account. The app is not published yet.

## Timeline

### 1. Repo review (initial)
- Read the Expo app (`App.js`), the pure JavaScript rules engine (`src/engine/`), and the FastAPI backend (`backend/app.py`).
- Found that Vercel serverless functions cannot keep WebSocket connections, and rooms and accounts lived in process memory.

### 2. Login hardening and rooms that work over the internet
- **Backend storage:** moved accounts, sessions, rooms, and matches from memory to SQLite (`backend/store.py`), a JSON document store behind one lock.
- **Login protection:** five failed sign-ins lock an email for 15 minutes. Verification and reset codes lock after five wrong attempts. Code emails have a 60-second cooldown.
- **Sessions:** 30-day expiry, `/auth/me` to check a saved token, `/auth/logout`, and a session version that signs out other devices on password reset.
- **Rooms:** join, leave (host passes on), and reconnect. Joining is blocked during a match.
- **Hosting:** added a root `Dockerfile` for a long-running host. Removed the Vercel backend config.
- **Gaps fixed:** rules shared in `shared/rules.json`, development codes only when explicitly enabled, errors sent only to the player who made the bad move, malformed WebSocket messages handled, stale docs corrected.
- **Tests:** 14 backend tests, including rooms over a real WebSocket and a restart test.

### 3. Turn order and rule changes
- A round starts with one card (the starter) on the discard pile.
- Each turn: discard one or more cards of the same rank (required), then pick up one card (required). Picking up ends the turn.
- The pickup card is the top card from before this turn's discard. A card discarded this turn can't be picked back up.
- Declaring is allowed only before discarding. Later changed to 15 points or less.
- The AI follows the same order.
- The rules are implemented in both `src/engine/gameEngine.js` and `backend/app.py`, and must be kept in sync.

### 4. Fixing local preview problems
- The page was blank because `react` (19.2.7) and `react-dom` (19.1.0) didn't match. React requires an exact match. Later, `react-native` 0.81.6 needed `react` 19.1.4 or newer, so the Expo versions were aligned to SDK 54.
- The web bundle was stale after edits, because Metro didn't rebuild. Restarting the dev server with `--clear` fixed it.
- `babel-preset-expo` went missing from the top level after a reinstall, and was added back as a dev dependency.

### 5. App UX changes
- "Play without account" option. A welcome screen became the starting page (Login or Sign Up, and Play without account).
- Log out button on the home screen.
- Resume Match appears only for an unfinished local match, stored per account. Finished matches are removed.
- Opponent cards were visible during AI turns. The local view now shows nothing during an AI turn.
- Declare enabled at 15 points or less, in both the engine and the backend.

### 6. Email (SMTP)
- `backend/mailer.py`: STARTTLS on port 587 or implicit TLS on port 465 (`SMTP_USE_SSL=true`). Settings come from `SMTP_*` environment variables.
- `backend/send_test.py`: sends one test email and reports the exact error. Run it with `python D:\Projects\declare_card-game\backend\send_test.py you@example.com`.
- Verified against a local SMTP server, then against Gmail. A signup OTP arrived in the inbox.
- Gmail needs an app password. One was shared in chat during setup. It must be revoked, and a new one created and entered only in a local terminal.

### 7. Android build (superseded)
- Generated an Android project with `expo prebuild` and built a release APK with Gradle. This was installed on a phone over USB and used for sign-in.
- Plain `http` to the backend was blocked by Android until `usesCleartextTraffic` was restored in `app.json` (the setting was lost when `expo install` rewrote the file).
- Windows Firewall blocked the phone on the Public network. Setting the Wi-Fi to Private fixed it. Port 8000 needed a firewall rule for the Private profile.
- Superseded by the web app rebuild below.

### 8. Vercel removed
- The PR failed Vercel schema validation: `vercel.json` had an unsupported `"public": true` property. Fixed, then the whole Vercel config was removed because the backend can't run on Vercel.
- Commits: `4f9fc5b` (property fix) and `f76e2cc` (removal).

### 9. Expo removed, web app rebuilt (commit `82d8ac9`)
- Decision: option 2, an installable web app that reaches Apple users without the App Store.
- Engine converted to ES modules. Rules unchanged.
- Screens rebuilt in React: welcome, login, home, setup, gameplay, round and match results, statistics, settings, online.
- `src/api.js`, `src/storage.js`, `src/format.js`, `src/components/ui.jsx`, `src/styles.css`.
- PWA: `public/manifest.webmanifest`, `public/sw.js` (caches the app shell, never API calls), icons (`public/icons/`).
- `VITE_API_URL` replaces `EXPO_PUBLIC_API_URL`. In development, the app uses port 8000 on the host it was opened from.
- Tests added: 66 Vitest tests covering engine rules, AI, server helpers, storage, login validation, and gameplay visibility.
- Checked in headless Chrome: welcome screen at a 390px phone width, and a local turn (discard, then pick up).

### 10. Google Play preparation (uncommitted)
- Chosen route: Capacitor, which wraps the web app into Android and later iOS. Installed `@capacitor/core`, `@capacitor/android`, and `@capacitor/cli` (version 8.x).
- `capacitor.config.json`: app ID `com.declare.cardgame`, name `Declare`, web directory `dist`.
- `android/` was generated with `npx cap add android`. The folder is ignored by git for now (see "Open items").
- `public/privacy.html`: privacy policy page for Play. Name and email are filled in. Still needs the email provider and hosting provider names.
- The welcome screen links to the privacy page.
- Plan: new app listing in the existing Play Console. Upload key created by the user, Play App Signing for the rest. Closed testing with friends. Google requires 12 testers for 14 days for a new personal developer account. Please check the current rule in Play Console.

## Architecture (current)

| Part | Location | Notes |
| --- | --- | --- |
| Web app (PWA) | `src/`, `index.html`, `public/` | React 19.3.1 (pinned), Vite 7 |
| Game rules | `src/engine/` | Pure JavaScript modules |
| Shared rules | `shared/rules.json` | Limits, ranks, suits. Read by JS and Python |
| Backend | `backend/app.py`, `backend/store.py`, `backend/mailer.py` | FastAPI, SQLite, SMTP |
| Email tools | `backend/send_test.py` | Checks SMTP settings |
| Container | `Dockerfile`, `.dockerignore` | Runs the backend on any host with a persistent disk |
| Android (Capacitor) | `capacitor.config.json`, `android/` | Generated, not yet built or signed |
| Privacy policy | `public/privacy.html` | Served at `/privacy.html` once hosted |
| Tests | `tests/engine`, `tests/unit`, `backend/tests` | Vitest and pytest |

## Commands

```text
npm install                  install web dependencies
npm run dev                  web app on port 5173 (reachable on the LAN)
npm run build                production build in dist/
npm test                     frontend tests (Vitest)
npm run test:backend         backend tests (pytest)
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000     backend
```

Environment (see `.env.example`): `VITE_API_URL` (build time), `DATABASE_PATH`, `CORS_ORIGINS`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_USE_SSL`, and
`ALLOW_DEVELOPMENT_CODES` (local testing only).

## Decisions

- **Web app first, then native:** an installable web app reaches iPhone users without a store account. Capacitor wraps the same code for Android and later iOS.
- **Hosting:** Render for the backend. The free plan is fine for testing, but its data resets. The paid plan (about $7 a month) keeps accounts and rooms on a disk.
- **Store:** Google Play for Android. Apple App Store and TestFlight later, which needs an Apple Developer account ($99 a year).
- **Privacy policy:** served from the same host as the app (GitHub Pages, or the app host), at no cost.
- **SQLite:** one backend process owns the database. Scaling out needs a shared store and a message bus.
- **Declare rule:** declaring is an alternative to a turn, allowed only before discarding, at 15 points or less.

## Open items

1. **Commit the Capacitor and privacy work.** It's uncommitted: `package.json`, `package-lock.json`, `capacitor.config.json`, `public/privacy.html`, and the Welcome link.
2. **Decide whether to commit `android/`.** It's git-ignored, but Capacitor projects are usually committed. It must not contain keystores or passwords.
3. **Revoke the Gmail app password** that was shared in chat, then create a new one and enter it only in a local terminal.
4. **Choose an email provider name and a hosting provider name** for the privacy policy. Replace the placeholders in `public/privacy.html`.
5. **Host the backend on Render.** Choose free (for testing) or paid (for keeping data). Then set `VITE_API_URL` to the Render HTTPS address and rebuild.
6. **Create the Android upload key** (`keytool`, stored outside the repo). Configure Gradle signing, set `versionCode`, and build the `.aab`.
7. **Play listing:** icon (512 px, ready), feature graphic (1024×500, needed), at least two phone screenshots, data safety form, content rating, target audience.
8. **Closed testing:** add testers' emails, check the 12-tester and 14-day rule in Play Console, then share the opt-in link.
9. **Enable GitHub Pages** for the privacy page once its placeholders are filled. The URL will be `https://sunny250389.github.io/declare_card-game/privacy.html` if published from a `gh-pages` branch.
10. **Install check:** the PWA install needs HTTPS, so test it on the hosted site.

## Known limits

- Sign-up and sign-in need the backend to be reachable. Local play works without it.
- Rooms are held by one backend process, so run only one instance.
- The Android build allows plain HTTP only for local testing. The Play build must use HTTPS.
- The Gmail sending limit is small, which is fine for a few friends but not for public use.
- Headless Chrome narrow windows clip layouts. Check with device emulation instead.

## Session notes (for future work)

- Metro and the Vite dev server don't always pick up changes. Restart with `--clear` when the browser shows old code.
- Backend processes started in this session were sometimes stopped by the system under memory pressure. Restart them only when asked.
- `git push` needs the GitHub remote `origin` (`https://github.com/Sunny250389/declare_card-game.git`).
