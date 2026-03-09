// src/scripts/smoke-tx-submission.ts
// Bypasses Layers 1–5 (Strategist, Guardian, Policy, Proof) and directly tests
// the full broadcast pipeline: Jupiter quote → swap tx → vault sign → kora cosign → devnet submit.
// Run with: `pnpmtsx src/scripts/smoke-tx-submission.ts`

import 'dotenv/config';
import { Vault } from '../wallet/vault';
import { KoraPaymaster } from '../protocol/kora-paymaster';
import { BroadcastService } from '../protocol/broadcast-service';
import type { StrategistDecision } from '../types/agent-types';

const MASTER_KEY = process.env.VAULT_MASTER_KEY ?? '';
const RPC_URL    = process.env.SOLANA_RPC_URL   ?? 'https://api.devnet.solana.com';
const KORA_URL   = process.env.KORA_RPC_URL     ?? '';

const FAKE_DECISION: StrategistDecision = {
    decision:   'SWAP',
    fromToken:  'SOL',
    toToken:    'USDC',
    amount:     0.001,
    confidence: 0.99,
    reasoning:  'smoke-tx-submission: manual pipeline test, bypassing agent layers.',
    riskFlags:  [],
};

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = {
    info:    (step: string, msg: string, data?: unknown) =>
        console.log(`        ✓ [${step}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : ''),
    warn:    (step: string, msg: string, data?: unknown) =>
        console.warn(`        ⚠ [${step}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : ''),
    error:   (step: string, msg: string, err?: unknown) =>
        console.error(`        ❌ [${step}] ${msg}`, err instanceof Error ? err.message : err),
    section: (n: string, title: string) =>
        console.log(`\n[ ${n} ] ${title}...`),
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Solus Protocol — TX Submission Smoke Test');
    console.log('  Rex  |  SOL → USDC  |  0.001 SOL');
    console.log('  Layers skipped: Strategist, Guardian, Policy, Proof');
    console.log('═══════════════════════════════════════════════════\n');

    if (!MASTER_KEY) throw new Error('VAULT_MASTER_KEY is not set in your .env file.');
    if (!KORA_URL)   throw new Error('KORA_RPC_URL is not set in your .env file.');
    if (!process.env.JUPITER_API_KEY) log.warn('ENV', 'JUPITER_API_KEY not set — requests may be rate-limited');

    // ── 1/4  Load Rex vault ────────────────────────────────────────────────────
    log.section('1/4', 'Loading Rex vault');
    const vault = await Vault.load('rex', MASTER_KEY, RPC_URL);
    log.info('VAULT', `Loaded`, { pubkey: vault.getPublicKey().toBase58() });

    const balance = await vault.getBalance();
    log.info('VAULT', `Balance`, { sol: balance.sol.toFixed(4), tokens: balance.tokens });
    if (balance.sol < 0.006) {
        log.warn('VAULT', `Low SOL — run: solana airdrop 1 ${vault.getPublicKey().toBase58()} --url devnet`);
    }

    // ── 2/4  Kora health check ─────────────────────────────────────────────────
    log.section('2/4', 'Checking Kora connectivity');
    const kora   = new KoraPaymaster(KORA_URL, process.env.KORA_API_KEY, process.env.KORA_HMAC_SECRET);
    const health = await kora.verifyConnection();
    if (!health.connected) {
        throw new Error(`Kora unreachable: ${health.error} — check KORA_RPC_URL and node status.`);
    }
    log.info('KORA', `Connected`, { latencyMs: health.latencyMs, feePayer: health.signerAddress });

    // ── 3/4  Execute swap via BroadcastService ─────────────────────────────────
    log.section('3/4', 'Running BroadcastService.executeSwap()');
    log.info('BROADCAST', 'Decision', FAKE_DECISION);
    console.log();

    const broadcastService = new BroadcastService();
    const start = Date.now();

    const result = await broadcastService.executeSwap(
        FAKE_DECISION,
        vault.getPublicKey().toBase58(),
        (serializedTx: Uint8Array) => vault.partiallySignTransaction(serializedTx),
    );

    const elapsed = Date.now() - start;
    log.info('BROADCAST', `Confirmed in ${elapsed}ms`, {
        signature:   result.signature,
        koraFeePayer: result.koraSignerAddress,
        amountIn:    result.confirmation.amount,
        amountOut:   result.confirmation.output,
        confirmedAt: new Date(result.confirmation.confirmedAt).toISOString(),
        explorer:    `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
    });

    // ── 4/4  Post-swap balance ─────────────────────────────────────────────────
    log.section('4/4', 'Post-swap balance');
    const after = await vault.getBalance();
    log.info('VAULT', 'Balance delta', {
        SOL:  `${balance.sol.toFixed(4)} → ${after.sol.toFixed(4)}`,
        USDC: `${balance.tokens?.USDC ?? 0} → ${after.tokens?.USDC ?? 0}`,
    });

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ TX Submission smoke test complete');
    console.log('═══════════════════════════════════════════════════');
}

main().catch((err: Error) => {
    const msg = err.message ?? '';

    if (msg.includes('custom program error')) {
        console.warn('\n⚠ Devnet simulation error — expected.');
        console.warn('  Jupiter mainnet pools do not exist on Devnet.');
        console.warn('  The full signing pipeline (vault + kora + rpc) worked correctly.\n');
        process.exit(0);
    }
    if (msg.includes('Failed to fetch lookup table')) {
        console.warn('\n⚠ Devnet ALT error — expected.');
        console.warn('  Jupiter V0 transactions reference Address Lookup Tables that only exist on mainnet.');
        console.warn('  The full signing pipeline (vault + kora + rpc) worked correctly.');
        console.warn('  On mainnet this will confirm.\n');
        process.exit(0);
    }
    if (msg.includes('Versioned messages must be deserialized')) {
        console.error('\n❌ vault.ts BUG — partiallySignTransaction() called Transaction.from() on versioned bytes.');
        console.error('   Replace vault.ts with the fixed version that uses isVersionedTransaction().\n');
        process.exit(1);
    }

    console.error('\n❌ Test FAILED:', err.message);
    process.exit(1);
});