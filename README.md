# Token Launch Radar

A radar agent for new pump.fun token launches: it watches launches in real
time, scores each one for risk with plain-language reasons, and serves the
results over HTTP. Built for the zkVerify Agent Games **Wildcard** track.

Observation and scoring only. **No wallet, no trading, no transactions.**
The agent never holds keys and never signs anything.

## The problem

Dozens of new tokens launch on pump.fun every minute. Most are worthless or
actively hostile: copycat symbols designed to catch mistaken buys, creators
holding huge chunks of supply, mint authorities left enabled so supply can be
inflated after people buy in. A newcomer opening a launch list has no fast way
to tell a legitimate experiment from a trap.

## Who it helps

- **Retail Solana users** deciding whether a brand-new token deserves a
  second look — the radar answers in seconds, with reasons, not just a number.
- **Researchers and moderators** triaging the firehose of launches.
- **Anyone learning** what makes a launch risky: every verdict explains
  itself, so the radar doubles as a checklist.

## How it works

```
PumpPortal websocket ──> normalize ──> score ──> HTTP API + demo page
(subscribeNewToken)        (rules)      │
                                       └─> enrich (best-effort):
                                           metadata, DexScreener, Solana RPC
```

1. **Feed.** The agent subscribes to PumpPortal's public keyless websocket
   (`wss://pumpportal.fun/api/data`, `subscribeNewToken`) and receives every
   new token creation event in real time.
2. **Score.** Each launch is scored immediately from the launch data by a
   deterministic rule engine (see below). No LLM calls in the critical path —
   the same facts always produce the same score and reasons.
3. **Enrich.** A small paced queue enriches each token from free public
   sources: token metadata (social links), DexScreener (price/liquidity once
   a pool exists), and Solana RPC (mint/freeze authority, holder
   concentration). Every enrichment step is best-effort; a failure leaves
   that signal "unknown" instead of failing the token.
4. **Serve.** The latest 200 launches are kept in an in-memory ring buffer
   and served over HTTP (see Endpoints). A simple demo page renders the
   radar as a table with per-token explanations.

If the live feed is unreachable, the radar keeps serving clearly-labelled
**seeded samples** and reports `degraded: true` in `/health`. It never
presents sample data as live data.

## Risk signals

The score is a **risk score from 0 to 100** (higher = riskier), starting at
a neutral 50. Each signal moves the score and adds a plain-language reason.

| Signal | What it checks | Effect |
|---|---|---|
| Impersonation | Symbol/name copies a well-known token (SOL, USDC, BONK, WIF, JUP, RAY) | +35 exact symbol, +20 name match |
| Bonding-curve progress | How far along the launch is | +10 if <10% filled, +3 if <50%, −10 if ≥80% |
| Liquidity | Virtual SOL reserves / market cap on the curve | +15 if none, +8 if mcap <1 SOL, −5 if mcap ≥20 SOL |
| Mint authority | Creator can still print more supply (via Solana RPC) | +15 enabled, −8 revoked |
| Freeze authority | Creator can still freeze holder accounts (via RPC) | +10 enabled, −5 revoked |
| Holder concentration | Share of supply in the largest wallet (via RPC) | +20 if >30%, +10 if >15%, −5 if <5% |
| Creator concentration | Creator wallet is the largest holder (via RPC) | +8 |
| Social links | Any Twitter / Telegram / website in metadata | +10 if none, −5 if present |
| Metadata | Metadata JSON definitively missing/invalid (gateway blocks from this host leave it unknown, not penalized) | +5 |
| DEX liquidity | Real pool liquidity after graduation (DexScreener) | −3 if >$1,000 |

Signals that cannot be verified (e.g. RPC unreachable) are listed under
`unknowns` in the API response and never move the score silently.

### Verdict thresholds

| Score | Verdict | Meaning |
|---|---|---|
| 0–34 | `WATCH` | Nothing alarming found |
| 35–64 | `CAUTION` | One or more yellow flags — look closer before acting |
| 65–100 | `AVOID` | Strong or multiple red flags |

## Endpoints

| Method & path | Description |
|---|---|
| `GET /health` | Status, feed state (`degraded` flag), store/enricher stats |
| `GET /radar?limit=50` | Latest launches, newest first (JSON summaries) |
| `GET /radar.html` | Auto-refreshing demo page |
| `GET /token/:mint` | Full detail: score, verdict, every reason, unknowns, enrichment |
| `GET /` | Redirects to `/radar.html` |

## Key decisions

- **Rules, not a model.** Risk calls must be reproducible and explainable.
  A deterministic scorer gives the same answer every time and every point
  of the score is traceable to a named signal.
- **Unknowns are first-class.** Free public data fails often (RPC rate
  limits, unindexed tokens, dead metadata). Hiding that would make the
  radar look more confident than it is, so every unverifiable signal is
  reported explicitly.
- **Degrade, don't die.** The feed, the enricher, and each enrichment
  source fail independently. The radar serves what it has and says so.
- **Minimal dependencies.** Plain Node `http` + `ws` + `https-proxy-agent`
  only — fewer moving parts, faster review.
- **Proxy-aware, proxy-optional.** All outbound traffic (websocket and
  HTTPS) goes through an explicit proxy agent when `RADAR_PROXY_URL`
  (or the standard `*_PROXY` variables) is set, and direct otherwise —
  so the same code runs on a proxied host and on an open VPS.
- **No persistence.** A 200-token ring buffer is enough for a radar; a
  restart refills from the live feed within seconds.

## What it can and cannot do

**Can:** surface new launches within seconds; flag impersonators,
concentrated supply, live mint/freeze authorities, and launches with no
public presence; explain every verdict in plain language.

**Cannot:** guarantee a token is safe (a `WATCH` verdict means "nothing
alarming found", not "safe"); see holder-count growth over time (no
reliable free source — holder *concentration* is used instead); verify
off-chain claims (team identity, real-world backing); detect novel scam
patterns outside its signal list. Scores are a triage aid, not financial
advice.

**Known live limitation (verified 2026-11-15):** the public Solana RPC
endpoint rate-limits `getTokenLargestAccounts` (HTTP 429) and the fallback
endpoint requires a personal token for indexed calls, so the holder
concentration signal is usually `unknown` in practice. The code implements
the check and populates it whenever the endpoint allows; the verdict never
pretends otherwise.

## Run it

```sh
npm install
node server.js            # listens on PORT (default 18777)
```

Then open http://localhost:18777/radar.html, or:

```sh
curl localhost:18777/health
curl localhost:18777/radar?limit=5
curl localhost:18777/token/<mint>
```

Run the scorer smoke test (three representative tokens, asserted verdicts):

```sh
npm test
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `18777` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `RADAR_PROXY_URL` | egress proxy from environment | Outbound proxy for feed + enrichment (credentials stripped) |

No secrets are required. There is no `.env` file and no API key anywhere.

## Layout

```
server.js            HTTP server + wiring
src/
  feed.js            PumpPortal websocket client + reconnect + normalization
  scorer.js          deterministic rule engine (pure, no I/O)
  store.js           200-token ring buffer + rescoring
  enrich.js          metadata / DexScreener / Solana RPC enrichment queue
  proxy.js           explicit proxy agent + JSON fetch helper
  samples.js         labelled seeded samples for degraded/demo mode
public/
  radar.html         demo page (no external assets)
test-scorer.js       scorer smoke test
```

## License

MIT.
