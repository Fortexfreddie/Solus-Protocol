// src/protocol/solana-rpc.ts
// Centralized Solana Devnet connection manager for Solus Protocol.
// Provides: connection singleton, airdrop helper, transaction confirmation polling,
// and a hard mainnet URL guard enforced at module initialization.

import {
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
    type TransactionSignature,
    type Commitment,
    type RpcResponseAndContext,
    type SignatureResult,
} from '@solana/web3.js';

// Constants 

const DEFAULT_COMMITMENT: Commitment = 'confirmed';
const TX_CONFIRM_TIMEOUT_MS = 30_000;   // 30 second confirmation timeout (per spec)
const TX_CONFIRM_POLL_INTERVAL_MS = 500;
const AIRDROP_MAX_SOL = 2;              // Devnet airdrop cap

// Mainnet Guard 
/**
 * Hard rejects any RPC URL that does not contain "devnet".
 * This check runs at module initialization time and cannot be bypassed.
 */
function assertDevnetRpcUrl(url: string): void {
    if (!url.toLowerCase().includes('devnet')) {
        throw new Error(
        `[SolanaRPC] MAINNET GUARD TRIGGERED\n` +
            `SOLANA_RPC_URL must contain "devnet". Received: "${url}"\n` +
            `Solus Protocol is a Devnet-only system. Refusing to initialize.`,
        );
    }
}

// SolanaRPC class 

export class SolanaRPC {
    private readonly connection: Connection;
    private readonly rpcUrl: string;

    constructor(rpcUrl: string) {
        assertDevnetRpcUrl(rpcUrl);
        this.rpcUrl = rpcUrl;
        this.connection = new Connection(rpcUrl, DEFAULT_COMMITMENT);
    }

    // Connection access 
    /**
     * Returns the underlying Connection instance.
     * Used by Vault, TokenManager, and BroadcastService.
     */
    getConnection(): Connection {
        return this.connection;
    }

    /** Returns the configured RPC URL (devnet guaranteed). */
    getRpcUrl(): string {
        return this.rpcUrl;
    }

    // Health check

    /**
     * Pings the RPC endpoint and returns the current slot number.
     * Used by the /health REST endpoint.
     *
     * @returns Current slot number if the RPC is reachable
     * @throws if the RPC is unreachable
     */
    async ping(): Promise<{ slot: number; latencyMs: number }> {
        const start = Date.now();
        const slot = await this.connection.getSlot();
        return { slot, latencyMs: Date.now() - start };
    }

    // Airdrop 

    /**
     * Requests a Devnet SOL airdrop to the given address.
     * Capped at 2 SOL per request (Devnet faucet limit).
     * Waits for confirmation before returning.
     *
     * @param recipient - Wallet public key to receive the airdrop
     * @param amountSol - SOL amount to request (capped at AIRDROP_MAX_SOL)
     * @returns Transaction signature
     */
    async airdrop(recipient: PublicKey, amountSol: number): Promise<string> {
        const capped = Math.min(amountSol, AIRDROP_MAX_SOL);
        const lamports = Math.floor(capped * LAMPORTS_PER_SOL);

        console.log(
            `[SolanaRPC] Requesting airdrop of ${capped} SOL to ${recipient.toBase58()}`,
        );

        const signature = await this.connection.requestAirdrop(recipient, lamports);
        await this.confirmTransaction(signature);

        console.log(`[SolanaRPC] Airdrop confirmed. Sig: ${signature}`);
        return signature;
    }

    // Transaction confirmation 
    /**
     * Polls for transaction confirmation with a 30-second timeout (per spec).
     * Uses `confirmTransaction` with a blockhash strategy for reliability.
     *
     * @param signature - Transaction signature to confirm
     * @param commitment - Commitment level (default: 'confirmed')
     * @returns Confirmation result
     * @throws if the transaction fails or times out
     */
    async confirmTransaction(
        signature: TransactionSignature,
        commitment: Commitment = DEFAULT_COMMITMENT,
    ): Promise<RpcResponseAndContext<SignatureResult>> {
        const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash(commitment);

        const result = await this.connection.confirmTransaction(
            {
                signature,
                blockhash,
                lastValidBlockHeight,
            },
            commitment,
        );

        if (result.value.err) {
            throw new Error(
                `[SolanaRPC] Transaction ${signature} failed on-chain: ${JSON.stringify(result.value.err)}`,
            );
        }

        return result;
    }

    /**
     * Polling-based confirmation fallback. Checks the signature status every
     * TX_CONFIRM_POLL_INTERVAL_MS until confirmed or TX_CONFIRM_TIMEOUT_MS elapses.
     * Used when blockhash-based confirmation is not suitable (e.g., after retries).
     */
    async pollForConfirmation(
        signature: TransactionSignature,
    ): Promise<boolean> {
        const deadline = Date.now() + TX_CONFIRM_TIMEOUT_MS;

        while (Date.now() < deadline) {
            const status = await this.connection.getSignatureStatus(signature, {
                searchTransactionHistory: true,
            });

            const conf = status?.value?.confirmationStatus;
            if (conf === 'confirmed' || conf === 'finalized') {
                if (status.value?.err) {
                    throw new Error(
                        `[SolanaRPC] Transaction ${signature} failed: ${JSON.stringify(status.value.err)}`,
                    );
                }
                return true;
            }

            await sleep(TX_CONFIRM_POLL_INTERVAL_MS);
        }

        throw new Error(
            `[SolanaRPC] Confirmation timeout after ${TX_CONFIRM_TIMEOUT_MS / 1000}s for signature: ${signature}`,
        );
    }

    // Slot / block helpers 

    /** Returns the current Devnet slot number. */
    async getCurrentSlot(): Promise<number> {
        return this.connection.getSlot();
    }

    /** Returns the latest blockhash. Used when building transactions manually. */
    async getLatestBlockhash() {
        return this.connection.getLatestBlockhash('confirmed');
    }

    // SOL balance 
    /**
     * Quick SOL balance fetch. For full balances including SPL tokens, use TokenManager.
     */
    async getSolBalance(publicKey: PublicKey): Promise<number> {
        const lamports = await this.connection.getBalance(publicKey, 'confirmed');
        return lamports / LAMPORTS_PER_SOL;
    }
}

// Module-level singleton factory 
let _instance: SolanaRPC | null = null;

/**
 * Returns the shared SolanaRPC singleton.
 * On first call, reads SOLANA_RPC_URL from the environment and applies the
 * mainnet guard. Subsequent calls return the cached instance.
 */
export function getSolanaRPC(): SolanaRPC {
    if (_instance) return _instance;

    const url = process.env.SOLANA_RPC_URL;
    if (!url) {
        throw new Error(
        '[SolanaRPC] SOLANA_RPC_URL is not set. Add it to your .env file.',
        );
    }

    _instance = new SolanaRPC(url);
    return _instance;
}

// Utilities 

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}