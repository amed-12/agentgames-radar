'use strict';

/**
 * In-memory token store: a ring buffer of the most recent launches.
 *
 * Nothing is persisted to disk — after a restart the radar refills
 * from the live feed within seconds, and the seeded samples are
 * always reloaded so the demo endpoints never come up empty.
 */

const { scoreToken } = require('./scorer');

const MAX_TOKENS = 200;

// Pump.fun's bonding curve starts with ~1.073B virtual tokens and
// graduates when roughly 85 SOL has been raised. Both constants are
// used only to estimate curve progress from launch data.
const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
const GRADUATION_SOL = 85;

function tokenToFacts(token) {
  const enrichment = token.enrichment || {};
  const socials = token.socials;
  let socialsPresent = null;
  if (socials && typeof socials === 'object') {
    socialsPresent = Boolean(socials.twitter || socials.telegram || socials.website);
  }
  return {
    symbol: token.symbol,
    name: token.name,
    bondingProgress: token.bondingProgress ?? null,
    liquiditySol: token.liquiditySol ?? null,
    marketCapSol: token.marketCapSol ?? null,
    mintAuthorityEnabled: enrichment.mintAuthorityEnabled ?? null,
    freezeAuthorityEnabled: enrichment.freezeAuthorityEnabled ?? null,
    topHolderPct: enrichment.topHolderPct ?? null,
    creatorIsTopHolder: enrichment.creatorIsTopHolder ?? null,
    socialsPresent,
    metadataOk: token.metadataOk ?? null,
    dexLiquidityUsd: enrichment.dexLiquidityUsd ?? null,
  };
}

class TokenStore {
  constructor() {
    this.tokens = []; // newest first
    this.byMint = new Map();
  }

  rescore(token) {
    const result = scoreToken(tokenToFacts(token));
    token.score = result.score;
    token.verdict = result.verdict;
    token.reasons = result.reasons;
    token.unknowns = result.unknowns;
    token.lastUpdatedAt = Date.now();
    return token;
  }

  add(draft) {
    const existing = this.byMint.get(draft.mint);
    if (existing) {
      // Refresh live figures, keep the earliest first-seen time.
      if (draft.marketCapSol !== undefined) existing.marketCapSol = draft.marketCapSol;
      if (draft.liquiditySol !== undefined) existing.liquiditySol = draft.liquiditySol;
      if (draft.bondingProgress !== undefined) existing.bondingProgress = draft.bondingProgress;
      if (draft.socials) existing.socials = { ...(existing.socials || {}), ...draft.socials };
      return this.rescore(existing);
    }
    const token = {
      mint: draft.mint,
      name: draft.name || '',
      symbol: draft.symbol || '',
      uri: draft.uri || null,
      creator: draft.creator || null,
      marketCapSol: draft.marketCapSol ?? null,
      liquiditySol: draft.liquiditySol ?? null,
      bondingProgress: draft.bondingProgress ?? null,
      socials: draft.socials || null,
      metadataOk: draft.metadataOk ?? null,
      enrichment: draft.enrichment || {},
      source: draft.source || 'live',
      seeded: draft.source === 'seed',
      firstSeenAt: draft.firstSeenAt || Date.now(),
      lastUpdatedAt: Date.now(),
      score: 50,
      verdict: 'CAUTION',
      reasons: [],
      unknowns: [],
    };
    this.tokens.unshift(token);
    this.byMint.set(token.mint, token);
    if (this.tokens.length > MAX_TOKENS) {
      const dropped = this.tokens.pop();
      this.byMint.delete(dropped.mint);
    }
    return this.rescore(token);
  }

  list(limit = 50) {
    return this.tokens.slice(0, Math.max(1, Math.min(limit, MAX_TOKENS)));
  }

  get(mint) {
    return this.byMint.get(mint) || null;
  }

  counts() {
    let live = 0;
    let seeded = 0;
    for (const token of this.tokens) {
      if (token.seeded) seeded += 1;
      else live += 1;
    }
    return { total: this.tokens.length, live, seeded };
  }
}

module.exports = { TokenStore, tokenToFacts, INITIAL_VIRTUAL_TOKENS, GRADUATION_SOL, MAX_TOKENS };
