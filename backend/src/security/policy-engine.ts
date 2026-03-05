/**
 * policy-engine.ts
 * Layer 4: Policy Engine — 9 hard deterministic rule checks.
 *
 * These checks run in strict sequence after the Guardian audit. Neither the
 * Strategist nor the Guardian can override them. Each check produces a typed
 * PolicyCheck result that is emitted individually to the dashboard for animated
 * display and written verbatim into the Proof-of-Reasoning payload.
 *
 * Check outcomes:
 *   REJECT      — cycle ends, no transaction submitted
 *   FORCE_HOLD  — decision converted to HOLD, cycle continues without swap
 *   CLAMP       — amount reduced to the permitted maximum, cycle continues
 *   QUEUE       — rate limit hit, cycle ends (future: queued for next window)
 *   RESTRICT    — stop-loss triggered, agent enters HOLD-only mode
 *   PASS        — check satisfied, no modification
 *
 * WebSocket event emitted: POLICY_PASS | POLICY_FAIL
 */

import type {
    StrategistDecision,
    PersonalityProfile,
    PolicyCheck,
    PolicyCheckName,
    PolicyResult,
    PolicyOutcome,
    AgentBalance,
    PriceData,
} from '../types/agent-types.js';

// Constants 

const ALLOWED_ACTIONS = new Set(['SWAP', 'HOLD', 'SKIP']);
const ALLOWED_TOKENS = new Set(['SOL', 'USDC', 'RAY', 'BONK']);
const FEE_RESERVE_SOL = 0.01;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Rate limiter (per-agent in-process state) 

interface RateLimiterState {
    timestamps: number[];
}

const rateLimiters = new Map<string, RateLimiterState>();

function getRateLimiter(agentId: string): RateLimiterState {
    if (!rateLimiters.has(agentId)) {
        rateLimiters.set(agentId, { timestamps: [] });
    }
    return rateLimiters.get(agentId)!;
}

function recordTransaction(agentId: string): void {
    const limiter = getRateLimiter(agentId);
    limiter.timestamps.push(Date.now());
}

// Stop-loss state (per-agent in-process) 
// Tracks total USD portfolio value to prevent false positives when SOL is
// spent on valid swaps (e.g. SOL→USDC drops SOL but doesn't lose value).

interface StopLossState {
    sessionHighUsd: number;
    restricted: boolean;
}

const stopLossStates = new Map<string, StopLossState>();

function getStopLossState(agentId: string, currentUsd: number): StopLossState {
    if (!stopLossStates.has(agentId)) {
        stopLossStates.set(agentId, { sessionHighUsd: currentUsd, restricted: false });
    }
    const state = stopLossStates.get(agentId)!;
    // Update session high if portfolio value has grown
    if (currentUsd > state.sessionHighUsd) {
        state.sessionHighUsd = currentUsd;
    }
    return state;
}

// Check builders 

function pass(name: PolicyCheckName, reason: string): PolicyCheck {
    return { name, passed: true, reason };
}

function fail(name: PolicyCheckName, reason: string, adjustedValue?: number): PolicyCheck {
    return { name, passed: false, reason, ...(adjustedValue !== undefined ? { adjustedValue } : {}) };
}

// PolicyEngine class 

export class PolicyEngine {
    /**
     * Runs all 9 policy checks against the proposed decision in strict order.
     *
     * Each check is run regardless of prior failures so the dashboard can display
     * all 9 results simultaneously. However, certain early failures (REJECT on
     * checks 1, 2, 5, 7) set a hard rejection flag — the final outcome is still
     * determined after all checks have been evaluated.
     *
     * The returned PolicyResult contains the (possibly modified) finalDecision —
     * callers must use this, not the original decision, for Layer 5 onwards.
     */
    check(
        decision: StrategistDecision,
        profile: PersonalityProfile,
        balance: AgentBalance,
        priceData: PriceData,
        dailyVolumeUsedSol: number,
        bestSpreadPct: number,
    ): PolicyResult {
        const checks: PolicyCheck[] = [];
        let hardReject = false;
        let forceHold = false;
        let failedOn: PolicyCheckName | undefined;
        let outcome: PolicyOutcome = 'APPROVED';

        // Working copy of the decision — modified in-place by checks 3, 4, 8
        const d = { ...decision };

        //  Check 1: Action whitelist 
        if (ALLOWED_ACTIONS.has(d.decision)) {
            checks.push(pass('ACTION_WHITELIST', `Action "${d.decision}" is permitted.`));
        } else {
            checks.push(fail('ACTION_WHITELIST', `Action "${d.decision}" is not in the allowed list: SWAP, HOLD, SKIP.`));
            hardReject = true;
            failedOn = 'ACTION_WHITELIST';
        }

        //  Check 2: Token whitelist 
        const badToken = [d.fromToken, d.toToken].find((t) => !ALLOWED_TOKENS.has(t));
        if (!badToken) {
            checks.push(pass('TOKEN_WHITELIST', `Tokens ${d.fromToken} and ${d.toToken} are both permitted.`));
        } else {
            checks.push(fail('TOKEN_WHITELIST', `Token "${badToken}" is not in the allowed list: SOL, USDC, RAY, BONK.`));
            hardReject = true;
            failedOn = failedOn ?? 'TOKEN_WHITELIST';
        }

        //  Check 3: Minimum confidence 
        if (d.decision !== 'SWAP') {
            checks.push(pass('MIN_CONFIDENCE', `Confidence check skipped — decision is ${d.decision}, not SWAP.`));
        } else if (d.confidence >= profile.minConfidence) {
            checks.push(pass(
                'MIN_CONFIDENCE',
                `Confidence ${d.confidence} meets minimum threshold ${profile.minConfidence}.`,
            ));
        } else {
            checks.push(fail(
                'MIN_CONFIDENCE',
                `Confidence ${d.confidence} is below the ${profile.riskProfile} threshold of ${profile.minConfidence}. Forcing HOLD.`,
            ));
            forceHold = true;
            failedOn = failedOn ?? 'MIN_CONFIDENCE';
        }

        //  Check 4: Volatility-Adjusted Position Sizing
        //  Replaces the static max-tx-amount clamp with a dynamic calculation
        //  that factors in the agent's confidence score and current market volatility.
        //  Formula: safeAmount = maxTxAmountSol × confidence × (1 - volatilityPenalty)
        if (d.decision === 'SWAP') {
            const baseAmount = profile.maxTxAmountSol;
            const confidence = d.confidence;

            // Null-safe access — CoinGecko occasionally drops change24h on low-volume tokens.
            const priceChange24h = Math.abs(priceData.prices[d.fromToken]?.change24h ?? 0);

            // Apply a volatility penalty only when 24h change exceeds the 5% baseline threshold.
            // Penalty is capped at 50% to prevent the formula from producing near-zero amounts.
            const volatilityPenalty =
                priceChange24h > 5
                    ? Math.min((priceChange24h - 5) / 100, 0.5)
                    : 0;

            const safeAmount = baseAmount * confidence * (1 - volatilityPenalty);
            const approvedAmount = Number(safeAmount.toFixed(4));

            // Overwrite the decision amount with the policy-calculated safe amount.
            d.amount = approvedAmount;

            checks.push(pass(
                'VOLATILITY_SIZING',
                `Base: ${baseAmount} SOL | Confidence: ${confidence} | ` +
                `24h change: ${priceChange24h.toFixed(2)}% | ` +
                `Volatility penalty: ${(volatilityPenalty * 100).toFixed(1)}% | ` +
                `Approved amount: ${approvedAmount} SOL`,
            ));
        } else {
            checks.push(pass(
                'VOLATILITY_SIZING',
                `Volatility sizing skipped — decision is ${d.decision}, not SWAP.`,
            ));
        }

        //  Check 5: Daily volume cap 
        const projectedVolume = dailyVolumeUsedSol + (d.decision === 'SWAP' ? d.amount : 0);
        if (projectedVolume <= profile.dailyVolumeCapSol) {
            checks.push(pass(
                'DAILY_VOLUME_CAP',
                `Projected daily volume ${projectedVolume.toFixed(4)} SOL is within cap of ${profile.dailyVolumeCapSol} SOL.`,
            ));
        } else {
            checks.push(fail(
                'DAILY_VOLUME_CAP',
                `Projected daily volume ${projectedVolume.toFixed(4)} SOL would exceed cap of ${profile.dailyVolumeCapSol} SOL.`,
            ));
            hardReject = true;
            failedOn = failedOn ?? 'DAILY_VOLUME_CAP';
        }

        //  Check 6: Rate limit 
        const limiter = getRateLimiter(profile.agentId);
        const now = Date.now();
        const windowStart = now - RATE_LIMIT_WINDOW_MS;
        // Purge timestamps outside the current window
        limiter.timestamps = limiter.timestamps.filter((t) => t > windowStart);
        const txInWindow = limiter.timestamps.length;

        if (txInWindow < RATE_LIMIT_MAX) {
            checks.push(pass(
                'RATE_LIMIT',
                `${txInWindow}/${RATE_LIMIT_MAX} transactions used in the current 60-second window.`,
            ));
        } else {
            checks.push(fail(
                'RATE_LIMIT',
                `Rate limit reached: ${txInWindow}/${RATE_LIMIT_MAX} transactions in the current 60-second window. Queuing.`,
            ));
            forceHold = true;
            if (!hardReject) {
                outcome = 'QUEUED';
                failedOn = failedOn ?? 'RATE_LIMIT';
            }
        }

        //  Check 7: Balance check 
        const requiredSol = d.decision === 'SWAP'
            ? d.amount + FEE_RESERVE_SOL
            : FEE_RESERVE_SOL;

        if (balance.sol >= requiredSol) {
            checks.push(pass(
                'BALANCE_CHECK',
                `Balance ${balance.sol.toFixed(4)} SOL covers required ${requiredSol.toFixed(4)} SOL (amount + ${FEE_RESERVE_SOL} SOL reserve).`,
            ));
        } else {
            checks.push(fail(
                'BALANCE_CHECK',
                `Insufficient balance: ${balance.sol.toFixed(4)} SOL available, ${requiredSol.toFixed(4)} SOL required.`,
            ));
            hardReject = true;
            failedOn = failedOn ?? 'BALANCE_CHECK';
        }

        //  Check 8: Spread threshold (uses Jupiter net spread when available)
        if (d.decision !== 'SWAP') {
            checks.push(pass('SPREAD_THRESHOLD', `Spread check skipped — decision is ${d.decision}, not SWAP.`));
        } else {
            // Use net spread from Jupiter quote if available and not errored.
            // Fall back to CoinGecko gross spread otherwise.
            const quote = priceData.executionQuote;
            const spreadPct = quote && !quote.error
                ? quote.netSpreadVsMarket * 100
                : bestSpreadPct;
            const source = quote && !quote.error ? 'Jupiter net' : 'CoinGecko gross';

            if (spreadPct >= profile.spreadThresholdPct) {
                checks.push(pass(
                    'SPREAD_THRESHOLD',
                    `Spread ${spreadPct.toFixed(3)}% (${source}) meets the ${profile.riskProfile} threshold of ${profile.spreadThresholdPct}%.`,
                ));
            } else {
                checks.push(fail(
                    'SPREAD_THRESHOLD',
                    `Spread ${spreadPct.toFixed(3)}% (${source}) is below the ${profile.riskProfile} threshold of ${profile.spreadThresholdPct}%. Forcing HOLD.`,
                ));
                forceHold = true;
                failedOn = failedOn ?? 'SPREAD_THRESHOLD';
            }
        }

        //  Check 9: Stop-loss circuit (USD Portfolio Tracking) 
        // Computes total portfolio value in USD across all held tokens to avoid
        // false-positive triggers when SOL is spent on valid swaps.
        const portfolioUsd =
            (balance.sol * priceData.prices.SOL.usd) +
            ((balance.tokens.USDC ?? 0) * priceData.prices.USDC.usd) +
            ((balance.tokens.RAY ?? 0) * priceData.prices.RAY.usd) +
            ((balance.tokens.BONK ?? 0) * priceData.prices.BONK.usd);

        const stopLoss = getStopLossState(profile.agentId, portfolioUsd);

        const drawdownPct = stopLoss.sessionHighUsd > 0
            ? ((portfolioUsd - stopLoss.sessionHighUsd) / stopLoss.sessionHighUsd) * 100
            : 0;

        if (stopLoss.restricted) {
            checks.push(fail(
                'STOP_LOSS_CIRCUIT',
                `Agent is in HOLD-only mode. Session drawdown previously exceeded ${profile.stopLossTriggerPct}% threshold.`,
            ));
            outcome = 'RESTRICTED';
            forceHold = true;
            failedOn = failedOn ?? 'STOP_LOSS_CIRCUIT';
        } else if (drawdownPct <= profile.stopLossTriggerPct) {
            // Note: stopLossTriggerPct is negative (e.g., Rex: -20, Nova: -10, Sage: -15)
            // drawdownPct is also negative when portfolio is below session high.
            // Condition triggers when drawdown exceeds the threshold magnitude.
            stopLoss.restricted = true;
            checks.push(fail(
                'STOP_LOSS_CIRCUIT',
                `Drawdown ${drawdownPct.toFixed(2)}% has breached the ${profile.stopLossTriggerPct}% threshold. Agent entering HOLD-only mode.`,
            ));
            outcome = 'RESTRICTED';
            forceHold = true;
            failedOn = failedOn ?? 'STOP_LOSS_CIRCUIT';
        } else {
            checks.push(pass(
                'STOP_LOSS_CIRCUIT',
                `Current drawdown ${drawdownPct.toFixed(2)}% is within the ${profile.stopLossTriggerPct}% stop-loss threshold. Session high: $${stopLoss.sessionHighUsd.toFixed(2)}.`,
            ));
        }

        //  Determine final outcome 
        if (hardReject) {
            outcome = 'REJECTED';
        } else if (forceHold) {
            // Convert to HOLD — only override outcome if not already RESTRICTED/QUEUED
            if (outcome === 'APPROVED') outcome = 'FORCE_HOLD';
            d.decision = 'HOLD';
            d.amount = 0;
        }

        const approved = outcome === 'APPROVED';

        // Record this transaction in the rate limiter only if approved SWAP.
        if (approved && d.decision === 'SWAP') {
            recordTransaction(profile.agentId);
        }

        return {
            approved,
            outcome,
            checks,
            ...(failedOn ? { failedOn } : {}),
            ...(failedOn ? { reason: checks.find((c) => c.name === failedOn)?.reason } : {}),
            finalDecision: d,
        };
    }

    /**
     * Resets the stop-loss restriction for an agent.
     * Called by the operator via a future admin REST endpoint if they choose to
     * manually override the circuit breaker after reviewing the situation.
     */
    resetStopLoss(agentId: string): void {
        const state = stopLossStates.get(agentId);
        if (state) {
            state.restricted = false;
            state.sessionHighUsd = 0;
        }
    }

    /**
     * Returns current rate limiter status for an agent.
     * Used by the /health endpoint to surface operational state.
     */
    getRateLimitStatus(agentId: string): { used: number; limit: number; windowMs: number } {
        const limiter = getRateLimiter(agentId);
        const now = Date.now();
        const active = limiter.timestamps.filter((t) => t > now - RATE_LIMIT_WINDOW_MS);
        return { used: active.length, limit: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS };
    }
}

// Singleton 

export const policyEngine = new PolicyEngine();