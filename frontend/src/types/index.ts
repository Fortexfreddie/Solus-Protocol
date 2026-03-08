// ─── Agent Types ──────────────────────────────────────────────────────────────

export type AgentId = "rex" | "nova" | "sage";

/** Matches backend PersonalityProfile.riskProfile from swagger */
export type RiskProfile = "aggressive" | "conservative" | "balanced";

/** Display label for the mode badge */
export type AgentMode = "Aggressive" | "Conservative" | "Balanced";

/** Matches backend OperationalStatus */
export type OperationalStatus = "ACTIVE" | "PAUSED";

export type PipelineStepStatus = "done" | "running" | "error" | "pending";

export interface PipelineStep {
    id: string;
    label: string;
    status: PipelineStepStatus;
}

/** Matches backend AgentSummary schema from swagger */
export interface AgentPersonalityProfile {
    agentId: AgentId;
    name: string;
    riskProfile: RiskProfile;
    spreadThresholdPct: number;   // >= 0.5 (rex), >= 1.0 (nova), >= 0.75 (sage)
    minConfidence: number;         // 0.65 | 0.85 | 0.75
    maxTxAmountSol: number;        // 0.2 | 0.05 | 0.1
    dailyVolumeCapSol: number;     // 1.0 | 0.3 | 0.5
    stopLossTriggerPct: number;    // -20 | -10 | -15
}

/** Frontend agent card state */
export interface Agent {
    id: AgentId;
    name: string;
    /** Solana Base58 public key (truncated for display) */
    publicKey: string;
    profile: AgentPersonalityProfile;
    operationalStatus: OperationalStatus;
    /** SOL balance on-chain */
    solBalance: number;
    /** USDC balance */
    usdcBalance: number;
    /** Total portfolio USD equity */
    equity: number;
    /** Net PnL in USD vs baseline */
    netPnLUsd: number;
    pnlPercent: number;
    cycleCount: number;
    pipeline: PipelineStep[];
}

// ─── Price Data ───────────────────────────────────────────────────────────────

/** Matches backend price oracle PriceData output */
export interface TokenPriceEntry {
    usd: number;
    change24h: number;
}

export interface SpreadEntry {
    spreadPct: number;
    direction: string;
}

export interface ExecutionQuote {
    fromToken: string;
    toToken: string;
    inAmount: number;
    outAmount: number;
    impliedPrice: number;
    priceImpactPct: number;
    netSpreadVsMarket: number;
    worthTrading: boolean;
}

/** The actual API shape from /api/prices */
export interface PriceData {
    timestamp: number;
    stale: boolean;
    prices: {
        SOL: TokenPriceEntry;
        USDC: TokenPriceEntry;
        RAY: TokenPriceEntry;
        BONK: TokenPriceEntry;
    };
    spreads: Record<string, SpreadEntry>;
    executionQuote?: ExecutionQuote;
}

/** Simplified for UI display */
export interface TokenPrice {
    symbol: string;
    price: number;
    change24h: number;
    direction: "up" | "down" | "flat";
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

/** Matches backend LeaderboardEntry schema */
export interface LeaderboardEntry {
    rank: number;
    agentId: AgentId;
    name: string;
    netPnLUsd: number;           // USD (not SOL)
    netPnLPct: number;
    liveValueUsd: number;
    baselineUsd: number;
    solBalance: number;
    usdcBalance: number;
    rayBalance: number;
    bonkBalance: number;
    swapCount: number;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditSeverity = "info" | "success" | "warning" | "error" | "system";

export interface AuditEntry {
    id: string;
    timestamp: string;
    agentId: AgentId | "sys";
    agentLabel: string;
    message: string;
    severity: AuditSeverity;
    txLink?: string;
    rawEvent: string;
    data: Record<string, unknown>;
}

// ─── Proof-of-Reasoning ───────────────────────────────────────────────────────

export type ProofStatus = "verified" | "pending" | "failed";

/** Matches backend ProofRecord stored on-chain */
export interface ProofRecord {
    id: string;
    blockNumber: string;
    hash: string;
    memoSignature?: string;
    confidence: number | null;
    status: ProofStatus;
    agentId: AgentId;
    timestamp: string;
    cycle?: number;
}

// ─── Policy Check ─────────────────────────────────────────────────────────────

/** Matches backend policy engine check result */
export interface PolicyCheck {
    id: number;
    name: string;            // e.g. "action_whitelist"
    label: string;           // display label
    detail?: string;
    status: "pass" | "fail" | "warn";
}

// ─── Strategist / Guardian ────────────────────────────────────────────────────

export interface StrategistLine {
    type: "comment" | "pass" | "warn" | "result";
    text: string;
}

/** Matches backend strategist decision */
export interface StrategistDecision {
    decision: "SWAP" | "HOLD" | "SKIP";
    fromToken?: string;
    toToken?: string;
    amount?: number;
    confidence: number;
    reasoning: string;
    riskFlags: string[];
}

/** Guardian verdict */
export interface GuardianVerdict {
    verdict: "APPROVE" | "VETO" | "MODIFY";
    challenge: string;
    modifiedAmount?: number;
}

// ─── WebSocket Event ──────────────────────────────────────────────────────────

/** SolusEvent envelope from the backend event bus */
export interface SolusEvent {
    type: string;
    agentId: AgentId;
    timestamp: number;
    payload: Record<string, unknown>;
}

// ─── System Stats ─────────────────────────────────────────────────────────────

export interface SystemStats {
    load: number;
    latencyMs: number;
    verifiersOnline: number;
    verifiersTotal: number;
    network: "Devnet" | "Mainnet";
    rpcConnected: boolean;
    koraConnected: boolean;
    pricesFresh: boolean;
}

// ─── Transaction History & Proof Verification ───────────────────────────────────

export interface TxRecord {
    signature: string;
    agentId: AgentId;
    fromToken: string;
    toToken: string;
    amountIn: number;
    amountOut: number;
    timestamp: number;
    cycle: number;
    proofHash?: string;
}

export interface ProofVerificationEntry {
    agentId: AgentId;
    event: string;
    cycle: number;
    data: {
        cycle: number;
        agentId: string;
        timestamp: number;
        strategistDecision: {
            decision: string;
            fromToken: string;
            toToken: string;
            amount: number;
            confidence: number;
            reasoning: string;
            riskFlags: string[];
        };
        guardianVerdict: {
            verdict: string;
            challenge: string;
            modifiedAmount: number | null;
        };
        policyChecks: Array<{
            name: string;
            passed: boolean;
            reason: string;
            adjustedValue?: number;
        }>;
        priceSnapshot: {
            timestamp: number;
            stale: boolean;
            prices: Record<string, { usd: number; change24h: number }>;
            spreads: Record<string, { spreadPct: number; direction: string }>;
            executionQuote?: {
                fromToken: string;
                toToken: string;
                inAmount: number;
                outAmount: number;
                impliedPrice: number;
                priceImpactPct: number;
                netSpreadVsMarket: number;
                worthTrading: boolean;
                slippageBps: number;
                fetchedAt: number;
            };
        };
        hash?: string;
        memoSignature?: string;
        payloadSummary?: string;
    };
    ts: number;
}

export interface ProofVerificationResult {
    entry: ProofVerificationEntry;
    verified: boolean;
}
