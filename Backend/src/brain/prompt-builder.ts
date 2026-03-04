/**
 * prompt-builder.ts
 * Constructs all LLM prompts dynamically from agent state at call time.
 *
 * SKILLS.md is read from disk on every Strategist and Guardian call — it is never
 * cached. This means the agent's operational constitution can be updated without
 * restarting the server, and every cycle reflects the current file on disk.
 *
 * Produces two prompt pairs:
 *   - Strategist (Layer 2): system = SKILLS.md + personality; user = market + balance
 *   - Guardian  (Layer 3): system = adversarial audit mandate; user = decision + context
 */

import fs from 'node:fs';
import path from 'node:path';

import type {
  PriceData,
  AgentBalance,
  TxRecord,
  PersonalityProfile,
  StrategistDecision,
  AgentId,
} from '../types/agent-types';

// Shared SKILLS.md loading

const SKILLS_PATH =
  process.env.SKILLS_MD_PATH ?? path.resolve(process.cwd(), 'SKILLS.md');

/**
 * Reads SKILLS.md fresh from disk on every call (no caching — per spec).
 * Throws with a clear message if the file is absent, so the missing file is
 * caught immediately rather than producing an empty or broken system prompt.
 */
function loadSkillsMd(): string {
  if (!fs.existsSync(SKILLS_PATH)) {
    throw new Error(
      `[PromptBuilder] SKILLS.md not found at "${SKILLS_PATH}".\n` +
      `Set SKILLS_MD_PATH in your .env file or place SKILLS.md in the project root.`,
    );
  }
  return fs.readFileSync(SKILLS_PATH, 'utf-8');
}

// Formatting helpers 

function formatBalance(balance: AgentBalance): string {
  const t = balance.tokens;
  const parts: string[] = [`${balance.sol.toFixed(4)} SOL`];
  if (t.USDC !== undefined) parts.push(`${t.USDC.toFixed(2)} USDC`);
  if (t.RAY !== undefined) parts.push(`${t.RAY.toFixed(4)} RAY`);
  if (t.BONK !== undefined) parts.push(`${t.BONK.toFixed(0)} BONK`);
  return parts.join(' / ');
}

function formatTxHistory(history: TxRecord[]): string {
  if (history.length === 0) return 'No transactions recorded this session.';
  return history
    .slice(-5)
    .map(
      (tx, i) =>
        `${i + 1}. [Cycle ${tx.cycle}] ${tx.fromToken} → ${tx.toToken} | ` +
        `In: ${tx.amountIn} | Out: ${tx.amountOut} | Sig: ${tx.signature.slice(0, 12)}...`,
    )
    .join('\n');
}

function formatPrices(data: PriceData): string {
  const staleWarning = data.stale ? '\n  WARNING: Price data is STALE (API delay).' : '';
  return (
    Object.entries(data.prices)
      .map(
        ([symbol, price]) =>
          `  ${symbol.padEnd(5)}: $${price.usd.toFixed(8).replace(/\.?0+$/, '')} ` +
          `(24h: ${price.change24h >= 0 ? '+' : ''}${price.change24h}%)`,
      )
      .join('\n') + staleWarning
  );
}

function formatSpreads(data: PriceData): string {
  return Object.entries(data.spreads)
    .map(([pair, spread]) =>
      `  ${pair.padEnd(12)}: ${spread.spreadPct.toFixed(3)}% momentum divergence | direction: ${spread.direction}`,
    )
    .join('\n');
}

function formatExecutionQuote(data: PriceData): string {
  const q = data.executionQuote;
  if (!q) return '';
  if (q.error) {
    return `\n=== JUPITER EXECUTION QUOTE ===\nUnavailable (${q.error}) — use CoinGecko momentum divergence as fallback only.`;
  }
  return `\n=== JUPITER EXECUTION QUOTE (${q.fromToken} → ${q.toToken}) ===
  THIS IS THE ONLY REAL SPREAD — use this, not momentum divergence above.
  Jupiter net spread:        ${(q.netSpreadVsMarket * 100).toFixed(4)}%
  Execution rate:            $${q.impliedPrice.toFixed(4)}
  Price impact:              ${q.priceImpactPct.toFixed(3)}%
  Worth trading (net > 0):   ${q.worthTrading ? 'YES' : 'NO'}

DECISION RULE: If Jupiter net spread < your threshold → HOLD. If negative → HOLD immediately.`;
}

// PromptBuilder 
export class PromptBuilder {

  // Strategist prompts 

  /**
   * Builds the Strategist system prompt.
   * Structure: SKILLS.md content (read fresh from disk) + agent personality directive.
   * The personality directive carries the hard numeric limits the Policy Engine enforces,
   * so the LLM is informed of the constraints it is operating within.
   */
  buildStrategistSystemPrompt(profile: PersonalityProfile): string {
    const skillsMd = loadSkillsMd();

    const personalityAppendix = `

---

## Agent Identity Override

${profile.llmDirective}

### CRITICAL ARBITRAGE RULE:
If the spread analysis indicates a token is 'overpriced', you must SELL that token (set it as fromToken) and BUY the underpriced token (set it as toToken). NEVER buy the overpriced asset.

### Profile Limits (enforced by Policy Engine — cannot be bypassed by LLM output):
- Spread threshold required to act: >= ${profile.spreadThresholdPct}%
- Minimum confidence to proceed: ${profile.minConfidence}
- Maximum single transaction: ${profile.maxTxAmountSol} SOL
- Daily volume cap: ${profile.dailyVolumeCapSol} SOL
- Stop-loss trigger: ${profile.stopLossTriggerPct}% drawdown from session high

Note: Your decision will be adversarially reviewed by Google Gemini (Guardian AI) before
any execution proceeds. Unjustified confidence or thin reasoning will be vetoed.
`;

    return skillsMd + personalityAppendix;
  }

  /**
   * Builds the Strategist user message.
   * Contains live market data, current balance, and recent transaction history.
   * All inputs are formatted as plain text — no JSON injection into the user turn.
   */
  buildStrategistUserPrompt(
    priceData: PriceData,
    balance: AgentBalance,
    txHistory: TxRecord[],
    agentId: AgentId,
    cycle: number,
  ): string {
    const staleWarning = priceData.stale
      ? '\nWARNING: Price data is STALE. Consider SKIP if data quality is insufficient.\n'
      : '';

    return `CYCLE ${cycle} — AGENT: ${agentId.toUpperCase()}
Timestamp: ${new Date(priceData.timestamp).toISOString()}
${staleWarning}
=== CURRENT TOKEN PRICES ===
${formatPrices(priceData)}

=== SPREAD ANALYSIS ===
${formatSpreads(priceData)}
${formatExecutionQuote(priceData)}

=== YOUR CURRENT BALANCE ===
${formatBalance(balance)}

=== LAST 5 TRANSACTIONS ===
${formatTxHistory(txHistory)}

Respond ONLY in valid JSON matching the required schema. No other text or explanation.`;
  }

  // Guardian prompts 
  /**
   * Builds the Guardian system prompt.
   * The Guardian (Google Gemini) is explicitly framed as an adversarial auditor.
   * It receives no instruction to be helpful or balanced — its mandate is to challenge.
   */
  buildGuardianSystemPrompt(profile: PersonalityProfile): string {
    return `You are the Guardian AI for agent ${profile.name.toUpperCase()}, powered by Google Gemini.

Your SOLE mandate is adversarial risk auditing. You receive a trading decision from the Strategist AI (DeepSeek) and your job is to rigorously challenge it from a different perspective.

The use of two different AI providers is intentional: you and the Strategist may have different biases, knowledge, and failure modes. Your independent judgment is what makes this pipeline trustworthy.

Your auditing criteria:
- Is the spread signal strong enough to justify acting? Is the data fresh?
- Is the confidence score appropriate given the market context provided?
- Is the position size reasonable relative to the agent's balance?
- Does the reasoning match the data? Are there unsupported claims?
- Could this decision cause meaningful capital loss if the spread reverts?

Verdicts:
- APPROVE: The decision is sound, well-reasoned, and the risk is appropriate.
- VETO: The decision is flawed, overconfident, or the risk is unjustified. Stop here.
- MODIFY: The direction is correct but the position size should be reduced. Set modifiedAmount to your recommended amount.

Agent profile you are guarding:
- Name: ${profile.name} | Risk level: ${profile.riskProfile}
- Required spread to act: >= ${profile.spreadThresholdPct}%
- Minimum confidence: ${profile.minConfidence}
- Maximum transaction size: ${profile.maxTxAmountSol} SOL
- Stop-loss threshold: ${profile.stopLossTriggerPct}%

Keep your "challenge" field concise — maximum 3 sentences. 
Your verdict and key reasoning only. No verbose explanation.

Respond ONLY in valid JSON. No text outside the JSON object:
{
  "verdict": "APPROVE" | "VETO" | "MODIFY",
  "challenge": "<your full reasoning — what you found, why you approved, vetoed, or modified>",
  "modifiedAmount": <positive number if MODIFY, null otherwise>
}`;
  }

  /**
   * Builds the Guardian user message.
   * Contains the Strategist's complete decision object + full market context
   * so the Guardian can verify the reasoning against the actual data.
   */
  buildGuardianUserPrompt(
    decision: StrategistDecision,
    priceData: PriceData,
    balance: AgentBalance,
    cycle: number,
  ): string {
    return `CYCLE ${cycle} — STRATEGIST DECISION AWAITING YOUR AUDIT:

${JSON.stringify(decision, null, 2)}

=== MARKET CONTEXT (verify the Strategist's reasoning against this data) ===

Token prices:
${formatPrices(priceData)}

Spreads:
${formatSpreads(priceData)}
${formatExecutionQuote(priceData)}

Agent balance: ${formatBalance(balance)}
${priceData.stale ? '\nWARNING: The price data used for this decision is STALE.' : ''}

Audit this decision rigorously. Respond ONLY in valid JSON.`;
  }
}

// Singleton 

export const promptBuilder = new PromptBuilder();