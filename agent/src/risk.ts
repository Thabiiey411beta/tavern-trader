// Risk gates — fail-closed. Any missing data blocks; any breached limit halts.
// Paper USD, tracked in cents. Pattern follows the HSK agent's risk.ts.
export interface RiskState {
  equityCents: number;
  peakEquityCents: number;
  dailyPnLCents: number;
  deployedTodayCents: number;
  openPositions: number;
  halted: boolean;
  haltReason: string;
  day: string; // YYYY-MM-DD
}

export function newRiskState(equityCents: number): RiskState {
  return {
    equityCents,
    peakEquityCents: equityCents,
    dailyPnLCents: 0,
    deployedTodayCents: 0,
    openPositions: 0,
    halted: false,
    haltReason: '',
    day: new Date().toISOString().slice(0, 10),
  };
}

export interface RiskCheck {
  pass: boolean;
  reasons: string[];
}

/** Evaluate all gates. `dataOk=false` (missing/stale price data) always fails. */
export function checkRisk(
  state: RiskState,
  cfg: { dailyLossLimit: number; maxDrawdown: number; stopLossPct: number },
  opts: { dataOk: boolean; positionPnlPct?: number; today: string },
): RiskCheck {
  const reasons: string[] = [];
  if (!opts.dataOk) reasons.push('BLOCKED: missing or stale market data — fail-closed');
  if (state.halted) reasons.push(`HALTED: ${state.haltReason}`);
  if (opts.today !== state.day) {
    reasons.push('BLOCKED: stale risk state (day rollover not yet applied)');
  }
  if (state.dailyPnLCents < -cfg.dailyLossLimit * state.equityCents) {
    reasons.push(
      `daily loss limit breached: ${(state.dailyPnLCents / 100).toFixed(2)} paper USD < -${(cfg.dailyLossLimit * 100).toFixed(1)}% of equity`,
    );
  }
  const drawdown = (state.peakEquityCents - state.equityCents) / state.peakEquityCents;
  if (drawdown > cfg.maxDrawdown) {
    reasons.push(`max drawdown breached: ${(drawdown * 100).toFixed(1)}% > ${(cfg.maxDrawdown * 100).toFixed(1)}%`);
  }
  if (opts.positionPnlPct !== undefined && opts.positionPnlPct <= -cfg.stopLossPct) {
    reasons.push(`stop-loss hit on open position: ${(opts.positionPnlPct * 100).toFixed(2)}% <= -${(cfg.stopLossPct * 100).toFixed(1)}%`);
  }
  return { pass: reasons.length === 0, reasons };
}

export function applyHalt(state: RiskState, reason: string): void {
  state.halted = true;
  state.haltReason = reason;
}

export function resetDay(state: RiskState, today: string): void {
  state.day = today;
  state.dailyPnLCents = 0;
  state.deployedTodayCents = 0;
  state.halted = false;
  state.haltReason = '';
}
