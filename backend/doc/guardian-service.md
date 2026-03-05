# Solus Protocol Guardian Service (`guardian-service.ts`)

**Location:** `src/brain/guardian-service.ts`
**Purpose:** Layer 3 of the air-gap engine. Powers the Google Gemini adversarial auditor via the unified OpenAI SDK, enforcing the "DeepSeek proposes, Gemini audits" dual-provider security model. The adversarial isolation exists at the corporate/model level (DeepSeek vs Google), not the package level.

---



## 1. The Adversarial Mandate
Unlike the Strategist, the Guardian is not trying to find profitable trades. Its system prompt explicitly commands it to find flaws, check for overconfidence, and scrutinize position sizing. It receives the Strategist's exact output and the raw market data, and must issue one of three verdicts: `APPROVE`, `VETO`, or `MODIFY`.

## 2. Fail-Closed Security Posture
In cybersecurity, a system should "fail closed" (default to denying access) rather than "fail open" if a component breaks. 
If the Google Gemini API (accessed via its OpenAI-compatible endpoint) times out, returns unparseable JSON, or issues an incomplete verdict (like a `MODIFY` without a new amount), this service triggers a `safetyVeto: true`. The cycle aborts securely, and the agent tries again in 60 seconds.

## 3. Guardian Limitations
While Gemini is powerful, Layer 3 still enforces hard logical bounds on its outputs:
* Gemini is mathematically forbidden from *increasing* a trade size. If it attempts to `MODIFY` a 0.1 SOL trade to 0.2 SOL, the service overrides the LLM, treats it as a hallucination, and automatically converts the verdict to a `VETO`.