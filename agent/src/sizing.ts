// Position sizing inside hard caps. Pure function, unit-tested.
// Pattern follows the HSK agent's sizing.ts; amounts in paper USD cents.
import { clamp } from './signal.js';

export interface SizingInput {
  equityCents: number;
  signalScore: number; // 0-100
  perTradeCap: number; // fraction of equity
  dailyCap: number; // fraction of equity
  deployedTodayCents: number;
  riskAppetite: number; // 0-1
  minScore: number;
}

export interface SizingResult {
  sizeCents: number;
  blocked: boolean;
  reason: string;
}

/** Size = perTradeCap * equity * (score/100) * (0.5 + riskAppetite), capped by daily headroom. */
export function sizePosition(input: SizingInput): SizingResult {
  if (input.signalScore < input.minScore) {
    return { sizeCents: 0, blocked: true, reason: `score ${input.signalScore} below threshold ${input.minScore}` };
  }
  const dailyHeadroom = input.dailyCap * input.equityCents - input.deployedTodayCents;
  if (dailyHeadroom <= 0) {
    return { sizeCents: 0, blocked: true, reason: `daily cap reached (deployed ${(input.deployedTodayCents / 100).toFixed(2)} of ${((input.dailyCap * input.equityCents) / 100).toFixed(2)} paper USD)` };
  }
  const base = input.perTradeCap * input.equityCents;
  const scoreScale = input.signalScore / 100;
  const appetiteScale = 0.5 + clamp(input.riskAppetite, 0, 1);
  const size = Math.min(base * scoreScale * appetiteScale, dailyHeadroom);
  if (size <= 0) return { sizeCents: 0, blocked: true, reason: 'computed size is zero' };
  return {
    sizeCents: Math.round(size),
    blocked: false,
    reason: `size ${(size / 100).toFixed(2)} paper USD = cap ${(base / 100).toFixed(2)} x score ${scoreScale.toFixed(2)} x appetite ${appetiteScale.toFixed(2)}, daily headroom ${(dailyHeadroom / 100).toFixed(2)}`,
  };
}
