# Production API base URL & environment switch (frontend)

The backend is now **deployed** (Railway). Point the frontend at the deployed
base URL in production instead of `http://localhost:3000`. Nothing about the
request/response shapes changed — only the host. Everything still lives under
the `/v1` version prefix and uses the same `Authorization: Bearer <token>` auth.

## Base URLs

| Environment | Base URL |
| --- | --- |
| Local dev | `http://localhost:3000` |
| Production | `https://REPLACE-WITH-YOUR-RAILWAY-DOMAIN.up.railway.app` |

> **Get the real production domain** from Railway → the `learning_vocab_backend`
> service → **Settings → Networking → Public Networking**. It looks like
> `https://<something>.up.railway.app`. Use **https** (not http) and **no port**
> — the public domain is served on 443; the internal `:8080` is not exposed.

All API calls are then `"<base>/v1/<path>"`, e.g.
`https://<domain>.up.railway.app/v1/auth/login`.

## Configure it (Next.js)

Drive the base URL from an env var so the same code works in both environments.

`.env.local` (dev):
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

Production env (Vercel/host dashboard or `.env.production`):
```
NEXT_PUBLIC_API_BASE_URL=https://<your-railway-domain>.up.railway.app
```

Usage:
```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

const res = await fetch(`${API_BASE}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
```

Do **not** hardcode `localhost` anywhere — it will silently fail in production.

## CORS — your origin must be whitelisted

Production CORS is **origin-restricted**. The backend only accepts browser
requests from origins listed in its `CORS_ORIGINS` env var. If your deployed
frontend origin (e.g. `https://your-app.vercel.app`) isn't in that list, the
browser blocks the call with a CORS error even though the API is healthy.

- Ask the backend owner to add your frontend origin(s) to `CORS_ORIGINS`
  (comma-separated) on the Railway service, then redeploy.
- Local dev (`CORS_ORIGINS` empty) allows any origin, so localhost works without
  setup.
- Credentials are enabled (`credentials: true`), so cookies/Authorization headers
  are allowed for whitelisted origins.

## Health check

`GET <base>/health` → `200 {"status":"ok"}` (version-neutral — note: **no** `/v1`
prefix). Handy for a connectivity smoke test or an "API is up" indicator before
hitting authenticated routes.

```ts
const ok = (await fetch(`${API_BASE}/health`)).ok;
```

## Gotchas

- **HTTPS only** in production — calling `http://` from an `https://` page is
  blocked as mixed content.
- **No trailing slash** on the base URL (`...up.railway.app`, not
  `...up.railway.app/`) — otherwise you'd build `//v1/...`.
- **Trial uptime:** while the backend runs on Railway's free trial, the service
  may go offline if the trial credit/time runs out. If every request suddenly
  fails (not a CORS error, but connection refused/timeout), the backend is
  probably down, not your code.
- Unversioned routes are only `GET /` and `GET /health`; **every** other route is
  under `/v1`.
