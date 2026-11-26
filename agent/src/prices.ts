// Off-chain prices from the CoinGecko public API (no key).
// Gno testnet has no real DEX price feed, so the scored universe is
// GNOT + BTC/ETH/SOL in USD, fetched off-chain. The realm never sees a
// price except as the entry/close the agent records — the README says so.
//
// CoinGecko ids: gno-land (GNOT), bitcoin, ethereum, solana.
// Staleness: a spot quote older than 10 minutes is stale and fail-closed.
import type { PricePoint } from './signal.js';

export const UNIVERSE: { symbol: string; id: string }[] = [
  { symbol: 'GNOT', id: 'gno-land' },
  { symbol: 'BTC', id: 'bitcoin' },
  { symbol: 'ETH', id: 'ethereum' },
  { symbol: 'SOL', id: 'solana' },
];

export const SPOT_MAX_AGE_MS = 10 * 60 * 1000;

export interface SpotQuote {
  symbol: string;
  price: number;
  change24hPct: number;
  fetchedAt: number;
  fresh: boolean;
}

export async function fetchSpot(fetchFn: typeof fetch = fetch): Promise<SpotQuote[]> {
  const ids = UNIVERSE.map((u) => u.id).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko spot HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
  const now = Date.now();
  return UNIVERSE.map((u) => {
    const d = data[u.id];
    const price = d?.usd ?? 0;
    return {
      symbol: u.symbol,
      price,
      change24hPct: d?.usd_24h_change ?? 0,
      fetchedAt: now,
      fresh: price > 0,
    };
  });
}

/** 30 days of daily closes + volumes for one coin (used by the backtest fixture). */
export async function fetchHistory(
  id: string,
  days = 30,
  fetchFn: typeof fetch = fetch,
): Promise<PricePoint[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko history HTTP ${res.status} for ${id}`);
  const data = (await res.json()) as { prices: [number, number][]; total_volumes: [number, number][] };
  return data.prices.map(([ts, price], i) => ({
    ts,
    price,
    volume: data.total_volumes[i]?.[1] ?? 0,
  }));
}

export function isFresh(q: SpotQuote, now = Date.now()): boolean {
  return q.fresh && now - q.fetchedAt <= SPOT_MAX_AGE_MS;
}
