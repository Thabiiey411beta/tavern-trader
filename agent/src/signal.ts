// Signal scoring for Tavern Trader — pure function, same code path in the
// live agent and the backtest.
//
// Universe: GNOT, BTC, ETH, SOL priced in USD off-chain (CoinGecko public
// API). Gno testnet has no real DEX price feed, so prices come from
// CoinGecko and the realm only stores the resulting paper decisions —
// the README says this honestly.
//
// WEIGHTS (total 100, signed — the sign picks the side):
//   momentum 40 — 7-day return. Full points at +/-10%.
//   trend    35 — price vs 20-day simple moving average. Full at +/-10%.
//   volume   25 — 24h volume vs 7-day average volume, in the direction of
//                 momentum (rising activity confirms the move; it never
//                 creates a direction on its own).
// Threshold 60: no single component can trigger a trade on its own.
// Direction: long when the signed total is >= +60, short when <= -60.
// Fail-closed: fewer than 21 daily closes, or a non-positive price, or
// missing volume, scores nothing and reports dataOk=false — the agent
// never trades on it.

export interface PricePoint {
  ts: number; // ms epoch
  price: number; // USD
  volume: number; // 24h USD volume for that day
}

export interface SignalInput {
  symbol: string;
  /** Daily closes, oldest first. Needs >= 21 entries. */
  history: PricePoint[];
}

export interface Signal {
  symbol: string;
  score: number; // 0-100, magnitude of conviction
  direction: 'long' | 'short' | 'none';
  components: { momentum: number; trend: number; volume: number };
  reasons: string[];
  dataOk: boolean;
}

export const MIN_HISTORY = 21;
export const SCORE_THRESHOLD = 60;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sma(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function scoreSignal(input: SignalInput): Signal {
  const reasons: string[] = [];
  const h = input.history;
  if (h.length < MIN_HISTORY) {
    return {
      symbol: input.symbol, score: 0, direction: 'none',
      components: { momentum: 0, trend: 0, volume: 0 },
      reasons: [`BLOCKED: only ${h.length} daily closes, need ${MIN_HISTORY} — fail-closed`],
      dataOk: false,
    };
  }
  const price = h[h.length - 1].price;
  if (!(price > 0) || h.some((p) => !(p.price > 0) || !(p.volume >= 0))) {
    return {
      symbol: input.symbol, score: 0, direction: 'none',
      components: { momentum: 0, trend: 0, volume: 0 },
      reasons: ['BLOCKED: missing or non-positive price/volume in history — fail-closed'],
      dataOk: false,
    };
  }

  const price7dAgo = h[h.length - 8].price;
  const ret7d = (price - price7dAgo) / price7dAgo;
  const sma20 = sma(h.slice(-20).map((p) => p.price));
  const devSma = (price - sma20) / sma20;
  const volNow = h[h.length - 1].volume;
  const volAvg = sma(h.slice(-7).map((p) => p.volume));
  const volRatio = volAvg > 0 ? volNow / volAvg : 0;

  const momentum = clamp(ret7d / 0.1, -1, 1) * 40;
  const trend = clamp(devSma / 0.1, -1, 1) * 35;
  // Volume confirms momentum's direction only; it cannot flip a signal.
  const volMag = volAvg > 0 ? clamp((volRatio - 1) / 1, 0, 1) * 25 : 0;
  const volume = Math.sign(momentum) * volMag;

  const total = momentum + trend + volume;
  const score = Math.min(100, Math.abs(Math.round(total)));
  const direction: Signal['direction'] =
    total >= SCORE_THRESHOLD ? 'long' : total <= -SCORE_THRESHOLD ? 'short' : 'none';

  reasons.push(`7d return ${(ret7d * 100).toFixed(2)}% (momentum ${momentum.toFixed(1)} pts)`);
  reasons.push(`price vs 20d SMA ${(devSma * 100).toFixed(2)}% (trend ${trend.toFixed(1)} pts)`);
  reasons.push(
    volAvg > 0
      ? `24h volume ${volRatio.toFixed(2)}x its 7d average (volume ${volume.toFixed(1)} pts)`
      : 'no volume history — volume component scored 0',
  );
  reasons.push(
    direction === 'none'
      ? `signed total ${total.toFixed(1)} below threshold ${SCORE_THRESHOLD} — no trade`
      : `signed total ${total.toFixed(1)} clears threshold ${SCORE_THRESHOLD} — ${direction}`,
  );
  return { symbol: input.symbol, score, direction, components: { momentum, trend, volume }, reasons, dataOk: true };
}
