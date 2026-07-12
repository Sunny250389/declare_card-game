# Declare

Declare is a cross-platform iOS and Android card game built with Expo React Native.

## What is included

- Local pass-and-play match flow for 2-6 players.
- Human and AI players with easy, medium, and hard decision strategies.
- Full core rule engine for draw, discard, declare, round scoring, same-rank bonus, and match end at 100 points.
- Mobile screens for home, setup, gameplay, round result, match result, statistics, settings, and online lobby entry.
- FastAPI/WebSocket backend scaffold for authoritative online multiplayer events.

## Run the mobile app

Install dependencies with Node.js and npm, then run:

```bash
npm install
npm start
```

Use Expo to open the app on iOS or Android.

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
