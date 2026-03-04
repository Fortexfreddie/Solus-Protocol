// src/agent/agent-profiles.ts
// Canonical PersonalityProfile definitions for all three Solus Protocol agents.
// These are loaded at runtime and injected into every LLM call.
// Values are tuned for Devnet liquidity pools (wider slippage than mainnet).

import type { PersonalityProfile, AgentId } from '../types/agent-types.js';

// Profile Definitions 
const REX: PersonalityProfile = {
    agentId: 'rex',
    name: 'Rex',
    riskProfile: 'aggressive',
    cycleOffsetSeconds: 0,
    cycleIntervalSeconds: 60,
    spreadThresholdPct: 0.15,
    minConfidence: 0.45,
    maxTxAmountSol: 0.2,
    dailyVolumeCapSol: 1.0,
    stopLossTriggerPct: -20,
    llmDirective:
        'You are Rex. Your mandate is aggressive arbitrage. ' +
        'Act on spreads at or above 0.15 percent. Prioritize speed. ' +
        'Minimum confidence threshold: 0.45. ' +
        'Token preference: any pair. Act fast. Capture spreads aggressively.',
};

const NOVA: PersonalityProfile = {
    agentId: 'nova',
    name: 'Nova',
    riskProfile: 'conservative',
    cycleOffsetSeconds: 20,
    cycleIntervalSeconds: 60,
    spreadThresholdPct: 0.5,
    minConfidence: 0.65,
    maxTxAmountSol: 0.05,
    dailyVolumeCapSol: 0.3,
    stopLossTriggerPct: -10,
    llmDirective:
        'You are Nova. Your mandate is capital preservation. ' +
        'Act only on spreads at or above 0.5 percent with high certainty. ' +
        'Prefer stablecoin pairs (SOL/USDC). ' +
        'Minimum confidence threshold: 0.65. ' +
        'Only act on high-confidence, low-risk setups.',
};

const SAGE: PersonalityProfile = {
    agentId: 'sage',
    name: 'Sage',
    riskProfile: 'balanced',
    cycleOffsetSeconds: 40,
    cycleIntervalSeconds: 60,
    spreadThresholdPct: 0.3,
    minConfidence: 0.55,
    maxTxAmountSol: 0.1,
    dailyVolumeCapSol: 0.5,
    stopLossTriggerPct: -15,
    llmDirective:
        'You are Sage. Your mandate is balanced opportunity capture. ' +
        'Act on spreads at or above 0.3 percent. ' +
        'Consider position sizing carefully. ' +
        'Minimum confidence threshold: 0.55. ' +
        'Balance risk and opportunity across cycles.',
};

// Profile Registry 
export const AGENT_PROFILES: Record<AgentId, PersonalityProfile> = {
    rex: REX,
    nova: NOVA,
    sage: SAGE,
};

export function getProfile(agentId: AgentId): PersonalityProfile {
    return AGENT_PROFILES[agentId];
}

export { REX, NOVA, SAGE };