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
 *      the JSON output. 1024 was too low — the model was hitting the limit
 *      mid-generation and returning truncated or empty content. 4096 is safe.
 *
 *   2. The visible output sometimes includes a <think>…</think> preamble,
 *      markdown code fences, or trailing prose AFTER the JSON object.
 *      decision-parser.ts handles all of these via extractJsonObject().
 *
 * response_format is intentionally omitted: Gemini's OpenAI-compatible endpoint
 * truncates JSON mid-stream when response_format: json_object is set without a
 * strict schema. JSON extraction in the parser is the correct mitigation.
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
 * 4096 tokens to cover Gemini's hidden thinking budget + JSON output.
 * gemini-2.5-flash thinking models consume tokens internally before emitting
 * visible content — 1024 was insufficient and caused truncated/empty responses.
 */
const MAX_TOKENS = 4096;

/**
 * Low temperature enforces structured, consistent JSON rather than exploratory prose.
 * The Guardian's job is deterministic auditing, not creative reasoning.
 */
const TEMPERATURE = 0.1;

// ─── Result types ──────────────────────────────────────────────────────────────

export interface GuardianSuccess {
    ok: true;
    audit: GuardianAudit;
    /** Raw Gemini output stored verbatim in the audit log for full traceability. */
    rawOutput: string;
}

export interface GuardianFailure {
    ok: false;
    error: string;
    rawOutput: string;
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
     * Fail-closed: any error at this layer — API failure, timeout, parse error,
     * or structurally invalid MODIFY — results in a safety VETO. An uncertain
     * or unknown Guardian verdict must never allow a transaction to proceed.
     *
     * Error detail is returned to the caller for audit logging rather than being
     * swallowed here. This preserves full traceability of every veto reason.
     *
     * @returns GuardianResult — typed discriminated union, never throws
     */
    async audit(
        profile: PersonalityProfile,
        decision: StrategistDecision,
        priceData: PriceData,
        balance: AgentBalance,
        cycle: number,
    ): Promise<GuardianResult> {
        const systemPrompt = promptBuilder.buildGuardianSystemPrompt(profile);
        const userPrompt = promptBuilder.buildGuardianUserPrompt(decision, priceData, balance, cycle);

        let rawOutput = '';

        try {
            const completion = await getGeminiClient().chat.completions.create({
                model: GEMINI_MODEL,
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                // response_format intentionally omitted — see module-level comment.
            });

            rawOutput = completion.choices[0]?.message?.content ?? '';

            if (!rawOutput.trim()) {
                return this._safetyVeto(
                    `Gemini returned an empty response. ` +
                    `Finish reason: ${completion.choices[0]?.finish_reason ?? 'unknown'}. ` +
                    `This may indicate the thinking budget consumed all available tokens — ` +
                    `MAX_TOKENS may need to be increased further.`,
                    rawOutput,
                );
            }

            const parseResult: ParseResult<GuardianAudit> = parseGuardianAudit(rawOutput);

            if (!parseResult.ok) {
                return this._safetyVeto(parseResult.error, rawOutput);
            }

            const audit = parseResult.data;

            // A MODIFY verdict without a concrete modifiedAmount is a half-verdict.
            // Gemini has identified a problem but failed to quantify the correction.
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
                audit.verdict === 'MODIFY' &&
                audit.modifiedAmount != null &&
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
            // Surface HTTP status codes for API diagnostics (503 = overloaded, 429 = rate limit).
            const status = (err as { status?: number }).status;
            const statusInfo = status ? ` [HTTP ${status}]` : '';
            return this._safetyVeto(
                `Gemini API error${statusInfo}: ${(err as Error).message}`,
                rawOutput,
            );
        }
    }

    /**
     * Constructs a GuardianFailure with safetyVeto: true.
     * Named with underscore to signal it is an internal factory, not a public API.
     */
    private _safetyVeto(error: string, rawOutput: string): GuardianFailure {
        return { ok: false, error, rawOutput, safetyVeto: true };
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const guardianService = new GuardianService();