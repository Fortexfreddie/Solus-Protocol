/**
 * guardian-service.ts
 * Layer 3: Guardian AI Service — Google Gemini adversarial auditor.
 *
 * Uses Google Gemini (gemini-2.5-flash) via the OpenAI-compatible endpoint.
 * Fails closed: any API error, empty response, or parse failure results in a
 * safety VETO — the cycle ends without any transaction being submitted.
 *
 * Gemini-specific considerations
 * ───────────────────────────────
 * gemini-2.5-flash is a thinking model. It silently burns tokens on internal
 * reasoning before producing its visible output. This has two consequences:
 *
 *   1. MAX_TOKENS must be high enough to cover BOTH the thinking budget AND
 *      the JSON output. 4096 is safe; lower values risk truncated/empty output.
 *
 *   2. The visible output sometimes includes a <think>…</think> preamble,
 *      markdown code fences, or trailing prose AFTER the JSON object.
 *      decision-parser.ts handles all of these via cleanLlmOutput().
 *
 * response_format is intentionally omitted: Gemini's OpenAI-compatible endpoint
 * truncates JSON mid-stream when response_format: json_object is set without a
 * strict schema. JSON extraction in the parser is the correct mitigation.
 *
 * The Guardian now receives SKILLS.md (loaded by prompt-builder.ts) as context —
 * not as operating instructions. This gives it the frame of reference to evaluate
 * whether the Strategist's decision is consistent with the Strategist's mandate.
 *
 * The priceData passed to audit() should be the Layer 1c corrected data from
 * agent.ts — the Jupiter quote re-fetched for the exact pair and amount the
 * Strategist decided on. This ensures the Guardian evaluates the real execution
 * cost of the proposed trade, not a proxy quote for a different pair.
 *
 * WebSocket event emitted: GUARDIAN_AUDIT
 * Model: gemini-2.5-flash (configurable via GEMINI_MODEL env var)
 */

import type {
    StrategistDecision,
    GuardianAudit,
    PriceData,
    AgentBalance,
    PersonalityProfile,
} from '../types/agent-types';
import { getGeminiClient } from './ai-client';
import { promptBuilder } from './prompt-builder';
import { parseGuardianAudit, type ParseResult } from './decision-parser';

// ─── Constants ─────────────────────────────────────────────────────────────────

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

/**
 * 4096 tokens to cover Gemini's hidden thinking budget + SKILLS.md context + JSON output.
 * gemini-2.5-flash thinking models consume tokens internally before emitting visible
 * content — lower values caused truncated/empty responses in testing.
 *
 * Note: SKILLS.md adds significant token count to the system prompt (roughly 1500-2000
 * tokens depending on file size). If SKILLS.md grows substantially, consider raising
 * this to 6144 or monitoring finish_reason for 'length' truncations.
 */
const MAX_TOKENS = 4096;

/**
 * Low temperature enforces consistent, structured JSON over creative exploration.
 * The Guardian's job is deterministic auditing, not creative reasoning.
 */
const TEMPERATURE = 0.1;

// ─── Result types ──────────────────────────────────────────────────────────────

export interface GuardianSuccess {
    ok:        true;
    audit:     GuardianAudit;
    /** Raw Gemini output stored verbatim in the audit log for full traceability. */
    rawOutput: string;
}

export interface GuardianFailure {
    ok:         false;
    error:      string;
    rawOutput:  string;
    /**
     * Always true on GuardianFailure — signals a safety-triggered VETO rather
     * than an explicit model verdict. The caller MUST end the cycle without
     * submitting any transaction.
     */
    safetyVeto: true;
}

export type GuardianResult = GuardianSuccess | GuardianFailure;

// ─── GuardianService ───────────────────────────────────────────────────────────

export class GuardianService {
    /**
     * Adversarially audits the Strategist's decision using Google Gemini.
     *
     * The priceData argument should be the Layer 1c corrected data — re-fetched by
     * agent.ts for the exact decided pair when the Strategist picked a different pair
     * than the Layer 1b pre-scan. If the pairs match, the same priceData is passed
     * through unchanged. Either way, the Guardian audits against real execution data.
     *
     * Fail-closed: any error at this layer — API failure, timeout, parse error, or
     * structurally invalid MODIFY — results in a safety VETO. An uncertain or unknown
     * Guardian verdict must never allow a transaction to proceed.
     *
     * @returns GuardianResult — typed discriminated union, never throws
     */
    async audit(
        profile:   PersonalityProfile,
        decision:  StrategistDecision,
        priceData: PriceData,
        balance:   AgentBalance,
        cycle:     number,
    ): Promise<GuardianResult> {
        const systemPrompt = promptBuilder.buildGuardianSystemPrompt(profile);
        const userPrompt   = promptBuilder.buildGuardianUserPrompt(decision, priceData, balance, cycle);

        let rawOutput = '';

        try {
            const completion = await getGeminiClient().chat.completions.create({
                model:       GEMINI_MODEL,
                max_tokens:  MAX_TOKENS,
                temperature: TEMPERATURE,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt   },
                ],
                // response_format intentionally omitted — see module-level comment.
            });

            rawOutput = completion.choices[0]?.message?.content ?? '';

            if (!rawOutput.trim()) {
                return this._safetyVeto(
                    `Gemini returned an empty response. ` +
                    `Finish reason: ${completion.choices[0]?.finish_reason ?? 'unknown'}. ` +
                    `The thinking budget may have consumed all available tokens — ` +
                    `consider increasing MAX_TOKENS if this recurs.`,
                    rawOutput,
                );
            }

            const parseResult: ParseResult<GuardianAudit> = parseGuardianAudit(rawOutput);

            if (!parseResult.ok) {
                return this._safetyVeto(parseResult.error, rawOutput);
            }

            const audit = parseResult.data;

            // A MODIFY verdict without a concrete modifiedAmount is a half-verdict.
            // The Guardian identified a problem but failed to quantify the correction.
            if (audit.verdict === 'MODIFY' && (audit.modifiedAmount == null)) {
                return this._safetyVeto(
                    'Gemini issued MODIFY verdict but modifiedAmount is null or missing. ' +
                    'A MODIFY verdict requires a concrete positive amount. Treating as VETO.',
                    rawOutput,
                );
            }

            // The Guardian may only reduce position size — never increase it.
            // modifiedAmount >= original signals a model hallucination or logic error.
            if (
                audit.verdict === 'MODIFY'          &&
                audit.modifiedAmount != null         &&
                audit.modifiedAmount >= decision.amount
            ) {
                return this._safetyVeto(
                    `Gemini MODIFY amount (${audit.modifiedAmount}) >= original (${decision.amount}). ` +
                    `The Guardian may only reduce position size, not increase it. Treating as VETO.`,
                    rawOutput,
                );
            }

            return { ok: true, audit, rawOutput };

        } catch (err) {
            const status     = (err as { status?: number }).status;
            const statusInfo = status ? ` [HTTP ${status}]` : '';
            return this._safetyVeto(
                `Gemini API error${statusInfo}: ${(err as Error).message}`,
                rawOutput,
            );
        }
    }

    /**
     * Constructs a GuardianFailure with safetyVeto: true.
     * Error detail is preserved for the caller to write to the audit log.
     */
    private _safetyVeto(error: string, rawOutput: string): GuardianFailure {
        return { ok: false, error, rawOutput, safetyVeto: true };
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const guardianService = new GuardianService();