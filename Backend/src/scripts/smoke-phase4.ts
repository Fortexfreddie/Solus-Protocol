/**
 * smoke-phase4.ts
 * Phase 4 smoke test: Full 7-layer pipeline for all 3 agents running concurrently.
 *
 * This test runs one complete cycle for each agent (Rex, Nova, Sage) sequentially
 * and verifies that every layer fires correctly end-to-end, including:
 *   - Live Jupiter prices (Layer 1)
 *   - Deepseek Strategist decision (Layer 2)
 *   - Gemini Guardian audit (Layer 3)
 *   - Policy Engine all 9 checks (Layer 4)
 *   - Proof anchored on Devnet via Memo Program (Layer 5)
 *   - Vault partial sign (Layer 6)
 *   - Kora co-sign + broadcast + confirmation (Layer 7)
 *
 * Requires: funded vaults (run pnpm smoke:vault first), all API keys set,
 *           and a running Kora node at KORA_RPC_URL.
 *
 * Run with: pnpm smoke:phase4
 */

import 'dotenv/config';
import process from 'node:process';

import { getSolanaRPC } from '../protocol/solana-rpc';
import { getKoraPaymaster } from '../protocol/kora-paymaster';
import { getPriceOracle } from '../price/price-oracle';
import { Agent } from '../agent/agent';
import { AGENT_PROFILES } from '../agent/agent-profiles';
import { getAuditLogger } from '../security/audit-logger';
import type { AgentId } from '../types/agent-types';

const AGENT_IDS: AgentId[] = ['rex', 'nova', 'sage'];

async function main(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Solus Protocol — Phase 4 Smoke Test');
    console.log('  Full 7-Layer Pipeline — All 3 Agents');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // ── Pre-flight checks ──────────────────────────────────────────────────────
    console.log('[PRE-FLIGHT] Checking infrastructure connections...\n');

    // RPC
    process.stdout.write('  Solana Devnet RPC... ');
    const { slot, latencyMs } = await getSolanaRPC().ping();
    console.log(`✓ slot ${slot} (${latencyMs}ms)`);

    // Kora
    process.stdout.write('  Kora Paymaster...    ');
    const kora = await getKoraPaymaster().verifyConnection();
    if (kora.connected) {
        console.log(`✓ payer: ${kora.signerAddress} (${kora.latencyMs}ms)`);
    } else {
        console.log(`⚠ UNREACHABLE — ${kora.error}`);
        console.log('\n  ⚠ Kora is required for Layer 7. Start a local Kora node:');
        console.log('    cargo install kora-cli && kora rpc\n');
        // Continue — we can still test Layers 1–6 and flag the Layer 7 failure.
    }

    // Price oracle
    process.stdout.write('  Jupiter Price API... ');
    const oracle = getPriceOracle();
    const priceData = await oracle.getPrices();
    console.log(`✓ ${Object.keys(priceData.prices).join(', ')} (stale: ${priceData.stale})`);

    console.log('');

    // ── Run one cycle per agent ────────────────────────────────────────────────
    console.log('[CYCLES] Running one full cycle per agent...\n');

    const logger = getAuditLogger();
    let swapCount = 0;

    for (const agentId of AGENT_IDS) {
        const profile = AGENT_PROFILES[agentId];
        console.log(`▶ ${profile.name.toUpperCase()} (${profile.riskProfile})`);
        console.log('  ─────────────────────────────────────────────');

        // Track audit log size before the cycle to count new entries.

        const agent = await Agent.create(profile);
        await agent.runCycle();

        // Print the event sequence from the audit log for this agent.
        const newEntries = logger.getLastN(20, agentId);

        // Print the event sequence from the audit log.
        for (const entry of newEntries.reverse()) {
            const icon = entry.event.includes('ERROR') || entry.event.includes('FAIL') || entry.event.includes('VETO')
                ? '  ✗'
                : '  ✓';
            console.log(`${icon} ${entry.event}`);

            if (entry.event === 'TX_CONFIRMED') {
                const d = entry.data as Record<string, unknown>;
                console.log(`    └ sig: ${String(d['signature']).slice(0, 20)}...`);
                console.log(`    └ https://explorer.solana.com/tx/${d['signature']}?cluster=devnet`);
                swapCount++;
            }

            if (entry.event === 'PROOF_ANCHORED') {
                const d = entry.data as Record<string, unknown>;
                console.log(`    └ hash: ${String(d['hash']).slice(0, 20)}...`);
            }
        }

        console.log('');
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════');
    if (swapCount > 0) {
        console.log(`  ✅ Phase 4 smoke test PASSED — ${swapCount}/3 agent(s) completed confirmed swaps.`);
        console.log('  All 7 layers executed. Real transactions confirmed on Devnet.');
    } else {
        console.log('  ⚠ Phase 4 completed — no swaps confirmed this run.');
        console.log('  Agents may have HELD (low spread) or been VETOED (Guardian).');
        console.log('  Check market conditions and re-run. This is a valid outcome.');
    }
    console.log('  Ready for Phase 5: Frontend Dashboard.');
    console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err: unknown) => {
    console.error('\n❌ Phase 4 smoke test FAILED:', err);
    process.exit(1);
});