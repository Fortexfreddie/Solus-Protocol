# Solus Protocol Solana RPC Manager (`solana-rpc.ts`)

**Location:** `src/protocol/solana-rpc.ts`
**Purpose:** This module acts as the centralized nervous system for all external blockchain communication. It manages the connection to the Solana Devnet, handles transaction confirmations, and provisions test funds via airdrops.

---

## 1. The Singleton Connection Pattern



Creating a new `Connection` object every time an agent needs to check a balance is highly inefficient and will quickly trigger rate limits from the RPC provider. 

To solve this, the module exports a `getSolanaRPC()` factory function. 
* **First Call:** It initializes the connection using the `.env` URL.
* **Subsequent Calls:** It returns the exact same cached instance (`_instance`).

**Team Takeaway:** Wherever you need to interact with the blockchain in the backend, always import and call `getSolanaRPC()`. Never instantiate `new Connection()` manually outside of this file.

## 2. Hard Mainnet Guard

Just like the `Vault`, this file implements a catastrophic failure mechanism if configured incorrectly. The `assertDevnetRpcUrl` function checks the `SOLANA_RPC_URL` string on startup. If the string `"devnet"` is missing, the backend refuses to boot. This ensures our autonomous agents can never accidentally spend real SOL.

## 3. Transaction Confirmation Strategy



Submitting a transaction to the network is only half the battle; we must verify it was actually written to a block. 

* **Timeout Constraint:** The system enforces a strict `30_000` ms (30-second) timeout. If the network is congested and the transaction isn't confirmed within this window, the cycle aborts and emits a `TX_FAILED` event.
* **Blockhash Strategy:** The primary `confirmTransaction` method relies on `getLatestBlockhash`. By binding the transaction to a specific blockhash and tracking its `lastValidBlockHeight`, the RPC can efficiently determine if the transaction was successfully processed or officially dropped by the network.

## 4. Developer Utilities

* **`ping()`:** A lightweight health check that grabs the current network slot. This is hooked up to the Next.js dashboard's top status bar to indicate the RPC connection is alive.
* **`airdrop()`:** Automatically requests 2 SOL from the Devnet faucet. The `Vault` calls this automatically if it generates a brand new wallet that needs initial funding.