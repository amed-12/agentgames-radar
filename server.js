'use strict';

/**
 * Token-launch radar — HTTP server.
 *
 * Endpoints:
 *   GET /health        feed + store status (degraded: true when the
 *                      live feed is down and only samples are served)
 *   GET /radar         latest launches as JSON (?limit=, default 50)
 *   GET /radar.html    simple demo page (auto-refreshing table)
 *   GET /token/:mint   full detail: score, verdict, every signal
 *                      that drove it, and what could not be verified
 *
 * Observation and scoring only. No wallet, no trading, no
 * transactions — the agent never holds keys and never signs.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { TokenStore } = require('./src/store');
const { RadarFeed } = require('./src/feed');
const { Enricher } = require('./src/enrich');
const { SEEDS } = require('./src/samples');

const PORT = Number(process.env.PORT) || 18777;
const HOST = process.env.HOST || '0.0.0.0';
const STARTED_AT = Date.now();

const store = new TokenStore();
const enricher = new Enricher(store);

const feed = new RadarFeed((draft) => {
  const token = store.add(draft);
  enricher.enqueue(token);
  console.log(`[radar] ${token.symbol || token.name || token.mint.slice(0, 8)} -> ${token.verdict} (${token.score})`);
});

// Seeded samples first: the API is useful from the first second,
// even before the live feed connects.
for (const seed of SEEDS) store.add(seed);
feed.start();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function summarize(token) {
  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    score: token.score,
    verdict: token.verdict,
    marketCapSol: token.marketCapSol,
    bondingProgress: token.bondingProgress,
    seeded: token.seeded,
    firstSeenAt: token.firstSeenAt,
    reasonCount: token.reasons.length,
    unknownCount: token.unknowns.length,
  };
}

function detail(token) {
  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    uri: token.uri,
    creator: token.creator,
    score: token.score,
    verdict: token.verdict,
    marketCapSol: token.marketCapSol,
    liquiditySol: token.liquiditySol,
    bondingProgress: token.bondingProgress,
    socials: token.socials,
    metadataOk: token.metadataOk,
    enrichment: token.enrichment,
    reasons: token.reasons,
    unknowns: token.unknowns,
    seeded: token.seeded,
    source: token.source,
    firstSeenAt: token.firstSeenAt,
    lastUpdatedAt: token.lastUpdatedAt,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    const feedHealth = feed.health();
    return sendJson(res, 200, {
      status: 'ok',
      service: 'agentgames-radar',
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      feed: feedHealth,
      degraded: feedHealth.degraded,
      store: store.counts(),
      enricher: enricher.stats(),
    });
  }

  if (req.method === 'GET' && pathname === '/radar') {
    const limit = Number(url.searchParams.get('limit')) || 50;
    const tokens = store.list(limit).map(summarize);
    return sendJson(res, 200, {
      count: tokens.length,
      degraded: !feed.health().connected,
      tokens,
    });
  }

  if (req.method === 'GET' && pathname === '/radar.html') {
    const file = path.join(__dirname, 'public', 'radar.html');
    fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 500, { error: 'demo page missing' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/token/')) {
    const mint = decodeURIComponent(pathname.slice('/token/'.length));
    const token = store.get(mint);
    if (!token) return sendJson(res, 404, { error: 'token not in radar buffer', mint });
    return sendJson(res, 200, detail(token));
  }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(302, { Location: '/radar.html' });
    return res.end();
  }

  return sendJson(res, 404, { error: 'not found', hint: 'try /health, /radar, /radar.html, /token/:mint' });
});

server.listen(PORT, HOST, () => {
  console.log(`[radar] listening on http://${HOST}:${PORT} (feed starting, ${store.counts().seeded} seeded samples loaded)`);
});

process.on('SIGINT', () => {
  feed.stop();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  feed.stop();
  server.close(() => process.exit(0));
});
