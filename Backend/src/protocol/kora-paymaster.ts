/**
 * kora-paymaster.ts
 * Integrates the Kora gasless signing infrastructure from the Solana Foundation.
 * Accepts agent-signed (partially signed) transactions from the Vault and co-signs
 * them as fee payer via the KoraClient SDK, eliminating the need for agents to hold
 * SOL for gas fees.
 *
 * Layer 7 responsibility split:
 *   - Vault (Layer 6): agent proves ownership and intent by signing the transaction
 *   - KoraPaymaster (Layer 7): pays gas by co-signing as fee payer
 *
 * Security note: Kora can only co-sign what the agent has already authorized.
 * It cannot initiate transactions or redirect funds independently.
 *
 * SDK reference: @solana/kora — https://www.npmjs.com/package/@solana/kora
 * KoraClient({ rpcUrl, apiKey? })
 * client.signTransaction({ transaction: base64String }) -> co-signed tx
 * client.getPayerSigner() -> { signer_address }
 * client.getBlockhash() -> { blockhash, lastValidBlockHeight }
 */

import { KoraClient } from '@solana/kora';

// Types

export interface KoraSignResult {
    /** Base64-encoded fully signed transaction (agent + Kora co-sign) */
    signedTransaction: string;
    /** Kora's fee payer address — for audit logging */
    koraSignerAddress: string;
    /** Timestamp of co-sign operation */
    cosignedAt: number;
}

export interface KoraHealthResult {
    connected: boolean;
    signerAddress?: string;
    latencyMs?: number;
    error?: string;
}

export interface KoraBlockhash {
    blockhash: string;
    lastValidBlockHeight: number;
}

// Constants 

const KORA_TIMEOUT_MS = 10_000; // 10-second timeout for all Kora RPC calls

// KoraPaymaster class 
export class KoraPaymaster {
    private readonly client: KoraClient;
    private readonly rpcUrl: string;
    /** Cached after first successful getPayerSigner() call to avoid repeated RPC round-trips */
    private cachedSignerAddress: string | null = null;

    constructor(rpcUrl: string, apiKey?: string, hmacSecret?: string) {
        this.rpcUrl = rpcUrl;
        this.client = new KoraClient({
        rpcUrl,
        ...(apiKey ? { apiKey } : {}),
        ...(hmacSecret ? { hmacSecret } : {}),
        });
    }

    // Connection verification 

    /**
     * Verifies Kora node connectivity by fetching the signer address.
     * Called during startup (step 4 of boot sequence) and by the /health endpoint.
     * Fails gracefully — returns { connected: false } rather than throwing.
     */
    async verifyConnection(): Promise<KoraHealthResult> {
        const start = Date.now();
        try {
            const { signer_address } = await withTimeout(
                this.client.getPayerSigner(),
                KORA_TIMEOUT_MS,
                'Kora getPayerSigner() timed out',
            );
            this.cachedSignerAddress = signer_address;
            return {
                connected: true,
                signerAddress: signer_address,
                latencyMs: Date.now() - start,
            };
        } catch (err) {
            return {
                connected: false,
                error: (err as Error).message,
                latencyMs: Date.now() - start,
            };
        }
    }

    // Co-signing (Layer 7 core operation) 
    /**
     * Accepts a base64-encoded, agent-partially-signed transaction and submits it
     * to the Kora node for fee-payer co-signing.
     *
     * The expected flow:
     *   1. Agent has already signed the transaction (Layer 6 Vault output)
     *   2. Kora validates the tx against its configured allowlist and spend rules
     *   3. Kora adds its signature as the fee payer
     *   4. Returns the fully signed transaction ready for broadcast
     *
     * Kora cannot initiate or redirect transactions — it can only co-sign what the
     * agent has already authorized. This is a security property of the protocol.
     *
     * @param base64AgentSignedTx - Base64-encoded partially signed transaction
     * @returns KoraSignResult containing the fully co-signed transaction
     * @throws if Kora rejects the transaction, the node is unreachable, or times out
     */
    async cosign(base64AgentSignedTx: string): Promise<KoraSignResult> {
        const response = await withTimeout(
        this.client.signTransaction({ transaction: base64AgentSignedTx }),
        KORA_TIMEOUT_MS,
        'Kora signTransaction() timed out',
        );

        const signedTx = extractSignedTransaction(response);
        const signerAddress = this.cachedSignerAddress ?? await this.getSignerAddress();

        return {
        signedTransaction: signedTx,
        koraSignerAddress: signerAddress,
        cosignedAt: Date.now(),
        };
    }

    // Blockhash helper

    /**
     * Fetches the latest blockhash from the Kora node.
     * Using Kora's blockhash ensures the transaction lifetime is aligned with
     * the same network state that Kora will validate against during co-signing.
     */
    async getBlockhash(): Promise<KoraBlockhash> {
        const result = await withTimeout(
        this.client.getBlockhash(),
        KORA_TIMEOUT_MS,
        'Kora getBlockhash() timed out',
        ) as KoraBlockhash;
        return result;
    }

    // Signer address 

    /**
     * Returns the Kora node's fee payer public key (base58).
     * Cached after the first call to minimize RPC round-trips per cycle.
     */
    async getSignerAddress(): Promise<string> {
        if (this.cachedSignerAddress) return this.cachedSignerAddress;
        const { signer_address } = await withTimeout(
        this.client.getPayerSigner(),
        KORA_TIMEOUT_MS,
        'Kora getPayerSigner() timed out',
        );
        this.cachedSignerAddress = signer_address;
        return signer_address;
    }

    getRpcUrl(): string {
        return this.rpcUrl;
    }
}

// Utility helpers 

/**
 * Wraps a promise with a hard timeout. The Kora node may be slow or unreachable
 * during devnet testing — we must never block an agent cycle indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`[KoraPaymaster] ${message}`)), ms);
        promise
        .then((v) => { clearTimeout(timer); resolve(v); })
        .catch((e: unknown) => { clearTimeout(timer); reject(e as Error); });
    });
}

/**
 * Extracts the co-signed transaction string from the Kora signTransaction response.
 * The @solana/kora SDK has evolved across versions and field names differ.
 * This helper handles the known variations defensively.
 */
function extractSignedTransaction(response: unknown): string {
    // Some SDK versions return the string directly
    if (typeof response === 'string') return response;

    if (response !== null && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        // Known field names across SDK versions
        if (typeof r['transaction'] === 'string') return r['transaction'];
        if (typeof r['signedTransaction'] === 'string') return r['signedTransaction'];
        if (typeof r['result'] === 'string') return r['result'];
    }

    throw new Error(
        `[KoraPaymaster] Unexpected signTransaction response shape. ` +
        `Cannot extract signed transaction from: ${JSON.stringify(response)}`,
    );
}

// Module-level singleton 
let _instance: KoraPaymaster | null = null;

/**
 * Returns the shared KoraPaymaster singleton.
 * Reads KORA_RPC_URL and KORA_API_KEY from environment on first call.
 * Throws clearly if KORA_RPC_URL is not configured.
 */
export function getKoraPaymaster(): KoraPaymaster {
    if (_instance) return _instance;

    const rpcUrl = process.env.KORA_RPC_URL;
    if (!rpcUrl) {
        throw new Error(
        '[KoraPaymaster] KORA_RPC_URL is not set.\n' +
        'Add it to your .env file. For local development: KORA_RPC_URL=http://localhost:8080\n' +
        'See https://launch.solana.com/docs/kora/getting-started for setup instructions.',
        );
    }

    // KORA_API_KEY is optional — depends on how the Kora node is configured.
    // Nodes configured with apiKey authentication require it; others do not.
    const apiKey = process.env.KORA_API_KEY;
    const hmacSecret = process.env.KORA_HMAC_SECRET; // Optional HMAC secret for additional auth
    _instance = new KoraPaymaster(rpcUrl, apiKey, hmacSecret);
    return _instance;
}