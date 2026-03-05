# Solus Protocol Token Manager (`token-manager.ts`)

**Location:** `src/wallet/token-manager.ts`
**Purpose:** This module abstracts the complexities of the `@solana/spl-token` package. It manages the agent's native SOL balances, SPL token balances (USDC, RAY, BONK), and ensures the necessary Associated Token Accounts (ATAs) exist before trades are executed.

---

## 1. Known Devnet Mints

The `TOKEN_MINTS` object acts as our source of truth for the token addresses we are trading. Because Solus Protocol operates strictly on Solana Devnet, these are the official devnet contract addresses for USDC, RAY, and BONK. 

**Team Takeaway:** If we ever upgrade the system to Mainnet in the future, these are the only addresses that would need to change.

## 2. Balance Fetching & Normalization

Solana stores balances as integers (Lamports). For example, 1 SOL is represented on-chain as `1,000,000,000` lamports. 
The LLMs (Strategist and Guardian) cannot easily reason about massive integers. 

The `TokenManager` handles the conversion automatically:
* `getSolBalance`: Divides by `1e9`.
* `getTokenBalance`: Dynamically fetches the token's decimal count from the blockchain (e.g., 6 decimals for USDC) and scales the integer back into a UI-friendly decimal (e.g., `27.5`).

The `getFullBalance` method aggregates all of these into a single snapshot used by the `Vault` to report state to the dashboard.

## 3. Associated Token Accounts (ATAs)



Unlike Ethereum, where your main wallet address directly holds token balances in a smart contract, Solana requires you to open a specific "sub-account" for every type of token you want to hold. This is called an Associated Token Account (ATA).

* **The Problem:** If Solus Protocol tries to swap SOL for BONK, but the agent's wallet has never held BONK before, the Jupiter swap will fail because the BONK ATA doesn't exist yet to receive the funds.
* **The Solution:** The `ensureAta` method checks if the ATA exists. If it doesn't, it automatically builds a `createAssociatedTokenAccountInstruction`. This instruction can then be prepended to the final swap transaction so the account is created in the exact same block the trade executes.