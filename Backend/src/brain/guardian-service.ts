/**
 * guardian-service.ts
 * Layer 3: Guardian AI Service — Google Gemini adversarial auditor.
 *
 * The Guardian is a completely separate LLM from the Strategist (DeepSeek).
 * Using different providers is intentional: two different reasoning engines, two
 * different failure modes, two different biases. If both agree, the decision is
 * genuinely robust.
 *
 * Both providers are accessed through the unified OpenAI SDK — DeepSeek and
 * Gemini each expose OpenAI-compatible chat completion endpoints. The adversarial
 * isolation happens at the corporate/model level (DeepSeek vs Google), not at the
 * package level. This is the "Single SDK, Dual Provider" architecture.
 *
 * The Guardian's sole purpose is adversarial challenge. It receives the Strategist's
 * full decision and must find flaws before approving it. It fails closed — if Gemini
 * is unreachable or returns invalid output, the decision receives a safety VETO and
 * the cycle ends without any transaction being submitted.
 *
 * WebSocket event emitted: GUARDIAN_AUDIT
 * Model: Google Gemini gemini-2.5-flash (via OpenAI-compatible endpoint)
 */

import type {
    StrategistDecision,
    GuardianAudit,
    PriceData,
    AgentBalance,
    PersonalityProfile,
    // AgentId,
} from '../types/agent-types';
import { getGeminiClient } from './ai-client';
import { promptBuilder } from './prompt-builder';
import {
    parseGuardianAudit,
    type ParseResult,
} from './decision-parser';

// Constants 
// gemini-2.5-flash: fast inference appropriate for per-cycle adversarial audits.
// Upgrade to gemini-2.5-pro for higher reasoning quality in production deployments.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const MAX_TOKENS = 2048;
// Low temperature enforces structured JSON rather than exploratory prose.
const TEMPERATURE = 0.2;

// Result types 
export interface GuardianSuccess {
    ok: true;
    audit: GuardianAudit;
    /** Raw Gemini output stored in audit log for full decision traceability */
    rawOutput: string;
}

export interface GuardianFailure {
    ok: false;
    error: string;
    rawOutput: string;
    /**
     * Always true on GuardianFailure — signals that this is a safety-triggered VETO
     * rather than an explicit model verdict. The caller must end the cycle without
     * submitting any transaction.
     */
    safetyVeto: true;
}

export type GuardianResult = GuardianSuccess | GuardianFailure;

// GuardianService class

export class GuardianService {
    /**
     * Adversarially audits the Strategist's decision using Google Gemini via
     * the OpenAI-compatible chat completions endpoint.
     *
     * Fail-closed security posture: any error at this layer — API failure,
     * timeout, parse error, or structurally invalid MODIFY — results in a
     * safety VETO. An unknown or uncertain Guardian verdict must never allow
     * a transaction to proceed.
     *
     * The error detail is returned to the caller for audit logging rather than
     * being swallowed here. This preserves full traceability of every veto reason.
     *
     * @returns GuardianResult — typed discriminated union, never throws
     */
    async audit(
        // agentId: AgentId,
        profile: PersonalityProfile,
        decision: StrategistDecision,
        priceData: PriceData,
        balance: AgentBalance,
        cycle: number,
    ): Promise<GuardianResult> {
        const systemPrompt = promptBuilder.buildGuardianSystemPrompt(profile);
        const userPrompt = promptBuilder.buildGuardianUserPrompt(
            decision,
            priceData,
            balance,
            cycle,
        );

        let rawOutput = '';

        try {
            // NOTE: response_format is intentionally OMITTED for Gemini.
            // Gemini's OpenAI-compatible endpoint truncates JSON mid-generation
            // when response_format: { type: 'json_object' } is set without a
            // strict schema. Instead, we rely on stripCodeFences + Zod validation
            // in decision-parser.ts to extract and validate the JSON output.
            const completion = await getGeminiClient().chat.completions.create({
                model: GEMINI_MODEL,
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            });

            rawOutput = completion.choices[0]?.message?.content ?? '';

            if (!rawOutput) {
                return this.safetyVeto('Gemini returned an empty response.', rawOutput);
            }

            const parseResult: ParseResult<GuardianAudit> = parseGuardianAudit(rawOutput);

            if (!parseResult.ok) {
                return this.safetyVeto(parseResult.error, rawOutput);
            }

            const audit = parseResult.data;

            // A MODIFY verdict without a concrete modifiedAmount is structurally
            // incomplete — Gemini has issued a half-verdict. Treat as VETO.
            if (audit.verdict === 'MODIFY' && audit.modifiedAmount === null) {
                return this.safetyVeto(
                    'Gemini issued MODIFY verdict but modifiedAmount is null. Treating as VETO.',
                    rawOutput,
                );
            }

            // The Guardian may only reduce a position size, never increase it.
            // A modifiedAmount >= original is a model hallucination or logic error.
            if (
                audit.verdict === 'MODIFY' &&
                audit.modifiedAmount !== null &&
                audit.modifiedAmount >= decision.amount
            ) {
                return this.safetyVeto(
                    `Gemini MODIFY amount (${audit.modifiedAmount}) >= original (${decision.amount}). ` +
                    `The Guardian may only reduce position size, not increase it. Treating as VETO.`,
                    rawOutput,
                );
            }

            return { ok: true, audit, rawOutput };

        } catch (err) {
            return this.safetyVeto(
                `Gemini API error: ${(err as Error).message}`,
                rawOutput,
            );
        }
    }

    /**
     * Constructs a GuardianFailure with safetyVeto: true.
     * Error detail is preserved for the caller to write to the audit log.
     */
    private safetyVeto(error: string, rawOutput: string): GuardianFailure {
        return { ok: false, error, rawOutput, safetyVeto: true };
    }
}

// Singleton 
export const guardianService = new GuardianService();