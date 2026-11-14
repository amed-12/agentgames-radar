# Agent Games — Wildcard Submission: Token Launch Radar

**Agent link:** https://github.com/amed-12/agentgames-radar
**Public endpoint:** https://18777-agq5ymqecxx7ouvendzaldira4.instabox.tech
**Demo page:** https://18777-agq5ymqecxx7ouvendzaldira4.instabox.tech/radar.html

## Use case

New tokens launch on pump.fun every few seconds, and most traders still check
them by hand: open each mint, read the bonding curve, guess whether the
deployer is about to dump. By the time a human finishes checking one token,
twenty more have launched.

Token Launch Radar watches every new launch in real time and flags the risky
ones before anyone puts money in: impersonators copying known tickers,
launches with no public presence, live mint/freeze authorities, and
concentrated creator supply. It helps Solana traders and researchers triage
the firehose — what deserves a closer look, and what to avoid.

## What it does

- Subscribes to the PumpPortal websocket for new-token creation events.
- Scores each launch 0–100 across 9 deterministic signals and issues a
  verdict — WATCH (<35), CAUTION (35–64), AVOID (≥65) — with the exact
  reasons listed.
- Serves results over HTTP: `/health`, `/radar`, `/radar.html` (live demo
  page), `/token/:mint` (verdict explanation).
- Observation only: no wallet, no trading, no transactions.

## Build context

- Node.js, two dependencies (`ws`, `https-proxy-agent`). Pipeline: live feed
  → normalize → enrich (token metadata, DexScreener, Solana RPC) → score →
  200-token ring buffer → HTTP API.
- Deterministic rule engine, no LLM in the critical path: every verdict is
  reproducible and explainable from the signals that produced it.
- Proxy-optional outbound plumbing: an explicit proxy agent when a proxy is
  configured, direct connections otherwise — the same code runs behind an
  egress proxy and on an open cloud machine.
- Degraded mode is explicit: if the live feed drops, `/health` reports
  `degraded: true` and the API serves clearly-labelled seeded samples
  instead of pretending the data is live.

## Limitations

- Holder concentration is usually "unknown": the public Solana RPC
  rate-limits `getTokenLargestAccounts`.
- DexScreener enrichment returns nothing for fresh bonding-curve tokens —
  they are not indexed until graduation.
- A WATCH verdict means "nothing alarming found", not "safe".

## zkVerify

Not used. The agent's claims are checkable without it: the public endpoint
serves live verdicts, and the deterministic scorer in `src/scorer.js`
reproduces any verdict from its inputs.

## Try it

```sh
curl https://18777-agq5ymqecxx7ouvendzaldira4.instabox.tech/health
curl "https://18777-agq5ymqecxx7ouvendzaldira4.instabox.tech/radar?limit=5"
curl https://18777-agq5ymqecxx7ouvendzaldira4.instabox.tech/token/<mint>
```
