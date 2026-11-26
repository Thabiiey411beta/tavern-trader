import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignal, type PricePoint } from '../src/signal.js';

function flatHistory(prices: number[], volumes?: number[]): PricePoint[] {
  return prices.map((price, i) => ({ ts: 1_700_000_000_000 + i * 86_400_000, price, volume: volumes?.[i] ?? 1_000_000 }));
}

test('strong uptrend scores long above threshold', () => {
  // 30 days: flat $100 for 21 days, then +2%/day for 9 days -> 7d return ~+15%, price well above SMA.
  const prices = [...Array(21).fill(100), 102, 104.04, 106.12, 108.24, 110.41, 112.62, 114.87, 117.17, 119.51];
  const s = scoreSignal({ symbol: 'BTC', history: flatHistory(prices) });
  assert.equal(s.dataOk, true);
  assert.equal(s.direction, 'long');
  assert.ok(s.score >= 60, `score ${s.score} should clear 60`);
});

test('strong downtrend scores short above threshold', () => {
  const prices = [...Array(21).fill(100), 98, 96.04, 94.12, 92.24, 90.39, 88.58, 86.81, 85.08, 83.37];
  const s = scoreSignal({ symbol: 'BTC', history: flatHistory(prices) });
  assert.equal(s.dataOk, true);
  assert.equal(s.direction, 'short');
  assert.ok(s.score >= 60, `score ${s.score} should clear 60`);
});

test('flat market scores none', () => {
  const s = scoreSignal({ symbol: 'BTC', history: flatHistory(Array(30).fill(100)) });
  assert.equal(s.dataOk, true);
  assert.equal(s.direction, 'none');
  assert.ok(s.score < 60);
});

test('short history is fail-closed', () => {
  const s = scoreSignal({ symbol: 'BTC', history: flatHistory(Array(10).fill(100)) });
  assert.equal(s.dataOk, false);
  assert.equal(s.direction, 'none');
  assert.equal(s.score, 0);
});

test('rising volume confirms momentum direction, never creates one', () => {
  const prices = [...Array(21).fill(100), 101, 102, 103, 104, 105, 106, 107, 108, 109];
  const flatVol = flatHistory(prices);
  const spikeVol = flatHistory(prices, [...Array(29).fill(1_000_000), 5_000_000]);
  const a = scoreSignal({ symbol: 'BTC', history: flatVol });
  const b = scoreSignal({ symbol: 'BTC', history: spikeVol });
  assert.ok(b.score >= a.score, 'volume spike should not reduce the score');
  assert.equal(b.components.volume > 0, true);
});
