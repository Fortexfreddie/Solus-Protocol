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
 *
 * JSON Extraction Strategy
 * ─────────────────────────
 * Gemini (gemini-2.5-flash) is a thinking model. It frequently produces output in
 * one of these forms before or after the JSON payload:
 *
 *   1. <think>…</think>{…}
 *   2. ```json\n{…}\n```
 *   3. "Here is my audit:\n```json\n{…}\n```\nLet me know if…"
 *   4. Plain {…} with no decoration (ideal, rarely happens)
 *   5. {…} followed by a trailing explanation paragraph
 *
 * Simple regex fence-stripping (the previous approach) fails on cases 1, 3, and 5.
 * The robust approach: locate the FIRST `{` and the LAST `}` in the response and
 * extract only that substring. This is safe for our schemas because neither
 * StrategistDecision nor GuardianAudit contain nested objects that could produce
 * false positives — and even if they did, JSON.parse would reject a malformed slice.
 *
 * DeepSeek is well-behaved with response_format: json_object and rarely needs this,
 * but running it through the same extractor costs nothing and adds resilience.
 */

import { z } from 'zod';
import type { StrategistDecision, GuardianAudit } from '../types/agent-types';

// ─── Shared literal schemas ────────────────────────────────────────────────────

const TokenSymbolSchema = z.enum(['SOL', 'USDC', 'RAY', 'BONK']);
const DecisionActionSchema = z.enum(['SWAP', 'HOLD', 'SKIP']);
const GuardianVerdictSchema = z.enum(['APPROVE', 'VETO', 'MODIFY']);

// ─── Strategist output schema (Layer 2 — DeepSeek deepseek-chat) ───────────────

export const StrategistDecisionSchema = z.object({
    decision: DecisionActionSchema,
    fromToken: TokenSymbolSchema,
    toToken: TokenSymbolSchema,
    amount: z.number().nonnegative('amount must be >= 0').finite('amount must be finite'),
    confidence: z.number().min(0, 'confidence must be >= 0.0').max(1, 'confidence must be <= 1.0'),
    reasoning: z.string().min(1, 'reasoning must not be empty').max(2000, 'reasoning must be <= 2000 chars'),
    riskFlags: z.array(z.string()),
});

// ─── Guardian output schema (Layer 3 — Google Gemini via OpenAI SDK) ──────────

export const GuardianAuditSchema = z.object({
    verdict: GuardianVerdictSchema,
    challenge: z.string().min(1, 'challenge must not be empty').max(2000, 'challenge must be <= 2000 chars'),
    modifiedAmount: z.number().nonnegative().finite().nullish(),
});

// ─── Result types ──────────────────────────────────────────────────────────────

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

// ─── Extraction helpers ────────────────────────────────────────────────────────

/**
 * Strips <think>…</think> blocks that Gemini thinking models prepend to responses.
 * Also handles <thinking>…</thinking> variants used by some model versions.
 * The s-flag (dotAll) ensures newlines inside the block are matched.
 */
function stripThinkingBlocks(raw: string): string {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .trim();
}

/**
 * Extracts the outermost JSON object from an arbitrary string.
 *
 * Strategy: find the index of the first `{` and the index of the last `}`,
 * then slice. This handles all known Gemini output patterns:
 *   - Preamble text before JSON
 *   - Markdown code fences (```json … ```)
 *   - Trailing explanation text after the closing brace
 *   - Mixed combinations of the above
 *
 * Returns null if no `{…}` block is found at all.
 */
function extractJsonObject(raw: string): string | null {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');

    if (start === -1 || end === -1 || end < start) return null;

    return raw.slice(start, end + 1);
}

/**
 * Full cleaning pipeline applied to every raw LLM response before JSON.parse.
 *
 * Order matters:
 *   1. Strip thinking blocks (may contain `{` characters that would confuse extraction)
 *   2. Extract the outermost JSON object
 *
 * Returns null if no JSON object can be found after cleaning.
 */
function cleanLlmOutput(raw: string): string | null {
    const withoutThinking = stripThinkingBlocks(raw);
    return extractJsonObject(withoutThinking);
}

function formatZodError(err: z.ZodError): string {
    return err.issues
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; ');
}

// ─── Parse functions ───────────────────────────────────────────────────────────

/**
 * Parses and validates a raw Strategist (DeepSeek) LLM output string.
 *
 * DeepSeek with response_format: json_object is reliable, but we run it through
 * the same robust extraction pipeline as Gemini for consistency and resilience.
 *
 * Returns a typed ParseResult — never throws.
 */
export function parseStrategistDecision(rawOutput: string): ParseResult<StrategistDecision> {
    const cleaned = cleanLlmOutput(rawOutput);

    if (!cleaned) {
        return {
            ok: false,
            error: 'Could not locate a JSON object in DeepSeek response. Raw output contained no { } block.',
            rawOutput,
        };
    }

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
 *
 * Gemini via the OpenAI-compatible endpoint frequently wraps responses in
 * markdown fences, thinking blocks, or trailing prose. The cleanLlmOutput
 * pipeline handles all known variants before JSON.parse is attempted.
 *
 * Returns a typed ParseResult — never throws.
 */
export function parseGuardianAudit(rawOutput: string): ParseResult<GuardianAudit> {
    const cleaned = cleanLlmOutput(rawOutput);

    if (!cleaned) {
        return {
            ok: false,
            error: 'Could not locate a JSON object in Gemini response. ' +
                'Raw output contained no { } block — possible empty or pure-prose reply.',
            rawOutput,
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        return {
            ok: false,
            error: `JSON parse failed after extraction: ${(err as Error).message}. ` +
                `Extracted slice: ${cleaned.slice(0, 200)}`,
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