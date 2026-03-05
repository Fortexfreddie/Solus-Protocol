/**
 * ai-client.ts
 * Unified OpenAI SDK router for the Solus Protocol dual-provider AI pipeline.
 *
 * Routes Strategist calls to DeepSeek and Guardian calls to Gemini using
 * their respective OpenAI-compatible endpoints. Both clients are lazy-initialized
 * so dotenv is guaranteed loaded before any environment variable is read.
 *
 * The two providers remain corporately and architecturally independent — different
 * companies, different models, different failure modes — even though they share a
 * single SDK interface. This is the "Single SDK, Dual Provider" pattern.
 */

import OpenAI from 'openai';

//  DeepSeek Client (Strategist — Layer 2) 

let _deepseek: OpenAI | null = null;

export function getDeepSeekClient(): OpenAI {
    if (!_deepseek) {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) throw new Error('[AI Client] DEEPSEEK_API_KEY is missing.');
        _deepseek = new OpenAI({
            apiKey,
            baseURL: process.env.DEEPSEEK_BASE_URL
                ?? 'https://api.deepseek.com',
        });
    }
    return _deepseek;
}

//  Gemini Client (Guardian — Layer 3) 

let _gemini: OpenAI | null = null;

export function getGeminiClient(): OpenAI {
    if (!_gemini) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('[AI Client] GEMINI_API_KEY is missing.');
        _gemini = new OpenAI({
            apiKey,
            baseURL: process.env.GEMINI_BASE_URL
                ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });
    }
    return _gemini;
}
