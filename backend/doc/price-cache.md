# Solus Protocol Price Cache (`price-cache.ts`)

**Location:** `src/price/price-cache.ts`
**Purpose:** Acts as the shared, in-memory state for Layer 1 (Price Oracle). It strictly enforces a 30-second Time-To-Live (TTL) on all market data to prevent rate-limiting from the Jupiter API.

---



## 1. The Singleton Pattern Advantage

Because Solus Protocol runs three independent agents (Rex, Nova, and Sage) staggered at 20-second intervals, having each agent fetch its own prices would result in 3 API calls per minute. 

By exporting a single instantiated class (`export const priceCache`), all three agents share the exact same memory space. 
* **T+0s (Rex):** Cache is empty. Fetches fresh data from Jupiter. Cache TTL starts.
* **T+20s (Nova):** Cache is only 20s old. Nova reads directly from RAM without hitting Jupiter.
* **T+40s (Sage):** Cache is 40s old (TTL expired). Sage fetches fresh data from Jupiter and restarts the TTL.

**Team Takeaway:** This cuts our external API load in half while ensuring all agents are operating on highly synchronized market snapshots.

## 2. The Stale Fallback Mechanism

In DeFi, RPCs and APIs fail constantly. If Jupiter goes down, we cannot let the agents crash. 

The `getStale()` method is our Layer 1 safety net. If the `PriceOracle` fails to fetch fresh data, it calls `getStale()`. This method retrieves the last known good prices but explicitly flips the `stale` boolean to `true`. 

When the Strategist LLM (Layer 2) sees `stale: true`, its `SKILLS.md` prompt instructs it to flag a `STALE_PRICE_DATA` risk. The Guardian AI (Layer 3) will then scrutinize that risk and likely `VETO` any aggressive swaps until fresh data is restored.