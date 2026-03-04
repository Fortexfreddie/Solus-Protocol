# Solus Protocol Policy Engine (`policy-engine.ts`)

**Location:** `src/policy/policy-engine.ts`
**Purpose:** Layer 4 of the air-gap engine. A deterministic, non-AI logic gate that rigorously double-checks every AI decision before it is allowed to reach the on-chain execution layer.

---

## 1. The Core Philosophy
AI models operate probabilistically and are prone to hallucinations; math operates deterministically. 

Even with a dual-provider setup (DeepSeek vs Gemini), we cannot mathematically guarantee the AIs won't agree on an invalid parameter. The Policy Engine enforces 9 absolute, hard-coded rules. Neither the Strategist nor the Guardian can override these.

## 2. Dynamic Clamping vs. Hard Rejection
The engine is designed to salvage a trade rather than abort the cycle completely when possible:
* **Clamping:** If DeepSeek wants to trade 0.5 SOL, but Nova's `maxTxAmountSol` is 0.05, Check 4 (`MAX_TX_AMOUNT`) will seamlessly "clamp" the amount down to 0.05, mark the check as modified, and allow the cycle to continue.
* **Forced Holds:** If the AI attempts to trade when the spread is too low or the rate limit is hit, the engine overrides the `SWAP` action and converts it to a `HOLD`, ensuring the agent stays awake without burning capital.

## 3. The 9 Security Checks
1. **Action Whitelist:** Ensures the AI only outputs SWAP, HOLD, or SKIP.
2. **Token Whitelist:** Prevents the AI from trading unsupported or malicious mints.
3. **Minimum Confidence:** Enforces the agent's risk profile confidence threshold.
4. **Max Transaction Amount:** Clamps position sizing.
5. **Daily Volume Cap:** Prevents an agent from draining liquidity through high-frequency trading.
6. **Rate Limiting:** In-memory sliding window preventing >5 trades per minute per agent.
7. **Balance Check:** Ensures sufficient funds + gas buffer exist before trading.
8. **Spread Threshold:** Enforces profitability margins. When a Jupiter execution quote is available, evaluates the **net** spread (after slippage and price impact) against the agent's threshold. Falls back to CoinGecko gross spread if no quote is available. This prevents approving trades where slippage entirely consumes the visible spread.
9. **Stop-Loss Circuit:** Calculates total USD portfolio value across all held assets. If the portfolio drops below the agent's maximum allowed drawdown, the agent is locked into a HOLD-only restricted mode.