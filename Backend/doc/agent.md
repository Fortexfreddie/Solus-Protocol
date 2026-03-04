# Solus Protocol Autonomous Agent (`agent.ts`)

**Location:** `src/agent/agent.ts`  
**Purpose:** The central nervous system of an individual agent. It binds all 7 layers of the Air-Gap Engine into a single, cohesive, fault-tolerant execution cycle.

---

## 1. Complete State Isolation

Each `Agent` instance represents a single trader (Rex, Nova, or Sage). The class encapsulates:
* Its specific `PersonalityProfile` (risk thresholds, LLM instructions).
* Its own `Vault` (secure key enclave).
* Its own `cycleCount`.

There is **zero shared mutable state** between agents. They operate completely independently, meaning a failure or rate-limit in Rex will never impact Nova's trading cycle.

## 2. The 7-Layer Air-Gap Pipeline

The `runCycle()` method is the authoritative implementation of the Solus Protocol workflow. It executes sequentially:
1. **Layer 1 (Oracle):** Fetches live prices and spreads from CoinGecko.
2. **Layer 1b (Execution Quote):** Fetches a Jupiter execution quote for the highest-spread candidate pair via `getCandidatePair()`. Attaches `executionQuote` to `priceData` for all downstream layers. Non-fatal — continues with CoinGecko only on failure.
3. **Layer 2 (Strategist):** DeepSeek evaluates the market (including Jupiter quote context) and proposes a trade.
4. **Layer 3 (Guardian):** Google Gemini audits the proposal (with Jupiter execution data) and issues an APPROVE, MODIFY, or VETO.
5. **Layer 4 (Policy Engine):** 9 deterministic math checks ensure the trade doesn't violate hard constraints. Check 8 uses Jupiter net spread when available.
6. **Layer 5 (Proof-of-Reasoning):** The entire decision state is hashed and anchored to the Solana blockchain via a Memo transaction.
7. **Layer 6 (Vault):** The isolated HSM partially signs the swap transaction as the authority.
8. **Layer 7 (Broadcast):** The Kora Paymaster co-signs to cover gas fees, and the transaction is submitted to Devnet.

## 3. Event-Driven Telemetry

This class is heavily instrumented with `eventBus.emit()`. 
Every single layer transition broadcasts its state (`AGENT_THINKING`, `GUARDIAN_AUDIT`, `POLICY_PASS`, `TX_CONFIRMED`). 
This completely decouples the backend logic from the frontend UI. The dashboard simply listens to these WebSocket events to render real-time animations of the agent's "brain" at work without needing to poll the database.

## 4. Fault Tolerance

Autonomous agents cannot crash. The entire `runCycle()` is wrapped in `try/catch` blocks. 
Whether the LLM returns garbled output, the RPC node times out, or a policy check fails, the error is caught, logged to the immutable `AuditLogger`, and the cycle ends cleanly, leaving the agent perfectly ready for its next scheduled run.