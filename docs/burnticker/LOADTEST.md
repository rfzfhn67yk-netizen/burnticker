# Launch-day load test, caching and the static fallback

Owner-approved 2026-10-10 (night), trust-ops item 7. The box is a small VPS (2 vCPU, 4 GB, no swap) behind Cloudflare and Caddy;
the Next app (`mct-burnticker-web`) is the only dynamic piece. This page holds the pass bar, how to run the test, the caching plan
(origin headers + the Cloudflare cache rules the owner applies by hand), the fallback when the app is down, and every run's numbers
(appended by the script, newest at the bottom).

## Pass bar

Before launch day, from the Mac against the live box: **50 requests per second, mixed, for 30 seconds — p95 under 800 ms, zero 5xx,
zero timeouts**, with the box's available memory staying above 1 GB. The mix is the launch-day path: landing page (20 %), a coin page
(25 %), that coin's API document (20 %), the token list (10 %), search (15 %, a fixed query — a heavy-bucket route), a static page
(10 %), plus the receipt verifier at a fixed 0.25 per second (it re-reads devnet and the Treasury on every call).

## How to run

```sh
sh scripts/ops/loadtest.sh                                  # warm-up 10 RPS × 20 s, 25 RPS × 30 s, then 50 RPS × 30 s; prints the report
sh scripts/ops/loadtest.sh --write                          # … and appends it below
sh scripts/ops/loadtest.sh --stages 50x60 --bar rps=50,p95=800,5xx=0
```

`scripts/ops/loadtest.mjs` is dependency-free (Node's `fetch`; nothing is downloaded — no k6, no autocannon) and open-loop: requests
start on schedule whatever the latency, so a slow box shows up as latency and errors, not as a quietly lower rate. It samples the box's
`free -m`, load average and `top` over ssh every 8 s (read-only; needs ssh to the box — `BURNTICKER_HOST`, `BURNTICKER_SSH`). 429s are the API's
per-client limiter answering (all test traffic comes from one address) and are counted apart from errors.

## Caching plan

### What the origin sends (as of 2026-10-11)

| Path | Cache-Control | Set by |
|---|---|---|
| `/`, `/t/*`, `index.json`, `status/*`, `ops.json`, `audit.json`, `/deficit/*` (the static receipts site) | `no-store` | Caddy `(static_site)` — receipts are never stale |
| `/burnticker`, `/burnticker/*` (app page shells) | was `s-maxage=31536000` (Next's prerender default) → **`public, max-age=0, s-maxage=60, stale-while-revalidate=300`** | Caddy `header_down` rewrite (this batch) |
| `/_next/static/*` | `public, max-age=31536000, immutable` | Next (content-hashed files) |
| `/api/burnticker/v1/*` GET | `public, max-age=N, s-maxage=N, stale-while-revalidate=N` with N per endpoint (30–3600 s) | `src/lib/burnticker/api/spec.ts` → `runV1` |
| `/api/burnticker/v1/*` POST, any error | `no-store` | `runV1` |
| other `/api/burnticker/*` (the wizard's and the trust page's own routes) | none, or short `public, max-age=30` | the route |

Why the page rewrite: a page shell kept for a year at a CDN would reference `/_next/static` chunks that the next deploy removes,
and the page would break for everyone that edge serves. 60 seconds at the edge plus five minutes of stale-while-revalidate absorbs a
launch spike without that risk.

### Cloudflare cache rules (owner: apply in the dashboard, zone burnticker.com → Caching → Cache Rules, in this order)

1. **Static assets** — `starts_with(http.request.uri.path, "/_next/static/")` → Eligible for cache; Edge TTL: use cache-control
   header if present; Browser TTL: respect origin.
2. **Brand files** — `starts_with(http.request.uri.path, "/brand/") or starts_with(http.request.uri.path, "/burnticker/brand/")` →
   Eligible for cache; Edge TTL 1 day; Browser TTL 1 hour.
3. **Public API reads** — `starts_with(http.request.uri.path, "/api/burnticker/v1/") and http.request.method eq "GET" and not
   starts_with(http.request.uri.path, "/api/burnticker/v1/launch/")` → Eligible for cache; Edge TTL: **use cache-control header if
   present, bypass cache if not**; cache key: include the full query string. (Every v1 GET sets its own TTL; an error is `no-store`.)
4. **App page shells** — `http.request.uri.path eq "/burnticker" or starts_with(http.request.uri.path, "/burnticker/")` and method GET
   → Eligible for cache; Edge TTL: use cache-control header if present, bypass cache if not (the origin now says 60 s).
5. **Receipts, status, everything else** — no rule (Cloudflare's default does not cache HTML or JSON without one, and the origin says
   `no-store`). Do NOT add a "Cache Everything" rule for `/`: the static receipts site must never be stale.

Not cached anywhere: POSTs (Cloudflare never caches them), `/api/burnticker/*` outside v1 without a rule, the status host.

### Finding: the API's per-client limiter sees Cloudflare, not the client

**Fixed in code 2026-10-12 (ops-2):** `src/lib/burnticker/api/clientIp.ts` keys on `CF-Connecting-IP` when the right-most hop is a
Cloudflare edge (published ranges), else on the socket address; tests in `test/burntickerClientIp.test.ts`; cut-over steps in
`docs/burnticker/OPS-EDGE.md`. The text below is the original finding.

`src/lib/burnticker/api/http.ts` keys the rate limit on the right-most `X-Forwarded-For` hop — the address Caddy itself appends. Behind
Cloudflare that is the **Cloudflare edge's** address, so every visitor routed through the same edge shares one bucket: on launch day a
popular edge would exhaust the heavy bucket (20 per minute: search, back-tests, the verifier) for everyone behind it. Fix (not made
in this batch; it touches the security-sensitive client-key logic): in the Caddyfile's global options set `servers { trusted_proxies
static <Cloudflare's published ranges> ; client_ip_headers CF-Connecting-IP }`, pass `header_up X-Real-IP {client_ip}` to the app, and
key the limiter on `X-Real-IP` first — and close direct origin access to 80/443 from outside Cloudflare (or the header can be forged).

## Static fallback when the app is down

`site/burnticker/fallback/index.html` (B1 receipt style, the landing's tokens): "The app is catching up. Receipts and the program are
unaffected", the program ids and live coins' mints with Solscan links (from `/.well-known/burnticker.json` and the keeper's
`index.json`, both static), links to the static coin list, the status page and the whitepaper. Caddy serves it with **503** and
`Retry-After: 30` when the app is unreachable, times out (3 s to connect, 20 s to first byte) or a page answers 5xx; `/api/burnticker/*`
gets a JSON 503 with the same sentence when the app is unreachable, while the API's own 5xx answers (a venue switched off, an upstream
source down) pass through unchanged. `sh scripts/ops/deploy-sites.sh --pages-only` ships it (and every `--publish-only` timer run keeps
it in place).

## Runs

### Run 2026-10-11 02:44 UTC — PASS against https://burnticker.com

Bar: last stage at ≥ 50 RPS mixed, p95 < 800 ms, 0 5xx/timeouts. Coin used: $DEFICIT. Peak requests in flight: 12.

| Stage | RPS × s | Requests | 2xx/3xx | 4xx (not 429) | 429 | 5xx | Timeouts | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 10 × 20 | 205 | 156 | 40 | 9 | 0 | 0 | 166 | 253 | 550 | 1436 |
| 2 | 25 × 30 | 757 | 469 | 113 | 175 | 0 | 0 | 164 | 180 | 227 | 1437 |
| 3 | 50 × 30 | 1507 | 850 | 45 | 612 | 0 | 0 | 166 | 198 | 231 | 355 |

Per route, last stage (50 RPS):

| Route | Path | Requests | 2xx/3xx | 4xx | 429 | 5xx | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|
| landing | `/` | 300 | 300 | 0 | 0 | 0 | 163 | 192 |
| coin-page | `/burnticker/t/DEFICIT` | 375 | 375 | 0 | 0 | 0 | 168 | 198 |
| v1-token | `/api/burnticker/v1/tokens/DEFICIT` | 300 | 0 | 45 | 255 | 0 | 160 | 172 |
| v1-search | `/api/burnticker/v1/search?q=broncos` | 225 | 10 | 0 | 215 | 0 | 224 | 346 |
| static-page | `/whitepaper.html` | 150 | 150 | 0 | 0 | 0 | 167 | 191 |
| v1-tokens | `/api/burnticker/v1/tokens` | 150 | 15 | 0 | 135 | 0 | 160 | 176 |
| v1-verifier | `/api/burnticker/v1/check/receipts/3gBYyBbz…` | 7 | 0 | 0 | 7 | 0 | — | — |

Box resources during the run (`free -m`, `top -bn1`, over ssh every ~10 s):

| Time (UTC) | RAM used MB / total | available MB | load 1 min | CPU idle % | top process |
|---|---|---|---|---|---|
| 02:44:59 | 915 / 3809 | 2894 | 0.28 | 65.0 | caddy 10.0% |
| 02:45:09 | 929 / 3809 | 2880 | 0.23 | 77.3 | caddy 9.1% |
| 02:45:19 | 929 / 3809 | 2879 | 0.20 | 95.0 | next-se+ 20.0% |
| 02:45:29 | 955 / 3809 | 2853 | 0.17 | 90.9 | next-se+ 18.2% |
| 02:45:39 | 979 / 3809 | 2829 | 0.14 | 79.2 | tailsca+ 9.1% |
| 02:45:49 | 993 / 3809 | 2815 | 0.20 | 77.3 | next-se+ 27.3% |
| 02:45:59 | 1004 / 3809 | 2804 | 0.17 | 85.0 | caddy 20.0% |
| 02:46:09 | 1044 / 3809 | 2764 | 0.22 | 80.0 | caddy 20.0% |
| 02:46:19 | 1041 / 3809 | 2767 | 0.19 | 95.2 | tailsca+ 10.0% |
**Reading this run (2026-10-11 02:44 UTC, the first; the box before the trust-ops deploy):**

- PASS on the bar: 0 5xx, 0 timeouts, p95 198 ms at 50 RPS mixed (p50 166 ms, which is mostly the Denver → Falkenstein round trip:
  the limiter's own 429s answer in the same ~160 ms). The box never noticed: available memory 2.76–2.89 GB of 3.8 GB, CPU idle ≥ 65 %,
  load ≤ 0.28; Caddy and the Next server took turns at the top at 10–27 % of one core.
- The page side is cheap by construction: the landing and the whitepaper are static files, and the coin page is a prerendered shell
  (Next cache HIT) whose data loads from the API in the visitor's browser.
- **The API side was mostly answered by the limiter, not the app**: from one address the read bucket (120 burst, 2 per second) and the
  heavy bucket (20 burst, 20 per minute) ran dry within seconds — 612 of the last stage's 1,507 requests were 429s, including 255 of 300
  `/v1/tokens/DEFICIT`, 215 of 225 searches and all 7 verifier calls. So this run does not measure the app's dynamic capacity; it does
  show the limiter holding. (No coins are registered on the box yet: `/v1/tokens/DEFICIT` answers 404 and `/v1/tokens` an empty list,
  so the registry path is light. Re-run once the rehearsal coin exists.)
- **Launch-day risk this exposes:** behind Cloudflare the limiter keys on the Cloudflare edge's address (see "Finding" above), so every
  visitor behind one edge shares those 2 reads per second. A coin page makes several API reads; a few dozen visitors on one edge would
  start seeing 429s. Fix the client key before launch day, then re-run this test from two or more addresses.
