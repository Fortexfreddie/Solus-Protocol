/**
 * prompt-builder.ts
 * Constructs all LLM prompts dynamically from agent state at call time.
 *
 * SKILLS.md is read from disk on every Strategist AND Guardian call — it is never
 * cached. This means the agent's operational constitution can be updated without
 * restarting the server, and every cycle reflects the current file on disk.
 *
 * The Guardian receives SKILLS.md as background context — not as its operating
 * instructions. This gives the Guardian the frame of reference to evaluate whether
 * the Strategist's decision is consistent with its stated mandate. The Guardian's
 * actual mandate (adversarial auditing) is defined in its own system prompt section,
 * clearly separated from the SKILLS.md context block.
 *
 * Produces two prompt pairs:
 *   - Strategist (Layer 2): system = SKILLS.md + personality; user = market + balance
 *   - Guardian  (Layer 3): system = SKILLS.md (as context) + adversarial mandate;
 *                          user = Strategist decision + Layer 1c corrected market data
 *
 * Layer 1c quote correction:
 *   If the Strategist selects a different pair than the Layer 1b pre-scan, agent.ts
 *   re-fetches a Jupiter quote for the exact decided pair and amount before calling
 *   the Guardian. The corrected priceData is passed into buildGuardianUserPrompt().
 *   The Guardian therefore always audits against the real execution cost of the actual
 *   proposed trade — not a proxy quote for a different pair.
 */

import fs   from 'node:fs';
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
    const t     = balance.tokens;
    const parts = [`${balance.sol.toFixed(4)} SOL`];
    if (t.USDC  !== undefined) parts.push(`${t.USDC.toFixed(2)} USDC`);
    if (t.RAY   !== undefined) parts.push(`${t.RAY.toFixed(4)} RAY`);
    if (t.BONK  !== undefined) parts.push(`${t.BONK.toFixed(0)} BONK`);
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
     * Contains live market data (including the Layer 1b pre-scan Jupiter execution
     * quote for the highest-momentum pair), current balance, and recent tx history.
     */
    buildStrategistUserPrompt(
        priceData: PriceData,
        balance:   AgentBalance,
        txHistory: TxRecord[],
        agentId:   AgentId,
        cycle:     number,
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
            `=== SPREAD ANALYSIS (momentum divergence — identifies WHICH pair to evaluate) ===\n` +
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
     * Structure:
     *   1. CRITICAL output requirement (JSON-only) — stated first so it is never
     *      buried after a large context block.
     *   2. SKILLS.md — loaded fresh from disk. Gives the Guardian the exact operator
     *      manual the Strategist followed, so it can evaluate whether the decision is
     *      consistent with the Strategist's mandate (4-step Decision Rule, spread
     *      direction logic, reasoning quality standards, risk flag criteria).
     *   3. Adversarial audit mandate — the Guardian's own operating instructions,
     *      clearly separated from the SKILLS.md context block.
     *
     * Gemini-specific authoring notes:
     *   gemini-2.5-flash is a THINKING model. It burns tokens on internal reasoning
     *   before producing visible output. The JSON output requirement is stated THREE
     *   TIMES (intro, verdict section, closing) to overcome the model's tendency to
     *   wrap structured output in prose despite clear instruction.
     */
    buildGuardianSystemPrompt(profile: PersonalityProfile): string {
        const skillsMd = loadSkillsMd();

        return (
            `CRITICAL OUTPUT REQUIREMENT — READ THIS FIRST:\n` +
            `Your ENTIRE response must be a single valid JSON object.\n` +
            `Do NOT include any text before the opening brace {.\n` +
            `Do NOT include any text after the closing brace }.\n` +
            `Do NOT wrap the JSON in markdown code fences (\`\`\`).\n` +
            `Do NOT include any explanation, preamble, or commentary outside the JSON.\n` +
            `The response must start with { and end with }. Nothing else.\n` +
            `\n` +
            `════════════════════════════════════════════════════════════════\n` +
            `STRATEGIST CONTEXT — THE OPERATOR MANUAL THE STRATEGIST FOLLOWED\n` +
            `════════════════════════════════════════════════════════════════\n` +
            `\n` +
            `The Strategist AI (DeepSeek) that produced the decision you are auditing\n` +
            `was given the following operator manual as its base system prompt.\n` +
            `Use it to evaluate whether the Strategist correctly followed its mandate —\n` +
            `particularly the 4-step Decision Rule, spread direction logic, and reasoning\n` +
            `quality standards. You are not bound by this manual; you are judging it.\n` +
            `\n` +
            skillsMd +
            `\n\n` +
            `════════════════════════════════════════════════════════════════\n` +
            `YOUR MANDATE — ADVERSARIAL RISK AUDITING\n` +
            `════════════════════════════════════════════════════════════════\n` +
            `\n` +
            `You are the Guardian AI for trading agent ${profile.name.toUpperCase()}, powered by Google Gemini.\n` +
            `Your SOLE job is to find flaws in the Strategist's decision before it executes.\n` +
            `Do not try to be agreeable. Do not approve unless you genuinely cannot find a flaw.\n` +
            `\n` +
            `Two different AI providers are used intentionally — you and the Strategist have\n` +
            `different training data, biases, and failure modes. Your independent judgment is\n` +
            `what makes this pipeline trustworthy.\n` +
            `\n` +
            `AUDITING CRITERIA — challenge the decision on any of these:\n` +
            `- Did the Strategist correctly follow the 4-step Decision Rule from the manual above?\n` +
            `- Does the Jupiter net spread actually exceed the agent's threshold? (${profile.spreadThresholdPct}%)\n` +
            `- Does the Strategist's cited spread match the actual Jupiter quote provided?\n` +
            `- Is the confidence score justified given the market data and signal strength?\n` +
            `- Is the trade direction correct? (overpriced token must be fromToken)\n` +
            `- Is the position size reasonable relative to the balance and profile limits?\n` +
            `- Is the reasoning specific and data-grounded, or vague and unsupported?\n` +
            `- Could this cause meaningful capital loss if the spread immediately reverts?\n` +
            `\n` +
            `VERDICT OPTIONS:\n` +
            `- APPROVE  : Decision is sound. Reasoning matches the data. Risk is appropriate.\n` +
            `- VETO     : Decision is flawed, reasoning is unsupported, or risk is unjustified.\n` +
            `- MODIFY   : Direction is correct but position size must be reduced.\n` +
            `             modifiedAmount MUST be a positive number strictly less than the original.\n` +
            `             modifiedAmount MUST NOT be null when verdict is MODIFY.\n` +
            `\n` +
            `AGENT PROFILE YOU ARE GUARDING:\n` +
            `  Name:               ${profile.name}\n` +
            `  Risk level:         ${profile.riskProfile}\n` +
            `  Required spread:    >= ${profile.spreadThresholdPct}%\n` +
            `  Min confidence:     ${profile.minConfidence}\n` +
            `  Max tx size:        ${profile.maxTxAmountSol} SOL\n` +
            `  Stop-loss:          ${profile.stopLossTriggerPct}%\n` +
            `\n` +
            `REQUIRED OUTPUT SCHEMA:\n` +
            `{\n` +
            `  "verdict": "APPROVE" | "VETO" | "MODIFY",\n` +
            `  "challenge": "<1-3 sentences — cite specific numbers from the data>",\n` +
            `  "modifiedAmount": <positive number if MODIFY, null if APPROVE or VETO>\n` +
            `}\n` +
            `\n` +
            `FINAL REMINDER: Output ONLY the JSON object above. No other characters.`
        );
    }

    /**
     * Builds the Guardian user message.
     *
     * The priceData passed here is the CORRECTED data from Layer 1c in agent.ts.
     * If the Strategist selected a different pair than the Layer 1b pre-scan, the
     * agent re-fetches the Jupiter quote for the exact decided pair and amount before
     * invoking the Guardian. This ensures the Guardian evaluates the real execution
     * cost of the proposed trade — not a proxy quote for a different pair.
     *
     * If the Strategist selected the same pair as the pre-scan (the common case),
     * the same priceData is passed through unchanged.
     */
    buildGuardianUserPrompt(
        decision:  StrategistDecision,
        priceData: PriceData,
        balance:   AgentBalance,
        cycle:     number,
    ): string {
        return (
            `CYCLE ${cycle} — STRATEGIST DECISION AWAITING YOUR AUDIT:\n\n` +
            `${JSON.stringify(decision, null, 2)}\n\n` +
            `=== MARKET CONTEXT (verify the Strategist's reasoning against this data) ===\n\n` +
            `Token prices:\n` +
            `${formatPrices(priceData)}\n\n` +
            `Momentum divergence spreads:\n` +
            `${formatSpreads(priceData)}\n` +
            `${formatExecutionQuote(priceData)}\n\n` +
            `IMPORTANT: The Jupiter execution quote above is for the EXACT pair and amount the\n` +
            `Strategist proposed. If the Strategist's cited spread does not match the quote,\n` +
            `that is a discrepancy you should challenge.\n\n` +
            `Agent balance: ${formatBalance(balance)}\n` +
            `${priceData.stale ? '\nWARNING: The price data used for this decision is STALE.' : ''}\n\n` +
            `Audit this decision rigorously. Verify reasoning against the numbers above.\n` +
            `Respond with ONLY a valid JSON object. No text before { or after }.`
        );
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const promptBuilder = new PromptBuilder();