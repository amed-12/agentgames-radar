'use strict';

/**
 * Scorer smoke test: run three representative tokens through the
 * real store + scorer path and check the verdicts come out as
 * designed. Exits non-zero on any mismatch.
 *
 *   node test-scorer.js
 */

const { TokenStore } = require('./src/store');
const { SEEDS } = require('./src/samples');

const EXPECTED = [
  { symbol: 'BONK', verdict: 'AVOID', why: 'exact impersonation + authorities enabled + 42% top holder + no socials' },
  { symbol: 'RADR', verdict: 'WATCH', why: 'near graduation + authorities revoked + spread holders + socials present' },
  { symbol: 'MCAT', verdict: 'CAUTION', why: 'mid-curve + no socials, authority checks unknown' },
];

const store = new TokenStore();
for (const seed of SEEDS) store.add(seed);

let failed = 0;
for (const check of EXPECTED) {
  const token = store.list(200).find((t) => t.symbol === check.symbol);
  if (!token) {
    console.log(`FAIL: seed ${check.symbol} not found in store`);
    failed += 1;
    continue;
  }
  const ok = token.verdict === check.verdict;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${token.symbol} (${token.name}) -> score ${token.score}, verdict ${token.verdict} (expected ${check.verdict}; ${check.why})`);
  for (const reason of token.reasons) {
    console.log(`      ${reason.points > 0 ? '+' : ''}${reason.points} [${reason.signal}] ${reason.detail}`);
  }
  for (const u of token.unknowns) {
    console.log(`      ?? [${u.signal}] ${u.detail}`);
  }
  if (!ok) failed += 1;
}

console.log(`\n${EXPECTED.length - failed}/${EXPECTED.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
