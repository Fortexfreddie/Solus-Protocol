/**
 * wallet-store.ts
 * Storage abstraction for encrypted vault files.
 *
 * Dual-mode:
 *   development → FileWalletStore (filesystem, ./wallets/*.vault.json)
 *   production  → DbWalletStore   (Prisma AgentWallet table in Supabase)
 *
 * The Vault class calls these methods instead of using fs.* directly,
 * making it unaware of whether wallets live on disk or in a database.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isProduction, getPrisma } from '../config/db';
import type { EncryptedVaultFile } from '../types/agent-types';

//  Interface 

export interface WalletStore {
    /** Returns true if a vault exists for the given agent. */
    exists(agentId: string): Promise<boolean>;

    /** Persists an encrypted vault file. Throws if one already exists (no silent overwrite). */
    save(agentId: string, vaultFile: EncryptedVaultFile): Promise<void>;

    /** Loads an encrypted vault file. Throws if not found. */
    load(agentId: string): Promise<EncryptedVaultFile>;

    /** Persists the agent's starting SOL balance. Written once at wallet creation — no-op if already set. */
    saveStartingBalance(agentId: string, solBalance: number): Promise<void>;

    /** Returns the persisted starting SOL balance, or null if not yet recorded. */
    getStartingBalance(agentId: string): Promise<number | null>;
}

//  FileWalletStore (development) 

class FileWalletStore implements WalletStore {
    private readonly vaultDir: string;

    constructor(vaultDir: string) {
        this.vaultDir = vaultDir;
    }

    async exists(agentId: string): Promise<boolean> {
        return fs.existsSync(this.filePath(agentId));
    }

    async save(agentId: string, vaultFile: EncryptedVaultFile): Promise<void> {
        fs.mkdirSync(this.vaultDir, { recursive: true });
        fs.writeFileSync(this.filePath(agentId), JSON.stringify(vaultFile, null, 2), {
            mode: 0o600, // owner read/write only
            flag: 'wx',  // fail if file already exists
        });
    }

    async load(agentId: string): Promise<EncryptedVaultFile> {
        const filePath = this.filePath(agentId);
        if (!fs.existsSync(filePath)) {
            throw new Error(
                `[FileWalletStore] Vault not found for agent "${agentId}" at ${filePath}.\n` +
                `Run the vault creation script first: pnpm smoke:vault`,
            );
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as EncryptedVaultFile;
    }

    private filePath(agentId: string): string {
        return path.join(this.vaultDir, `${agentId}.vault.json`);
    }

    private baselinePath(agentId: string): string {
        return path.join(this.vaultDir, `${agentId}.baseline.json`);
    }

    async saveStartingBalance(agentId: string, solBalance: number): Promise<void> {
        const filePath = this.baselinePath(agentId);
        if (fs.existsSync(filePath)) return; // already written — no-op
        fs.mkdirSync(this.vaultDir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ startingBalanceSol: solBalance }));
    }

    async getStartingBalance(agentId: string): Promise<number | null> {
        const filePath = this.baselinePath(agentId);
        if (!fs.existsSync(filePath)) return null;
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { startingBalanceSol: number };
        return raw.startingBalanceSol;
    }
}

//  DbWalletStore (production) 

class DbWalletStore implements WalletStore {
    async exists(agentId: string): Promise<boolean> {
        const prisma = getPrisma();
        const record = await prisma.agentWallet.findUnique({ where: { id: agentId } });
        return record !== null;
    }

    async save(agentId: string, vaultFile: EncryptedVaultFile): Promise<void> {
        const prisma = getPrisma();

        // Check for existing wallet — never silently overwrite.
        const existing = await prisma.agentWallet.findUnique({ where: { id: agentId } });
        if (existing) {
            throw new Error(
                `[DbWalletStore] Wallet already exists for agent "${agentId}". ` +
                `Delete the existing record before creating a new one.`,
            );
        }

        await prisma.agentWallet.create({
            data: {
                id: agentId,
                encryptedKey: JSON.stringify(vaultFile), // Full EncryptedVaultFile as JSON string
                publicKey: vaultFile.publicKey,
            },
        });
    }

    async load(agentId: string): Promise<EncryptedVaultFile> {
        const prisma = getPrisma();
        const record = await prisma.agentWallet.findUnique({ where: { id: agentId } });

        if (!record) {
            throw new Error(
                `[DbWalletStore] No wallet found for agent "${agentId}" in database.\n` +
                `Run the vault creation script first: NODE_ENV=production pnpm smoke:vault`,
            );
        }

        return JSON.parse(record.encryptedKey) as EncryptedVaultFile;
    }

    async saveStartingBalance(agentId: string, solBalance: number): Promise<void> {
        const prisma = getPrisma();
        // Only write if not already set (> -1 means already recorded).
        const existing = await prisma.agentWallet.findUnique({ where: { id: agentId } });
        if (!existing || existing.startingBalanceSol > -1) return;
        await prisma.agentWallet.update({
            where: { id: agentId },
            data: { startingBalanceSol: solBalance },
        });
    }

    async getStartingBalance(agentId: string): Promise<number | null> {
        const prisma = getPrisma();
        const record = await prisma.agentWallet.findUnique({ where: { id: agentId } });
        if (!record || record.startingBalanceSol === -1) return null;
        return record.startingBalanceSol;
    }
}

//  Factory 

let _store: WalletStore | null = null;

/**
 * Returns the appropriate WalletStore for the current environment.
 * Production → DbWalletStore (Prisma/Supabase)
 * Development → FileWalletStore (filesystem)
 */
export function getWalletStore(): WalletStore {
    if (!_store) {
        if (isProduction) {
            _store = new DbWalletStore();
        } else {
            const vaultDir = process.env.VAULT_DIR ?? './wallets';
            _store = new FileWalletStore(vaultDir);
        }
    }
    return _store;
}
