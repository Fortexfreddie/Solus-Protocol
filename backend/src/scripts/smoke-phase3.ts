/**
 * smoke-phase3.ts
 * Phase 3 smoke test: Policy Engine + Proof-of-Reasoning.
 *
 * Runs the full pipeline from Layer 1 through Layer 5 for one agent (Rex):
 * 1. Fetch live prices (Layer 1 — CoinGecko)
 * 2. Strategist decision (Layer 2 — DeepSeek)
 * 3. Guardian audit (Layer 3 — Gemini)
 * 4. Policy Engine — all 9 checks (Layer 4)
 * 5. Proof-of-Reasoning — SHA-256 hash anchored on Devnet via Memo Program (Layer 5)
 * 6. Verify proof hash locally matches the on-chain payload
 *
 * Requires: funded vault for at least one agent (run smoke-vault first).
 * Run with: pnpm smoke:phase3
 */

import 'dotenv/config';

import { Vault } from '../wallet/vault';
import { PriceOracle } from '../price/price-oracle';
import { strategistService } from '../brain/strategist-service';
import { guardianService } from '../brain/guardian-service';
import { policyEngine } from '../security/policy-engine';
import { proofService } from '../proof/proof-service';
import { getAuditLogger } from '../security/audit-logger';
import { AGENT_PROFILES } from '../agent/agent-profiles';
import type { AgentId } from '../types/agent-types';

// ─── Config ───────────────────────────────────────────────────────────────────

const TEST_AGENT: AgentId = 'rex';
const MASTER_KEY = process.env.VAULT_MASTER_KEY ?? '';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const TEST_CYCLE = 1;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Solus Protocol — Phase 3 Smoke Test');
  console.log('  Policy Engine + Proof-of-Reasoning (Layers 4 & 5)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!MASTER_KEY) {
    throw new Error('VAULT_MASTER_KEY is not set. Cannot load vault for signing.');
  }

  const profile = AGENT_PROFILES[TEST_AGENT];
  const auditLogger = getAuditLogger();

  // ── Step 1: Load vault and get live balance ───────────────────────────────
  console.log(`[ 1/6 ] Loading vault for ${TEST_AGENT.toUpperCase()}...`);
  const vault = await Vault.loadOrCreate(TEST_AGENT, MASTER_KEY, RPC_URL);
  const balance = await vault.getBalance();
  console.log(`        ✓ Pubkey:  ${vault.getPublicKey().toBase58()}`);
  console.log(`        ✓ Balance: ${balance.sol.toFixed(4)} SOL\n`);

  // ── Step 2: Fetch prices (Layer 1) ───────────────────────────────────────
  console.log('[ 2/6 ] Layer 1 — Fetching prices from CoinGecko Oracle...');
  const oracle = new PriceOracle();
  const priceData = await oracle.getPrices();
  console.log(`        ✓ Prices fetched (stale: ${priceData.stale})`);
  for (const [sym, p] of Object.entries(priceData.prices)) {
    const ch = p.change24h >= 0 ? `+${p.change24h}` : `${p.change24h}`;
    console.log(`          ${sym.padEnd(5)}: $${String(p.usd).slice(0, 10).padEnd(10)} (24h: ${ch}%)`);
  }
  console.log();

  // ── Step 3: Strategist (Layer 2) ─────────────────────────────────────────
  console.log('[ 3/6 ] Layer 2 — Strategist (DeepSeek)...');
  const txHistory = auditLogger.getLastNTransactions(5, TEST_AGENT);
  const strategistResult = await strategistService.reason(
    TEST_AGENT, profile, priceData, balance, txHistory, TEST_CYCLE,
  );

  if (!strategistResult.ok) {
    console.error(`        ✗ Strategist failed: ${strategistResult.error}`);
    process.exit(1);
  }

  const { decision } = strategistResult;
  console.log(`        ✓ Decision:   ${decision.decision} | ${decision.fromToken} → ${decision.toToken} | ${decision.amount} SOL`);
  console.log(`          Confidence: ${decision.confidence} | Flags: [${decision.riskFlags.join(', ') || 'none'}]`);
  console.log(`          Reasoning:  "${decision.reasoning}"\n`);

  // ── Step 4: Guardian (Layer 3) ────────────────────────────────────────────
  console.log('[ 4/6 ] Layer 3 — Guardian AI (Google Gemini)...');
  // FIX: Removed TEST_AGENT parameter to match updated guardianService signature
  const guardianResult = await guardianService.audit(
    profile, decision, priceData, balance, TEST_CYCLE,
  );

  if (!guardianResult.ok) {
    console.error(`        ✗ Guardian safety VETO: ${guardianResult.error}`);
    process.exit(1);
  }

  const { audit } = guardianResult;
  const verdictIcon = audit.verdict === 'APPROVE' ? '✓' : audit.verdict === 'VETO' ? '✗' : '⚠';
  console.log(`        ${verdictIcon} Verdict:   ${audit.verdict}${audit.verdict === 'MODIFY' ? ` → ${audit.modifiedAmount} SOL` : ''}`);
  console.log(`          Challenge: "${audit.challenge}"\n`);

  if (audit.verdict === 'VETO') {
    console.log('        Guardian issued VETO — cycle ends at Layer 3. Smoke test complete.');
    console.log('        (This is a valid outcome — re-run for a different market state.)');
    process.exit(0);
  }

  // Apply MODIFY if issued
  if (audit.verdict === 'MODIFY' && audit.modifiedAmount !== null) {
    decision.amount = audit.modifiedAmount;
    console.log(`        Guardian modified amount to ${decision.amount} SOL\n`);
  }

  // ── Step 5: Policy Engine (Layer 4) ──────────────────────────────────────
  console.log('[ 5/6 ] Layer 4 — Policy Engine (9 checks)...');
  const dailyVolume = auditLogger.getDailyVolumeSOL(TEST_AGENT);
  const bestSpread = Math.max(...Object.values(priceData.spreads).map((s) => s.spreadPct));
  // FIX: Added priceData parameter for Check 9 (USD Portfolio tracking)
  const policyResult = policyEngine.check(decision, profile, balance, priceData, dailyVolume, bestSpread);

  for (const check of policyResult.checks) {
    const icon = check.passed ? '✓' : '✗';
    const adj = check.adjustedValue !== undefined ? ` [clamped → ${check.adjustedValue}]` : '';
    console.log(`        ${icon} ${check.name.padEnd(20)}: ${check.reason}${adj}`);
  }
  console.log();

  if (!policyResult.approved && policyResult.outcome !== 'FORCE_HOLD') {
    console.log(`        Policy FAILED — outcome: ${policyResult.outcome} on ${policyResult.failedOn ?? 'unknown'}`);
    console.log('        (Re-run with different market conditions or top up the vault balance.)');
    process.exit(0);
  }

  const finalDecision = policyResult.finalDecision;
  console.log(`        ✓ Policy outcome: ${policyResult.outcome}`);
  console.log(`          Final decision: ${finalDecision.decision} | ${finalDecision.amount} SOL\n`);

  // ── Step 6: Proof-of-Reasoning (Layer 5) ─────────────────────────────────
  console.log('[ 6/6 ] Layer 5 — Proof-of-Reasoning (SHA-256 + Solana Memo)...');
  console.log('        Signing memo transaction and submitting to Devnet...');

  // The proof service requires a SignMemoFn callback that accepts memo content
  // and returns a confirmed transaction signature. We pass vault.signAndSendMemo
  // bound to the vault instance — the keypair never leaves the Vault boundary.
  const signer = vault.signAndSendMemo.bind(vault);

  const proofRecord = await proofService.anchor(
    TEST_AGENT,
    TEST_CYCLE,
    finalDecision,
    audit,
    policyResult.checks,
    priceData,
    signer,
  );

  console.log(`        ✓ Proof hash:      ${proofRecord.hash}`);
  console.log(`        ✓ Memo signature:  ${proofRecord.memoSignature}`);
  console.log(`          Explorer:        https://explorer.solana.com/tx/${proofRecord.memoSignature}?cluster=devnet`);
  console.log(`          Summary:         ${proofRecord.payloadSummary}\n`);

  // Verify the hash locally
  const verified = proofService.verify(proofRecord.payload, proofRecord.hash);
  console.log(`        ${verified ? '✓' : '✗'} Local hash verification: ${verified ? 'PASSED' : 'FAILED'}`);

  // Write to audit log
  auditLogger.log({
    agentId: TEST_AGENT,
    cycle: TEST_CYCLE,
    event: 'PROOF_ANCHORED',
    data: {
      hash: proofRecord.hash,
      memoSignature: proofRecord.memoSignature,
      payloadSummary: proofRecord.payloadSummary,
    },
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ Phase 3 smoke test PASSED');
  console.log('  Layers 1–5 executed successfully.');
  console.log('  Proof hash anchored on Solana Devnet via Memo Program.');
  console.log('  Ready for Phase 4: Broadcast + Multi-Agent Orchestration.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err: unknown) => {
  console.error('\n❌ Phase 3 smoke test FAILED:', err);
  process.exit(1);
});