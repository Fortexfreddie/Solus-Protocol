# Solus Protocol Secure Wallet Engine (`vault.ts`)

**Location:** `src/wallet/vault.ts`  
**Purpose:** This file implements Layer 6 of the Solus Protocol engine. It acts as an isolated software-based Hardware Security Module (HSM). The Vault prevents the LLMs (Strategist and Guardian) or any other system components from directly accessing private key material.

---

## 1. The Mainnet Guard

At the very top of the file, `assertDevnetUrl()` checks the `SOLANA_RPC_URL`. If the string `"devnet"` is missing, it violently throws an error and refuses to initialize the class.

**Team Takeaway:** This is a foolproof safety net. Even if someone accidentally copies a mainnet RPC URL into the `.env` file during testing, the backend will crash on boot, ensuring zero risk to real funds.

## 2. Vault Creation & Storage

When `Vault.create()` is called:
1. A new Solana Keypair is generated in RAM.
2. The 64-byte secret key is immediately passed to our `key-store.ts` encryption engine.
3. The encrypted payload is saved to disk as `vaults/{agentId}.vault.json`.
4. The `wx` file system flag is used. This means if a vault file already exists for that agent, the system will fail rather than overwriting it, protecting our agents from accidental key deletion.
5. The original plaintext key buffer is zeroed out.

## 3. Just-In-Time (JIT) Signing

The signing methods are the *only* places in the entire codebase where a private key exists in plaintext. 

**The JIT Lifecycle:**
1. The Orchestrator passes a raw `Uint8Array` of an *unsigned* transaction to the Vault.
2. The Vault reads its encrypted file from disk and decrypts the secret key into a temporary buffer.
3. The transaction is deserialized, signed, and re-serialized.
4. **Critical Step:** A `finally` block guarantees that `zeroBuffer()` wipes the secret key from RAM instantly after signing, even if the transaction serialization fails.

**Frontend/API Devs Takeaway:** Because of this architecture, the public interface (`IVault`) only exposes `getPublicKey()`, `getBalance()`, `signTransaction()`, `partiallySignTransaction()`, `signAndSendMemo()`, and `getHistory()`. You can confidently pass these vault instances around the application knowing that the private keys cannot be extracted.

## 4. The Kora Co-Sign Model (Layer 7)

For Jupiter token swaps, the agents do not pay their own gas fees. Instead, we use a sponsored meta-transaction model:
* **`partiallySignTransaction()`:** The Vault signs the transaction *only* as the owner/authority of the swap to prove the agent authorized the trade. It returns a base64-encoded partial transaction.
* **The Paymaster:** Layer 7 (Kora) receives this base64 string and co-signs it as the `feePayer`, covering the network costs before broadcasting it to Devnet.

## 5. Proof-of-Reasoning Anchoring (Layer 5)

Before a swap is executed, the `ProofService` must anchor the AI's decision hash to the blockchain.
* **`signAndSendMemo(memoContent)`:** This method builds a standalone Solana `TransactionInstruction` using the SPL Memo Program. 
* Unlike the Kora co-sign flow, the agent acts as its own `feePayer` for memo transactions (using airdropped Devnet SOL). The method securely decrypts the key, signs the memo, broadcasts it, and returns the transaction signature to the `ProofService`—all without the private key ever leaving the Vault enclave.

## 6. In-Memory Transaction History

To support the dashboard and the AI's contextual awareness, the Vault maintains a short-term memory of its actions.
* **`recordTransaction(tx)`:** Called by the Broadcast Service immediately after a swap is confirmed on-chain.
* **`getHistory()`:** Returns the last N confirmed `TxRecord` objects. The Strategist AI reads this to understand its recent trading behavior before making its next decision.