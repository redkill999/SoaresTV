# live-relay — MPEG-TS relay for suportejetflix.site (Web Desktop)

Standalone Node.js 20 + Fastify service. Runs **outside** the Lovable app, on
infrastructure with a **static public IPv4**. Its only job is to open a single
long-lived MPEG-TS connection to the IPTV provider and pipe bytes progressively
to the browser.

Only these flows use it:
- host `suportejetflix.site`
- Live channels (MPEG-TS)
- Web Desktop browser

APK, Android TV, movies, series, other providers do **not** touch this service.

## Why this exists

The published Lovable runtime (Cloudflare Worker edge) does not deliver
long-lived progressive MPEG-TS bodies to the browser: headers arrive but the
body never streams. In addition, the provider's Cloudflare policy rejects the
published deployment's egress IP with HTTP 403. Both problems are solved by
running the relay on a normal Node.js host with a fixed IPv4 that the provider
whitelists.

## Security model

- **AES-256-GCM opaque token.** The Lovable backend encrypts
  `{host, port, protocol, username, password, streamId, expiresAt, nonce}` with
  `LIVE_RELAY_ENCRYPTION_KEY`. The browser never sees the URL or credentials —
  only the base64url ciphertext.
- **60-second token TTL** and **single-use nonce** (replay-protected 5 min).
- **Host allowlist** enforced against the decrypted `host`.
- **SSRF guard**: DNS resolution + block private / loopback / link-local /
  cloud-metadata ranges.
- **CORS**: only origins in `ALLOWED_ORIGINS` may call `/live/:token`.
- **Rate limit** per IP + `MAX_CONCURRENT` cap.
- **Sanitized logs** (Pino redact): URL, user, password, token never appear.

## Files

```
live-relay/
├── src/
│   ├── server.ts       # Fastify entry point
│   ├── token.ts        # AES-256-GCM verification
│   ├── ssrf-guard.ts   # DNS + private-range guard (also exported as ssrf.ts)
│   └── ssrf.ts         # re-export alias
├── Dockerfile
├── docker-compose.yml
├── healthcheck.sh
├── .env.example
├── package.json
└── tsconfig.json
```

## Deploy — step by step

### 1. Generate `LIVE_RELAY_ENCRYPTION_KEY`

```
openssl rand -base64 48
```

Put the **same value** in:
- Lovable Cloud → Secrets → `LIVE_RELAY_ENCRYPTION_KEY`
- the relay host env (`.env` beside `docker-compose.yml`)

Never expose this key to the browser. Do **not** create a `VITE_LIVE_RELAY_ENCRYPTION_KEY`.

### 2. Provision a host with static IPv4

Use a VPS, dedicated server or L4 load balancer — any provider that gives you
a **stable public IPv4** and allows long-lived HTTP responses. Serverless
runtimes that buffer responses are **not** supported.

Confirm the IP is stable:

```
curl -4 https://ifconfig.io
```

### 3. Ask the IPTV provider to whitelist that IPv4

This is the definitive fix for the 403. Send the provider the exact IPv4 with
a note that it will be the sole egress IP of the Web relay. Do **not** attempt
to bypass Cloudflare with IP rotation, spoofed X-Forwarded-For, cookies or
alternative DNS — those are blocked by design.

### 4. Configure the relay

```
cp .env.example .env
# edit LIVE_RELAY_ENCRYPTION_KEY, ALLOWED_UPSTREAM_HOSTS, ALLOWED_ORIGINS
```

### 5. Run

```
docker compose up -d --build
./healthcheck.sh http://127.0.0.1:8787/health
```

Expected:

```
healthy: {"ok":true,"version":"v2-aes-gcm",...}
```

### 6. Test upstream connectivity directly from the relay host

Before wiring the frontend, verify the provider accepts this IP:

```
curl -v -I "https://<provider-host>/live/<user>/<pass>/<streamId>.ts" \
     -H "User-Agent: XCIPTV/7.0 (Linux; Android 13)"
```

- HTTP 200 + `Content-Type: video/mp2t` → IP was whitelisted, proceed.
- HTTP 403 → IP still blocked. Do **not** deploy the frontend integration yet.

### 7. HTTPS

Terminate TLS with Caddy, Nginx or Cloudflare Tunnel in front of the relay.
The browser must reach `https://relay.example.com/live/<token>`. Modern
browsers refuse mixed content from an HTTPS Lovable page.

### 8. Configure the app

Set the following Lovable **build** secret (Workspace → Build Secrets):

```
VITE_LIVE_RELAY_BASE_URL=https://relay.example.com
```

Re-publish the Lovable project. Without this variable, the frontend never
attempts the external relay path — every other player behavior is unchanged.

### 9. Verify end to end

Open the published site → Live tab → open a channel on a **desktop browser**.
The player will:

1. request `/api/live-relay-token`
2. open `https://relay.example.com/live/<token>` with MPEGTS.js
3. show `firstFrameReceived=true` within ~2 s

If the relay returns HTTP 403 → the provider still hasn't authorized this IP.

## Runtime endpoints

| Method | Path              | Purpose                              |
| ------ | ----------------- | ------------------------------------ |
| GET    | `/health`         | Liveness + counters (no auth)        |
| GET    | `/live/:token`    | Progressive MPEG-TS stream           |
| OPTIONS| `/live/:token`    | CORS preflight                       |

## Error contract

| Status | Code                     | Meaning                                                |
| ------ | ------------------------ | ------------------------------------------------------ |
| 401    | `TOKEN_INVALID`          | Token expired / mangled / wrong key                    |
| 401    | `NONCE_REPLAY`           | Token already used                                     |
| 403    | `ORIGIN_NOT_ALLOWED`     | Browser Origin not in allowlist                        |
| 403    | `HOST_NOT_ALLOWED`       | Decrypted host not in `ALLOWED_UPSTREAM_HOSTS`         |
| 403    | `UPSTREAM_FORBIDDEN`     | Provider rejected the relay IP — request whitelisting  |
| 400    | `SSRF_BLOCKED`           | Host resolved to a private/loopback range              |
| 502    | `FETCH_ERROR`            | Network error connecting to upstream                   |
| 502    | `FIRST_BYTE_TIMEOUT`     | Upstream accepted but sent no bytes within timeout     |
| 503    | `TOO_MANY_CONNECTIONS`   | Local concurrency cap reached                          |

## What this relay never does

- No `text()` / `arrayBuffer()` / `blob()` on the upstream body.
- No in-memory buffering of the full stream.
- No automatic retry after HTTP 403.
- No logging of URL / user / password / token / full response body.
- No connection to APK / Android TV / movies / series / other providers.
