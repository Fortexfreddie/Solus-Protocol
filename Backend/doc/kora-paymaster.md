# Solus Protocol Kora Paymaster (`kora-paymaster.ts`)

**Location:** `src/protocol/kora-paymaster.ts`
**Purpose:** Implements Layer 7 (Gasless Execution) using the Solana Foundation's Kora infrastructure. This service accepts a transaction that an agent has already signed, and forwards it to the Kora node to be co-signed by the fee payer.

---

## 1. The Co-Sign Security Model



It is critical to understand that **Kora does not initiate transactions**. 
* In Layer 6, the agent's `Vault` uses its private key to sign the transaction, proving that the agent authorizes the swap.
* In Layer 7, this `kora-paymaster.ts` file takes that partially-signed transaction and sends it to Kora via `client.signTransaction()`. 
* Kora evaluates the transaction against its strict on-chain policies (`allowed_programs`, `blocked_mint_extensions`, etc.). If it passes, Kora adds its own signature to the `feePayer` field and returns it.

**Team Takeaway:** This separation of concerns means the agent retains absolute authority over its assets, but the Kora node handles the operational friction of gas management.

## 2. Defensive Network Engineering

RPCs and nodes can occasionally hang or drop connections. 
* **The 10-Second Rule:** The `withTimeout` utility wraps every single call to the Kora SDK. If the Kora node takes longer than 10 seconds to respond, the promise rejects, the cycle fails gracefully, and the system moves on. This guarantees that an agent's 60-second heartbeat cycle is never permanently blocked by a hanging network request.
* **Defensive Extraction:** The `extractSignedTransaction` function anticipates variations in the `@solana/kora` SDK versions, checking for `transaction`, `signedTransaction`, or `result` to ensure the base64 string is retrieved safely regardless of underlying package updates.

## 3. Configuration Updates

To use this file, your `.env` must be updated with the credentials for your Kora node:

```env
KORA_RPC_URL=http://localhost:8080
KORA_API_KEY=your_kora_api_key
KORA_HMAC_SECRET=your_kora_hmac_secret