# Solus Protocol Agent Profiles (`agent-profiles.ts`)

**Location:** `src/agent/agent-profiles.ts`
**Purpose:** This file acts as the DNA for our three autonomous agents. It defines their exact risk tolerances, operational pacing, and LLM behavioral prompts.

---

## 1. The Dual Nature of the Profiles

These profiles are uniquely powerful because they act as both **soft instructions** and **hard mathematical boundaries**.

### The "Soft" LLM Instructions (Layer 2 & 3)
The `llmDirective` string is not just for our reference. During Layer 2 (Strategist) and Layer 3 (Guardian), this exact text is appended to the bottom of the `SKILLS.md` manual to dynamically alter the OpenAI prompt. 
* *Example:* Nova is explicitly instructed: *"Prefer stablecoin pairs (SOL/USDC). Only act on high-confidence, low-risk setups."*

### The "Hard" Deterministic Rules (Layer 4)
While the LLM is *asked* to obey the prompt, LLMs can hallucinate. Therefore, the numerical properties in these profiles (`maxTxAmountSol`, `dailyVolumeCapSol`, `spreadThresholdPct`) are passed directly into the **Policy Engine**. 
* *Example:* If Rex's LLM gets overly excited and tries to swap 0.5 SOL, the Policy Engine will read `maxTxAmountSol: 0.2` from this file and immediately clamp the transaction down to 0.2 SOL, ignoring the AI's request.

---

## 2. Agent Breakdown

* **Rex (Aggressive):** Operates at `T+0s`. Needs only a 0.5% spread and 65% confidence to execute. Has the highest daily volume cap (1.0 SOL) but risks the largest drawdown (-20% stop-loss).
* **Nova (Conservative):** Operates at `T+20s`. Requires a massive 1.0% spread and 85% confidence. Capped at tiny 0.05 SOL transactions to preserve capital.
* **Sage (Balanced):** Operates at `T+40s`. The middle ground. Looks for 0.75% spreads and maintains a strict 0.5 SOL daily cap.

**Team Takeaway:** Because of the `cycleOffsetSeconds`, the Orchestrator ensures that one of these three agents is firing its logic pipeline every 20 seconds, creating a constant, visually engaging stream of events on the Next.js dashboard.