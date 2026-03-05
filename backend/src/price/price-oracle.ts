/**
 * price-oracle.ts
 * Layer 1: Price Oracle Service (CoinGecko Exclusive).
 *
 * Fetches live token USD prices and 24-hour momentum data exclusively from CoinGecko
 * to bypass Jupiter API v2 authentication requirements. Results are stored in the
 * shared PriceCache singleton.
 *
 * On API failure, the last known cached data is returned with stale: true.
 */

import type {
    PriceData,
    TokenSymbol,
    TokenPrice,
    SpreadData,
    ExecutionQuote,
} from '../types/agent-types.js';
import { priceCache } from './price-cache.js';

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

const COINGECKO_IDS: Record<TokenSymbol, string> = {
    SOL: 'solana',
    USDC: 'usd-coin',
    RAY: 'raydium',
    BONK: 'bonk',
};

// Token mint addresses. Wrapped SOL is used for Jupiter swaps —
// native SOL must be wrapped before it can be routed.
const TOKEN_MINTS: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

// Decimals needed to convert human units to base units for the API.
const TOKEN_DECIMALS: Record<string, number> = {
    SOL: 9,
    USDC: 6,
    RAY: 6,
    BONK: 5,
};

const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

const SPREAD_PAIRS: [TokenSymbol, TokenSymbol][] = [
    ['SOL', 'USDC'],
    ['RAY', 'SOL'],
    ['BONK', 'SOL'],
    ['RAY', 'USDC'],
];

interface CoinGeckoResponse {
    [id: string]: {
        usd: number;
        usd_24h_change?: number;
    };
}

// Spread calculation ────────────────────────────────────────────────────────

function calculateSpread(
    baseSymbol: TokenSymbol,
    quoteSymbol: TokenSymbol,
    prices: Record<TokenSymbol, TokenPrice>,
): SpreadData {
    const base = prices[baseSymbol];
    const quote = prices[quoteSymbol];

    // Momentum divergence: how differently are these two tokens moving over 24h?
    // This is NOT an execution spread — it is a relative momentum signal.
    // A large divergence means one token is moving significantly vs its pair,
    // which may represent a tradeable opportunity when confirmed by Jupiter quote.
    const divergence = base.change24h - quote.change24h;
    const spreadPct = Math.abs(divergence);

    // Direction: which token has stronger upward momentum?
    // "overpriced" here means "outperforming" — the token with higher momentum
    // relative to its pair. This informs trade direction.
    let direction: string;
    if (spreadPct < 0.5) {
        direction = 'neutral';
    } else if (divergence > 0) {
        // base has higher momentum → base outperforming → sell base, buy quote
        direction = `${baseSymbol}_overpriced`;
    } else {
        // quote has higher momentum → quote outperforming → sell quote, buy base
        direction = `${quoteSymbol}_overpriced`;
    }

    return {
        spreadPct: Math.round(spreadPct * 1000) / 1000,
        direction,
    };
}

function buildSpreads(prices: Record<TokenSymbol, TokenPrice>): Record<string, SpreadData> {
    const spreads: Record<string, SpreadData> = {};
    for (const [base, quote] of SPREAD_PAIRS) {
        spreads[`${base}_${quote}`] = calculateSpread(base, quote, prices);
    }
    return spreads;
}

// Single Fetcher (CoinGecko) ───────────────────────────────────────────────

async function fetchPrices(): Promise<Record<TokenSymbol, TokenPrice>> {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const apiKey = process.env.COINGECKO_API_KEY;

    // Request both 'usd' and 'include_24hr_change'
    let url = `${COINGECKO_API}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    if (apiKey) url += `&x_cg_demo_api_key=${apiKey}`;

    const maxAttempts = 3;
    let attempt = 0;
    let res: Response | null = null;

    while (attempt < maxAttempts) {
        attempt++;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            res = await fetch(url, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json', 'User-Agent': 'Solus Protocol/2.0' },
            });
            clearTimeout(timeoutId);

            if (res.ok) break;

            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        } catch (error) {
            console.warn(`[PriceOracle] Network error on attempt ${attempt}: ${(error as Error).message}`);
            if (attempt >= maxAttempts) throw error;
        }
    }

    if (!res || !res.ok) {
        throw new Error(`CoinGecko HTTP ${res?.status}`);
    }

    const json = await res.json() as CoinGeckoResponse;
    const prices = {} as Record<TokenSymbol, TokenPrice>;

    for (const [symbol, cgId] of Object.entries(COINGECKO_IDS) as [TokenSymbol, string][]) {
        const data = json[cgId];
        if (!data) throw new Error(`Missing CoinGecko data for ${symbol}`);
        prices[symbol] = {
            usd: data.usd,
            change24h: data.usd_24h_change ?? 0,
        };
    }

    return prices;
}

// PriceOracle class ────────────────────────────────────────────────────────

type PriceFetchedCallback = (data: PriceData) => void;

export class PriceOracle {
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private readonly onFetched: PriceFetchedCallback | null;

    constructor(onFetched?: PriceFetchedCallback) {
        this.onFetched = onFetched ?? null;
    }

    start(): void {
        if (this.pollTimer) return;
        void this.fetchAndCache();
        this.pollTimer = setInterval(() => {
            void this.fetchAndCache();
        }, POLL_INTERVAL_MS);
    }

    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async getPrices(): Promise<PriceData> {
        const cached = priceCache.get();
        if (cached) return cached;
        return this.fetchAndCache();
    }

    /**
     * Fetches a real execution quote from Jupiter Quote API v1.
     * Returns what the agent would actually receive for the proposed swap
     * at current pool depth, including slippage and price impact.
     *
     * Called once per agent cycle, using the agent’s proposed
     * fromToken/toToken pair and a representative amount (0.1 SOL equivalent).
     * The quote is passed to the Strategist as execution context alongside
     * the CoinGecko market price.
     *
     * On failure (network error, unsupported pair, devnet liquidity absent),
     * returns an ExecutionQuote with error set. The cycle continues using
     * CoinGecko data only — Jupiter quote failure is non-fatal.
     */
    async getExecutionQuote(
        fromToken: string,
        toToken: string,
        amount: number,
        fromPriceUsd: number,
        toPriceUsd: number,
    ): Promise<ExecutionQuote> {
        const fromMint = TOKEN_MINTS[fromToken];
        const toMint = TOKEN_MINTS[toToken];

        if (!fromMint || !toMint) {
            return this.quoteError(fromToken, toToken, amount, 'Unsupported token pair');
        }

        const decimals = TOKEN_DECIMALS[fromToken] ?? 9;
        const amountBase = Math.floor(amount * Math.pow(10, decimals));

        try {
            const url = new URL('https://api.jup.ag/swap/v1/quote');
            url.searchParams.set('inputMint', fromMint);
            url.searchParams.set('outputMint', toMint);
            url.searchParams.set('amount', amountBase.toString());
            url.searchParams.set('slippageBps', '50');

            const res = await fetch(url.toString(), {
                headers: {
                    'Accept': 'application/json',
                    'x-api-key': process.env.JUPITER_API_KEY as string,
                },
            });

            if (!res.ok) {
                return this.quoteError(fromToken, toToken, amount, `Jupiter API ${res.status}`);
            }

            const data = await res.json() as Record<string, string>;

            const toDecimals = TOKEN_DECIMALS[toToken] ?? 6;
            const inAmount = Number(data.inAmount) / Math.pow(10, decimals);
            const outAmount = Number(data.outAmount) / Math.pow(10, toDecimals);
            const priceImpactPct = parseFloat(data.priceImpactPct ?? '0');

            // Calculate exact USD values for input and output to get true spread
            const inValueUsd = inAmount * fromPriceUsd;
            const outValueUsd = outAmount * toPriceUsd;

            // Net spread: how much better (or worse) is the execution value
            // vs the CoinGecko fair market value, after price impact.
            const netSpreadVsMarket = inValueUsd > 0 ? (outValueUsd - inValueUsd) / inValueUsd : 0;

            // Implied execution price in USD for the asset being traded
            let impliedPrice = 0;
            if (fromToken === 'USDC') {
                impliedPrice = outAmount > 0 ? inAmount / outAmount : 0;
            } else {
                impliedPrice = inAmount > 0 ? (outAmount / inAmount) * toPriceUsd : 0;
            }

            return {
                fromToken,
                toToken,
                inAmount,
                outAmount,
                impliedPrice,
                priceImpactPct,
                slippageBps: 50,
                netSpreadVsMarket,
                worthTrading: netSpreadVsMarket > 0,
                fetchedAt: Date.now(),
            };

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return this.quoteError(fromToken, toToken, amount, message);
        }
    }

    private quoteError(
        fromToken: string,
        toToken: string,
        amount: number,
        error: string,
    ): ExecutionQuote {
        return {
            fromToken,
            toToken,
            inAmount: amount,
            outAmount: 0,
            impliedPrice: 0,
            priceImpactPct: 0,
            slippageBps: 50,
            netSpreadVsMarket: 0,
            worthTrading: false,
            fetchedAt: Date.now(),
            error,
        };
    }

    private async fetchAndCache(): Promise<PriceData> {
        try {
            const prices = await fetchPrices();
            const spreads = buildSpreads(prices);

            const data: PriceData = {
                timestamp: Date.now(),
                stale: false,
                prices,
                spreads,
            };

            priceCache.set(data);
            this.onFetched?.(data);
            return data;

        } catch (err) {
            const staleData = priceCache.getStale();
            if (staleData) {
                const result: PriceData = { ...staleData, stale: true };
                this.onFetched?.(result);
                return result;
            }
            throw new Error(`[PriceOracle] Fetch failed: ${(err as Error).message}`);
        }
    }
}

// Singleton ────────────────────────────────────────────────────────────────

let _oracle: PriceOracle | null = null;

export function getPriceOracle(onFetched?: PriceFetchedCallback): PriceOracle {
    if (!_oracle) {
        _oracle = new PriceOracle(onFetched);
    }
    return _oracle;
}