// Backtest: replay the saved real CoinGecko 90-day fixture
// (agent/data/prices-30d.json) through the SAME scoring + sizing + risk
// code the live agent uses. Paper only. Reports honest win/loss.
// `npm run backtest` (after `npm run fetch-history`, or with the fixture
// already saved in the repo).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignal, SCORE_THRESHOLD, type PricePoint } from './signal.js';
import { checkRisk, newRiskState } from './risk.js';
import { sizePosition } from './sizing.js';
import { Journal } from './journal.js';

const STOP_LOSS_PCT = 0.05;
const TAKE_PROFIT_PCT = 0.1;

interface Fixture {
  fetchedAt: string;
  days: number;
  symbols: Record<string, PricePoint[]>;
}

interface BacktestPosition {
  symbol: string;
  side: 'long' | 'short';
  sizeCents: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryDay: number;
}

export function runBacktest(fixture: Fixture): {
  trades: number; wins: number; losses: number; realisedPnLCents: number;
  finalEquityCents: number; blockedOpens: number; details: string[]; alignedDays: number;
} {
  const symbols = Object.keys(fixture.symbols);
  // Align symbols on shared calendar dates: CoinGecko returns fewer points
  // for thin coins (GNOT: 71 closes in a 90-day window vs 91 for BTC/ETH/SOL),
  // so intersect on YYYY-MM-DD and replay only dates every symbol has.
  const byDate = new Map<string, Record<string, PricePoint>>();
  for (const s of symbols) {
    for (const p of fixture.symbols[s]) {
      const d = new Date(p.ts).toISOString().slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, {});
      byDate.get(d)![s] = p;
    }
  }
  const dates = [...byDate.keys()].sort().filter((d) => symbols.every((s) => byDate.get(d)![s]));
  const aligned: Record<string, PricePoint[]> = {};
  for (const s of symbols) aligned[s] = dates.map((d) => byDate.get(d)![s]);
  const days = dates.length;
  const risk = newRiskState(10_000);
  const positions: BacktestPosition[] = [];
  const details: string[] = [];
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let realised = 0;
  let blockedOpens = 0;
  const journal = new Journal(join(process.cwd(), 'data', 'journal.jsonl'));

  // Start once every symbol has 21 closes of history.
  for (let day = 21; day < days; day++) {
    const today = dates[day];
    if (risk.day !== today) {
      // Day rollover, same as the live agent's resetDay (daily counters reset).
      risk.day = today;
      risk.dailyPnLCents = 0;
      risk.deployedTodayCents = 0;
    }
    for (const pos of [...positions]) {
      const price = aligned[pos.symbol][day].price;
      const pnlPct = pos.side === 'long'
        ? (price - pos.entryPrice) / pos.entryPrice
        : (pos.entryPrice - price) / pos.entryPrice;
      let why: string | null = null;
      if (pnlPct <= -STOP_LOSS_PCT) why = 'stop-loss';
      else if (pnlPct >= TAKE_PROFIT_PCT) why = 'take-profit';
      else if (day === days - 1) why = 'fixture end (closed at last price)';
      if (!why) continue;
      const pnlCents = Math.round(pos.sizeCents * pnlPct);
      trades++;
      realised += pnlCents;
      risk.equityCents += pnlCents;
      risk.dailyPnLCents += pnlCents;
      if (pnlCents > 0) wins++; else if (pnlCents < 0) losses++;
      details.push(`day ${day} ${pos.symbol} ${pos.side} ${why} pnl ${(pnlCents / 100).toFixed(2)} paper USD`);
      positions.splice(positions.indexOf(pos), 1);
    }
    for (const symbol of symbols) {
      const history = aligned[symbol].slice(0, day + 1);
      const signal = scoreSignal({ symbol, history });
      if (signal.direction === 'none' || !signal.dataOk) continue;
      if (positions.some((p) => p.symbol === symbol)) continue;
      const check = checkRisk(risk, { dailyLossLimit: 0.2, maxDrawdown: 0.3, stopLossPct: STOP_LOSS_PCT }, { dataOk: true, today });
      if (!check.pass) { blockedOpens++; continue; }
      const sizing = sizePosition({
        equityCents: risk.equityCents, signalScore: signal.score,
        perTradeCap: 0.3, dailyCap: 0.5, deployedTodayCents: risk.deployedTodayCents,
        riskAppetite: 0.5, minScore: SCORE_THRESHOLD,
      });
      if (sizing.blocked) { blockedOpens++; continue; }
      const price = history[history.length - 1].price;
      risk.deployedTodayCents += sizing.sizeCents;
      positions.push({
        symbol, side: signal.direction as 'long' | 'short', sizeCents: sizing.sizeCents,
        entryPrice: price,
        stopLoss: signal.direction === 'long' ? price * (1 - STOP_LOSS_PCT) : price * (1 + STOP_LOSS_PCT),
        takeProfit: signal.direction === 'long' ? price * (1 + TAKE_PROFIT_PCT) : price * (1 - TAKE_PROFIT_PCT),
        entryDay: day,
      });
      details.push(`day ${day} OPEN ${symbol} ${signal.direction} score ${signal.score} @ $${price.toFixed(4)} size $${(sizing.sizeCents / 100).toFixed(2)} paper`);
    }
  }
  journal.append({ type: 'backtest', paper: true, trades, wins, losses, realisedPnLCents: realised, finalEquityCents: risk.equityCents });
  return { trades, wins, losses, realisedPnLCents: realised, finalEquityCents: risk.equityCents, blockedOpens, details, alignedDays: days };
}

const fixturePath = join(process.cwd(), 'data', 'prices-30d.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
const r = runBacktest(fixture);
console.log('Tavern Trader backtest — PAPER ONLY (fixture: real CoinGecko daily closes)');
console.log(`Symbols: ${Object.keys(fixture.symbols).join(', ')} | aligned days: ${r.alignedDays} (fixture window ${fixture.days}d, intersected on shared dates) | fetched: ${fixture.fetchedAt}`);
console.log(`Trades: ${r.trades} | wins: ${r.wins} | losses: ${r.losses} | blocked opens: ${r.blockedOpens}`);
console.log(`Realised paper P&L: $${(r.realisedPnLCents / 100).toFixed(2)} on $100.00 paper equity -> final $${(r.finalEquityCents / 100).toFixed(2)}`);
for (const d of r.details) console.log('  ' + d);
