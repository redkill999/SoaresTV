# live-relay

Standalone Node.js 20 + Fastify service that streams MPEG-TS Live channels
from **suportejetflix.site** to the browser for the Lovable web app when the
managed runtime cannot deliver long-lived progressive bodies.

This service is **isolated**. It only handles:

- host `suportejetflix.site`
- Live (`.ts`) streams
- Web Desktop browsers

The APK, Android TV, Movies, Series, categories, and every other provider
inside the Lovable app **do not** touch this service.

---

## How it fits together

```
Browser ── GET /api/live-token ─────────────► Lovable app  (HMAC signs a token
                                                            with providerId,
                                                            streamId, exp, nonce)
Browser ── GET <RELAY>/live/<token> ────────► live-relay   (verifies HMAC,
                                                            reconstructs upstream
                                                            URL with env creds,
                                                            pipes one connection)
live-relay ── GET https://suportejetflix.site/live/USER/PASS/ID.ts (single upstream)
```

- Credentials (`PROVIDER_USER` / `PROVIDER_PASS`) live only on the relay
  process. They never appear in the token, in the URL the browser sees,
  in headers, or in any log line.
- Token TTL is 60 seconds (issued by the Lovable app).
- Closing the browser tab aborts the upstream immediately.

---

## Deploy

### 1. Configure the shared secret

Pick a strong random string and store it in **two** places with the exact
same value:

- Inside the Lovable app: Cloud → Secrets → `LIVE_RELAY_TOKEN_SECRET`.
- In the relay environment: `LIVE_RELAY_TOKEN_SECRET`.

### 2. Configure the relay environment

Copy `.env.example` to `.env` and fill in every variable — see comments
in the file. The most important:

| Variable                    | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `LIVE_RELAY_TOKEN_SECRET`   | HMAC key, must match the app.                        |
| `PROVIDER_USER`             | Xtream username for the account you want streamed.   |
| `PROVIDER_PASS`             | Xtream password for that account.                    |
| `PROVIDER_HOST`             | Allowlisted upstream host (default suportejetflix).  |
| `ALLOWED_ORIGINS`           | Comma list of browser Origins allowed to consume.    |
| `FIRST_BYTE_TIMEOUT_MS`     | Fail fast if upstream is silent (default 8000).      |
| `MAX_CONCURRENT`            | Cap on simultaneous upstream connections.            |

### 3. Run

**Local:**

```bash
cd live-relay
npm install
npm run dev
# open http://localhost:8787/health
```

**Docker:**

```bash
docker build -t live-relay .
docker run --rm -p 8787:8787 --env-file .env live-relay
```

**Fly.io / Render / Railway / VPS:** any Node.js 20 host that supports
long-lived HTTP connections works. Serverless platforms that buffer the
whole response (Vercel/Netlify/Cloudflare Workers) are **not** suitable —
that is the exact problem this service exists to work around.

### 4. Point the Lovable app at the relay

In the Lovable project, add a build variable:

```
VITE_LIVE_RELAY_BASE_URL=https://your-relay.example.com
```

Then re-publish the app. The app will start minting tokens and requesting
`${VITE_LIVE_RELAY_BASE_URL}/live/<token>` **only** for suportejetflix Live
on Web Desktop.

---

## Endpoints

### `GET /health`
Returns `{ ok, version, providerHost, activeConnections, maxConcurrent }`.

### `GET /live/:token`
Verifies the token, opens a single upstream, and pipes MPEG-TS bytes
progressively. Response headers:

- `Content-Type: video/mp2t`
- `Cache-Control: no-store, no-cache, must-revalidate, no-transform`
- `X-Accel-Buffering: no`
- `X-Live-Relay-Version: v1`
- `X-Live-Relay-Upstream-Status: <n>`

Never sent: `Content-Length`, `Content-Encoding`, `Transfer-Encoding`,
`Connection`, `Keep-Alive`, `Accept-Ranges`.

---

## Security

- HMAC-SHA256 token verification with timing-safe compare.
- SSRF guard: refuses to open connections against private, loopback,
  link-local, CGNAT, or multicast addresses.
- Explicit provider host allowlist (`PROVIDER_HOST`).
- Origin allowlist for browser callers.
- Per-IP rate limit (default 60 req / minute).
- Concurrent connection cap (default 50).
- Structured logs redact any accidental token/user/pass/URL fields.
- No credential, no URL, no token payload is ever logged.

---

## Troubleshooting

- **401 TOKEN_INVALID** — the HMAC secret does not match, or the token
  expired (60 s TTL). Re-issue by reopening the channel.
- **403 HOST_NOT_ALLOWED / ORIGIN_NOT_ALLOWED** — `PROVIDER_HOST` or
  `ALLOWED_ORIGINS` misconfigured.
- **502 FIRST_BYTE_TIMEOUT** — upstream did not send any bytes within
  `FIRST_BYTE_TIMEOUT_MS`; check provider status.
- **503 TOO_MANY_CONNECTIONS** — raise `MAX_CONCURRENT` if capacity allows.
