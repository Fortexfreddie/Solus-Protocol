# Solus Protocol Prompt Builder (`prompt-builder.ts`)

**Location:** `src/brain/prompt-builder.ts`
**Purpose:** Dynamically constructs the context windows for Layer 2 (Strategist) and Layer 3 (Guardian) by merging the agent's current state, live market data, and the `SKILLS.md` operator manual.

---



## 1. The "Hot-Swappable" Brain
Unlike traditional applications that load configuration files once at startup, `prompt-builder.ts` reads `SKILLS.md` directly from the disk *every single time* an agent cycle fires. 

**Team Takeaway:** If the judges ask you to change an agent's behavior during the live demo (e.g., "Can you make Rex stop trading BONK?"), you can simply type that rule into `SKILLS.md` and save the file. Within 60 seconds, Rex will read the new rule and obey it. No server restart required.

## 2. The Strategist Context (Layer 2)
The Strategist prompt is built in two parts:
1.  **System Prompt:** `SKILLS.md` + The agent's specific `PersonalityProfile` (`llmDirective`, `spreadThresholdPct`, etc.). It explicitly warns the DeepSeek model that a Google Gemini Guardian will be auditing its work, encouraging rigorous reasoning.
2.  **User Prompt:** A highly formatted snapshot of the current cycle, including live prices, computed spreads, current agent balances, and the last 5 transactions.

## 3. The Guardian Context (Layer 3)
The Guardian prompt flips the script:
1.  **System Prompt:** Explicitly instructs Google Gemini to act as an adversarial auditor. It explains the multi-provider architecture (DeepSeek vs Google) and demands that Gemini look for flaws, overconfidence, and unjustified risk.
2.  **User Prompt:** Passes the exact JSON decision outputted by the Strategist, alongside the exact market data the Strategist used (including Jupiter execution quote), asking Gemini to verify the logic.

## 4. Jupiter Execution Quote Context
Both Strategist and Guardian prompts include Jupiter execution quote data when available. The `formatExecutionQuote()` helper appends a block showing the implied execution rate, price impact, net spread vs market, and a `worthTrading` signal. When Jupiter is unavailable, both LLMs are told to use CoinGecko spreads only. This allows the Guardian to veto trades where slippage would consume the visible spread.