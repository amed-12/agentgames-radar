'use strict';

/**
 * Seeded sample launches.
 *
 * These are illustrative, hand-written examples — NOT real tokens.
 * They exist so the radar serves a meaningful demo the moment it
 * boots, and so the /radar endpoint stays useful when the live feed
 * is unreachable. Every seed is flagged `seeded: true` in the API
 * and labelled SAMPLE in the demo page. No seed is ever presented
 * as live data.
 *
 * The five seeds deliberately span the verdict range so the scoring
 * behavior is visible at a glance: one clear AVOID (impersonator),
 * two CAUTIONs, one WATCH, and one data-starved edge case.
 */

const now = Date.now();
const minute = 60_000;

const SEEDS = [
  {
    mint: 'SeedB0NK11111111111111111111111111111111111111',
    name: 'Bonk 2.0',
    symbol: 'BONK',
    uri: null,
    creator: 'SeedCreator1111111111111111111111111111111111',
    marketCapSol: 0.4,
    liquiditySol: 30.1,
    bondingProgress: 0.02,
    socials: { twitter: '', telegram: '', website: '' },
    metadataOk: true,
    enrichment: {
      mintAuthorityEnabled: true,
      freezeAuthorityEnabled: true,
      topHolderPct: 42.0,
      creatorIsTopHolder: true,
      dexLiquidityUsd: null,
    },
    source: 'seed',
    firstSeenAt: now - 4 * minute,
  },
  {
    mint: 'SeedRADR11111111111111111111111111111111111111',
    name: 'Radar Cat',
    symbol: 'RADR',
    uri: null,
    creator: 'SeedCreator2222222222222222222222222222222222',
    marketCapSol: 64.0,
    liquiditySol: 78.5,
    bondingProgress: 0.86,
    socials: { twitter: 'https://x.com/example', telegram: '', website: 'https://example.org' },
    metadataOk: true,
    enrichment: {
      mintAuthorityEnabled: false,
      freezeAuthorityEnabled: false,
      topHolderPct: 3.1,
      creatorIsTopHolder: false,
      dexLiquidityUsd: null,
    },
    source: 'seed',
    firstSeenAt: now - 9 * minute,
  },
  {
    mint: 'SeedM00N11111111111111111111111111111111111111',
    name: 'Moon Cat',
    symbol: 'MCAT',
    uri: null,
    creator: 'SeedCreator3333333333333333333333333333333333',
    marketCapSol: 12.0,
    liquiditySol: 38.2,
    bondingProgress: 0.45,
    socials: { twitter: '', telegram: '', website: '' },
    metadataOk: true,
    enrichment: {
      mintAuthorityEnabled: null,
      freezeAuthorityEnabled: null,
      topHolderPct: 12.0,
      creatorIsTopHolder: false,
      dexLiquidityUsd: null,
    },
    source: 'seed',
    firstSeenAt: now - 14 * minute,
  },
  {
    mint: 'SeedAQUA11111111111111111111111111111111111111',
    name: 'Aqua Dog',
    symbol: 'AQUA',
    uri: null,
    creator: 'SeedCreator4444444444444444444444444444444444',
    marketCapSol: 40.0,
    liquiditySol: 55.0,
    bondingProgress: 0.62,
    socials: { twitter: 'https://x.com/example', telegram: '', website: '' },
    metadataOk: true,
    enrichment: {
      mintAuthorityEnabled: false,
      freezeAuthorityEnabled: true,
      topHolderPct: 8.0,
      creatorIsTopHolder: false,
      dexLiquidityUsd: null,
    },
    source: 'seed',
    firstSeenAt: now - 21 * minute,
  },
  {
    mint: 'SeedGH0S11111111111111111111111111111111111111',
    name: 'Ghost',
    symbol: 'GHST',
    uri: null,
    creator: 'SeedCreator5555555555555555555555555555555555',
    marketCapSol: null,
    liquiditySol: null,
    bondingProgress: null,
    socials: null,
    metadataOk: false,
    enrichment: {},
    source: 'seed',
    firstSeenAt: now - 27 * minute,
  },
];

module.exports = { SEEDS };
