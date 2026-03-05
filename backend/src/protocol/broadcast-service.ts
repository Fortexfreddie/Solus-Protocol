/**
 * broadcast-service.ts
 * Layer 7: Broadcast Service — Jupiter swap execution via Kora gasless infrastructure.
 *
 * Responsible for the final leg of every agent swap cycle:
 * 1. Request a Jupiter swap quote for the approved token pair and amount
 * 2. Fetch the swap transaction bytes from the Jupiter Swap API
 * 3. Pass the unsigned transaction to the Vault (Layer 6) for partial signing
 * 4. Pass the agent-signed transaction to Kora for fee-payer co-signing (Layer 7)
 * 5. Submit the fully signed transaction to Devnet RPC
 * 6. Poll for confirmation with a 30-second timeout
 * 7. On success: return TxConfirmation for audit logging and event emission
 * 8. On failure: retry once, then throw for the caller to emit TX_FAILED
 *
 * Security boundary: this service never holds private keys. The Vault handles
 * all cryptographic signing — this service only handles serialized transaction bytes.
 *
 * WebSocket events emitted by the caller (agent.ts):
 * KORA_SIGNED, TX_SUBMITTED, TX_CONFIRMED, TX_FAILED, BALANCE_UPDATE
 */

import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { TxConfirmation, StrategistDecision, TokenSymbol } from '../types/agent-types';
import { getSolanaRPC } from './solana-rpc';
import { getKoraPaymaster } from './kora-paymaster';

//  Jupiter API constants

// Jupiter v6 Quote API — used on devnet (prices are sourced from mainnet pools).
const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1/swap';

// Devnet token mint addresses — must match price-oracle.ts TOKEN_MINTS.
const TOKEN_MINTS: Record<TokenSymbol, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_DECIMALS = 6;
const RAY_DECIMALS = 6;
const BONK_DECIMALS = 5;
const SLIPPAGE_BPS = 50;   // 0.5% slippage tolerance
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRY = 1;    // Retry once on submission failure (per spec)

//  Types -

interface JupiterQuote {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    priceImpactPct: string;
    routePlan: unknown[];
    slippageBps: number;
    otherAmountThreshold: string;
}

interface JupiterSwapResponse {
    swapTransaction: string; // base64-encoded versioned transaction
}

//  Amount conversion helpers 

function toBaseUnits(amount: number, token: TokenSymbol): number {
    switch (token) {
        case 'SOL': return Math.floor(amount * LAMPORTS_PER_SOL);
        case 'USDC': return Math.floor(amount * 10 ** USDC_DECIMALS);
        case 'RAY': return Math.floor(amount * 10 ** RAY_DECIMALS);
        case 'BONK': return Math.floor(amount * 10 ** BONK_DECIMALS);
    }
}

function fromBaseUnits(amount: string, token: TokenSymbol): number {
    const n = parseInt(amount, 10);
    switch (token) {
        case 'SOL': return n / LAMPORTS_PER_SOL;
        case 'USDC': return n / 10 ** USDC_DECIMALS;
        case 'RAY': return n / 10 ** RAY_DECIMALS;
        case 'BONK': return n / 10 ** BONK_DECIMALS;
    }
}

//  HTTP helper -

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

//  BroadcastService class 

export class BroadcastService {
    private readonly connection: Connection;

    constructor() {
        this.connection = getSolanaRPC().getConnection();
    }

    //  Public API 

    /**
     * Executes the full Layer 6 + Layer 7 swap pipeline for one approved decision.
     *
     * Steps:
     * 1. Get Jupiter quote
     * 2. Get swap transaction bytes from Jupiter
     * 3. Vault partial signs (agent proves intent, Layer 6)
     * 4. Kora co-signs as fee payer (Layer 7)
     * 5. Submit and confirm on Devnet
     *
     * @param decision         - The final approved decision from the Policy Engine
     * @param agentPublicKey   - Agent's base58 public key (for Jupiter userPublicKey)
     * @param partialSign      - Vault callback: serialized tx → base64 partially-signed tx
     * @returns TxConfirmation with signature, amounts, and timestamp
     * @throws on quote failure, signing failure, or unconfirmed after retry
     */
    async executeSwap(
        decision: StrategistDecision,
        agentPublicKey: string,
        partialSign: (serializedTx: Uint8Array) => Promise<string>,
    ): Promise<{ signature: string; confirmation: TxConfirmation; koraSignerAddress: string }> {
        let attempt = 0;

        while (attempt <= MAX_RETRY) {
            try {
                // Step 1 — Jupiter quote
                const quote = await this.getQuote(decision);

                // Step 2 — Jupiter swap transaction bytes
                const swapTxBase64 = await this.getSwapTransaction(quote, agentPublicKey);
                const swapTxBytes = Buffer.from(swapTxBase64, 'base64');

                // Step 3 — Vault partial sign (Layer 6)
                const agentSignedBase64 = await partialSign(new Uint8Array(swapTxBytes));

                // Step 4 — Kora co-sign as fee payer (Layer 7)
                const kora = getKoraPaymaster();
                const koraResult = await kora.cosign(agentSignedBase64);

                // Step 5 — Submit to Devnet RPC
                const fullySignedBytes = Buffer.from(koraResult.signedTransaction, 'base64');
                const signature = await this.submitTransaction(fullySignedBytes);

                // Step 6 — Confirm via SolanaRPC (30s timeout per spec)
                await getSolanaRPC().confirmTransaction(signature);

                const outAmount = fromBaseUnits(quote.outAmount, decision.toToken);

                const txConfirmation: TxConfirmation = {
                    signature,
                    fromToken: decision.fromToken,
                    toToken: decision.toToken,
                    amount: decision.amount,
                    output: outAmount,
                    confirmedAt: Date.now(),
                };

                return {
                    signature,
                    confirmation: txConfirmation,
                    koraSignerAddress: koraResult.koraSignerAddress,
                };

            } catch (err) {
                attempt++;
                if (attempt > MAX_RETRY) {
                    throw new Error(
                        `[BroadcastService] Swap failed after ${MAX_RETRY + 1} attempt(s): ${(err as Error).message}`,
                    );
                }
                await sleep(2_000);
            }
        }

        throw new Error('[BroadcastService] Unexpected execution path.');
    }

    //  Jupiter integration 

    private async getQuote(decision: StrategistDecision): Promise<JupiterQuote> {
        const inputMint = TOKEN_MINTS[decision.fromToken];
        const outputMint = TOKEN_MINTS[decision.toToken];
        const amount = toBaseUnits(decision.amount, decision.fromToken);

        const params = new URLSearchParams({
            inputMint,
            outputMint,
            amount: String(amount),
            slippageBps: String(SLIPPAGE_BPS),
        });

        const response = await fetchWithTimeout(`${JUPITER_QUOTE_API}?${params.toString()}`, {
            headers: {
                'x-api-key': process.env.JUPITER_API_KEY || ''
            }
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Jupiter Quote API error ${response.status}: ${body.slice(0, 200)}`);
        }

        return await response.json() as JupiterQuote;
    }

    private async getSwapTransaction(
        quote: JupiterQuote,
        userPublicKey: string,
    ): Promise<string> {
        const body = {
            quoteResponse: quote,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: { maxBps: 300 },
        };

        const response = await fetchWithTimeout(JUPITER_SWAP_API, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-api-key': process.env.JUPITER_API_KEY || ''
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Jupiter Swap API error ${response.status}: ${errorBody.slice(0, 200)}`);
        }

        const data = await response.json() as JupiterSwapResponse;
        return data.swapTransaction;
    }

    //  RPC submission -

    private async submitTransaction(signedTxBytes: Uint8Array): Promise<string> {
        try {
            const versionedTx = VersionedTransaction.deserialize(signedTxBytes);
            return await this.connection.sendRawTransaction(versionedTx.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3,
            });
        } catch {
            const legacyTx = Transaction.from(signedTxBytes);
            return await this.connection.sendRawTransaction(legacyTx.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3,
            });
        }
    }
}

//  Singleton ─

export const broadcastService = new BroadcastService();

//  Utilities ─

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}