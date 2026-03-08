/**
 * decision-parser.ts
 * Zod schema validation for all LLM outputs in the Solus Protocol pipeline.
 *
 * Both the Strategist (Layer 2, DeepSeek) and Guardian (Layer 3, Gemini) outputs
 * pass through this module before any downstream layer acts on them. Malformed,
 * incomplete, or schema-violating output is caught here and returned as a typed
 * failure — no exceptions bubble up, and no invalid data reaches the Policy Engine.
 *
 * The parse functions are purposely the only place in the codebase that handles
 * raw LLM string output. All other modules work with validated typed structs.
 */

import { z } from 'zod';
import type { StrategistDecision, GuardianAudit } from '../types/agent-types';

// Shared literal schemas 
const TokenSymbolSchema = z.enum(['SOL', 'USDC', 'RAY', 'BONK']);
const DecisionActionSchema = z.enum(['SWAP', 'HOLD', 'SKIP']);
const GuardianVerdictSchema = z.enum(['APPROVE', 'VETO', 'MODIFY']);

// Strategist output schema (Layer 2 — DeepSeek deepseek-chat) 

export const StrategistDecisionSchema = z.object({
    decision: DecisionActionSchema,
    fromToken: TokenSymbolSchema,
    toToken: TokenSymbolSchema,
    amount: z.number().nonnegative('amount must be >= 0').finite('amount must be finite'),
    confidence: z.number().min(0, 'confidence must be >= 0.0').max(1, 'confidence must be <= 1.0'),
    reasoning: z.string().min(1, 'reasoning must not be empty').max(2000, 'reasoning must be <= 2000 chars'),
    riskFlags: z.array(z.string()),
});

// Guardian output schema (Layer 3 — Google Gemini via OpenAI SDK) 
export const GuardianAuditSchema = z.object({
    verdict: GuardianVerdictSchema,
    challenge: z.string().min(1, 'challenge must not be empty').max(2000, 'challenge must be <= 2000 chars'),
    modifiedAmount: z.number().nonnegative().finite().nullish(),
});

// Result types 

export interface ParseSuccess<T> {
    ok: true;
    data: T;
}

export interface ParseFailure {
    ok: false;
    error: string;
    rawOutput: string;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

// Helpers 
/**
 * Strips markdown code fences that both DeepSeek and Gemini occasionally wrap
 * around JSON output despite being instructed not to. Handles ```json, ```,
 * and any leading/trailing whitespace.
 */
function stripCodeFences(raw: string): string {
    return raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function formatZodError(err: z.ZodError): string {
    return err.issues
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; ');
}

// Parse functions 

/**
 * Parses and validates a raw Strategist (DeepSeek) LLM output string.
 * Extracts the text from DeepSeek's response.choices[0].message.content before
 * calling this — the input here is the raw content string, not the API response object.
 * Returns a typed ParseResult — never throws.
 */
export function parseStrategistDecision(rawOutput: string): ParseResult<StrategistDecision> {
    const cleaned = stripCodeFences(rawOutput);

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        return {
            ok: false,
            error: `JSON parse failed: ${(err as Error).message}`,
            rawOutput,
        };
    }

    const result = StrategistDecisionSchema.safeParse(parsed);
    if (!result.success) {
        return {
            ok: false,
            error: `Schema validation failed: ${formatZodError(result.error)}`,
            rawOutput,
        };
    }

    return { ok: true, data: result.data as StrategistDecision };
}

/**
 * Parses and validates a raw Guardian (Gemini) LLM output string.
 * Gemini via OpenAI SDK returns response.choices[0].message.content directly.
 * The input here is that text string — not an API response object.
 * Returns a typed ParseResult — never throws.
 */
export function parseGuardianAudit(rawOutput: string): ParseResult<GuardianAudit> {
    const cleaned = stripCodeFences(rawOutput);

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        return {
            ok: false,
            error: `JSON parse failed: ${(err as Error).message}`,
            rawOutput,
        };
    }

    const result = GuardianAuditSchema.safeParse(parsed);
    if (!result.success) {
        return {
            ok: false,
            error: `Schema validation failed: ${formatZodError(result.error)}`,
            rawOutput,
        };
    }

    return { ok: true, data: result.data as GuardianAudit };
}