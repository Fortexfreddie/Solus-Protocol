# Solus Protocol — Deep Dive
## Technical Architecture, Design Decisions, and Security Model
### Superteam Nigeria | DeFi Developer Challenge — Agentic Wallets for AI Agents

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Problem This Solves](#the-problem-this-solves)
3. [System Architecture Overview](#system-architecture-overview)
4. [The 7-Layer Air-Gap Engine — In Depth](#the-7-layer-air-gap-engine)
5. [Agent Design and Autonomy](#agent-design-and-autonomy)
6. [Wallet Design and Key Management](#wallet-design-and-key-management)
7. [Dual-Model Adversarial AI Pipeline](#dual-model-adversarial-ai-pipeline)
8. [Proof-of-Reasoning — The On-Chain Audit Trail](#proof-of-reasoning)
9. [Kora Gasless Integration](#kora-gasless-integration)
10. [Dual-Mode Persistence Layer](#dual-mode-persistence-layer)
11. [Policy Engine Design](#policy-engine-design)
12. [SKILLS.md as a Runtime System Prompt](#skillsmd-as-a-runtime-system-prompt)
13. [WebSocket Event Architecture](#websocket-event-architecture)
14. [Threat Model](#threat-model)
15. [Known Limitations and Future Work](#known-limitations-and-future-work)
16. [Agent Command Center](#agent-command-center)
17. [PnL Leaderboard](#pnl-leaderboard)
18. [Telegram Bot](#telegram-bot)

---

## 1. Introduction

### TL;DR for Judges
- **7-Layer Air-Gap Engine:** Decouples AI reasoning from private key execution through a deterministic policy engine and zero-trust vault.
- **Dual-Model Adversarial Auditing:** Uses DeepSeek for strategy and Gemini for risk auditing, mitigating single-model bias and hallucination.
- **On-Chain Proof-of-Reasoning:** Cryptographically anchors the entire decision context (including price snapshots and LLM inputs/outputs) to Devnet via SHA-256 and Solana Memo before any funds can move.

Solus Protocol is a prototype demonstrating what production-grade agentic wallet infrastructure looks like on Solana. It is not a toy demo — it is an opinionated, security-first design that answers the question: *how do you give an AI agent a wallet and sleep at night?*

The answer requires solving several problems simultaneously:

- **Key isolation:** the agent must never hold its own private key
- **Decision accountability:** every autonomous decision must be verifiable after the fact
- **Hallucination containment:** a single LLM making financial decisions is insufficient
- **Policy enforcement:** hard spending rules that no model can override
- **Gas abstraction:** agents should not need to manage SOL reserves just to operate
- **Observability:** humans need to watch what agents are doing in real time

Solus Protocol addresses all six. This document explains how.

---

## 2. The Problem This Solves

### The Hot Wallet Problem

Traditional wallets require a human to approve every transaction. For an AI agent to act autonomously, it needs a wallet it controls — one that can sign transactions without waiting for human input. But giving an AI model direct access to a private key is catastrophically dangerous. A hallucinating LLM with an unlocked wallet is a liability, not an asset.

### The Trust Problem

How do you trust that an autonomous agent made a sound decision before spending funds? Without an audit trail, you cannot. The agent could have received bad data, hallucinated a price, or been manipulated through its prompt. You need cryptographic proof of what the agent knew and decided before it acted.

### The Gas Problem

Agents holding and trading USDC still need SOL to pay network fees. This creates a dependency: every agent wallet must hold a SOL reserve that gets consumed over time. Managing these reserves at scale is operationally complex and creates a new attack surface — drain the SOL, paralyze the agent.

### The Accountability Problem

If an agent executes a bad trade, who is responsible? Without a structured, immutable record of the decision chain — what data the agent saw, what it reasoned, what a second model said, what policy checks ran — there is no basis for accountability, debugging, or compliance.

Solus Protocol solves all four.

---

## 3. System Architecture Overview

Solus Protocol is structured around three principles:

**Separation of concerns.** The agent's reasoning (LLM layers) is completely isolated from the agent's execution (Vault). The LLM layers never see a private key. They output a decision. The execution layers validate and act on that decision.

**Defense in depth.** No single component is trusted absolutely. The Strategist's decision is challenged by the Guardian. The Guardian's approval is checked by the Policy Engine. The Policy Engine's approval is required before the Vault will sign. Every layer can independently stop the cycle.

**Full observability.** Every layer emits a WebSocket event. Every action is written to an append-only audit log. Every approved decision is hashed and stored on-chain. There is no action that is not observable and verifiable.

### Component Relationships

```
Agent Orchestrator
  └── Agent (Rex / Nova / Sage)
        └── runCycle()
              ├── Layer 1:  Price Oracle       (CoinGecko cache + momentum divergence spreads)
              ├── Layer 1b: Jupiter Pre-scan   (execution quote for highest-divergence pair)
              ├── Layer 2:  Strategist         (DeepSeek — decides with real quote in context)
              ├── Layer 1c: Quote Correction   (re-fetch if decided pair differs from pre-scan)
              ├── Layer 3:  Guardian           (Gemini — audits with correct trade quote)
              ├── Layer 4:  Policy Engine      (9 deterministic rule checks)
              ├── Layer 5:  Proof Service      (SHA-256 + Solana Memo anchor)
              ├── Layer 6:  Vault              (AES-256-GCM decrypt + partial sign + zero)
              └── Layer 7:  Kora + Broadcast   (gasless co-sign + Devnet confirm)

Shared across all agents:
  ├── Price Cache       (30s TTL, single instance)
  ├── Audit Logger      (append-only, file + DB in prod)
  ├── Event Bus         (Socket.io, broadcasts to dashboard)
  └── Solana RPC        (single Devnet connection)
```

---

## 4. The 7-Layer Air-Gap Engine — In Depth

### Why 7 Layers?

The number is not arbitrary. Each layer addresses a distinct failure mode:

| Layer | Failure Mode It Addresses |
| :--- | :--- |
| **L1 Price Oracle** | Agent reasoning on stale or fabricated prices |
| **L1b Jupiter Pre-scan** | Strategist deciding without real executable pricing — mislabelling momentum divergence as a tradeable spread |
| **L2 Strategist** | No reasoning at all — scripted or hardcoded decisions |
| **L3 Guardian** | Single-model hallucination or bias going unchallenged |
| **L4 Policy Engine** | LLM outputs that technically pass L3 but violate hard spending rules |
| **L5 Proof-of-Reasoning** | No verifiable record that a decision was made before execution |
| **L6 Vault** | Private key exposure to application logic or LLM context |
| **L7 Kora + Broadcast** | Agent needing SOL reserves for gas; raw RPC submission without fee abstraction |

Removing any layer leaves a specific, exploitable gap in the architecture.

### Layer 1 — Price Oracle Service

**File:** `src/price/price-oracle.ts`

The Price Oracle is the data foundation of every agent cycle. Its job is to provide grounded, real-world market data so that LLM decisions are not made in a vacuum.

**Design decisions:**

*Shared cache.* All three agents read from a single `PriceCache` instance with a 30-second TTL. This prevents three simultaneous CoinGecko API calls every minute and ensures all agents are reasoning about the same price snapshot within any given window.

*Stale flag.* On API failure, the Oracle returns the last cached data with `stale: true`. This allows the cycle to continue with a caveat rather than crashing entirely. The Strategist's prompt includes the stale flag so the LLM can factor data freshness into its confidence score.

*Momentum divergence spreads.* Raw prices alone are not sufficient signal. The Oracle calculates momentum divergence between token pairs — the difference in 24-hour price change between two assets. If SOL rose 0.77% and USDC rose 0.01% over the past 24 hours, the SOL/USDC divergence is 0.76% with direction `SOL_overpriced`. This is a directional signal that identifies *which* pair may have a tradeable opportunity. It is a deterministic TypeScript calculation, not an LLM inference, and it runs in the Oracle, not in the model.

**Important:** momentum divergence is not an execution spread. It does not account for slippage, pool depth, or routing fees. In testing, a 0.63% CoinGecko momentum divergence for SOL/USDC corresponded to a 0.058% Jupiter net spread after slippage — a tenfold difference. The Jupiter execution quote (Layer 1b) is the definitive signal for whether an opportunity is actually executable.

*Spread direction and trade action.* When momentum divergence exceeds the 0.5% neutral threshold, the Oracle computes a direction: `base_overpriced` means the base token is outperforming and should be sold; `quote_overpriced` means the reverse. This maps directly to `fromToken` and `toToken` in the Strategist's output — the overperforming token is always the `fromToken`.

*Jupiter execution quote.* `getExecutionQuote()` calls Jupiter Quote API v1 (`api.jup.ag/swap/v1/quote`) to retrieve what the agent would actually receive at current pool depth. The result includes `inAmount`, `outAmount`, `priceImpactPct`, and `netSpreadVsMarket` — the percentage difference between CoinGecko fair value and actual execution value after slippage and routing fees. Jupiter failure is strictly non-fatal; the cycle continues using CoinGecko data only.

**Output shape:**
```json
{
  "timestamp": 1700000000000,
  "stale": false,
  "prices": {
    "SOL":  { "usd": 83.94, "change24h": 0.68 },
    "USDC": { "usd": 0.9999, "change24h": 0.00 },
    "RAY":  { "usd": 0.5863, "change24h": -0.10 },
    "BONK": { "usd": 0.00000587, "change24h": -0.34 }
  },
  "spreads": {
    "SOL_USDC":  { "spreadPct": 0.630, "direction": "SOL_overpriced" },
    "RAY_SOL":   { "spreadPct": 0.730, "direction": "SOL_overpriced" },
    "BONK_SOL":  { "spreadPct": 0.974, "direction": "SOL_overpriced" },
    "RAY_USDC":  { "spreadPct": 0.100, "direction": "neutral" }
  },
  "executionQuote": {
    "fromToken": "BONK",
    "toToken": "SOL",
    "inAmount": 0.1,
    "outAmount": 0.000699,
    "impliedPrice": 0.00000587,
    "priceImpactPct": 0.001,
    "netSpreadVsMarket": 0.00023,
    "worthTrading": true
  }
}
```

### Layer 1b — Jupiter Pre-scan

**File:** `src/agent/agent.ts` → `getBestMomentumPair()`

This is the architectural decision that makes the Strategist reliable. Without it, DeepSeek receives only momentum divergence data and no real execution quote. In testing, this caused DeepSeek to consistently mislabel the divergence value as a "Jupiter net spread" in its reasoning — producing plausible-sounding but numerically wrong output that Gemini vetoed every cycle.

Before the Strategist runs, `buildCandidateList()` collects all non-neutral momentum pairs sorted by descending divergence, and the agent selects the pair at its current `prescanRotationIndex` — advancing the index each cycle. This rotation ensures all candidate pairs receive real execution quotes over time. Without it, the highest-divergence pair (e.g. USDC→RAY) monopolized every pre-scan slot despite consistently producing negative Jupiter net spreads on Devnet — causing every agent to HOLD every cycle because Step 1 of the Decision Rule correctly rejects negative executable sprea

```typescript
private buildCandidateList(priceData: PriceData): CandidatePair[] {
    const candidates: CandidatePair[] = [];
    for (const [key, spread] of Object.entries(priceData.spreads)) {
        if (spread.direction === 'neutral') continue;
        const [tokenA, tokenB] = key.split('_') as [string, string];
        const pair: CandidatePair = spread.direction.startsWith(tokenA)
            ? { from: tokenA, to: tokenB, spreadPct: spread.spreadPct }
            : { from: tokenB, to: tokenA, spreadPct: spread.spreadPct };
        candidates.push(pair);
    }
    candidates.sort((a, b) => b.spreadPct - a.spreadPct);
    return candidates;
}
```

The resulting quote is attached to `priceData.executionQuote` before the Strategist prompt is constructed. DeepSeek now sees both signals: the momentum divergence (which pair to consider) and the real net spread (whether execution is profitable). If all pairs are neutral, `buildCandidateList()` returns null and no API call is made.

### Layer 1c — Quote Correction

**File:** `src/agent/agent.ts`

After the Strategist decides, if it selected a different pair than the pre-scan, a second Jupiter quote is fetched for the exact decided pair and amount. This ensures the Guardian and Policy Engine evaluate the true execution cost of the actual proposed trade, not a proxy quote.

If the Strategist decided on the same pair as the pre-scan — the common case when the highest-divergence pair is also the most attractive — this step is skipped entirely. No duplicate API call.

```
Pre-scan fetches:    BONK→SOL (highest momentum divergence pair)
Strategist decides:  SOL→USDC (different pair selected)
Layer 1c:            fetch Jupiter quote for SOL→USDC at decided amount
Guardian audits:     with the correct SOL→USDC quote — fair evaluation
```

### Layer 2 — Strategist Service

**File:** `src/brain/strategist-service.ts`
**Model:** DeepSeek `deepseek-chat`

The Strategist is the primary decision-making component. It is the only layer that produces a trade intent.

**Design decisions:**

*SKILLS.md loaded at runtime.* The agent's operational constitution is not hardcoded into the service. It is read from disk at each call. Behavioral updates require only a file edit — no rebuild, no redeploy.

*Personality injection.* After the SKILLS.md base, the agent's `PersonalityProfile` is appended. Rex gets an aggressive directive with a 0.15% spread threshold. Nova gets a conservative one at 0.5%. Sage gets a balanced one at 0.3%. Same Strategist code, three genuinely different agents.

*4-step Decision Rule enforced in SKILLS.md.* The Strategist is given an explicit ordered decision process:

1. If Jupiter net spread is negative → HOLD immediately
2. If Jupiter net spread is positive but below the agent threshold → HOLD
3. If confidence would fall below the agent minimum → HOLD
4. All checks pass → SWAP with correct token direction

This ordered rule prevents the Strategist from proposing a SWAP that Gemini then has to veto — saving two API roundtrips per bad cycle.

*Strict JSON output schema.* The model is instructed to respond only in valid JSON matching a specific schema. The output is validated with Zod. If the model returns anything that does not conform, the output is rejected and the cycle ends cleanly with a logged `LLM_PARSE_ERROR`.

*Context window construction.* The prompt contains: current prices and momentum divergence spreads, the real Jupiter execution quote, current wallet balance, last 5 transactions, and the SKILLS.md + personality prompt. The model has everything it needs to reason — and nothing it should not have (no private keys, no vault paths, no credentials).

**Decision output:**
```json
{
  "decision": "SWAP",
  "fromToken": "SOL",
  "toToken": "USDC",
  "amount": 0.15,
  "confidence": 0.72,
  "reasoning": "Jupiter net spread for SOL→USDC is +0.19%, exceeding my 0.15% threshold. SOL momentum divergence 0.63% with SOL_overpriced direction. Executing SWAP SOL→USDC.",
  "riskFlags": ["LARGE_POSITION"]
}
```

### Layer 3 — Guardian AI Service

**File:** `src/brain/guardian-service.ts`
**Model:** Google Gemini `gemini-2.5-flash`

The Guardian is the architectural feature that most clearly differentiates Solus Protocol. See [Section 7](#dual-model-adversarial-ai-pipeline) for the full adversarial AI design rationale.

**The Guardian's role is not to make a better decision. Its role is to find reasons to reject the Strategist's decision.**

Its system prompt explicitly instructs it to act as a risk auditor, challenge the reasoning, and only approve if the decision is sound. It receives the Strategist's full output alongside the current market data — including the corrected Jupiter execution quote for the exact proposed trade — and the agent's permission profile.

Because the Guardian now receives the quote for the *actual* decided pair (after Layer 1c correction), its evaluation is precise. If the Strategist claims "Jupiter net spread is +0.19%" and the quote confirms +0.19%, the Guardian can approve. If there is a discrepancy, the Guardian catches it.

**Verdict options:**

- `APPROVE` — decision is sound, proceed to Policy Engine
- `VETO` — decision has a flaw; challenge reasoning is logged and the cycle ends
- `MODIFY` — directionally correct but the amount should be reduced; `modifiedAmount` is returned and applied before proceeding

*Note: The Guardian's API call intentionally omits `response_format: { type: 'json_object' }` — Gemini's OpenAI-compatible endpoint truncates JSON mid-generation when this flag is set. The Guardian response is parsed using `stripCodeFences` + Zod validation instead.*

**Why a different provider?** DeepSeek and Gemini are trained differently, on different data, by different organizations, with different alignment approaches. A decision that passes both is genuinely more robust than a decision that passes one model twice. This is the same principle as multi-sig wallets, applied to AI reasoning.

### Layer 4 — Policy Engine

**File:** `src/security/policy-engine.ts`

The Policy Engine is the only layer in the system with no AI component. It is pure deterministic TypeScript. Neither LLM can influence its output. It runs after Guardian approval and before the Vault signs anything.

**All 9 checks run in order, and the failure reason for every check is logged regardless of the final outcome.**

The stop-loss circuit (Check 9) is particularly important. It tracks total portfolio value in USD across all held tokens — SOL, USDC, RAY, BONK — to avoid false positives when SOL is legitimately converted to USDC in a valid swap. If the circuit trips, the agent enters HOLD-only mode until manually reset. The circuit is entirely deterministic — no LLM involvement.

**Each check emits its result to the dashboard individually.** Judges and observers can watch the 9 checkboxes animate green or red in real time. This makes policy enforcement visible and auditable, not just functional.

### Layer 5 — Proof-of-Reasoning Service

**File:** `src/proof/proof-service.ts`

See [Section 8](#proof-of-reasoning) for the complete design rationale.

### Layer 6 — Vault

**File:** `src/wallet/vault.ts`

See [Section 6](#wallet-design-and-key-management) for the complete wallet design.

### Layer 7 — Kora Paymaster + Broadcast Service

**Files:** `src/protocol/kora-paymaster.ts`, `src/protocol/broadcast-service.ts`

See [Section 9](#kora-gasless-integration) for the complete Kora integration design.

---

## 5. Agent Design and Autonomy

### What Makes an Agent Autonomous

An agent in Solus Protocol is autonomous in the strict sense: it makes decisions and executes them without any human action required at any point in the cycle. There is no approval button. There is no human in the loop by default.

Autonomy is achieved through three components working together:

1. **The Vault** holds the agent's keypair and will sign a transaction when the execution pipeline approves it — no human confirmation required.
2. **The `runCycle()` method** is triggered by a timer, not by a human request.
3. **The Orchestrator** manages the timer and the agent lifecycle without external instruction.

### Agent Profiles

Each agent is defined by a `PersonalityProfile` in `agent-profiles.ts`. The profile governs both the Policy Engine's hard limits and the LLM directive injected into the Strategist's system prompt. The same TypeScript object serves both purposes — there is no separate configuration for the LLM and the rule engine.

| Parameter | Rex (Aggressive) | Nova (Conservative) | Sage (Balanced) |
| :--- | :---: | :---: | :---: |
| `spreadThresholdPct` | 0.15% | 0.50% | 0.30% |
| `minConfidence` | 0.45 | 0.65 | 0.55 |
| `maxTxAmountSol` | 0.20 SOL | 0.05 SOL | 0.10 SOL |
| `dailyVolumeCapSol` | 1.00 SOL | 0.30 SOL | 0.50 SOL |
| `stopLossTriggerPct` | -20% | -10% | -15% |

These thresholds are calibrated for Devnet liquidity pools, which have significantly wider slippage than mainnet. On mainnet deployment, higher spread and confidence minimums would be appropriate.

Rex will find a reason to act on almost any non-neutral momentum signal. Nova will HOLD most cycles and only act when the execution spread is genuinely strong. Sage sits between them. Same pipeline, same code, three genuinely different agents.

### Agent Isolation

Each agent is completely isolated:

- **Separate wallet files / DB rows** — no shared storage
- **Separate rate limiter instances** — one agent hitting its rate limit does not affect others
- **Separate daily volume counters** — each agent's spending cap is tracked independently
- **Separate audit log scope** — each agent's history is queryable independently
- **Separate permission profiles** — Rex's 0.2 SOL limit does not apply to Nova or Sage

### Staggered Cycles

Rex runs at T+0s, Nova at T+20s, Sage at T+40s, all on 60-second intervals. This staggering distributes API calls to CoinGecko, DeepSeek, and Gemini over time rather than firing three simultaneous requests every 60 seconds — reducing rate limiting risk and ensuring the dashboard always has at least one agent mid-pipeline.

---

## 6. Wallet Design and Key Management

### Wallet Creation Flow

When `Agent.create(profile)` is called, it invokes `Vault.loadOrCreate(agentId, masterKey, rpcUrl)`. This checks the `WalletStore` for an existing vault. Finding none on first run, it calls `Vault.create()`:

```typescript
static async create(agentId, masterKey, rpcUrl): Promise<Vault> {
    assertDevnetUrl(rpcUrl);                              // hard guard — mainnet refused

    const keypair = Keypair.generate();                   // fresh Ed25519 keypair
    const secretKeyBuffer = Buffer.from(keypair.secretKey); // 64 bytes in memory

    let encryptedPayload: EncryptedPayload;
    try {
        encryptedPayload = encrypt(secretKeyBuffer, password); // AES-256-GCM
    } finally {
        zeroBuffer(secretKeyBuffer); // zeroed even if encryption throws
    }

    await store.save(agentId, vaultFile); // only ciphertext touches disk
}
```

The plaintext keypair never touches disk. The moment `Keypair.generate()` produces the 64-byte secret key, it goes directly into the AES-256-GCM encryption function. The `finally` block guarantees the buffer is zeroed regardless of whether encryption succeeds or throws.

The resulting vault file contains: the ciphertext blob, a random 16-byte IV (never reused), the GCM auth tag (for tamper detection), the PBKDF2 salt, the public key in plaintext, and metadata. Only the public key is human-readable on disk — everything else is opaque ciphertext.

On subsequent startups, `loadOrCreate()` finds the existing vault and calls `Vault.load()`, which reads the ciphertext and reconstructs the `PublicKey` from the stored base58 string. The agent resumes with the same Solana address, same history, and same on-chain balance. Decryption does not happen at load time — only at signing time.

The three agents share the same `VAULT_MASTER_KEY` but have unique derived encryption keys because the key derivation combines `VAULT_MASTER_KEY::agentId`. The `::` delimiter prevents key collision. Rex's vault cannot be decrypted using Nova's derived key even if the master key is known.

### Mainnet Guard

The `assertDevnetUrl()` function is called at vault construction time and rejects any `SOLANA_RPC_URL` that does not contain `devnet`. There is no code path that touches mainnet in the current implementation. This is a hard guard, not a configuration flag.

### Encryption

**Algorithm:** AES-256-GCM  
**Key derivation:** PBKDF2 with SHA-512 and 200,000 iterations  
**IV:** Random 16 bytes generated per encryption operation (never reused)  
**Password:** `VAULT_MASTER_KEY::agentId`  

The 200,000 PBKDF2 iterations make brute-force attacks computationally expensive — above the NIST-recommended minimum and aligned with modern password storage standards.

### The Signing Window

The private key exists in memory only during the signing window:

```
1. Read encrypted bytes from WalletStore (file or DB row)
2. Derive decryption key: PBKDF2(VAULT_MASTER_KEY::agentId, salt, 200000, SHA-512)
3. Decrypt: AES-256-GCM.decrypt(ciphertext, key, iv, authTag)
4. Deserialize keypair into temp Buffer
5. transaction.partialSign(keypair)    ← key in memory (milliseconds)
6. buffer.fill(0)                      ← key zeroed in finally block
7. Buffer eligible for garbage collection
```

The `finally` block in every signing method guarantees the zero executes even if signing throws an exception.

### Two Signing Modes

**`partiallySignTransaction()`** — used for Jupiter swap transactions. The transaction's fee payer is set to Kora's address before this is called. The agent adds only its authority signature. Kora adds the fee-payer signature in Layer 7.

**`signAndSendMemo()`** — used exclusively by the Proof-of-Reasoning service (Layer 5). The agent signs and pays gas for its own Memo transaction. Devnet SOL must be present in the agent wallet before cycles begin — the orchestrator automatically requests a Devnet airdrop at startup if the balance is below 0.1 SOL. Only the final swap uses Kora's gasless infrastructure.

### Key Isolation from LLM Layers

The Vault class's public interface exposes only safe, non-secret operations:
- `getPublicKey()` — always safe, public information
- `getBalance()` — reads from RPC, no key involved
- `partiallySignTransaction()` — agent partial-sign for Jupiter swaps
- `signAndSendMemo()` — proof anchoring only
- `getHistory()` / `recordTransaction()` — transaction history

There is no method to retrieve the private key. The LLM services (Strategist and Guardian) call no Vault methods — they interact only with `priceData`, `balance`, and `history` objects. The Vault is not in their dependency graph.

---

## 7. Dual-Model Adversarial AI Pipeline

### The Core Problem with Single-Model Systems

Every LLM has a bias distribution. Given the same prompt, the same model will tend toward similar decisions. If DeepSeek has a systematic bias toward overconfidence in certain market conditions, it will consistently fail to flag risk in those conditions. Running the same model twice does not catch this — it confirms the same bias twice.

The adversarial pipeline solves this by using models from different providers, trained on different data, with different alignment approaches. DeepSeek (Chinese research lab) and Google Gemini have meaningfully different distributions. A decision that passes both is more likely to be genuinely sound than a decision that passes either one alone.

### The Guardian's System Prompt

The Guardian's system prompt is intentionally adversarial:

```
You are a risk auditor reviewing a proposed trade decision made by an autonomous 
AI trading agent. Your job is to find flaws. Challenge the reasoning. Look for:

- Overconfidence relative to the actual spread size
- Risk that the Strategist's profile does not permit
- Amounts that seem aggressive given current volatility
- Reasoning that does not follow logically from the price data

Only return APPROVE if you genuinely cannot find a material flaw.
Return VETO with your specific objection if you find one.
Return MODIFY with an adjusted amount if the direction is right but the size is wrong.
```

An APPROVE from a skeptical auditor predisposed to find problems is more meaningful than an APPROVE from a neutral one.

### Information Asymmetry Between Models

The Strategist and Guardian receive the same market data and agent profile, but the Guardian also receives the Strategist's full output including its reasoning and confidence score. The Guardian can therefore evaluate not just whether the decision is good, but whether the Strategist's stated reasoning actually supports the decision.

A Strategist that claims "Jupiter net spread is +0.62%" when the actual quote shows +0.058% is immediately vulnerable to Guardian challenge — regardless of whether the underlying direction is correct. In early testing, this exact mislabelling occurred every cycle when the Strategist received no Jupiter quote in its context. The Layer 1b pre-scan resolved it: the Strategist now cites real numbers from real data, and the Guardian can verify them against the same quote.

### Why Both Use the OpenAI SDK

Both models are called through the OpenAI SDK using their respective OpenAI-compatible endpoints. The adversarial isolation exists at the corporate and model level — the two systems are genuinely independent — while the implementation uses a single SDK pattern, reducing maintenance surface.

```typescript
// Strategist client → routes to DeepSeek
const strategistClient = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// Guardian client → routes to Gemini
const guardianClient = new OpenAI({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey: process.env.GEMINI_API_KEY,
});
```

---

## 8. Proof-of-Reasoning

### The Problem

Autonomous agents executing financial transactions without human oversight raise a fundamental accountability question: how do you prove, after the fact, that the agent made a sound decision based on real data before it acted?

Without on-chain proof, all you have is a transaction on the blockchain and logs on your server. Logs can be modified. The transaction has no metadata about the decision that preceded it.

### The Solution

Before any transaction is signed, Solus Protocol constructs a proof payload and anchors its hash on-chain.

**Proof payload structure:**
```json
{
  "agentId": "rex",
  "cycle": 42,
  "timestamp": 1700000000000,
  "strategistDecision": {
    "decision": "SWAP",
    "fromToken": "SOL",
    "toToken": "USDC",
    "amount": 0.15,
    "confidence": 0.72,
    "reasoning": "Jupiter net spread for SOL→USDC is +0.19%..."
  },
  "guardianVerdict": {
    "verdict": "APPROVE",
    "challenge": "Decision is sound and reasoning matches quote data..."
  },
  "policyChecks": [
    { "check": "action_whitelist", "passed": true },
    { "check": "token_whitelist", "passed": true },
    "... 9 results total"
  ],
  "priceSnapshot": {
    "SOL": 83.94,
    "USDC": 0.9999,
    "momentumDivergence_SOL_USDC": 0.630,
    "jupiterNetSpread_SOL_USDC": 0.190
  }
}
```

**Anchoring process:**
1. Serialize the payload to a JSON string. (Note: key sorting applies to top-level payload fields only. Nested objects are serialized in insertion order, which is consistent across the single code path that produces them.)
2. `SHA-256(json_string)` → 64-character hex hash
3. Submit the hash as a Solana Memo transaction using a direct `TransactionInstruction` targeting the Memo Program ID (`MemoSq4g...`)
4. Only then proceed to Layer 6 — Vault signing for the actual swap. (The returned `{ hash, memoSignature }` is stored in the audit log and PostgreSQL by the orchestrator after the anchor step returns.)

**Verification:**
Anyone can independently verify any proof:
1. Fetch the proof record from `GET /api/proofs/:hash`
2. Receive the full payload and `memoSignature`
3. Navigate to `https://explorer.solana.com/tx/{memoSignature}?cluster=devnet`
4. Read the Memo data — it contains the SHA-256 hash
5. Re-serialize the local payload and SHA-256 hash it locally
6. Compare — if they match, the proof is authentic

The agent cannot have claimed to make a different decision than it actually made. The hash is immutable on-chain. The payload that produces that hash is the exact decision that was made.

### What This Proves

- The agent saw specific price data before acting (price snapshot in payload)
- The Strategist reasoned about that data using real Jupiter execution context (full LLM output in payload)
- The Guardian reviewed and approved the reasoning (Guardian verdict in payload)
- All 9 policy checks ran with specific results (policy checks in payload)
- This all happened before the actual swap transaction (Memo confirmed before Vault signs)

---

## 9. Kora Gasless Integration

### The Gas Problem at Scale

Consider 10 agents each executing 10 transactions per day. At 5,000 lamports per transaction, that is 0.0005 SOL per day — trivial in isolation. But at scale — 1,000 agents, 100 transactions each — gas management becomes a real operational problem. Each wallet needs a SOL reserve. That reserve depletes. Someone needs to top it up. An agent with no SOL cannot act even if it has funds in USDC.

### What Kora Does

Kora is the Solana Foundation's official paymaster infrastructure. It solves the gas problem at the infrastructure level:

- Kora operates a fee-payer wallet
- When an agent submits a signed transaction, Kora co-signs as the fee payer
- The gas comes from Kora's wallet, not the agent's wallet

The separation of responsibilities is precise:
- **Agent Vault (Layer 6):** partial-signs the transaction — proves the agent authorized this action
- **Kora (Layer 7):** adds the fee-payer signature — enables the network to process it

### Signing Flow

```
1. BroadcastService requests a swap transaction from Jupiter API, which sets Kora's address as feePayer
2. Vault.partiallySignTransaction()  →  agent authority signature only  →  base64 partial tx
3. KoraPaymaster.cosign()            →  Kora adds fee-payer signature    →  fully signed base64
4. BroadcastService submits via connection.sendRawTransaction()
```

The 0.01 SOL fee reserve in the Policy Engine's balance check covers Memo transactions (Layer 5), which the agent pays for directly. Devnet SOL is auto-funded at startup — the orchestrator checks each wallet's balance and requests a 2 SOL Devnet airdrop if below 0.1 SOL, waiting for on-chain confirmation before proceeding. Only the final Jupiter swap uses Kora's gasless path.

### Why This Matters for the Bounty

Kora was listed as a resource in the bounty brief itself. Integrating it demonstrates that Solus Protocol was designed with production deployment in mind — not just a sandbox demo. The architecture answer to "how do agents pay for gas at scale" is Kora.

---

## 10. Dual-Mode Persistence Layer

### The Ephemeral Filesystem Problem

Cloud platforms like Render use ephemeral filesystems. Every redeploy wipes the disk. For a system where agent wallets are stored as encrypted files, every redeploy means lost keypairs, lost Devnet SOL, lost transaction history, lost proof records, and a broken demo for judges reviewing over multiple days.

### The Solution: WalletStore Interface

Rather than changing how the Vault works, we abstract the storage layer behind an interface. The Vault calls `exists()`, `save()`, and `load()` — it does not know or care whether those operations go to disk or a database.

```typescript
interface WalletStore {
  exists(agentId: string): Promise<boolean>;
  save(agentId: string, vaultFile: EncryptedVaultFile): Promise<void>;
  load(agentId: string): Promise<EncryptedVaultFile>;
  saveStartingBalance(agentId: string, solBalance: number): Promise<void>;
  getStartingBalance(agentId: string): Promise<number | null>;
}
```

`getWalletStore()` returns the correct implementation based on `NODE_ENV`:
- `development` → `FileWalletStore` (filesystem, zero DB dependency)
- `production` → `DbWalletStore` (Prisma + Supabase PostgreSQL)

### Audit Logs and Proof Records

The same dual-mode pattern extends to audit logs and proof records. In production, all writes to the database are fire-and-forget — a slow DB write never blocks an agent cycle. Failures are caught and logged to the winston file so they are never silently lost.

### Supabase Configuration Notes

Supabase exposes two connection strings:

- **Pooler URL (port 6543)** → `DATABASE_URL` — used at runtime by Prisma for all queries
- **Direct URL (port 5432)** → `DIRECT_URL` — used only for `prisma migrate deploy`

Migrations require a direct connection. Using the pooler URL for migrations is a common failure point — both must be set correctly.

---

## 11. Policy Engine Design

### Why Deterministic Rules, Not LLM Judgment

The Policy Engine is the last line of defense before funds move. It must be predictable, auditable, and unbypassable. An LLM-based policy engine would introduce the exact failure modes it is meant to prevent: the model might reason its way around a constraint, hallucinate a rule, or be inconsistent across cycles.

The Policy Engine is pure TypeScript. Given the same inputs, it always produces the same output. It can be unit tested to 100% branch coverage. It is not a "smart" system — it is a "reliable" system. In security-critical paths, reliability beats intelligence.

### Check Ordering

**Checks 1-2 (whitelist checks)** run first — cheapest to compute, catch the most obviously invalid actions.

**Checks 3-4 (confidence and volatility-adjusted sizing)** normalize the decision. Check 3 forces HOLD on low confidence. Check 4 applies the volatility-adjusted sizing formula:

```
safeAmount = maxTxAmountSol × confidence × (1 - volatilityPenalty)
```

`volatilityPenalty` is 0 when the 24h price change is below 5%, scaling up to a 50% cap for highly volatile assets. This produces a clamped amount that all subsequent checks evaluate — not the LLM-requested amount.

**Checks 5-6 (volume and rate checks)** evaluate the normalized amount against the daily volume cap and 60-second rate limit (max 5 transactions per window). If the rate limit is hit, it forces HOLD (does not hard reject).

**Check 7 (balance check)** runs after volume check — no point checking the balance if the volume cap already rejects the transaction.

**Check 8 (spread threshold)** evaluates the agent-specific minimum spread. When a Jupiter execution quote is available — the common case after Layer 1b — Check 8 evaluates the **net** spread (after slippage and price impact) rather than the CoinGecko momentum divergence. This prevents approving trades where slippage entirely consumes the visible opportunity.

**Check 9 (stop-loss circuit)** is a mode switch, not a per-transaction check. It tracks total portfolio value in USD across all held tokens to avoid false positives when SOL is legitimately converted to USDC. If the circuit trips, the agent enters HOLD-only mode until manually reset by an operator.

### Policy Result Emission

Every individual check emits its result to the event bus. This granularity enables the 9-checkbox animation on the dashboard and means the audit log contains the exact check that failed with the specific values — not just "policy rejected."

---

## 12. SKILLS.md as a Runtime System Prompt

### Why Not Hardcode the System Prompt?

If the agent's behavioral instructions are hardcoded in `strategist-service.ts`, changing agent behavior requires modifying TypeScript, rebuilding, and redeploying. In production agentic systems, the ability to update agent instructions without redeploying is a fundamental operational requirement.

`SKILLS.md` is read from disk on every Strategist and Guardian call. Behavioral updates require only a file edit and a restart. The file is human-readable — non-engineers can understand what the agent is configured to do. It is version-controlled independently of the application code.

### The SKILLS.md Structure

**The base identity section** is injected for every agent. It defines what the agent is, what it can do, the required JSON output format, and the explicit 4-step Decision Rule governing every cycle.

**The personality section** is appended per-agent in `prompt-builder.ts`. Rex, Nova, and Sage receive the same base with different LLM directives and threshold values.

### Prompt Engineering Insight

SKILLS.md evolved significantly during development. The initial version described spread analysis without distinguishing between momentum divergence and executable net spread — both described simply as "spread." Without a real Jupiter quote in context, DeepSeek consistently mislabelled the CoinGecko momentum divergence as the "Jupiter net spread," producing plausible-sounding but numerically wrong reasoning that Gemini vetoed every cycle.

The fix required two changes working together: the Layer 1b pre-scan (infrastructure — giving DeepSeek real data to cite) and the explicit 4-step Decision Rule in SKILLS.md (prompting — telling DeepSeek exactly how to process both signals in order). Neither fix alone was sufficient.

This is an important observation for production agentic systems: **prompt engineering and data availability are not separable concerns.** A well-written prompt cannot compensate for absent data. Correct data cannot compensate for ambiguous instructions. Both must be correct simultaneously.

### SKILLS.md for the Guardian

The Guardian also receives SKILLS.md as context — not as its operating instructions, but as background on what the Strategist was supposed to do. This gives the Guardian the frame of reference to evaluate whether the Strategist's decision is consistent with its stated mandate.

---

## 13. WebSocket Event Architecture

### Event-Driven Design

Every meaningful state transition in the 7-layer pipeline emits a WebSocket event through `event-bus.ts`. This is the mechanism by which the frontend maintains real-time state without polling.

The event envelope is consistent across all events:

```typescript
interface SolusEvent {
  type: EventType;
  agentId: 'rex' | 'nova' | 'sage';
  timestamp: number;
  payload: Record<string, unknown>;
}
```

### Event Granularity

Events are emitted at the finest meaningful granularity. For the Policy Engine, this means one event per check result. For the Proof Service, this means an event when the hash is computed and another when the Memo transaction confirms. This enables the dashboard to animate each step individually rather than showing a single "layer complete" notification.

### Dashboard State Reconstruction

The frontend `useAgentState` hook maintains a complete state model for all three agents derived entirely from WebSocket events. When a new connection is established after a browser refresh, the hook requests the last N events from `GET /api/logs` to seed initial state, then switches to live WebSocket updates. A brief disconnect does not leave the UI in an inconsistent state.

---

## 14. Threat Model

### What Solus Protocol Protects Against

**Private key extraction.** An attacker who gains read access to process memory, log files, network traffic, or the encrypted vault storage cannot extract the private key without both the `VAULT_MASTER_KEY` and the agent ID. The key exists in plaintext only during the signing window — milliseconds — and is explicitly zeroed in a `finally` block immediately after.

**LLM prompt injection.** If an attacker can influence the price data or transaction history appearing in the LLM prompt, they might attempt to manipulate the Strategist into proposing a malicious transaction. The Policy Engine provides deterministic protection — no matter what the LLM outputs, it cannot exceed the maximum transaction amount, daily volume cap, or whitelist of permitted tokens. The Guardian provides a second model as an additional filter.

**Runaway spending.** The daily volume cap, rate limiter, and stop-loss circuit collectively prevent an agent from draining its wallet even if both LLM layers behave erratically for a sustained period.

**Mainnet fund exposure.** The Vault's `assertDevnetUrl()` guard rejects any `SOLANA_RPC_URL` that does not contain `devnet`. There is no code path that touches mainnet in the current implementation.

### What Solus Protocol Does Not Protect Against

**Compromised `VAULT_MASTER_KEY`.** If the master key leaks from the environment, the encrypted vault files or DB rows can be decrypted. The defense is operational: proper secrets management, never committing the `.env` file, using platform secret storage, rotating the key periodically.

**Compromised Kora node.** If the Kora paymaster node is compromised, it could refuse to co-sign legitimate transactions (DoS) or attempt to manipulate fee computations. Mitigation: use a self-hosted Kora node or the official Solana Foundation hosted instance.

**CoinGecko API manipulation.** If an attacker could feed false price data to the Oracle, agents might make incorrect trading decisions. The Jupiter execution quote provides partial protection — a manipulated CoinGecko price would still need to produce a positive net spread through Jupiter's routing — but production requires multiple independent oracle sources with cross-validation.

---

## 15. Known Limitations and Future Work

### Jupiter Devnet Liquidity

Jupiter's swap routing API references mainnet liquidity pools. These pools do not exist on Devnet. Swap transactions built from Jupiter quotes and submitted to Devnet fail because the referenced program accounts are absent.

**Current mitigation:** The system gracefully logs `TX_FAILED` when Jupiter rejects the Devnet swap. The successful proof of the pipeline is the on-chain anchoring in Layer 5 — the Memo transaction and SHA-256 hash are real on-chain artifacts regardless of whether the swap completes.

**Production path:** On mainnet deployment, Jupiter swaps execute as designed. This is an infrastructure constraint, not a code limitation.

### Momentum Divergence vs. Executable Spread

The momentum divergence signal from CoinGecko and the executable net spread from Jupiter frequently differ by a significant margin. In testing, a 0.63% CoinGecko momentum divergence for SOL/USDC corresponded to a 0.058% Jupiter net spread — a tenfold difference. The pipeline handles this correctly: the Strategist uses Jupiter as its primary gate, and Policy Engine Check 8 evaluates Jupiter net spread when available. Agents HOLD more often than a naive reading of the divergence data would suggest. This is correct behavior — the pipeline only trades when execution reality supports it, not when lagged price data looks favorable.
The Layer 1b pair rotation (introduced after initial testing) addresses this at the infrastructure level. Rather than repeatedly pre-scanning the highest-divergence pair — which held the top spot every cycle but had negative execution depth on Devnet — the agent now cycles through all non-neutral candidates. Higher-divergence pairs are still evaluated most frequently since the rotation list is sorted descending, but no single pair can monopolize every cycle.

### Guardian — No Cross-Cycle Memory

The Guardian AI has no persistence across cycles. If it vetoes because of a market condition this cycle, the Strategist may propose the same trade next cycle without the Guardian having memory of the prior interaction. A consecutive-veto counter could detect loops and suppress repeated proposals.

### Price Oracle — Single Source

The current Oracle uses CoinGecko for market context and Jupiter Quote API for real execution pricing. A production system should aggregate on-chain oracles (Pyth, Switchboard, Chainlink) and cross-validate — rejecting data that deviates significantly across sources.

### Key Management — Environment Variable

`VAULT_MASTER_KEY` is stored in an environment variable. In production, this should be stored in a hardware security module (HSM) or a secrets manager like HashiCorp Vault or AWS Secrets Manager. Kora supports Turnkey and Privy as HSM-backed signers for exactly this reason.

### Supervised Mode

The current system is fully autonomous. A production deployment should support an optional supervised mode where transactions above a configurable threshold are queued for human approval before executing — the HITL (Human-In-The-Loop) pattern.

---

## 16. Agent Command Center

### Kill Switch (Pause/Resume)

Every agent has an `OperationalStatus` (`ACTIVE` | `PAUSED`), separate from the `AgentStatus` used for UI display states. When an agent is PAUSED, the orchestrator skips its scheduled cycle and emits a `skipped_paused` WebSocket event. In-flight cycles complete normally — the pause takes effect on the next scheduled cycle.

**API:** `PATCH /api/agents/:id/status` with body `{ "status": "ACTIVE" | "PAUSED" }`.

### Force Run

Triggers an immediate out-of-schedule cycle for a single agent. A 15-second cooldown prevents rapid-fire API abuse during demos. Force Run is blocked if the agent is PAUSED (returns 403 Forbidden) — the Kill Switch always takes priority.

**API:** `POST /api/agents/:id/run` — returns 202 (accepted), 403 (agent paused), or 429 (cooldown active).

### Implementation

Both features are implemented in `agent-orchestrator.ts` via `setOperationalStatus()`, `getOperationalStatus()`, and `triggerCycle()`. State is maintained in per-agent maps, not persisted to disk — a server restart resets all agents to `ACTIVE`, which is the correct default for a demo system.

---

## 17. PnL Leaderboard

### Design

The leaderboard ranks all three agents by net PnL, computed in real time from live on-chain balances and current market prices.

**Formula:**
```
baselineUsd  = initialBalanceSol × live SOL price
liveValueUsd = (SOL balance  × SOL price)
             + (USDC balance × 1.00)
             + (RAY balance  × RAY price)
             + (BONK balance × BONK price)
netPnLUsd    = liveValueUsd - baselineUsd
```

- **Baseline:** Each agent's initial SOL balance is snapshotted from the blockchain at server startup and persisted via `WalletStore.saveStartingBalance()`. In production, this is stored as `startingBalanceSol` on the `AgentWallet` Prisma table — surviving Render redeploys. The baseline is valued at the *current* SOL price so PnL reflects trading performance rather than SOL price movement since funding.
- **USDC peg:** USDC is treated as exactly $1.00 to avoid peg noise affecting PnL calculations.
- **SPL token inclusion:** All four token balances are summed. If the leaderboard tracked only SOL, a swap from SOL to USDC would register as a loss even though total portfolio value is unchanged.

**API:** `GET /api/leaderboard` — returns agents sorted by `netPnLUsd` descending, with per-agent balance breakdowns and swap counts.

---

## 18. Telegram Bot Integration

### Out-of-Band Monitoring

The Telegram integration (`TelegramNotifier`) is designed to give the protocol an out-of-band monitoring and remote control channel that is separate from the frontend web dashboard. 

### "Silent Guardian" Logic

A major UX enhancement is the **Silent Guardian** logic applied to push notifications. An agent processing a cycle successfully and getting an `APPROVE` verdict from the Guardian is routine behavior. 

The bot intentionally **does not** send a push notification for a routine approval. It only alerts the Telegram channel when the Guardian intervenes with a `VETO` or `MODIFY` action. This ensures the channel remains a high-signal environment for security alerts, rather than being spammed with routine checks.

### Dynamic Fleet Controls

The bot replaces primitive text commands with dynamic, state-aware inline keyboards. 
- The `/control` panel lists all three agents. 
- The `TelegramNotifier` queries the `AgentOrchestrator` to determine each agent's active `operationalStatus`. 
- An `ACTIVE` agent only shows a **Pause** button, preventing redundant activation.
- A `PAUSED` agent only shows a **Resume** button.

### Real-Time Balance Queries

The `/balances` command demonstrates direct integration with the Agent Vaults. Instead of relying on cached payload state or periodic polling, the Telegram command actively invokes `agent.getBalance()` across all three agents simultaneously, directly querying the Solana RPC for their real-time on-chain SOL balances.

---

*Solus Protocol — Autonomous. Auditable. On-chain.*

*Built for the Superteam Nigeria DeFi Developer Challenge.*