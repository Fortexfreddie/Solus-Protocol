/**
 * vault.ts
 * Layer 6: Vault — Secure Wallet Engine.
 *
 * Keypairs are generated once, immediately encrypted with AES-256-GCM, and never
 * stored in plaintext on disk or database. Private key material exists in RAM only
 * for the duration of a single signing operation and is zeroed immediately after.
 *
 * Public interface exposes ONLY:
 *   getPublicKey()              — returns the agent's Solana PublicKey (no secret material)
 *   getBalance()               — fetches SOL balance from Devnet RPC
 *   partiallySignTransaction() — agent partial-sign for Jupiter swaps (Kora pays gas)
 *   signTransaction()          — full sign for internal use
 *   signAndSendMemo()          — builds, signs, and sends a Memo Program tx (Layer 5)
 *   getHistory()               — returns recent confirmed transactions
 *   recordTransaction()        — appends a confirmed TxRecord to in-memory history
 *
 *  Kora co-sign model (Layer 7)
 * The Vault signs as the OWNER/AUTHORITY of the swap (proves agent authorization).
 * Kora (Layer 7) co-signs as the FEE PAYER — agents need no SOL reserve for gas.
 *
 * Signing flow for Jupiter swaps:
 *   1. BroadcastService builds unsigned transaction with Kora's payer as feePayer
 *   2. Vault.partiallySignTransaction() → agent sig only → base64 partial tx
 *   3. KoraPaymaster.cosign()           → Kora adds fee-payer sig → fully signed base64
 *   4. BroadcastService submits the fully co-signed transaction to Devnet RPC
 *
 * Storage: dual-mode via WalletStore interface
 *   development → filesystem (./wallets/*.vault.json)
 *   production  → PostgreSQL via Prisma (AgentWallet table)
 *
 * Devnet guard: startup rejects any SOLANA_RPC_URL that does not contain "devnet".
 * WebSocket event emitted: TX_SIGNING
 *
 * Fix: partiallySignTransaction() and signTransaction() now handle both
 * VersionedTransaction (Jupiter v6 V0 format) and legacy Transaction.
 * Jupiter v6 exclusively returns V0 versioned transactions — Transaction.from()
 * throws on these bytes. We detect the version byte (0 = versioned, else legacy)
 * and deserialize accordingly.
 */

import {
  Keypair,
  PublicKey,
  Connection,
  Transaction,
  VersionedTransaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

import {
  encrypt,
  decrypt,
  zeroBuffer,
  buildVaultPassword,
  type EncryptedPayload,
} from './key-store';
import { getWalletStore, type WalletStore } from './wallet-store.js';
import type {
  AgentId,
  EncryptedVaultFile,
  AgentBalance,
  TokenSymbol,
  TxRecord,
  IVault,
} from '../types/agent-types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const MINT_TO_SYMBOL: Record<string, TokenSymbol> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hard rejects any RPC URL that does not contain "devnet".
 * Called at Vault construction time — mainnet is unreachable by design.
 */
function assertDevnetUrl(url: string): void {
  if (!url.toLowerCase().includes('devnet')) {
    throw new Error(
      `[Vault] MAINNET GUARD TRIGGERED — SOLANA_RPC_URL must contain "devnet".\n` +
      `Received: "${url}"\n` +
      `Solus Protocol is configured for Solana Devnet only. Refusing to start.`,
    );
  }
}

/**
 * Detects whether serialized transaction bytes are a V0 VersionedTransaction
 * or a legacy Transaction by inspecting the first byte.
 *
 * Solana transaction format:
 *   - Legacy transactions begin with the number of required signatures (>= 1),
 *     encoded as a compact-u16. For any realistic transaction this is 0x01–0x7F.
 *   - Versioned transactions begin with a prefix byte of (0x80 | version).
 *     V0 versioned transactions therefore start with 0x80.
 *
 * We use this to route deserialization correctly so the Vault handles both
 * legacy memo transactions (built internally) and Jupiter v6 V0 swap transactions.
 */
function isVersionedTransaction(bytes: Uint8Array): boolean {
  return (bytes[0] & 0x80) !== 0 || bytes[0] === 0x00 || bytes[0] === 0x01;
}

// ─── Vault ────────────────────────────────────────────────────────────────────

export class Vault implements IVault {
  private readonly agentId: AgentId;
  private readonly store: WalletStore;
  private readonly password: string;
  private readonly connection: Connection;

  /** Cached public key — loaded from vault file at construction, never from decryption */
  private publicKey!: PublicKey;

  /** In-memory transaction history — populated via recordTransaction() after each confirmed swap */
  private txHistory: TxRecord[] = [];

  private constructor(
    agentId: AgentId,
    store: WalletStore,
    password: string,
    connection: Connection,
  ) {
    this.agentId    = agentId;
    this.store      = store;
    this.password   = password;
    this.connection = connection;
  }

  // ─── Factory: create ────────────────────────────────────────────────────────

  /**
   * Generates a fresh Solana keypair, encrypts it with AES-256-GCM, and persists
   * the encrypted vault via the WalletStore. The secret key is zeroed immediately
   * after encryption — it never touches disk/DB in plaintext.
   */
  static async create(
    agentId: AgentId,
    masterKey: string,
    rpcUrl: string,
  ): Promise<Vault> {
    assertDevnetUrl(rpcUrl);

    const password   = buildVaultPassword(masterKey, agentId);
    const connection = new Connection(rpcUrl, 'confirmed');
    const store      = getWalletStore();

    const keypair         = Keypair.generate();
    const secretKeyBuffer = Buffer.from(keypair.secretKey);

    let encryptedPayload: EncryptedPayload;
    try {
      encryptedPayload = encrypt(secretKeyBuffer, password);
    } finally {
      zeroBuffer(secretKeyBuffer);
    }

    const vaultFile: EncryptedVaultFile = {
      version:    1,
      agentId,
      publicKey:  keypair.publicKey.toBase58(),
      iv:         encryptedPayload.iv,
      authTag:    encryptedPayload.authTag,
      ciphertext: encryptedPayload.ciphertext,
      salt:       encryptedPayload.salt,
      createdAt:  Date.now(),
    };

    await store.save(agentId, vaultFile);

    const vault       = new Vault(agentId, store, password, connection);
    vault.publicKey   = keypair.publicKey;
    return vault;
  }

  // ─── Factory: load ──────────────────────────────────────────────────────────

  /**
   * Loads an existing encrypted vault from the WalletStore.
   * Does NOT decrypt on load — decryption only happens inside signing methods.
   */
  static async load(
    agentId: AgentId,
    masterKey: string,
    rpcUrl: string,
  ): Promise<Vault> {
    assertDevnetUrl(rpcUrl);

    const store     = getWalletStore();
    const vaultFile = await store.load(agentId);

    if (vaultFile.version !== 1) {
      throw new Error(`[Vault] Unsupported vault file version: ${vaultFile.version}`);
    }
    if (vaultFile.agentId !== agentId) {
      throw new Error(
        `[Vault] agentId mismatch: expected "${agentId}", got "${vaultFile.agentId}"`,
      );
    }

    const password   = buildVaultPassword(masterKey, agentId);
    const connection = new Connection(rpcUrl, 'confirmed');

    const vault     = new Vault(agentId, store, password, connection);
    vault.publicKey = new PublicKey(vaultFile.publicKey);
    return vault;
  }

  /**
   * Loads the vault if it already exists, otherwise creates a new one.
   * Convenience factory used by Agent constructor and smoke scripts.
   */
  static async loadOrCreate(
    agentId: AgentId,
    masterKey: string,
    rpcUrl: string,
  ): Promise<Vault> {
    const store = getWalletStore();
    if (await store.exists(agentId)) {
      return Vault.load(agentId, masterKey, rpcUrl);
    }
    return Vault.create(agentId, masterKey, rpcUrl);
  }

  // ─── Public interface ────────────────────────────────────────────────────────

  getPublicKey(): PublicKey  { return this.publicKey; }
  getAgentId():   AgentId    { return this.agentId;   }

  /**
   * Fetches the agent's current SOL and SPL token balances from Devnet RPC.
   * Does not require vault decryption.
   */
  async getBalance(): Promise<AgentBalance> {
    const lamports = await this.connection.getBalance(this.publicKey, 'confirmed');

    const tokens: Partial<Record<TokenSymbol, number>> = {};
    try {
      const response = await this.connection.getParsedTokenAccountsByOwner(
        this.publicKey,
        { programId: TOKEN_PROGRAM_ID },
        'confirmed',
      );
      for (const { account } of response.value) {
        const info   = account.data.parsed?.info;
        if (!info) continue;
        const symbol = MINT_TO_SYMBOL[info.mint as string];
        if (symbol) tokens[symbol] = info.tokenAmount?.uiAmount ?? 0;
      }
    } catch {
      // SPL fetch failure is non-fatal — SOL balance is still valid.
    }

    return { sol: lamports / 1_000_000_000, tokens, fetchedAt: Date.now() };
  }

  // ─── Signing ─────────────────────────────────────────────────────────────────

  /**
   * PARTIAL sign — used for Jupiter swap transactions routed through Kora (Layer 7).
   *
   * Handles both V0 VersionedTransaction (Jupiter v6) and legacy Transaction.
   * Jupiter v6 exclusively returns V0 versioned transactions — the previous
   * Transaction.from() call threw "Versioned messages must be deserialized with
   * VersionedMessage.deserialize()". We now detect the format via the version
   * prefix byte and deserialize accordingly.
   *
   * VersionedTransaction path:
   *   - Deserialize with VersionedTransaction.deserialize()
   *   - Call tx.sign([keypair]) — adds partial sig, does not require all signers
   *   - Serialize with tx.serialize() — returns Uint8Array
   *
   * Legacy Transaction path (retained for any non-Jupiter internal use):
   *   - Deserialize with Transaction.from()
   *   - Call tx.partialSign(keypair)
   *   - Serialize with requireAllSignatures: false
   *
   * Key lifecycle: decrypt → sign → zeroBuffer → return base64
   *
   * @param serializedTx - Unsigned serialized transaction bytes (V0 or legacy)
   * @returns Base64-encoded partially-signed transaction (agent sig only)
   */
  async partiallySignTransaction(serializedTx: Uint8Array): Promise<string> {
    const vaultFile       = await this.readVaultData();
    const secretKeyBuffer = decrypt(this.toEncryptedPayload(vaultFile), this.password);

    try {
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyBuffer));
      // console.log('[VAULT DEBUG] first byte:', serializedTx[0], '0x' + serializedTx[0].toString(16).toUpperCase());
      if (isVersionedTransaction(serializedTx)) {
        // ── V0 VersionedTransaction (Jupiter v6) ────────────────────────────
        const tx = VersionedTransaction.deserialize(serializedTx);
        // sign() on VersionedTransaction adds partial signatures for all provided
        // signers. Kora's fee-payer signature slot will remain empty until cosign().
        tx.sign([keypair]);
        return Buffer.from(tx.serialize()).toString('base64');

      } else {
        // ── Legacy Transaction (fallback) ───────────────────────────────────
        const tx = Transaction.from(serializedTx);
        tx.partialSign(keypair);
        const serialized = tx.serialize({ requireAllSignatures: false });
        return Buffer.from(serialized).toString('base64');
      }

    } finally {
      // MANDATORY zero — executes even if signing throws.
      zeroBuffer(secretKeyBuffer);
    }
  }

  /**
   * FULL sign — signs a serialized transaction with the agent as the sole signer.
   * Used internally when the agent is both authority and fee payer.
   *
   * Handles both V0 VersionedTransaction and legacy Transaction.
   *
   * Key lifecycle: decrypt → sign → zeroBuffer → return bytes
   *
   * @param serializedTx - Unsigned serialized transaction bytes (V0 or legacy)
   * @returns Fully signed transaction bytes
   */
  async signTransaction(serializedTx: Uint8Array): Promise<Uint8Array> {
    const vaultFile       = await this.readVaultData();
    const secretKeyBuffer = decrypt(this.toEncryptedPayload(vaultFile), this.password);

    try {
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyBuffer));

      if (isVersionedTransaction(serializedTx)) {
        const tx = VersionedTransaction.deserialize(serializedTx);
        tx.sign([keypair]);
        return tx.serialize();
      } else {
        const tx = Transaction.from(serializedTx);
        tx.sign(keypair);
        return tx.serialize();
      }

    } finally {
      zeroBuffer(secretKeyBuffer);
    }
  }

  /**
   * Builds, signs, and submits a Memo Program transaction to Solana Devnet.
   * Used exclusively by the Proof-of-Reasoning service (Layer 5).
   *
   * Always builds a legacy Transaction from scratch — memo transactions are
   * never versioned and never go through Jupiter. No format detection needed.
   *
   * Key lifecycle: decrypt → build tx → sign → zeroBuffer → sendAndConfirm → return sig
   */
  async signAndSendMemo(memoContent: string): Promise<string> {
    const vaultFile       = await this.readVaultData();
    const secretKeyBuffer = decrypt(this.toEncryptedPayload(vaultFile), this.password);

    try {
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyBuffer));

      const memoInstruction = new TransactionInstruction({
        keys:      [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
        data:      Buffer.from(memoContent, 'utf-8'),
        programId: MEMO_PROGRAM_ID,
      });

      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash('confirmed');

      const transaction = new Transaction({
        feePayer:            keypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(memoInstruction);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [keypair],
        { commitment: 'confirmed', maxRetries: 3 },
      );

      return signature;

    } finally {
      zeroBuffer(secretKeyBuffer);
    }
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  async getHistory(limit = 5): Promise<TxRecord[]> {
    return this.txHistory.slice(-limit);
  }

  recordTransaction(tx: TxRecord): void {
    this.txHistory.push(tx);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async readVaultData(): Promise<EncryptedVaultFile> {
    return this.store.load(this.agentId);
  }

  private toEncryptedPayload(vaultFile: EncryptedVaultFile): EncryptedPayload {
    return {
      iv:         vaultFile.iv,
      authTag:    vaultFile.authTag,
      ciphertext: vaultFile.ciphertext,
      salt:       vaultFile.salt,
    };
  }
}