# Solus Protocol Permission Profiles (`permission-profiles.ts`)

**Location:** `src/policy/permission-profiles.ts`
**Purpose:** Defines the strict, numeric boundary conditions for the Layer 4 Policy Engine.

---

## 1. Interface Segregation
While `agent-profiles.ts` holds the complete identity of an agent (including LLM directives, lore, and text prompts), `permission-profiles.ts` isolates *only* the mathematical constraints. 

By feeding the `PolicyEngine` this stripped-down `PolicyEngineProfile` interface, we guarantee that the deterministic safety checks are completely decoupled from the AI's natural language generation instructions. 

## 2. The Profiles
These numbers directly map to the 9 hard checks in the Policy Engine:
* **Rex (Aggressive):** Tolerates high drawdowns (-20%), allows large single trades (0.2 SOL), and acts on thin spreads (0.5%).
* **Nova (Conservative):** Extremely protective. Triggers stop-loss at just -10%, caps trades at a tiny 0.05 SOL, and demands a massive 1.0% spread before risking capital.
* **Sage (Balanced):** The middle ground, balancing steady growth with moderate risk controls (-15% stop-loss, 0.1 SOL max trade).