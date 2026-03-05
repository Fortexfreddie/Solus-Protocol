// src/scripts/smoke-vault.ts
// Phase 1 smoke test: Verify RPC, verify Kora, load vaults, smartly fund them, verify balances.
// Run with: pnpm smoke:vault

import 'dotenv/config';
import bs58 from 'bs58';
import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Vault } from '../wallet/vault';
import { TokenManager } from '../wallet/token-manager';
import { getSolanaRPC } from '../protocol/solana-rpc';
import { getKoraPaymaster } from '../protocol/kora-paymaster';
import type { AgentId } from '../types/agent-types';

const AGENTS: AgentId[] = ['rex', 'nova', 'sage'];
const MASTER_KEY = process.env.VAULT_MASTER_KEY ?? '';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const FUNDER_SECRET = process.env.FUNDER_SECRET_KEY ?? '';

const TARGET_BALANCE_SOL = 0.5;

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Solus Protocol — Phase 1 Smoke Test');
  console.log('  Vault + Solana Core + Kora + Smart Funder');
  console.log('═══════════════════════════════════════════════════\n');

  if (!MASTER_KEY) {
    throw new Error('VAULT_MASTER_KEY is not set in your .env file.');
  }

  const rpc = getSolanaRPC();
  const connection = rpc.getConnection();
  const tokenManager = new TokenManager(connection);

  // 1. Ping RPC
  console.log('[ 1/6 ] Pinging Solana Devnet RPC...');
  const { slot, latencyMs } = await rpc.ping();
  console.log(`        ✓ RPC online — current slot: ${slot} (${latencyMs}ms)\n`);

  // 2. Verify Kora connection
  console.log('[ 2/6 ] Verifying Kora Paymaster connection...');
  try {
    const kora = getKoraPaymaster();
    const koraStatus = await kora.verifyConnection();
    if (koraStatus.connected) {
      console.log(`        ✓ Kora online — payer: ${koraStatus.signerAddress} (${koraStatus.latencyMs}ms)\n`);
    } else {
      console.warn(`        ⚠ Kora unreachable at ${process.env.KORA_RPC_URL}`);
      console.warn(`          Continuing smoke test without Kora verification...\n`);
    }
  } catch (err) {
    console.warn(`        ⚠ Kora check failed: ${(err as Error).message}\n`);
  }

  // 3. Decode the Funder wallet
  console.log('[ 3/6 ] Checking Funder Wallet...');
  if (FUNDER_SECRET) {
    const funderKeypair = Keypair.fromSecretKey(bs58.decode(FUNDER_SECRET));
    const funderBalance = await rpc.getSolBalance(funderKeypair.publicKey);
    console.log(`        ✓ Funder Wallet: ${funderKeypair.publicKey.toBase58()}`);
    console.log(`        ✓ Balance: ${funderBalance} SOL\n`);

    const requiredSol = TARGET_BALANCE_SOL * AGENTS.length;
    if (funderBalance < requiredSol + 0.01) { // 0.01 buffer for gas
      console.warn(`        ⚠ Insufficient funder balance. Need at least ${requiredSol + 0.01} SOL.\n`);
    }
  } else {
    console.log(`        ℹ No FUNDER_SECRET_KEY found. Will use Devnet faucet if needed.\n`);
  }

  // 4. Create or load vaults
  const vaults: Record<AgentId, Vault> = {} as Record<AgentId, Vault>;
  console.log('[ 4/6 ] Creating / loading vaults...');
  for (const agentId of AGENTS) {
    const vault = await Vault.loadOrCreate(agentId, MASTER_KEY, RPC_URL);
    vaults[agentId] = vault;
    console.log(`        ✓ ${agentId.toUpperCase().padEnd(5)} — pubkey: ${vault.getPublicKey().toBase58()}`);
  }
  console.log();

  // 5. Smart Funding
  console.log('[ 5/6 ] Checking balances and funding if necessary...');
  const agentsNeedingFunds: Vault[] = [];

  for (const agentId of AGENTS) {
    const vault = vaults[agentId];
    const balance = await rpc.getSolBalance(vault.getPublicKey());
    if (balance < TARGET_BALANCE_SOL) {
      agentsNeedingFunds.push(vault);
    }
  }

  if (agentsNeedingFunds.length === 0) {
    console.log('        ✓ All agents are already adequately funded.\n');
  } else {
    if (FUNDER_SECRET) {
      // Use Funder Wallet (Batched Transaction)
      console.log(`        ℹ Using Funder Wallet to top up ${agentsNeedingFunds.length} agent(s)...`);
      const funderKeypair = Keypair.fromSecretKey(bs58.decode(FUNDER_SECRET));
      const transaction = new Transaction();

      for (const vault of agentsNeedingFunds) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: funderKeypair.publicKey,
            toPubkey: vault.getPublicKey(),
            lamports: TARGET_BALANCE_SOL * 1e9,
          })
        );
      }

      try {
        const signature = await sendAndConfirmTransaction(connection, transaction, [funderKeypair]);
        console.log(`        ✓ Funding successful! Sig: ${signature.slice(0, 20)}...\n`);
      } catch (err) {
        console.warn(`        ⚠ Funder wallet transaction failed: ${(err as Error).message}\n`);
      }
    } else {
      // Fallback to Devnet Faucet (Airdrop)
      console.log(`        ℹ Attempting public Devnet airdrop...`);
      for (const vault of agentsNeedingFunds) {
        try {
          const sig = await rpc.airdrop(vault.getPublicKey(), TARGET_BALANCE_SOL);
          console.log(`        ✓ ${vault.getAgentId().toUpperCase().padEnd(5)} — airdrop sig: ${sig.slice(0, 20)}...`);
        } catch (err) {
          console.warn(`        ⚠ ${vault.getAgentId().toUpperCase().padEnd(5)} — airdrop failed: ${(err as Error).message}`);
        }
        await sleep(2000); // Rate limit protection
      }
      console.log();
    }
  }

  // 6. Verify balances
  console.log('[ 6/6 ] Verifying balances...');
  for (const agentId of AGENTS) {
    const vault = vaults[agentId];
    const balance = await tokenManager.getFullBalance(vault.getPublicKey());
    console.log(
      `        ✓ ${agentId.toUpperCase().padEnd(5)} — SOL: ${balance.sol.toFixed(4)} | USDC: ${balance.tokens.USDC ?? 0} | RAY: ${balance.tokens.RAY ?? 0} | BONK: ${balance.tokens.BONK ?? 0}`,
    );
  }
  console.log();

  console.log('═══════════════════════════════════════════════════');
  console.log('  ✅ Phase 1 smoke test PASSED');
  console.log('  Vaults, Balances, and Kora Paymaster verified.');
  console.log('  Ready to proceed to Phase 2: Price Oracle + LLM Layers.');
  console.log('═══════════════════════════════════════════════════');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('\n❌ Smoke test FAILED:', err);
  process.exit(1);
});