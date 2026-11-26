import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRisk, newRiskState, applyHalt } from '../src/risk.js';
import { sizePosition } from '../src/sizing.js';

const CFG = { dailyLossLimit: 0.2, maxDrawdown: 0.3, stopLossPct: 0.05 };
const TODAY = new Date().toISOString().slice(0, 10);

test('risk passes on a healthy state with fresh data', () => {
  const s = newRiskState(10_000);
  const r = checkRisk(s, CFG, { dataOk: true, today: TODAY });
  assert.equal(r.pass, true);
});

test('risk fails closed on missing data', () => {
  const s = newRiskState(10_000);
  const r = checkRisk(s, CFG, { dataOk: false, today: TODAY });
  assert.equal(r.pass, false);
  assert.match(r.reasons.join(' '), /missing/i);
});

test('risk blocks after daily loss limit breach', () => {
  const s = newRiskState(10_000);
  s.dailyPnLCents = -2_001; // -$20.01 on $100 equity
  const r = checkRisk(s, CFG, { dataOk: true, today: TODAY });
  assert.equal(r.pass, false);
});

test('halt blocks everything', () => {
  const s = newRiskState(10_000);
  applyHalt(s, 'operator halt');
  const r = checkRisk(s, CFG, { dataOk: true, today: TODAY });
  assert.equal(r.pass, false);
  assert.match(r.reasons.join(' '), /HALTED/);
});

test('sizing blocks below threshold and scales with score', () => {
  const base = { equityCents: 10_000, perTradeCap: 0.3, dailyCap: 0.5, deployedTodayCents: 0, riskAppetite: 0.5, minScore: 60 };
  const low = sizePosition({ ...base, signalScore: 59 });
  assert.equal(low.blocked, true);
  const mid = sizePosition({ ...base, signalScore: 75 });
  const high = sizePosition({ ...base, signalScore: 100 });
  assert.equal(mid.blocked, false);
  assert.ok(high.sizeCents > mid.sizeCents, 'higher score should size larger');
  assert.ok(high.sizeCents <= 3000, 'never above the 30% per-trade cap');
});

test('sizing blocks when the daily cap is used up', () => {
  const r = sizePosition({
    equityCents: 10_000, signalScore: 90, perTradeCap: 0.3, dailyCap: 0.5,
    deployedTodayCents: 5000, riskAppetite: 0.5, minScore: 60,
  });
  assert.equal(r.blocked, true);
});
