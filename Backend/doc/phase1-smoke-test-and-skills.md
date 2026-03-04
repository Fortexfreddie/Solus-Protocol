# Solus Protocol: Agent Constitution & Phase 1 Smoke Test

**Purpose:** This document outlines the core LLM instructions (`SKILLS.md`) and how to execute the cryptographic validation test (`smoke-vault.ts`) before moving to Phase 2.

---

## 1. The Agent Operator Manual (`SKILLS.md`)

**Location:** Root directory (`/SKILLS.md`)

This markdown file is not just documentation; it is the **operational constitution** for our AI agents. During Layer 2 (Strategist) and Layer 3 (Guardian), this file is read from disk and injected directly into the LLM's system prompt.

**Key Architectural Decisions Enforced Here:**
* **Zero-Shot Formatting:** The prompt strictly forbids markdown code fences or explanatory text outside the JSON object. This ensures `zod` can parse the output reliably without regex stripping.
* **Spread Interpretations:** By explicitly defining `SOL_overpriced` and `change24h` momentum, we give the LLM a framework to interpret the raw numbers from the Jupiter API mathematically, rather than guessing.
* **Risk Flags:** The prompt defines exact trigger conditions (e.g., `HIGH_VOLATILITY` at ±10%). The LLM populates these flags, which the Guardian AI (Layer 3) will later scrutinize to determine if the risk is acceptable.

---

## 2. Phase 1 Smoke Test (`smoke-vault.ts`)

**Location:** `src/scripts/smoke-vault.ts`
**Command:** `pnpm smoke:vault`

Before we integrate OpenAI or Jupiter, we must prove that our Layer 6 (Vault) and Devnet RPC connections are airtight. 

**What this script does:**
1.  **RPC Ping:** Verifies the `SOLANA_RPC_URL` is alive and successfully pointing to Devnet.
2. **Kora Ping:** Initializes the `KoraPaymaster` and requests the fee payer address from the local Kora node, verifying the HMAC/API keys.
3. **Funder Check:** Decodes the `FUNDER_SECRET_KEY` and checks if it has enough SOL to subsidize testing.
4.  **Vault Generation:** Instantiates `Rex`, `Nova`, and `Sage`. It triggers the PBKDF2/AES-256-GCM encryption pipeline and writes their secure `.vault.json` files to the `/wallets` directory.
5.  **Airdrop Funding:** Automatically requests 2 SOL for each agent from the Devnet faucet. It includes a `try/catch` block because Devnet aggressively rate-limits airdrops.
6.  **Balance Verification:** Reads the on-chain balances using `TokenManager` to confirm the funds arrived safely.

**Team Takeaway:** If this script passes, our cryptographic air-gap is secure. No plaintext keys are leaking, and the backend is ready to sign real Jupiter transactions.