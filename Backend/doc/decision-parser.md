# Solus Protocol Decision Parser (`decision-parser.ts`)

**Location:** `src/brain/decision-parser.ts`
**Purpose:** Acts as the strict, deterministic firewall between the LLM APIs and the internal Solus Protocol Policy Engine. It validates the outputs of both the DeepSeek Strategist and the Gemini Guardian using Zod schemas.

---



## 1. The Necessity of Zod Validation
LLMs are probabilistic, meaning they can and will hallucinate formats, invent new token symbols, or output plain text instead of JSON. 

Because all outputs from the Strategist and Guardian must pass through the Policy Engine (Layer 4), feeding unvalidated LLM strings directly into our internal logic is a massive security vulnerability. This module uses `zod` to enforce the exact properties required by the `StrategistDecision` and `GuardianAudit` interfaces.

## 2. Fail-Safe Parsing
If an LLM returns malformed data, we must not throw an uncaught exception that crashes the Node server. 
* This module uses a `try/catch` around `JSON.parse` and `safeParse` for Zod.
* It returns a discriminated union: `ParseResult<T>`.
* If parsing fails, it returns `{ ok: false, error, rawOutput }`. 
* The calling layer can then emit an `LLM_PARSE_ERROR` WebSocket event and execute a clean cycle exit, exactly as dictated by the master workflow.

## 3. Defense-in-Depth
* **Markdown Stripping:** Automatically removes ```json fences that LLMs frequently prepend to their outputs. Both DeepSeek and Gemini's OpenAI-compatible endpoint can occasionally wrap JSON in code fences despite explicit instructions.
* **Value Clamping:** Zod ensures `amount` is positive and finite, and `confidence` is strictly bounded between `0.0` and `1.0`.