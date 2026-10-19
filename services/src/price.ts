// ZEC price for the referees (BRIEF section 3): per exchange, the average of the last
// hour's 1-minute closes; across exchanges, the median. Never a single tick.
//
// Five sources are read and only those with real trading in the hour count (at least 10
// one-minute candles): a venue with three trades in an hour is not evidence of a price.
// At least three must count, or there is no price, and nothing that needs one
// (liquidation) happens. The demo's override (PRICE_OVERRIDE_FILE) replaces the feeds
// and is labelled as such.
//
// Sources (checked 9 Oct 2026; Coinbase, Kraken and Binance APIs did not resolve from the
// development machine): Bitstamp, Bitfinex and Gemini ZEC/USD; Gate.io and MEXC ZEC/USDT
// (USDT taken at par with the dollar, as the venues quote it).
import { existsSync, readFileSync } from "fs";
import { PRICE_OVERRIDE_FILE } from "./config";

export interface Price {
  /// Micro-dollars per ZEC.
  microUsd: bigint;
  source: "feeds" | "override";
  /// Hour averages of the sources that counted, plus their median (or the override).
  detail: Record<string, number>;
  /// Sources left out, and why.
  skipped?: Record<string, string>;
}

const HOUR_MS = 3_600_000;
const MIN_CANDLES = 10;
const MIN_SOURCES = 3;
type Candle = [number, number]; // [time ms, close]

async function json(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const SOURCES: Record<string, () => Promise<Candle[]>> = {
  bitstamp: async () => {
    const d = (await json("https://www.bitstamp.net/api/v2/ohlc/zecusd/?step=60&limit=60")) as {
      data: { ohlc: { timestamp: string; close: string }[] };
    };
    return d.data.ohlc.map((c) => [Number(c.timestamp) * 1000, Number(c.close)]);
  },
  bitfinex: async () => {
    const d = (await json("https://api-pub.bitfinex.com/v2/candles/trade:1m:tZECUSD/hist?limit=60")) as number[][];
    return d.map((c) => [c[0], c[2]]); // [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]
  },
  gemini: async () => {
    const d = (await json("https://api.gemini.com/v2/candles/zecusd/1m")) as number[][];
    return d.map((c) => [c[0], c[4]]); // [ms, open, high, low, close, volume]
  },
  gate: async () => {
    const d = (await json("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=ZEC_USDT&interval=1m&limit=60")) as string[][];
    return d.map((c) => [Number(c[0]) * 1000, Number(c[2])]); // [t s, quote vol, close, high, low, open, base vol, done]
  },
  mexc: async () => {
    const d = (await json("https://api.mexc.com/api/v3/klines?symbol=ZECUSDT&interval=1m&limit=60")) as (string | number)[][];
    return d.map((c) => [Number(c[0]), Number(c[4])]); // [open ms, open, high, low, close, vol, close ms, quote vol]
  },
};

/// Mean close over the last hour; throws if the source has too little trading in it.
export function hourAverage(candles: Candle[], now: number): number {
  const recent = candles.filter(([t, close]) => t > now - HOUR_MS && t <= now && close > 0);
  if (recent.length < MIN_CANDLES) throw new Error(`only ${recent.length} candles in the last hour`);
  return recent.reduce((s, [, c]) => s + c, 0) / recent.length;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/// From each source's hour average (or the reason it has none), the price: the median of
/// those that count, if at least three do.
export function pickPrice(results: Record<string, number | Error>): Price {
  const detail: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  for (const [name, r] of Object.entries(results)) {
    if (r instanceof Error) skipped[name] = r.message;
    else detail[name] = r;
  }
  const good = Object.values(detail);
  if (good.length < MIN_SOURCES) {
    throw new Error(`${good.length} of ${Object.keys(results).length} exchanges have an hour of trading; need ${MIN_SOURCES}`);
  }
  const usd = median(good);
  return { microUsd: BigInt(Math.round(usd * 1e6)), source: "feeds", detail: { ...detail, median: usd }, skipped };
}

export function readOverride(): number | null {
  if (!existsSync(PRICE_OVERRIDE_FILE)) return null;
  const usd = Number(JSON.parse(readFileSync(PRICE_OVERRIDE_FILE, "utf8")).usd);
  return usd > 0 ? usd : null;
}

/// The feeds are a one-hour average, so one read every 30 seconds is plenty; it also
/// keeps a slow exchange from stalling every screen refresh and referee tick.
const CACHE_MS = 30_000;
let cached: { at: number; price: Price } | null = null;

export async function zecPrice(now = Date.now()): Promise<Price> {
  const override = readOverride();
  if (override !== null) {
    return { microUsd: BigInt(Math.round(override * 1e6)), source: "override", detail: { override } };
  }
  if (cached && now - cached.at < CACHE_MS) return cached.price;
  const results: Record<string, number | Error> = {};
  await Promise.all(
    Object.entries(SOURCES).map(async ([name, fetchCandles]) => {
      try {
        results[name] = hourAverage(await fetchCandles(), now);
      } catch (e) {
        results[name] = e instanceof Error ? e : new Error(String(e));
      }
    }),
  );
  const price = pickPrice(results);
  cached = { at: now, price };
  return price;
}
