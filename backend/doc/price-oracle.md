# Solus Protocol Price Oracle (`price-oracle.ts`)

**Location:** `src/price/price-oracle.ts`
**Purpose:** Layer 1 of the air-gap engine. Fetches live market data from CoinGecko, calculates actionable spreads, and provides Jupiter execution quotes for real trade pricing.

---

## 1. Dual-Source Architecture (CoinGecko + Jupiter)

The Oracle uses **CoinGecko** for market context (USD prices and 24-hour momentum) and **Jupiter Quote API** for real execution pricing (slippage, price impact, routing fees).

CoinGecko provides:
1. **USD Price:** Current market price for SOL, USDC, RAY, and BONK.
2. **24h Momentum:** Percentage change over 24 hours, used for spread directional analysis.

Jupiter provides (per agent cycle):
1. **Implied Price:** What the agent would actually receive for a given swap at current pool depth.
2. **Price Impact:** Estimated impact of the trade on the pool.
3. **Net Spread vs Market:** Difference between Jupiter execution rate and CoinGecko fair market price — positive means profitable after fees.

## 2. Jupiter Quote Integration

The `getExecutionQuote()` method fetches a quote from `api.jup.ag/swap/v1/quote` using `x-api-key` header authentication. Token mint addresses and decimals are mapped internally for SOL, USDC, RAY, and BONK.

**Non-fatal design:** Jupiter quote failure (network error, unsupported pair, rate limit) returns an `ExecutionQuote` with `error` set. The cycle continues using CoinGecko data only. This ensures Jupiter outages never block agent operation.

## 3. Defensive Network Engineering
* **Retries:** Up to 3 attempts with exponential backoff (500ms, 1000ms, 1500ms) for CoinGecko.
* **Timeouts:** Each CoinGecko API call is protected by a 10-second `AbortController`.
* **Rate Limit Awareness:** Supports optional `COINGECKO_API_KEY` for higher rate limits via `x_cg_demo_api_key` parameter. Jupiter uses `JUPITER_API_KEY` via `x-api-key` header.
* **Stale States:** If CoinGecko fails after all retries, the Oracle fetches `priceCache.getStale()` and explicitly flags the context as `stale: true`. Agents will likely `SKIP` their cycles until connectivity is restored to protect capital.