// Fetch the real 30-day CoinGecko history fixture used by the backtest.
// Run once: `npm run fetch-history` (writes agent/data/prices-30d.json).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchHistory, UNIVERSE } from './prices.js';

const out: Record<string, unknown> = { fetchedAt: new Date().toISOString(), days: 90, symbols: {} };
for (const u of UNIVERSE) {
  (out.symbols as Record<string, unknown>)[u.symbol] = await fetchHistory(u.id, 90);
  console.log(`fetched ${u.symbol} (${u.id}): ${((out.symbols as Record<string, unknown[]>)[u.symbol] as unknown[]).length} daily closes`);
  await new Promise((r) => setTimeout(r, 1200)); // be polite to the public API
}
writeFileSync(join(process.cwd(), 'data', 'prices-30d.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('wrote data/prices-30d.json');
