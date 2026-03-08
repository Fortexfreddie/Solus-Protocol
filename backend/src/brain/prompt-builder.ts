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

// ─── SKILLS.md loader ─────────────────────────────────────────────────────────

const SKILLS_PATH =
  process.env.SKILLS_MD_PATH ?? path.resolve(process.cwd(), 'SKILLS.md');

/**
 * Reads SKILLS.md fresh from disk on every call (no caching — per spec).
 * Throws with a clear message if the file is absent so the missing file is
 * caught immediately rather than producing a broken system prompt.
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

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatBalance(balance: AgentBalance): string {
  const t = balance.tokens;
  const parts = [`${balance.sol.toFixed(4)} SOL`];
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
    return (
      `\n=== JUPITER EXECUTION QUOTE ===\n` +
      `Unavailable (${q.error}) — use CoinGecko momentum divergence as fallback only.`
    );
  }
  return (
    `\n=== JUPITER EXECUTION QUOTE (${q.fromToken} → ${q.toToken}) ===\n` +
    `  THIS IS THE ONLY REAL SPREAD — use this, not momentum divergence above.\n` +
    `  Jupiter net spread:        ${(q.netSpreadVsMarket * 100).toFixed(4)}%\n` +
    `  Execution rate:            $${q.impliedPrice.toFixed(4)}\n` +
    `  Price impact:              ${q.priceImpactPct.toFixed(3)}%\n` +
    `  Worth trading (net > 0):   ${q.worthTrading ? 'YES' : 'NO'}\n\n` +
    `DECISION RULE: If Jupiter net spread < your threshold → HOLD. If negative → HOLD immediately.`
  );
}

// ─── PromptBuilder ─────────────────────────────────────────────────────────────

export class PromptBuilder {

  // ── Strategist prompts ────────────────────────────────────────────────────

  /**
   * Builds the Strategist system prompt.
   * Structure: SKILLS.md content (read fresh from disk) + agent personality directive.
   * The personality directive carries the hard numeric limits the Policy Engine enforces.
   */
  buildStrategistSystemPrompt(profile: PersonalityProfile): string {
    const skillsMd = loadSkillsMd();

    const personalityAppendix = `

---

## Agent Identity Override

${profile.llmDirective}

### CRITICAL ARBITRAGE RULE:
If the spread analysis indicates a token is 'overpriced', you must SELL that token (set it as fromToken)
and BUY the underpriced token (set it as toToken). NEVER buy the overpriced asset.

### Profile Limits (enforced by Policy Engine — cannot be bypassed by LLM output):
- Spread threshold required to act: >= ${profile.spreadThresholdPct}%
- Minimum confidence to proceed:    ${profile.minConfidence}
- Maximum single transaction:       ${profile.maxTxAmountSol} SOL
- Daily volume cap:                 ${profile.dailyVolumeCapSol} SOL
- Stop-loss trigger:                ${profile.stopLossTriggerPct}% drawdown from session high

Note: Your decision will be adversarially reviewed by Google Gemini (Guardian AI) before
any execution proceeds. Unjustified confidence or thin reasoning will be vetoed.
`;

    return skillsMd + personalityAppendix;
  }

  /**
   * Builds the Strategist user message.
   * Contains live market data, current balance, and recent transaction history.
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

    return (
      `CYCLE ${cycle} — AGENT: ${agentId.toUpperCase()}\n` +
      `Timestamp: ${new Date(priceData.timestamp).toISOString()}\n` +
      `${staleWarning}\n` +
      `=== CURRENT TOKEN PRICES ===\n` +
      `${formatPrices(priceData)}\n\n` +
      `=== SPREAD ANALYSIS ===\n` +
      `${formatSpreads(priceData)}\n` +
      `${formatExecutionQuote(priceData)}\n\n` +
      `=== YOUR CURRENT BALANCE ===\n` +
      `${formatBalance(balance)}\n\n` +
      `=== LAST 5 TRANSACTIONS ===\n` +
      `${formatTxHistory(txHistory)}\n\n` +
      `Respond ONLY in valid JSON matching the required schema. No other text or explanation.`
    );
  }

  // ── Guardian prompts ──────────────────────────────────────────────────────

  /**
   * Builds the Guardian system prompt for Google Gemini (gemini-2.5-flash).
   *
   * Gemini-specific authoring notes:
   * ──────────────────────────────────
   * gemini-2.5-flash is a THINKING model. It performs internal chain-of-thought
   * reasoning before producing visible output. This is beneficial for audit quality,
   * but it means the model may be tempted to narrate its thinking in the visible
   * output as well. The prompt must be extremely explicit that ONLY the JSON object
   * should appear in the final response — no preamble, no explanation, no fences.
   *
   * The JSON output requirement is stated THREE times (system intro, verdict section,
   * and closing instruction) to overcome the model's tendency to add prose context
   * around structured outputs.
   */
  buildGuardianSystemPrompt(profile: PersonalityProfile): string {
    return (
      `You are the Guardian AI for trading agent ${profile.name.toUpperCase()}, powered by Google Gemini.\n` +
      `\n` +
      `CRITICAL OUTPUT REQUIREMENT — READ THIS FIRST:\n` +
      `Your ENTIRE response must be a single valid JSON object.\n` +
      `Do NOT include any text before the opening brace {.\n` +
      `Do NOT include any text after the closing brace }.\n` +
      `Do NOT wrap the JSON in markdown code fences (\`\`\`).\n` +
      `Do NOT include any explanation, preamble, or commentary outside the JSON.\n` +
      `The response must start with { and end with }. Nothing else.\n` +
      `\n` +
      `─────────────────────────────────────────────────\n` +
      `\n` +
      `YOUR MANDATE: Adversarial risk auditing.\n` +
      `\n` +
      `You receive a trading decision from the Strategist AI (DeepSeek) and must\n` +
      `rigorously challenge it from an independent perspective. Two different AI\n` +
      `providers are used intentionally — you and the Strategist have different\n` +
      `biases and failure modes. Your independent judgment is what makes this\n` +
      `pipeline trustworthy.\n` +
      `\n` +
      `AUDITING CRITERIA:\n` +
      `- Is the spread signal strong enough to justify acting? Is the data fresh?\n` +
      `- Is the confidence score appropriate given the market context?\n` +
      `- Is the position size reasonable relative to the agent's balance?\n` +
      `- Does the reasoning match the provided data? Are there unsupported claims?\n` +
      `- Could this decision cause meaningful capital loss if the spread reverts?\n` +
      `\n` +
      `VERDICT OPTIONS:\n` +
      `- APPROVE  : Decision is sound, well-reasoned, and risk is appropriate.\n` +
      `- VETO     : Decision is flawed, overconfident, or risk is unjustified. Block it.\n` +
      `- MODIFY   : Direction is correct but position size must be reduced.\n` +
      `             You MUST set modifiedAmount to your recommended SOL amount.\n` +
      `             modifiedAmount MUST be less than the original amount.\n` +
      `             modifiedAmount MUST be a positive number (not null, not zero).\n` +
      `\n` +
      `AGENT PROFILE YOU ARE GUARDING:\n` +
      `  Name:               ${profile.name}\n` +
      `  Risk level:         ${profile.riskProfile}\n` +
      `  Required spread:    >= ${profile.spreadThresholdPct}%\n` +
      `  Min confidence:     ${profile.minConfidence}\n` +
      `  Max tx size:        ${profile.maxTxAmountSol} SOL\n` +
      `  Stop-loss:          ${profile.stopLossTriggerPct}%\n` +
      `\n` +
      `REQUIRED OUTPUT SCHEMA — your response must exactly match this structure:\n` +
      `{\n` +
      `  "verdict": "APPROVE" | "VETO" | "MODIFY",\n` +
      `  "challenge": "<your reasoning in 1-3 sentences — what you found and why>",\n` +
      `  "modifiedAmount": <positive number if MODIFY, null if APPROVE or VETO>\n` +
      `}\n` +
      `\n` +
      `FINAL REMINDER: Output ONLY the JSON object above. No other characters.`
    );
  }

  /**
   * Builds the Guardian user message.
   * Contains the Strategist's complete decision + full market context so the
   * Guardian can verify the reasoning against the actual data.
   */
  buildGuardianUserPrompt(
    decision: StrategistDecision,
    priceData: PriceData,
    balance: AgentBalance,
    cycle: number,
  ): string {
    return (
      `CYCLE ${cycle} — STRATEGIST DECISION AWAITING YOUR AUDIT:\n\n` +
      `${JSON.stringify(decision, null, 2)}\n\n` +
      `=== MARKET CONTEXT (verify the Strategist's reasoning against this data) ===\n\n` +
      `Token prices:\n` +
      `${formatPrices(priceData)}\n\n` +
      `Spreads:\n` +
      `${formatSpreads(priceData)}\n` +
      `${formatExecutionQuote(priceData)}\n\n` +
      `Agent balance: ${formatBalance(balance)}\n` +
      `${priceData.stale ? '\nWARNING: The price data used for this decision is STALE.' : ''}\n\n` +
      `Audit this decision rigorously.\n` +
      `Respond with ONLY a valid JSON object. No text before { or after }.`
    );
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const promptBuilder = new PromptBuilder();