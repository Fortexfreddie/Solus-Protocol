// src/scripts/smoke-balance.ts
// Test script to verify the Vault.getBalance() implementation fetches both SOL and SPL tokens.
// Run with: pnpm smoke:balance

import 'dotenv/config';
import { Vault } from '../wallet/vault';
import type { AgentId } from '../types/agent-types';

const AGENTS: AgentId[] = ['rex', 'nova', 'sage'];
const MASTER_KEY = process.env.VAULT_MASTER_KEY ?? '';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Solus Protocol — Vault Balance Test');
    console.log('  Verifying vault.getBalance() fetches SOL + SPL');
    console.log('═══════════════════════════════════════════════════\n');

    if (!MASTER_KEY) {
        throw new Error('VAULT_MASTER_KEY is not set in your .env file.');
    }

    const vaults: Record<AgentId, Vault> = {} as Record<AgentId, Vault>;

    console.log('[ 1/2 ] Loading vaults...');
    for (const agentId of AGENTS) {
        const vault = await Vault.loadOrCreate(agentId, MASTER_KEY, RPC_URL);
        vaults[agentId] = vault;
        console.log(`        ✓ ${agentId.toUpperCase().padEnd(5)} — pubkey: ${vault.getPublicKey().toBase58()}`);
    }
    console.log();

    console.log('[ 2/2 ] Testing vault.getBalance()...');
    for (const agentId of AGENTS) {
        const vault = vaults[agentId];
        try {
            const start = Date.now();
            const balance = await vault.getBalance();
            const latency = Date.now() - start;
            console.log(`        ✓ ${agentId.toUpperCase().padEnd(5)} (${latency}ms)`);
            console.log(`            SOL:  ${balance.sol.toFixed(4)}`);

            const usdc = balance.tokens?.USDC ?? 0;
            const ray = balance.tokens?.RAY ?? 0;
            const bonk = balance.tokens?.BONK ?? 0;

            console.log(`            SPL:  USDC: ${usdc} | RAY: ${ray} | BONK: ${bonk}`);
        } catch (err) {
            console.error(`        ❌ ${agentId.toUpperCase().padEnd(5)} — Error fetching balance: ${(err as Error).message}`);
        }
    }
    console.log();

    console.log('═══════════════════════════════════════════════════');
    console.log('  ✅ Vault Balance test complete');
    console.log('═══════════════════════════════════════════════════');
}

main().catch((err) => {
    console.error('\n❌ Test FAILED:', err);
    process.exit(1);
});
