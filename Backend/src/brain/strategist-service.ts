/**
 * strategist-service.ts
 * Layer 2: Strategist Service — DeepSeek primary decision maker.
 *
 * Reads SKILLS.md from disk at call time, builds a prompt from live market data
 * and agent state, calls DeepSeek (deepseek-chat) via the unified OpenAI SDK
 * with strict JSON output enforced, and validates the response through the Zod
 * schema before returning.
 *
 * On parse failure or API error: returns a typed StrategistFailure. The caller
 * emits LLM_PARSE_ERROR and ends the cycle cleanly — no transaction proceeds.
 *
 * DeepSeek's API can experience heavy congestion (HTTP 503 / 529). The error
 * handler captures the status code when available so operators can distinguish
 * between API outages and LLM parse failures in the audit log.
 *
 * WebSocket event emitted: AGENT_THINKING | LLM_PARSE_ERROR
 * Model: DeepSeek deepseek-chat (DeepSeek-V3)
 */

import type {
    PriceData,
    AgentBalance,
    TxRecord,
    PersonalityProfile,
    StrategistDecision,
    AgentId,
} from '../types/agent-types';
import { getDeepSeekClient } from './ai-client';
import { promptBuilder } from './prompt-builder';
import { parseStrategistDecision, type ParseResult } from './decision-parser';

// Constants 

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const MAX_TOKENS = 2048;
// Low temperature produces more consistent JSON structure and less creative drift.
const TEMPERATURE = 0.2;

// Result types

export interface StrategistSuccess {
    ok: true;
    decision: StrategistDecision;
    /** Raw DeepSeek output — stored verbatim in the audit log for traceability. */
    rawOutput: string;
    usage: { promptTokens: number; completionTokens: number };
}

export interface StrategistFailure {
    ok: false;
    error: string;
    rawOutput: string;
}

export type StrategistResult = StrategistSuccess | StrategistFailure;

// StrategistService class 

export class StrategistService {
    /**
     * Executes one Strategist reasoning cycle for an agent.
     *
     * Steps:
     *   1. Build system prompt: SKILLS.md (fresh from disk) + personality directive
     *   2. Build user prompt: live prices, spreads, balance, and tx history
     *   3. Call DeepSeek deepseek-chat with json_object response format enforced
     *   4. Extract and Zod-validate the response
     *   5. Return typed result — never throws
     *
     * The json_object response format forces the model to produce valid JSON,
     * but Zod validation is still required to confirm the schema matches what
     * downstream layers expect.
     */
    async reason(
        agentId: AgentId,
        profile: PersonalityProfile,
        priceData: PriceData,
        balance: AgentBalance,
        txHistory: TxRecord[],
        cycle: number,
    ): Promise<StrategistResult> {
        const systemPrompt = promptBuilder.buildStrategistSystemPrompt(profile);
        const userPrompt = promptBuilder.buildStrategistUserPrompt(
            priceData, balance, txHistory, agentId, cycle,
        );

        let rawOutput = '';

        try {
            const completion = await getDeepSeekClient().chat.completions.create({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            });

            rawOutput = completion.choices[0]?.message?.content ?? '';

            const usage = {
                promptTokens: completion.usage?.prompt_tokens ?? 0,
                completionTokens: completion.usage?.completion_tokens ?? 0,
            };

            if (!rawOutput) {
                return { ok: false, error: 'DeepSeek returned an empty response.', rawOutput: '' };
            }

            const parseResult: ParseResult<StrategistDecision> = parseStrategistDecision(rawOutput);

            if (!parseResult.ok) {
                return { ok: false, error: parseResult.error, rawOutput };
            }

            return { ok: true, decision: parseResult.data, rawOutput, usage };

        } catch (err) {
            // Surface HTTP status codes (503 / 529) for DeepSeek congestion diagnostics.
            const status = (err as { status?: number }).status;
            const statusInfo = status ? ` [HTTP ${status}]` : '';
            return {
                ok: false,
                error: `DeepSeek API error${statusInfo}: ${(err as Error).message}`,
                rawOutput,
            };
        }
    }
}

// Singleton 

export const strategistService = new StrategistService();