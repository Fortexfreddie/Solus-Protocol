# Solus Protocol Proof-of-Reasoning (`proof-service.ts`)

**Location:** `src/brain/proof-service.ts`
**Purpose:** Layer 5 of the air-gap engine. It cryptographically hashes the entire decision-making process (from market data to AI reasoning to policy checks) and anchors that hash to the Solana Devnet blockchain.

---

## 1. Tamper-Evident Accountability
If an agent executes a bad trade, the operator needs to know *why*. Was the AI hallucinating? Was the market data stale? Did a policy check fail but get bypassed?

Before any funds move, this service collects:
* The exact `PriceData` used.
* The DeepSeek Strategist's exact reasoning and JSON output.
* The Google Gemini Guardian's exact audit challenge.
* The pass/fail status of all 9 Policy Engine checks.

It serializes this data deterministically and generates a SHA-256 hash.

## 2. The On-Chain Anchor
The service uses a secure callback (`signMemo`) to send the SHA-256 hash to the Solana blockchain via the SPL Memo Program. 
The resulting transaction signature is saved alongside the hash in the local `audit.jsonl` log.

Because the hash is immutable on-chain, anyone can verify that the local audit log has not been altered after the fact.

## 3. Strict Key Isolation
Notice that `proof-service.ts` does not import `@solana/web3.js` or ask for a private key. It only asks for a function (`SignMemoFn`) that accepts a string. This ensures the execution layer (the Vault) remains completely isolated from the reasoning layers.