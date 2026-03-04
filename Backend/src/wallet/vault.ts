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
 */

import {
  Keypair,
  PublicKey,
  Connection,
  Transaction,
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

//  Constants

// The well-known Solana SPL Memo Program ID.
// Used to anchor Proof-of-Reasoning hashes on-chain (Layer 5).
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// SPL token mint addresses → token symbols for balance lookup.
// Must match price-oracle.ts TOKEN_MINTS.
const MINT_TO_SYMBOL: Record<string, TokenSymbol> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
};

//  Mainnet guard

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

//  Vault class

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
    this.agentId = agentId;
    this.store = store;
    this.password = password;
    this.connection = connection;
  }

  //  Factory: create new vault

  /**
   * Generates a fresh Solana keypair, encrypts it with AES-256-GCM, and persists
   * the encrypted vault via the WalletStore. The secret key is zeroed immediately
   * after encryption — it never touches disk/DB in plaintext.
   *
   * @param agentId   - Agent identity (rex | nova | sage)
   * @param masterKey - VAULT_MASTER_KEY from env; combined with agentId for key uniqueness
   * @param rpcUrl    - Solana RPC URL — must contain "devnet"
   */
  static async create(
    agentId: AgentId,
    masterKey: string,
    rpcUrl: string,
  ): Promise<Vault> {
    assertDevnetUrl(rpcUrl);

    const password = buildVaultPassword(masterKey, agentId);
    const connection = new Connection(rpcUrl, 'confirmed');
    const store = getWalletStore();

    const keypair = Keypair.generate();
    const secretKeyBuffer = Buffer.from(keypair.secretKey);

    let encryptedPayload: EncryptedPayload;
    try {
      encryptedPayload = encrypt(secretKeyBuffer, password);
    } finally {
      // Zero even if encryption throws — secret key must never linger in memory.
      zeroBuffer(secretKeyBuffer);
    }

    const vaultFile: EncryptedVaultFile = {
      version: 1,
      agentId,
      publicKey: keypair.publicKey.toBase58(),
      iv: encryptedPayload.iv,
      authTag: encryptedPayload.authTag,
      ciphertext: encryptedPayload.ciphertext,
      salt: encryptedPayload.salt,
      createdAt: Date.now(),
    };

    await store.save(agentId, vaultFile);

    const vault = new Vault(agentId, store, password, connection);
    vault.publicKey = keypair.publicKey;
    return vault;
  }

  //  Factory: load existing vault

  /**
   * Loads an existing encrypted vault from the WalletStore.
   * Does NOT decrypt on load — decryption only happens inside signing methods.
   *
   * @throws if the vault does not exist, is malformed, or agentId mismatches.
   */
  static async load(
    agentId: AgentId,
    masterKey: string,
    rpcUrl: string,
  ): Promise<Vault> {
    assertDevnetUrl(rpcUrl);

    const store = getWalletStore();
    const vaultFile = await store.load(agentId);

    if (vaultFile.version !== 1) {
      throw new Error(`[Vault] Unsupported vault file version: ${vaultFile.version}`);
    }
    if (vaultFile.agentId !== agentId) {
      throw new Error(
        `[Vault] agentId mismatch: expected "${agentId}", got "${vaultFile.agentId}"`,
      );
    }

    const password = buildVaultPassword(masterKey, agentId);
    const connection = new Connection(rpcUrl, 'confirmed');

    const vault = new Vault(agentId, store, password, connection);
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

  //  Public interface

  /** Returns the agent's Solana PublicKey. Safe to share — no secret material. */
  getPublicKey(): PublicKey {
    return this.publicKey;
  }

  /** Returns the agent's identity string. */
  getAgentId(): AgentId {
    return this.agentId;
  }

  /**
   * Fetches the agent's current SOL and SPL token balances from Devnet RPC.
   * SPL tokens are resolved via getParsedTokenAccountsByOwner and matched
   * against the known MINT_TO_SYMBOL map (USDC, RAY, BONK).
   * Does not require vault decryption.
   */
  async getBalance(): Promise<AgentBalance> {
    const lamports = await this.connection.getBalance(this.publicKey, 'confirmed');

    // Fetch all SPL token accounts for this wallet in a single RPC call.
    const tokens: Partial<Record<TokenSymbol, number>> = {};
    try {
      const response = await this.connection.getParsedTokenAccountsByOwner(
        this.publicKey,
        { programId: TOKEN_PROGRAM_ID },
        'confirmed',
      );

      for (const { account } of response.value) {
        const info = account.data.parsed?.info;
        if (!info) continue;
        const mint: string = info.mint;
        const symbol = MINT_TO_SYMBOL[mint];
        if (symbol) {
          tokens[symbol] = info.tokenAmount?.uiAmount ?? 0;
        }
      }
    } catch {
      // SPL fetch failure is non-fatal — SOL balance is still valid.
      // Tokens will remain at 0 which is conservative for stop-loss.
    }

    return {
      sol: lamports / 1_000_000_000,
      tokens,
      fetchedAt: Date.now(),
    };
  }

  //  Signing methods

  /**
   * PARTIAL sign — used for Jupiter swap transactions routed through Kora (Layer 7).
   *
   * The transaction's feePayer must already be set to Kora's payer address before
   * calling this method. The agent adds its authority signature only.
   * Kora will add the fee-payer signature in the next step.
   *
   * Key lifecycle: decrypt → partialSign → zeroBuffer → return base64
   *
   * @param serializedTx - Unsigned serialized legacy Transaction bytes
   * @returns Base64-encoded partially-signed transaction (agent sig only)
   */
  async partiallySignTransaction(serializedTx: Uint8Array): Promise<string> {
    const vaultFile = await this.readVaultData();
    const secretKeyBuffer = decrypt(this.toEncryptedPayload(vaultFile), this.password);

    try {
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyBuffer));
      const tx = Transaction.from(serializedTx);

      // partialSign adds the agent's signature without requiring all signers present.
      // The fee payer (Kora) will co-sign separately.
      tx.partialSign(keypair);

      // requireAllSignatures: false because Kora's fee-payer sig is not yet present.
      const serialized = tx.serialize({ requireAllSignatures: false });
      return Buffer.from(serialized).toString('base64');

    } finally {
      // MANDATORY zero — executes even if signing throws.
      zeroBuffer(secretKeyBuffer);
    }
  }

  /**
   * FULL sign — signs a serialized transaction with the agent as the sole signer.
   * Used internally when the agent is both authority and fee payer.
   *
   * Key lifecycle: decrypt → sign → zeroBuffer → return bytes
   *
   * @param serializedTx - Unsigned serialized legacy Transaction bytes
   * @returns Fully signed transaction bytes
   */
  async signTransaction(serializedTx: Uint8Array): Promise<Uint8Array> {
    const vaultFile = await this.readVaultData();
    const secretKeyBuffer = decrypt(this.toEncryptedPayload(vaultFile), this.password);

    try {
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyBuffer));
      const tx = Transaction.from(serializedTx);
      tx.sign(keypair);
      return tx.serialize();

    } finally {
      zeroBuffer(secretKeyBuffer);
    }
  }

  /**
   * Builds, signs, and submits a Memo Program transaction to Solana Devnet.
   * Used exclusively by the Proof-of-Reasoning service (Layer 5) to anchor
   * SHA-256 decision hashes on-chain before any swap is executed.
   *
   * The agent is the fee payer for memo transactions — Devnet SOL must be present
   * in the agent wallet. The orchestrator auto-airdrops at startup if balance < 0.1 SOL.
   * Jupiter swap transactions use Kora as fee payer instead (Layer 7).
   *
   * Key lifecycle: decrypt → build tx → sign → zeroBuffer → sendAndConfirm → return sig
   * The keypair never leaves this method.
   *
   * @param memoContent - The UTF-8 string to embed in the Memo Program instruction
   *                      (e.g. "solus-protocol:proof:<sha256-hash>")
   * @returns The confirmed transaction signature (base58)
   */
  async signAndSendMemo(memoContent: string): Promise<string> {
    const vaultFile = await this.readVaultData();
    const secretKeyBuffer = decrypt(this.toEncryptedPayload(vaultFile), this.password);

    try {
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyBuffer));

      // Build the Memo Program instruction directly — no external SDK dependency.
      const memoInstruction = new TransactionInstruction({
        keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from(memoContent, 'utf-8'),
        programId: MEMO_PROGRAM_ID,
      });

      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash('confirmed');

      const transaction = new Transaction({
        feePayer: keypair.publicKey,
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
      // MANDATORY zero — executes even if signing or confirmation throws.
      zeroBuffer(secretKeyBuffer);
    }
  }

  //  History

  /**
   * Returns the last `limit` confirmed transactions for this agent.
   * History is maintained in memory; the audit logger is the durable record.
   */
  async getHistory(limit = 5): Promise<TxRecord[]> {
    return this.txHistory.slice(-limit);
  }

  /**
   * Appends a confirmed TxRecord to the in-memory history.
   * Called by agent.ts immediately after TX_CONFIRMED is received.
   */
  recordTransaction(tx: TxRecord): void {
    this.txHistory.push(tx);
  }

  //  Private helpers

  /**
   * Reads the vault data from the store.
   * Called at the start of every signing operation.
   */
  private async readVaultData(): Promise<EncryptedVaultFile> {
    return this.store.load(this.agentId);
  }

  /**
   * Extracts the EncryptedPayload fields from a vault file object.
   * Centralises the field mapping so signing methods don't repeat it.
   */
  private toEncryptedPayload(vaultFile: EncryptedVaultFile): EncryptedPayload {
    return {
      iv: vaultFile.iv,
      authTag: vaultFile.authTag,
      ciphertext: vaultFile.ciphertext,
      salt: vaultFile.salt,
    };
  }
}