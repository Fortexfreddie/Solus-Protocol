# Solus Protocol Core Types (`agent-types.ts`)

**Location:** `src/types/agent-types.ts`
**Purpose:** This file is the central nervous system of the Solus Protocol architecture. It defines the exact data structures shared across the Backend Engine, the LLM APIs, the Solana RPC, the Kora Paymaster, and the Next.js Frontend Dashboard.

By defining these upfront, we guarantee that all developers (frontend, backend, and security) are speaking the exact same language and relying on strict TypeScript enforcement.

---

## 1. Agent Identity & Configuration

These types define *who* the agent is and *how* it behaves.

* **`AgentId` & `RiskProfile`**: String unions (`'rex' | 'nova' | 'sage'`) that uniquely identify our three concurrent agents and their default risk appetite. String unions are used instead of Enums to ensure clean JSON serialization when communicating with OpenAI and the frontend.
* **`PersonalityProfile`**: The operational DNA for an agent. 
    * `cycleOffsetSeconds`: Dictates the staggered start times (0s, 20s, 40s) so the dashboard always has an active agent.
    * `spreadThresholdPct` / `minConfidence` / `maxTxAmountSol`: The hard numerical limits enforced by the Policy Engine (Layer 4).
    * `llmDirective`: The string injected into `SKILLS.md` at runtime to prompt the LLM's specific behavior.

## 2. The 7-Layer Data Pipeline

The following interfaces map directly to the data passed between the 7 layers of our air-gap engine.

### Layer 1: Price Oracle
* **`PriceData`**: The market snapshot. Includes a `stale: boolean` flag for rate-limited scenarios and an optional `executionQuote?: ExecutionQuote` populated per agent cycle with real execution pricing from Jupiter.
* **`ExecutionQuote`**: Real execution pricing from Jupiter Quote API. Contains `impliedPrice` (actual execution rate), `priceImpactPct`, `netSpreadVsMarket` (net spread after slippage vs CoinGecko fair price), and `worthTrading` (whether net spread is positive). When Jupiter is unreachable, the `error` field is set and the cycle continues using CoinGecko data only.

### Layer 2 & 3: The LLM Brains
* **`StrategistDecision`**: The strict JSON schema that GPT-4o-mini **must** return. We validate this using Zod. If the LLM hallucinates, it fails validation here and the cycle aborts cleanly.
* **`GuardianAudit`**: The output of the adversarial Gemini pass. The Guardian can output `APPROVE`, `VETO`, or `MODIFY`. If it chooses `MODIFY`, it populates `modifiedAmount` to clamp the Strategist's intended trade size.

### Layer 4: Policy Engine
* **`PolicyCheck` & `PolicyResult`**: The deterministic safety net. 
    * `PolicyCheckName` lists the 9 hardcoded rules (e.g., `STOP_LOSS_CIRCUIT`). 
    * `adjustedValue` allows the engine to dynamically clamp a transaction (e.g., if a trade would breach the `DAILY_VOLUME_CAP`) without completely aborting the cycle.

### Layer 5: Proof of Reasoning
* **`ProofPayload`**: The object that gets hashed via SHA-256. Because it contains the Strategist's decision, the Guardian's verdict, the policy results, and the price snapshot, it securely binds the agent's *reasoning* to the specific market conditions.
* **`ProofRecord`**: Stores the final hash and the `memoSignature` (the Solana Devnet transaction ID where the hash is anchored).

### Layer 6: Vault & Balances
* **`EncryptedVaultFile`**: The structure of the `.vault.json` files on disk. It contains the AES-256-GCM `iv`, `authTag`, `ciphertext`, and the PBKDF2 `salt`. It intentionally lacks the private key.
* **`IVault`**: The public interface for the vault. It deliberately lacks any method to export the private key.

### Layer 7: Kora Paymaster

* **`KoraSignResult`**: Contains the `transaction` string that has been fully co-signed by the Kora node, proving the gas fee has been subsidized.
* **`KoraStatus`**: Used by the system health checks to verify the node is alive and to log the `payerAddress`.

### Real-Time Dashboard Events
* **`WsEventType`**: The standardized list of allowed WebSocket events (now including `KORA_SIGNED`).
* **`WsEventEnvelope`**: The standardized wrapper. **Frontend Dev Take Note:** Every event sent to the Next.js dashboard will follow this `{ type, agentId, timestamp, payload }` structure. You will use the `WsEventType` to trigger the Framer Motion animations in the UI pipeline.

---

## 3. Strict Coding Standards

* **No `any` Types:** Use proper TypeScript interfaces. If a type is unknown (like an external API response), type it as `unknown` and use a type guard before processing.
* **JSON Serialization:** Because this entire pipeline is fed to LLMs and WebSockets, avoid complex nested classes here. Stick to plain old JavaScript objects (POJOs) defined by these interfaces.