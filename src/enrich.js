'use strict';

/**
 * Best-effort enrichment from free public sources. No API keys.
 *
 * Three independent steps, each wrapped so a failure only leaves its
 * signals "unknown" — enrichment can never crash the radar or block
 * the feed:
 *
 *   1. Metadata   — the token's `uri` JSON (IPFS/Arweave/HTTPS):
 *      twitter / telegram / website links.
 *   2. DexScreener — price + real DEX liquidity once a token has a
 *      pool (usually only after graduation; absence is normal).
 *   3. Solana RPC — mint/freeze authority from the mint account, and
 *      top-holder concentration from the largest token accounts.
 *
 * Enrichment runs through a small queue (max 2 concurrent, short
 * pacing delay) so a burst of launches never hammers the public
 * endpoints. If the queue is full, tokens simply keep their
 * launch-time facts and their unknowns.
 */

const { fetchJson } = require('./proxy');

const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/';
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'];

const MAX_CONCURRENT = 3;
const PACE_MS = 400;
const MAX_QUEUE = 40;

async function rpcCall(method, params) {
  let lastError = null;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const res = await fetchJson(endpoint, {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method, params },
        timeoutMs: 6000,
      });
      if (res && res.error) throw new Error(`RPC error ${res.error.code}: ${res.error.message}`);
      if (!res || res.result === undefined) throw new Error('RPC returned no result');
      return res.result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All RPC endpoints failed');
}

function metadataUrls(uri) {
  if (!uri) return [];
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length);
    return IPFS_GATEWAYS.map((gw) => gw + cid);
  }
  if (uri.startsWith('ar://')) {
    return [`https://arweave.net/${uri.slice('ar://'.length)}`];
  }
  if (uri.startsWith('https://') || uri.startsWith('http://')) {
    const urls = [uri];
    // ipfs.io links get a second chance through another gateway.
    const ipfsMatch = uri.match(/^https?:\/\/ipfs\.io\/ipfs\/(.+)$/);
    if (ipfsMatch) urls.push(`https://cloudflare-ipfs.com/ipfs/${ipfsMatch[1]}`);
    return urls;
  }
  return [];
}

async function enrichMetadata(token) {
  // Launch events often already carry the links — trust those first.
  const existing = token.socials;
  if (existing && (existing.twitter || existing.telegram || existing.website)) {
    token.metadataOk = true;
    return;
  }
  const urls = metadataUrls(token.uri);
  if (urls.length === 0) {
    token.metadataOk = null; // nothing to fetch; not a failure
    return;
  }
  // Distinguish "definitively missing" from "could not reach":
  // a 404 or invalid JSON means the metadata itself is bad (+5 in
  // scoring), while gateway/proxy errors (403, CONNECT failures)
  // are this host's problem and leave the signal unknown.
  let sawDefinitiveMiss = false;
  for (const url of urls) {
    try {
      const meta = await fetchJson(url, { timeoutMs: 6000 });
      if (meta && typeof meta === 'object') {
        token.socials = {
          twitter: meta.twitter || '',
          telegram: meta.telegram || '',
          website: meta.website || '',
        };
        token.metadataOk = true;
        return;
      }
      sawDefinitiveMiss = true;
    } catch (err) {
      if (/HTTP 404|Invalid JSON/.test(err.message)) sawDefinitiveMiss = true;
    }
  }
  token.metadataOk = sawDefinitiveMiss ? false : null;
}

async function enrichDexScreener(token) {
  try {
    const data = await fetchJson(`${DEXSCREENER_URL}${token.mint}`, { timeoutMs: 6000 });
    const pair = data && Array.isArray(data.pairs) ? data.pairs[0] : null;
    if (pair) {
      const liquidityUsd = pair.liquidity ? Number(pair.liquidity.usd) : null;
      token.enrichment.dexLiquidityUsd = Number.isFinite(liquidityUsd) ? liquidityUsd : null;
      token.enrichment.priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
      token.enrichment.dexPair = pair.pairAddress || null;
    }
  } catch {
    // Brand-new bonding-curve tokens are usually not indexed yet.
  }
}

async function enrichRpc(token) {
  // Mint + freeze authority from the parsed mint account.
  const account = await rpcCall('getAccountInfo', [token.mint, { encoding: 'jsonParsed' }]);
  const info = account && account.value && account.value.data && account.value.data.parsed
    ? account.value.data.parsed.info
    : null;
  if (info) {
    token.enrichment.mintAuthorityEnabled = info.mintAuthority !== null && info.mintAuthority !== undefined;
    token.enrichment.freezeAuthorityEnabled = info.freezeAuthority !== null && info.freezeAuthority !== undefined;
  }

  // Top-holder concentration: largest account vs total supply.
  // Isolated: public RPCs often rate-limit this call, and a failure
  // here must not discard the authority facts gathered above.
  try {
    const [supply, largest] = await Promise.all([
      rpcCall('getTokenSupply', [token.mint]),
      rpcCall('getTokenLargestAccounts', [token.mint]),
    ]);
    const supplyAmount = supply && supply.value ? Number(supply.value.amount) : NaN;
    const top = largest && Array.isArray(largest.value) ? largest.value[0] : null;
    if (top && Number.isFinite(supplyAmount) && supplyAmount > 0) {
      const topAmount = Number(top.amount);
      if (Number.isFinite(topAmount)) {
        token.enrichment.topHolderPct = (topAmount / supplyAmount) * 100;
      }
      // Is the largest holder the creator? The largest-accounts list
      // gives token-account addresses; the owner needs one more lookup.
      if (token.creator) {
        try {
          const topAccount = await rpcCall('getAccountInfo', [top.address, { encoding: 'jsonParsed' }]);
          const owner = topAccount && topAccount.value && topAccount.value.data && topAccount.value.data.parsed
            ? topAccount.value.data.parsed.info.owner
            : null;
          token.enrichment.creatorIsTopHolder = owner === token.creator;
        } catch {
          token.enrichment.creatorIsTopHolder = null;
        }
      }
    }
  } catch {
    // Concentration stays unknown; authority facts still stand.
  }
}

class Enricher {
  constructor(store) {
    this.store = store;
    this.queue = [];
    this.active = 0;
    this.enriched = 0;
    this.skipped = 0;
  }

  enqueue(token) {
    if (token.seeded) return; // seeds carry their own illustrative facts
    if (this.queue.length >= MAX_QUEUE) {
      this.skipped += 1;
      return;
    }
    if (token.enrichment && token.enrichment.enrichmentQueued) return;
    token.enrichment.enrichmentQueued = true;
    this.queue.push(token);
    this.pump();
  }

  pump() {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      const token = this.queue.shift();
      this.active += 1;
      this.run(token)
        .catch(() => {})
        .finally(() => {
          this.active -= 1;
          this.enriched += 1;
          setTimeout(() => this.pump(), PACE_MS);
        });
    }
  }

  async run(token) {
    // The three steps are independent, so they run concurrently and
    // each rescore lands as its step settles — a step that throws
    // halfway still has its partial facts reflected in the verdict,
    // and a slow metadata fetch never blocks the RPC facts.
    const steps = [enrichMetadata, enrichDexScreener, enrichRpc];
    await Promise.all(
      steps.map(async (fn) => {
        try {
          await fn(token);
        } catch {
          // Failures leave the affected signals unknown.
        } finally {
          this.store.rescore(token);
        }
      })
    );
    token.enrichment.enrichedAt = Date.now();
    this.store.rescore(token);
  }

  stats() {
    return { queued: this.queue.length, active: this.active, enriched: this.enriched, skipped: this.skipped };
  }
}

module.exports = { Enricher };
