/**
 * permission-profiles.ts
 * Policy Engine permission profiles for Rex, Nova, and Sage.
 *
 * While agent-profiles.ts defines the full PersonalityProfile (LLM directives,
 * cycle timing, etc.), this module provides a focused view of the same numeric
 * limits specifically for Policy Engine consumption and dashboard display.
 *
 * Both modules derive from the same source-of-truth values in the master spec.
 * The PolicyEngineProfile type makes it explicit which fields the Policy Engine
 * reads so future changes to PersonalityProfile do not silently affect policy logic.
 */

import type { AgentId } from '../types/agent-types.js';

// PolicyEngineProfile 
export interface PolicyEngineProfile {
    agentId: AgentId;
    name: string;
    /** Minimum spread % required before the engine allows a SWAP. Check 8. */
    spreadThresholdPct: number;
    /** Minimum LLM confidence score required. Below this: force HOLD. Check 3. */
    minConfidence: number;
    /** Maximum SOL per single transaction. Above this: clamp. Check 4. */
    maxTxAmountSol: number;
    /** Maximum SOL traded per calendar session. Above this: reject. Check 5. */
    dailyVolumeCapSol: number;
    /** Drawdown % from session high that triggers HOLD-only mode. Check 9. */
    stopLossTriggerPct: number;
}

// Profile definitions 
export const POLICY_PROFILES: Record<AgentId, PolicyEngineProfile> = {
    rex: {
        agentId: 'rex',
        name: 'Rex',
        spreadThresholdPct: 0.15,
        minConfidence: 0.45,
        maxTxAmountSol: 0.2,
        dailyVolumeCapSol: 1.0,
        stopLossTriggerPct: -20,
    },
    nova: {
        agentId: 'nova',
        name: 'Nova',
        spreadThresholdPct: 0.5,
        minConfidence: 0.65,
        maxTxAmountSol: 0.05,
        dailyVolumeCapSol: 0.3,
        stopLossTriggerPct: -10,
    },
    sage: {
        agentId: 'sage',
        name: 'Sage',
        spreadThresholdPct: 0.3,
        minConfidence: 0.55,
        maxTxAmountSol: 0.1,
        dailyVolumeCapSol: 0.5,
        stopLossTriggerPct: -15,
    },
};

export function getPolicyProfile(agentId: AgentId): PolicyEngineProfile {
    return POLICY_PROFILES[agentId];
}