// src/wallet/token-manager.ts
// Handles all token-related RPC operations for Solus Protocol agents.
// Manages SOL balances, SPL token accounts, and ATA creation.

import {
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TokenAccountNotFoundError,
    TokenInvalidAccountOwnerError,
} from '@solana/spl-token';

import type { TokenSymbol, AgentBalance } from '../types/agent-types.js';

// Known Token Mint Addresses (Devnet)
// These are the official devnet mint addresses for the tokens Solus Protocol trades.

export const TOKEN_MINTS: Record<TokenSymbol, PublicKey> = {
    // SOL does not have a mint address (it's the native token)
    // but we include it here as a sentinel for completeness.
    SOL: new PublicKey('So11111111111111111111111111111111111111112'),    // Wrapped SOL
    USDC: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), // USDC (devnet)
    RAY: new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'),  // RAY (devnet)
    BONK: new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), // BONK (devnet)
};

// TokenManager class 

export class TokenManager {
    private readonly connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    // SOL Balance 
    /**
     * Fetches the native SOL balance for a wallet address.
     * @returns SOL amount as a decimal (e.g., 1.5 SOL, not lamports)
     */
    async getSolBalance(owner: PublicKey): Promise<number> {
        const lamports = await this.connection.getBalance(owner, 'confirmed');
        return lamports / LAMPORTS_PER_SOL;
    }

    // SPL Token Balance 

    /**
     * Fetches the SPL token balance for a given token and wallet owner.
     * Returns 0 if the associated token account (ATA) does not exist.
     *
     * @param owner  - Wallet public key
     * @param token  - Token symbol (USDC | RAY | BONK)
     * @returns Token amount in UI-friendly decimals (e.g., 27.5 USDC)
     */
    async getTokenBalance(owner: PublicKey, token: Exclude<TokenSymbol, 'SOL'>): Promise<number> {
            const mint = TOKEN_MINTS[token];
            const ata = await getAssociatedTokenAddress(
            mint,
            owner,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        try {
            const account = await getAccount(this.connection, ata, 'confirmed');
            // Convert from raw lamport-equivalent units to UI amount
            const mintInfo = await this.connection.getParsedAccountInfo(mint);
            const decimals = this.extractMintDecimals(mintInfo);
            return Number(account.amount) / Math.pow(10, decimals);
        } catch (err) {
        if (
            err instanceof TokenAccountNotFoundError ||
            err instanceof TokenInvalidAccountOwnerError
        ) {
            // ATA doesn't exist — balance is effectively 0
            return 0;
        }
            throw err;
        }
    }

    // Full Balance Snapshot 
    /**
     * Fetches SOL + all supported SPL token balances for a wallet.
     * Used by the Vault and Strategist to build the current agent balance state.
     */
    async getFullBalance(owner: PublicKey): Promise<AgentBalance> {
        const [sol, usdc, ray, bonk] = await Promise.all([
            this.getSolBalance(owner),
            this.getTokenBalance(owner, 'USDC'),
            this.getTokenBalance(owner, 'RAY'),
            this.getTokenBalance(owner, 'BONK'),
        ]);

        return {
            sol,
            tokens: {
                USDC: usdc,
                RAY: ray,
                BONK: bonk,
            },
            fetchedAt: Date.now(),
        };
    }

    // Associated Token Account (ATA)

    /**
     * Returns the Associated Token Account (ATA) address for a given owner and token.
     * The ATA is a deterministic address — it does not require an RPC call to compute.
     */
    async getAtaAddress(owner: PublicKey, token: Exclude<TokenSymbol, 'SOL'>): Promise<PublicKey> {
        const mint = TOKEN_MINTS[token];
        return getAssociatedTokenAddress(
            mint,
            owner,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );
    }

    /**
     * Checks whether the ATA for the given owner and token exists on-chain.
     * @returns true if the ATA exists and is initialized
     */
    async ataExists(owner: PublicKey, token: Exclude<TokenSymbol, 'SOL'>): Promise<boolean> {
        const ata = await this.getAtaAddress(owner, token);
        try {
            await getAccount(this.connection, ata, 'confirmed');
            return true;
        } catch (err) {
        if (
            err instanceof TokenAccountNotFoundError ||
            err instanceof TokenInvalidAccountOwnerError
        ) {
            return false;
        }
            throw err;
        }
    }

    /**
     * Builds an instruction to create the ATA for the given owner and token.
     * The instruction must be included in a transaction and signed by the payer.
     *
     * Usage: include this in the swap transaction build if the ATA doesn't exist yet.
     */
    async buildCreateAtaInstruction(
        payer: PublicKey,
        owner: PublicKey,
        token: Exclude<TokenSymbol, 'SOL'>,
    ) {
        const mint = TOKEN_MINTS[token];
        const ata = await this.getAtaAddress(owner, token);

        return createAssociatedTokenAccountInstruction(
            payer,
            ata,
            owner,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );
    }

    /**
     * Ensures the ATA for a given token exists, creating it if necessary.
     * Returns the ATA public key.
     *
     * NOTE: This returns the instruction if creation is needed. The caller is
     * responsible for including it in a transaction (the swap tx is a good place).
     */
    async ensureAta(
        payer: PublicKey,
        owner: PublicKey,
        token: Exclude<TokenSymbol, 'SOL'>,
    ): Promise<{ ata: PublicKey; needsCreation: boolean; createInstruction?: ReturnType<typeof createAssociatedTokenAccountInstruction> }> {
            const ata = await this.getAtaAddress(owner, token);
            const exists = await this.ataExists(owner, token);

            if (exists) {
            return { ata, needsCreation: false };
        }

        const createInstruction = await this.buildCreateAtaInstruction(payer, owner, token);
        return { ata, needsCreation: true, createInstruction };
    }

    // Helpers

    /**
     * Extracts the mint's decimal count from a parsed account info response.
     * Falls back to 6 decimals (USDC default) if extraction fails.
     */
    private extractMintDecimals(
        mintInfo: Awaited<ReturnType<Connection['getParsedAccountInfo']>>,
    ): number {
        try {
            const parsed = mintInfo.value?.data;
            if (parsed && typeof parsed === 'object' && 'parsed' in parsed) {
                const parsedData = (parsed as { parsed: unknown }).parsed;
                if (parsedData && typeof parsedData === 'object' && 'info' in parsedData) {
                    const info = (parsedData as { info: unknown }).info;
                    if (info && typeof info === 'object' && 'decimals' in info) {
                        return typeof info.decimals === 'number' ? info.decimals : 6;
                    }
                }
            }
        } catch (err) {
            // fall through to default
        }
        return 6;
    }

    /**
     * Returns the mint PublicKey for a given token symbol.
     */
    getMint(token: TokenSymbol): PublicKey {
        return TOKEN_MINTS[token];
    }
}