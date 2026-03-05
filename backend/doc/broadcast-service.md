# Solus Protocol Broadcast Service (`broadcast-service.ts`)

**Location:** `src/protocol/broadcast-service.ts`  
**Purpose:** Implements Layer 7 of the architecture. It orchestrates the final execution of an approved AI trade by interacting with the Jupiter Swap API, managing the Kora Paymaster co-signature, and pushing the transaction to the Solana blockchain.

---

## 1. The Execution Pipeline

The `executeSwap` method acts as the transaction coordinator. Once a decision clears the Policy Engine (Layer 4) and is anchored on-chain (Layer 5), this service takes over:

1. **Quote Fetch:** It calls the Jupiter v6 API to find the optimal routing and output amounts for the exact token pair.
2. **Transaction Construction:** It requests unsigned `VersionedTransaction` bytes from Jupiter.
3. **Layer 6 (Vault) Delegation:** It passes the unsigned bytes back to the Vault via the `partialSign` callback. The Vault briefly decrypts its key in memory, signs as the authority, and returns a Base64 string.
4. **Layer 7 (Kora) Delegation:** It sends the partially signed Base64 string to the Kora Paymaster. Kora appends its own signature, paying the network gas fees for the agent.
5. **Broadcast & Confirm:** It pushes the fully-signed payload to Devnet and polls the RPC for the latest blockhash confirmation.

## 2. Security Boundaries

This service adheres strictly to the Air-Gap model.
* It **never** imports `key-store.ts`.
* It **never** has access to the agent's private key.
* It only handles serialized bytes and base64 strings.

## 3. Graceful Degradation

If the Jupiter API goes down, or the RPC node drops the submission, the service will pause for 2 seconds and automatically retry the process one more time (`MAX_RETRY = 1`). If it still fails, it throws a structured error that the Orchestrator catches and logs as a `TX_FAILED` event, preventing the entire Node.js backend from crashing.