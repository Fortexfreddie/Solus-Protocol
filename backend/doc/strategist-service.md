# Solus Protocol Strategist Service (`strategist-service.ts`)

**Location:** `src/brain/strategist-service.ts`
**Purpose:** Implements Layer 2 of the air-gap engine. It acts as the primary brain (DeepSeek `deepseek-chat`) for all three agents, processing market data and outputting a structured trading intent.

---



## 1. The Decision Engine
This service is a stateless function that gets called every 20 seconds by the Orchestrator. 
When called, it:
1. Dynamically constructs the prompt using `SKILLS.md` and the live `PriceData`.
2. Sends the prompt to DeepSeek via the unified OpenAI SDK (`ai-client.ts`).
3. Receives a JSON string.
4. Passes the string to `decision-parser.ts`.
5. Returns a strictly typed `StrategistDecision` interface.

## 2. API Security and Failure Handling
In DeFi, relying on a 3rd party API (like DeepSeek) creates a massive single point of failure. If DeepSeek goes down, the agentic wallet must not crash.
* **Error Catching:** The `reason()` method is wrapped in a `try/catch`. If DeepSeek throws a 503 (congestion) or 529 (rate limit) error, the function catches it and returns `{ ok: false, error }` with the HTTP status code logged for diagnostics.
* **Clean Cycle Exit:** When the Orchestrator receives this `{ ok: false }` object, it simply logs an `LLM_PARSE_ERROR`, halts the current agent's cycle, and waits for the next minute to try again. No funds are risked during an API outage.

## 3. Cost Control
* We use `deepseek-chat` (DeepSeek-V3) because it is lightning fast and cost-effective.
* We cap `max_tokens` at `512`. Since the AI is only outputting a small JSON object, it should never exceed ~150 tokens. This hard cap prevents the model from experiencing a runaway generation loop that drains your API credits.