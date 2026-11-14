'use strict';

/**
 * Deterministic, rule-based risk scoring for new token launches.
 *
 * The score is a RISK score from 0 to 100: higher means riskier.
 * It starts at a neutral 50 and each signal moves it up or down.
 * No machine learning, no LLM calls, no randomness — the same facts
 * always produce the same score and the same reasons.
 *
 * Verdict thresholds:
 *   score <  35  -> WATCH    (nothing alarming found)
 *   score 35-64  -> CAUTION  (one or more yellow flags)
 *   score >= 65  -> AVOID    (strong or multiple red flags)
 *
 * Every verdict lists exactly the signals that moved the score, plus
 * the signals that could not be verified (unknowns). Unknowns never
 * move the score silently; they are reported so the reader knows what
 * is missing.
 */

const WELL_KNOWN = [
  { symbol: 'SOL', names: ['SOLANA'] },
  { symbol: 'USDC', names: ['USD COIN'] },
  { symbol: 'BONK', names: ['BONK'] },
  { symbol: 'WIF', names: ['DOGWIFHAT'] },
  { symbol: 'JUP', names: ['JUPITER'] },
  { symbol: 'RAY', names: ['RAYDIUM'] },
];

function words(text) {
  return String(text || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * Impersonation heuristic. A brand-new pump.fun mint can never BE one
 * of the well-known tokens (those have fixed, long-established mints),
 * so reusing their symbol or name is a red flag: it usually exists to
 * catch mistaken buys.
 * Returns 'strong' (exact symbol match), 'medium' (known name/symbol
 * appears as a whole word in the name), or null.
 */
function impersonationLevel(symbol, name) {
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nameWords = new Set(words(name));
  for (const known of WELL_KNOWN) {
    if (sym && sym === known.symbol) return 'strong';
  }
  for (const known of WELL_KNOWN) {
    if (nameWords.has(known.symbol)) return 'medium';
    for (const n of known.names) {
      if (n.includes(' ') ? String(name || '').toUpperCase().includes(n) : nameWords.has(n)) {
        return 'medium';
      }
    }
  }
  return null;
}

/**
 * Score one token.
 *
 * facts = {
 *   symbol, name,
 *   bondingProgress: 0..1 | null,   fraction of the bonding curve filled
 *   liquiditySol: number | null,    virtual SOL reserves on the curve
 *   marketCapSol: number | null,
 *   mintAuthorityEnabled: boolean | null,   true = dev can still mint more
 *   freezeAuthorityEnabled: boolean | null, true = dev can still freeze accounts
 *   topHolderPct: number | null,    share of supply in the largest wallet
 *   creatorIsTopHolder: boolean | null,
 *   socialsPresent: boolean | null, at least one of twitter/telegram/website
 *   metadataOk: boolean | null,     metadata JSON fetched and parsed
 *   dexLiquidityUsd: number | null, real DEX liquidity if the token graduated
 * }
 */
function scoreToken(facts) {
  const reasons = [];
  const unknowns = [];
  let score = 50;

  const add = (signal, points, detail) => {
    score += points;
    reasons.push({ signal, points, detail });
  };
  const unknown = (signal, detail) => unknowns.push({ signal, detail });

  // 1. Impersonation — the single strongest signal.
  const impersonation = impersonationLevel(facts.symbol, facts.name);
  if (impersonation === 'strong') {
    add('impersonation', 35, `Symbol "${facts.symbol}" copies a well-known token. A new mint cannot be the real one — this usually exists to catch mistaken buys.`);
  } else if (impersonation === 'medium') {
    add('impersonation', 20, `Name "${facts.name}" borrows a well-known token's name. Treat as a possible lookalike.`);
  }

  // 2. Bonding-curve progress — how far along the launch is.
  if (facts.bondingProgress === null || facts.bondingProgress === undefined) {
    unknown('bonding_progress', 'Bonding-curve progress could not be determined from the launch data.');
  } else if (facts.bondingProgress < 0.1) {
    add('bonding_progress', 10, `Bonding curve only ${Math.round(facts.bondingProgress * 100)}% filled — very early, price moves easily on small buys.`);
  } else if (facts.bondingProgress < 0.5) {
    add('bonding_progress', 3, `Bonding curve ${Math.round(facts.bondingProgress * 100)}% filled — still early.`);
  } else if (facts.bondingProgress >= 0.8) {
    add('bonding_progress', -10, `Bonding curve ${Math.round(facts.bondingProgress * 100)}% filled — close to graduation, deeper liquidity.`);
  }

  // 3. Liquidity present on the curve. A zero reserves reading is
  // only alarming when the market cap agrees — a positive market cap
  // with a zero reserves field is a data quirk, not an empty curve.
  if ((facts.liquiditySol === null || facts.liquiditySol === undefined) && (facts.marketCapSol === null || facts.marketCapSol === undefined)) {
    unknown('liquidity', 'No liquidity or market-cap figure was available for this launch.');
  } else if (
    facts.liquiditySol !== null && facts.liquiditySol !== undefined && facts.liquiditySol <= 0 &&
    (facts.marketCapSol === null || facts.marketCapSol === undefined || facts.marketCapSol <= 0)
  ) {
    add('liquidity', 15, 'No virtual SOL reserves reported on the bonding curve — nothing backing the price.');
  } else if (facts.marketCapSol !== null && facts.marketCapSol !== undefined && facts.marketCapSol < 1) {
    add('liquidity', 8, `Market cap under 1 SOL (${facts.marketCapSol.toFixed(2)} SOL) — extremely thin.`);
  } else if (facts.marketCapSol !== null && facts.marketCapSol !== undefined && facts.marketCapSol >= 20) {
    add('liquidity', -5, `Market cap ${facts.marketCapSol.toFixed(1)} SOL — meaningful value already in the curve.`);
  }

  // 4. Mint authority — can the creator print more supply?
  if (facts.mintAuthorityEnabled === null || facts.mintAuthorityEnabled === undefined) {
    unknown('mint_authority', 'Mint authority status could not be verified (Solana RPC unreachable).');
  } else if (facts.mintAuthorityEnabled) {
    add('mint_authority', 15, 'Mint authority is still enabled — the creator can print more supply at any time.');
  } else {
    add('mint_authority', -8, 'Mint authority is revoked — supply cannot be inflated.');
  }

  // 5. Freeze authority — can the creator freeze holder accounts?
  if (facts.freezeAuthorityEnabled === null || facts.freezeAuthorityEnabled === undefined) {
    unknown('freeze_authority', 'Freeze authority status could not be verified (Solana RPC unreachable).');
  } else if (facts.freezeAuthorityEnabled) {
    add('freeze_authority', 10, 'Freeze authority is still enabled — the creator can freeze holder accounts.');
  } else {
    add('freeze_authority', -5, 'Freeze authority is revoked — holder accounts cannot be frozen.');
  }

  // 6. Top-holder concentration — how much supply one wallet holds.
  if (facts.topHolderPct === null || facts.topHolderPct === undefined) {
    unknown('holder_concentration', 'Holder distribution could not be verified (Solana RPC unreachable).');
  } else if (facts.topHolderPct > 30) {
    add('holder_concentration', 20, `Largest wallet holds ${facts.topHolderPct.toFixed(1)}% of supply — a single dump can crash the price.`);
  } else if (facts.topHolderPct > 15) {
    add('holder_concentration', 10, `Largest wallet holds ${facts.topHolderPct.toFixed(1)}% of supply — concentrated.`);
  } else if (facts.topHolderPct < 5) {
    add('holder_concentration', -5, `Largest wallet holds only ${facts.topHolderPct.toFixed(1)}% of supply — well spread.`);
  }
  if (facts.creatorIsTopHolder === true) {
    add('creator_concentration', 8, 'The creator wallet is the largest holder — dev exposure is direct.');
  }

  // 7. Social / website links — is there any public presence at all?
  if (facts.socialsPresent === null || facts.socialsPresent === undefined) {
    unknown('social_links', 'Social and website links could not be checked (metadata unreachable).');
  } else if (facts.socialsPresent === false) {
    add('social_links', 10, 'No Twitter, Telegram, or website links in the token metadata — no public presence to hold accountable.');
  } else {
    add('social_links', -5, 'Token metadata includes at least one public link (Twitter, Telegram, or website).');
  }

  // 8. Metadata reachability. Only fires when metadata is
  // definitively missing/invalid — gateway blocks from this host
  // leave the signal unknown instead of penalizing the token.
  if (facts.metadataOk === false) {
    add('metadata', 5, 'Token metadata is missing or invalid — description and links are unverifiable.');
  }

  // 9. Real DEX liquidity (only after graduation; absence is normal).
  if (facts.dexLiquidityUsd !== null && facts.dexLiquidityUsd !== undefined && facts.dexLiquidityUsd > 1000) {
    add('dex_liquidity', -3, `Real DEX liquidity of $${Math.round(facts.dexLiquidityUsd).toLocaleString()} observed — the token graduated to a pool.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score < 35 ? 'WATCH' : score < 65 ? 'CAUTION' : 'AVOID';
  return { score, verdict, reasons, unknowns };
}

module.exports = { scoreToken, impersonationLevel, WELL_KNOWN };
