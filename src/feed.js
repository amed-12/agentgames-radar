'use strict';

/**
 * Live launch feed from the PumpPortal websocket.
 *
 * The socket is public and keyless: after connecting we send
 * `{"method":"subscribeNewToken"}` and creation events arrive in
 * real time. The `ws` library needs an explicit proxy agent on this
 * host — a direct connection fails — so the agent from proxy.js is
 * passed to every connection attempt.
 *
 * Reconnects use exponential backoff (5s, x1.5, capped at 60s).
 * If the feed is down, the radar keeps serving seeded samples and
 * reports degraded: true in /health — it never pretends the feed
 * is live when it is not.
 */

const WebSocket = require('ws');
const { proxyAgent } = require('./proxy');
const { INITIAL_VIRTUAL_TOKENS, GRADUATION_SOL } = require('./store');

const WS_URL = 'wss://pumpportal.fun/api/data';
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

/**
 * Normalize one PumpPortal creation event into a token draft.
 * Field names vary slightly between event shapes, so several
 * aliases are accepted. Returns null for non-creation payloads.
 */
function normalizeEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const isCreate = payload.txType === 'create' || (!payload.txType && payload.mint && (payload.name || payload.symbol));
  if (!isCreate || !payload.mint) return null;

  const marketCapSol = num(pick(payload, ['marketCapSol', 'market_cap_sol']));
  const liquiditySol = num(pick(payload, ['vSolInBondingCurve', 'virtualSolReserves', 'realSolReserves']));
  const virtualTokens = num(pick(payload, ['vTokensInBondingCurve', 'virtualTokenReserves']));

  let bondingProgress = null;
  if (virtualTokens !== null && virtualTokens > 0 && virtualTokens <= INITIAL_VIRTUAL_TOKENS) {
    bondingProgress = 1 - virtualTokens / INITIAL_VIRTUAL_TOKENS;
  } else if (marketCapSol !== null && marketCapSol >= 0) {
    bondingProgress = Math.min(1, marketCapSol / GRADUATION_SOL);
  }

  const socials = {
    twitter: payload.twitter || '',
    telegram: payload.telegram || '',
    website: payload.website || '',
  };
  const hasSocialFields = payload.twitter !== undefined || payload.telegram !== undefined || payload.website !== undefined;

  return {
    mint: payload.mint,
    name: payload.name || '',
    symbol: payload.symbol || '',
    uri: payload.uri || null,
    // Creation events name the creator wallet `traderPublicKey`.
    creator: payload.creator || payload.traderPublicKey || null,
    marketCapSol,
    liquiditySol,
    bondingProgress,
    socials: hasSocialFields ? socials : null,
    metadataOk: null,
    source: 'live',
    firstSeenAt: Date.now(),
  };
}

class RadarFeed {
  constructor(onToken) {
    this.onToken = onToken;
    this.ws = null;
    this.stopped = false;
    this.reconnectTimer = null;
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.connected = false;
    this.lastConnectedAt = null;
    this.lastEventAt = null;
    this.lastError = null;
    this.reconnects = 0;
    this.messagesSeen = 0;
    this.tokensSeen = 0;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  connect() {
    if (this.stopped) return;
    this.ws = new WebSocket(WS_URL, { agent: proxyAgent(), handshakeTimeout: 15000 });

    this.ws.on('open', () => {
      this.connected = true;
      this.lastConnectedAt = Date.now();
      this.lastError = null;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      console.log('[feed] connected to PumpPortal, subscribed to new tokens');
    });

    this.ws.on('message', (raw) => {
      this.messagesSeen += 1;
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const draft = normalizeEvent(payload);
      if (!draft) return;
      this.lastEventAt = Date.now();
      this.tokensSeen += 1;
      try {
        this.onToken(draft);
      } catch (err) {
        console.log(`[feed] token handler error: ${err.message}`);
      }
    });

    this.ws.on('error', (err) => {
      this.lastError = err.message;
      console.log(`[feed] socket error: ${err.message}`);
    });

    this.ws.on('close', (code) => {
      this.connected = false;
      this.ws = null;
      console.log(`[feed] disconnected (code=${code})`);
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnects += 1;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.5, MAX_BACKOFF_MS);
    console.log(`[feed] reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnects})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  health() {
    return {
      connected: this.connected,
      degraded: !this.connected,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      reconnects: this.reconnects,
      messagesSeen: this.messagesSeen,
      tokensSeen: this.tokensSeen,
    };
  }
}

module.exports = { RadarFeed, normalizeEvent };
