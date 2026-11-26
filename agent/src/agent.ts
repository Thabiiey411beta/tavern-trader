// Tavern Trader agent: poll -> score -> risk-gate -> size -> open/close
// PAPER positions, mirroring each decision to the realm when live, or to
// the journal as a dry-run when no funded testnet key exists.
// Paper P&L is labelled PAPER everywhere. No real funds, ever.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scoreSignal, SCORE_THRESHOLD, type PricePoint, type Signal } from './signal.js';
import { checkRisk, newRiskState, applyHalt, resetDay, type RiskState } from './risk.js';
import { sizePosition } from './sizing.js';
import { Journal } from './journal.js';
import { fetchSpot, fetchHistory, UNIVERSE, isFresh } from './prices.js';
import { callRealm, realmConfigFromEnv, toMicroUsd, type RealmConfig } from './realm.js';

export interface PaperPosition {
  realmId: number | null; // null while dry-run (no on-chain id yet)
  symbol: string;
  side: 'long' | 'short';
  sizeCents: number;
  entryPrice: number; // USD
  stopLoss: number; // USD
  takeProfit: number; // USD
  score: number;
  openedAt: string;
  reason: string;
}

export interface AgentConfig {
  equityCents: number; // paper equity, default $100.00
  perTradeCap: number; // fraction of equity, default 0.30
  dailyCap: number; // fraction of equity, default 0.50
  dailyLossLimit: number; // fraction of equity, default 0.20
  maxDrawdown: number; // fraction, default 0.30
  stopLossPct: number; // 0.05
  takeProfitPct: number; // 0.10
  riskAppetite: number; // 0-1, default 0.5
  pollMs: number;
  dataDir: string;
}

export const DEFAULT_CONFIG: AgentConfig = {
  equityCents: 10_000,
  perTradeCap: 0.3,
  dailyCap: 0.5,
  dailyLossLimit: 0.2,
  maxDrawdown: 0.3,
  stopLossPct: 0.05,
  takeProfitPct: 0.1,
  riskAppetite: 0.5,
  pollMs: 5 * 60 * 1000,
  dataDir: join(process.cwd(), 'data'),
};

export interface AgentState {
  risk: RiskState;
  positions: PaperPosition[];
  realisedPnLCents: number;
  lastSignals: Signal[];
  lastPollAt: string | null;
  polls: number;
}

export class Agent {
  readonly journal: Journal;
  readonly cfg: AgentConfig;
  readonly realmCfg: RealmConfig | null;
  state: AgentState;
  private stateFile: string;
  /** History cache, symbol -> daily closes (oldest first). */
  history = new Map<string, PricePoint[]>();

  constructor(cfg: Partial<AgentConfig> = {}, env: NodeJS.ProcessEnv = process.env) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    mkdirSync(this.cfg.dataDir, { recursive: true });
    this.journal = new Journal(join(this.cfg.dataDir, 'journal.jsonl'));
    this.realmCfg = realmConfigFromEnv(env);
    this.stateFile = join(this.cfg.dataDir, 'state.json');
    this.state = this.loadState();
  }

  private loadState(): AgentState {
    if (existsSync(this.stateFile)) {
      try {
        return JSON.parse(readFileSync(this.stateFile, 'utf8')) as AgentState;
      } catch { /* fall through to fresh state */ }
    }
    return {
      risk: newRiskState(this.cfg.equityCents),
      positions: [],
      realisedPnLCents: 0,
      lastSignals: [],
      lastPollAt: null,
      polls: 0,
    };
  }

  saveState(): void {
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
  }

  get liveRealm(): boolean {
    return this.realmCfg !== null;
  }

  /** One full poll: fetch, score, manage positions. Never throws. */
  async pollOnce(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.risk.day !== today) {
      resetDay(this.state.risk, today);
      this.journal.append({ type: 'decision', note: 'new day — daily counters reset', day: today });
    }
    this.state.polls++;
    try {
      const quotes = await fetchSpot();
      const fresh = quotes.filter((q) => isFresh(q));
      const dataOk = fresh.length === UNIVERSE.length;
      if (!dataOk) {
        this.journal.append({ type: 'block', reason: `only ${fresh.length}/${UNIVERSE.length} fresh spot quotes — fail-closed, no trades this poll` });
      }
      // Refresh 30d history per symbol (cheap: 4 calls per poll; CoinGecko
      // public rate limits apply — a failure keeps the previous cache and
      // the signal reports dataOk=false if the cache is too short).
      for (const u of UNIVERSE) {
        try {
          this.history.set(u.symbol, await fetchHistory(u.id, 30));
        } catch (e) {
          this.journal.append({ type: 'error', where: `history ${u.symbol}`, error: String(e) });
        }
      }
      const signals: Signal[] = UNIVERSE.map((u) =>
        scoreSignal({ symbol: u.symbol, history: this.history.get(u.symbol) ?? [] }),
      );
      this.state.lastSignals = signals;
      for (const s of signals) {
        this.journal.append({ type: 'signal', symbol: s.symbol, score: s.score, direction: s.direction, components: s.components, reasons: s.reasons, dataOk: s.dataOk });
        await this.recordScore(s);
      }
      const priceBySymbol = new Map(quotes.map((q) => [q.symbol, q.price]));
      this.managePositions(priceBySymbol, dataOk);
      for (const s of signals) {
        if (s.direction === 'none' || !s.dataOk) continue;
        this.maybeOpen(s, priceBySymbol.get(s.symbol) ?? 0, dataOk);
      }
      this.journal.append({ type: 'poll', n: this.state.polls, dataOk, openPositions: this.state.positions.length });
    } catch (e) {
      this.journal.append({ type: 'error', where: 'pollOnce', error: String(e) });
    }
    this.state.lastPollAt = new Date().toISOString();
    this.saveState();
  }

  /**
   * Write one score to the realm and journal the result. A failed call is
   * retried once after a short pause: on 25 Nov 2026 poll #13 silently
   * dropped ETH/SOL because RecordScore had outgrown the 5M gas cap
   * (5.2M used at 9 log entries) and nobody checked the return value.
   * A retry can double-record if the first call actually landed but the
   * CLI reported failure — harmless in an append-only decision log.
   */
  private async recordScore(s: Signal): Promise<void> {
    if (!this.realmCfg) return;
    const args = [s.symbol, String(s.score), s.reasons[0] ?? ''];
    let call = callRealm(this.realmCfg, 'RecordScore', args);
    this.journal.append({ type: 'realm', func: 'RecordScore', symbol: s.symbol, ok: call.ok, output: (call.output ?? '').slice(0, 300) });
    if (!call.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      call = callRealm(this.realmCfg, 'RecordScore', args);
      this.journal.append({ type: 'realm', func: 'RecordScore', symbol: s.symbol, retry: true, ok: call.ok, output: (call.output ?? '').slice(0, 300) });
      if (!call.ok) {
        this.journal.append({ type: 'error', where: 'realm RecordScore', symbol: s.symbol, error: 'gnokey call failed after retry — score kept local-only', output: (call.output ?? '').slice(0, 300) });
      }
    }
  }

  /** Close positions whose stop-loss / take-profit was hit at current prices. */
  managePositions(prices: Map<string, number>, dataOk: boolean): void {
    for (const pos of [...this.state.positions]) {
      const price = prices.get(pos.symbol);
      if (!price || price <= 0) continue;
      const pnlPct = pos.side === 'long'
        ? (price - pos.entryPrice) / pos.entryPrice
        : (pos.entryPrice - price) / pos.entryPrice;
      let reason: string | null = null;
      if (pnlPct <= -this.cfg.stopLossPct) reason = `stop-loss hit (${(pnlPct * 100).toFixed(2)}%)`;
      else if (pnlPct >= this.cfg.takeProfitPct) reason = `take-profit hit (+${(pnlPct * 100).toFixed(2)}%)`;
      if (reason) this.closePosition(pos, price, reason, dataOk);
    }
  }

  maybeOpen(signal: Signal, price: number, dataOk: boolean): void {
    if (!(price > 0)) {
      this.journal.append({ type: 'block', symbol: signal.symbol, reason: 'no fresh price — fail-closed' });
      return;
    }
    if (this.state.positions.some((p) => p.symbol === signal.symbol)) {
      this.journal.append({ type: 'block', symbol: signal.symbol, reason: 'already holding a paper position in this symbol' });
      return;
    }
    const risk = checkRisk(this.state.risk, this.cfg, { dataOk, today: new Date().toISOString().slice(0, 10) });
    if (!risk.pass) {
      this.journal.append({ type: 'block', symbol: signal.symbol, score: signal.score, reasons: risk.reasons });
      return;
    }
    const sizing = sizePosition({
      equityCents: this.state.risk.equityCents,
      signalScore: signal.score,
      perTradeCap: this.cfg.perTradeCap,
      dailyCap: this.cfg.dailyCap,
      deployedTodayCents: this.state.risk.deployedTodayCents,
      riskAppetite: this.cfg.riskAppetite,
      minScore: SCORE_THRESHOLD,
    });
    if (sizing.blocked) {
      this.journal.append({ type: 'block', symbol: signal.symbol, score: signal.score, reason: sizing.reason });
      return;
    }
    const stopLoss = signal.direction === 'long'
      ? price * (1 - this.cfg.stopLossPct)
      : price * (1 + this.cfg.stopLossPct);
    const takeProfit = signal.direction === 'long'
      ? price * (1 + this.cfg.takeProfitPct)
      : price * (1 - this.cfg.takeProfitPct);
    const reason = signal.reasons.join(' | ');
    const pos: PaperPosition = {
      realmId: null,
      symbol: signal.symbol,
      side: signal.direction as 'long' | 'short',
      sizeCents: sizing.sizeCents,
      entryPrice: price,
      stopLoss,
      takeProfit,
      score: signal.score,
      openedAt: new Date().toISOString(),
      reason,
    };
    if (this.realmCfg) {
      const call = callRealm(this.realmCfg, 'OpenPaperPosition', [
        pos.symbol, pos.side, String(pos.sizeCents),
        String(toMicroUsd(pos.entryPrice)), String(toMicroUsd(pos.stopLoss)),
        String(toMicroUsd(pos.takeProfit)), String(pos.score), reason.slice(0, 200),
      ]);
      this.journal.append({ type: 'realm', func: 'OpenPaperPosition', ok: call.ok, output: call.output, command: call.command });
      if (!call.ok) {
        this.journal.append({ type: 'error', where: 'realm OpenPaperPosition', error: 'gnokey call failed — position kept local-only', output: call.output });
      }
    } else {
      const call = callRealm(null, 'OpenPaperPosition', [
        pos.symbol, pos.side, String(pos.sizeCents),
        String(toMicroUsd(pos.entryPrice)), String(toMicroUsd(pos.stopLoss)),
        String(toMicroUsd(pos.takeProfit)), String(pos.score), reason.slice(0, 200),
      ]);
      this.journal.append({ type: 'dry-run', func: 'OpenPaperPosition', command: call.command, note: 'no funded testnet key — intended realm call recorded, nothing sent on-chain' });
    }
    this.state.positions.push(pos);
    this.state.risk.openPositions = this.state.positions.length;
    this.state.risk.deployedTodayCents += pos.sizeCents;
    this.journal.append({ type: 'open', paper: true, symbol: pos.symbol, side: pos.side, sizeCents: pos.sizeCents, entryPrice: pos.entryPrice, stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, score: pos.score, reasons: signal.reasons });
    this.saveState();
  }

  closePosition(pos: PaperPosition, price: number, reason: string, _dataOk: boolean): void {
    const pnlPct = pos.side === 'long'
      ? (price - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - price) / pos.entryPrice;
    const pnlCents = Math.round(pos.sizeCents * pnlPct);
    if (this.realmCfg && pos.realmId !== null) {
      const call = callRealm(this.realmCfg, 'ClosePaperPosition', [String(pos.realmId), String(toMicroUsd(price)), reason.slice(0, 200)]);
      this.journal.append({ type: 'realm', func: 'ClosePaperPosition', ok: call.ok, output: call.output, command: call.command });
    } else if (!this.realmCfg) {
      const call = callRealm(null, 'ClosePaperPosition', [String(pos.realmId ?? 0), String(toMicroUsd(price)), reason.slice(0, 200)]);
      this.journal.append({ type: 'dry-run', func: 'ClosePaperPosition', command: call.command, note: 'no funded testnet key — intended realm call recorded, nothing sent on-chain' });
    }
    this.state.positions = this.state.positions.filter((p) => p !== pos);
    this.state.risk.openPositions = this.state.positions.length;
    this.state.risk.equityCents += pnlCents;
    this.state.risk.dailyPnLCents += pnlCents;
    this.state.risk.peakEquityCents = Math.max(this.state.risk.peakEquityCents, this.state.risk.equityCents);
    this.state.realisedPnLCents += pnlCents;
    if (this.state.risk.dailyPnLCents < -this.cfg.dailyLossLimit * this.cfg.equityCents) {
      applyHalt(this.state.risk, 'daily paper loss limit breached');
      this.journal.append({ type: 'halt', reason: 'daily paper loss limit breached' });
    }
    this.journal.append({ type: 'close', paper: true, symbol: pos.symbol, side: pos.side, closePrice: price, pnlCents, reason });
    this.saveState();
  }

  halt(reason: string): void {
    applyHalt(this.state.risk, reason);
    this.journal.append({ type: 'halt', reason });
    this.saveState();
  }

  resume(): void {
    this.state.risk.halted = false;
    this.state.risk.haltReason = '';
    this.journal.append({ type: 'decision', note: 'halt lifted by operator' });
    this.saveState();
  }
}
