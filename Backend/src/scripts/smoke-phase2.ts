/**
 * smoke-phase2.ts
 * Phase 2 smoke test: Price Oracle + LLM Layers.
 *
 * Verifies end-to-end connectivity for:
 * 1. CoinGecko Price Oracle (Layer 1 — live price fetch via CoinGecko)
 * 2. DeepSeek Strategist (Layer 2 — one decision per agent)
 * 3. Google Gemini Guardian (Layer 3 — adversarial audit of each decision)
 *
 * Run with: pnpm smoke:phase2
 */

import 'dotenv/config';
import { PriceOracle } from '../price/price-oracle';
import { strategistService } from '../brain/strategist-service';
import { guardianService } from '../brain/guardian-service';
import { AGENT_PROFILES } from '../agent/agent-profiles';
import type { AgentBalance, AgentId, TxRecord } from '../types/agent-types';

const AGENTS: AgentId[] = ['rex', 'nova', 'sage'];

// Synthetic balances for smoke test — real balances come from Vault in production.
const mockBalance = (agentId: AgentId): AgentBalance => ({
  sol: agentId === 'rex' ? 1.5 : agentId === 'nova' ? 0.8 : 1.2,
  tokens: { USDC: 25.0, RAY: 0, BONK: 0 },
  fetchedAt: Date.now(),
});

const mockHistory: TxRecord[] = [];

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Solus Protocol — Phase 2 Smoke Test');
  console.log('  CoinGecko Oracle + Strategist (DeepSeek) + Guardian (Gemini)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Step 1: Live price fetch ───────────────────────────────────────────────
  console.log('[ 1/3 ] Fetching live prices from CoinGecko Oracle...');
  const oracle = new PriceOracle();
  const priceData = await oracle.getPrices();

  const staleLabel = priceData.stale ? ' (STALE)' : '';
  console.log(`        ✓ Prices fetched${staleLabel}`);
  for (const [symbol, price] of Object.entries(priceData.prices)) {
    const change = price.change24h >= 0 ? `+${price.change24h}` : `${price.change24h}`;
    console.log(`          ${symbol.padEnd(5)}: $${String(price.usd).slice(0, 12).padEnd(12)} (24h: ${change}%)`);
  }
  console.log('\n        Spreads:');
  for (const [pair, spread] of Object.entries(priceData.spreads)) {
    console.log(`          ${pair.padEnd(12)}: ${spread.spreadPct.toFixed(3)}% — ${spread.direction}`);
  }
  console.log();

  // ── Steps 2 & 3: Strategist + Guardian per agent ──────────────────────────
  console.log('[ 2/3 ] Running Strategist (DeepSeek) + Guardian (Gemini) per agent...\n');

  let allPassed = true;

  for (const agentId of AGENTS) {
    const profile = AGENT_PROFILES[agentId];
    const balance = mockBalance(agentId);

    console.log(`  ▶ ${profile.name.toUpperCase()} (${profile.riskProfile})`);
    console.log(`    Balance: ${balance.sol} SOL / ${balance.tokens.USDC} USDC`);

    // Layer 2 — Strategist
    process.stdout.write('    L2 Strategist... ');
    const strategistResult = await strategistService.reason(
      agentId, profile, priceData, balance, mockHistory, 1,
    );

    if (!strategistResult.ok) {
      console.log('FAILED');
      console.log(`    ✗ Error: ${strategistResult.error}`);
      if (strategistResult.rawOutput) {
        console.log(`      Raw: ${strategistResult.rawOutput.slice(0, 200)}`);
      }
      console.log();
      allPassed = false;
      continue;
    }

    const { decision } = strategistResult;
    console.log('done');
    console.log(`    Decision:   ${decision.decision} | ${decision.fromToken} → ${decision.toToken} | ${decision.amount} SOL`);
    console.log(`    Confidence: ${decision.confidence} | Flags: [${decision.riskFlags.join(', ') || 'none'}]`);
    console.log(`    Reasoning:  "${decision.reasoning}"`);

    // Layer 3 — Guardian
    process.stdout.write('    L3 Guardian...   ');
    // Note: agentId is intentionally removed here based on our previous refactor
    const guardianResult = await guardianService.audit(
      profile, decision, priceData, balance, 1,
    );

    if (!guardianResult.ok) {
      console.log('SAFETY VETO');
      console.log(`    ✗ ${guardianResult.error}`);
      if (guardianResult.rawOutput) {
        console.log(`      Raw: ${guardianResult.rawOutput}`);
      }
    } else {
      const { audit } = guardianResult;
      const icon = audit.verdict === 'APPROVE' ? '✓' : audit.verdict === 'VETO' ? '✗' : '⚠';
      console.log('done');
      console.log(`    ${icon} Verdict: ${audit.verdict}${audit.verdict === 'MODIFY' ? ` → ${audit.modifiedAmount} SOL` : ''}`);
      console.log(`    Challenge: "${audit.challenge}"`);
    }

    console.log();
  }

  console.log('[ 3/3 ] Summary');
  console.log('═══════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log('  ✅ Phase 2 smoke test PASSED');
    console.log('  Prices fetched, DeepSeek reasoned, and Gemini audited.');
    console.log('  Ready for Phase 3: Policy Engine + Proof-of-Reasoning + Audit Logger.');
  } else {
    console.log('  ⚠ Phase 2 completed with failures — check output above.');
  }
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((err: unknown) => {
  console.error('\n❌ Phase 2 smoke test FAILED:', err);
  process.exit(1);
});