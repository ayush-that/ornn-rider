# Engineer Boyfriend

<img width="1024" height="536" alt="og-banner" src="https://github.com/user-attachments/assets/fa5e6183-eee1-464b-af64-9392edda950d" />

Hill-climb bike game (live at https://engineerboyfriend.com) where the terrain is real market data from the [Ornn Data API](https://ornn-data.mintlify.app): GPU rental indices, memory spot prices, and per-lab token price indices. Ride the chart, collect coins, post your run to the leaderboard with your X account.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19 — app shell, and a server route (`src/routes/api/$.ts`) that proxies the Ornn API with the key injected server-side.
- [Phaser 3](https://phaser.io) + matter-js — the game (`src/lib/game`).
- [Convex](https://convex.dev) — leaderboards + auth (`convex/`), deployment `dusty-koala-401`.
- [Convex Auth](https://labs.convex.dev/auth) with the X (Twitter) OAuth provider.

## Run it

```bash
pnpm install
pnpm exec convex dev   # keep running: syncs convex/ functions to the dev deployment
pnpm dev               # app on http://localhost:3000 (or next free port)
```

`.env` needs `ORNN_API_KEY` (used by the API proxy). `.env.local` holds the Convex deployment URLs (written by `convex dev`).

## X (Twitter) sign-in setup

One-time, in the [X developer portal](https://developer.x.com):

1. Create an app with OAuth 2.0, type "Web App".
2. Callback URL: `https://dusty-koala-401.convex.site/api/auth/callback/twitter`
3. Scopes: `users.read tweet.read offline.access`.
4. Set the credentials on the Convex deployment:

```bash
npx convex env set AUTH_TWITTER_ID <client id>
npx convex env set AUTH_TWITTER_SECRET <client secret>
npx convex env set SITE_URL http://localhost:3000   # or the deployed app URL
```

## Leaderboards

Three boards — compute, memory, tokens — with per-track filters. Score = distance (m) + coins × 100 + flips × 500, recomputed server-side in `convex/leaderboard.ts` with sanity clamps. Posting requires X sign-in; playing doesn't.
