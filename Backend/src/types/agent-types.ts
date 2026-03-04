// src/types/agent-types.ts
// Central type definitions for Solus Protocol — all shared interfaces defined upfront

import type { PublicKey } from '@solana/web3.js';

// Agent Identity 
export type AgentId = 'rex' | 'nova' | 'sage';
export type RiskProfile = 'aggressive' | 'conservative' | 'balanced';
export type TokenSymbol = 'SOL' | 'USDC' | 'RAY' | 'BONK';
export type DecisionAction = 'SWAP' | 'HOLD' | 'SKIP';
export type AgentStatus = 'IDLE' | 'THINKING' | 'AUDITING' | 'EXECUTING' | 'ERROR';
export type OperationalStatus = 'ACTIVE' | 'PAUSED';
export type GuardianVerdict = 'APPROVE' | 'VETO' | 'MODIFY';

// Agent Personality Profile 

export interface PersonalityProfile {
    agentId: AgentId;
    name: string;
    riskProfile: RiskProfile;
    cycleOffsetSeconds: number;         // Rex: 0, Nova: 20, Sage: 40
    cycleIntervalSeconds: number;        // 60 for all agents
    spreadThresholdPct: number;          // Rex: 0.5, Nova: 1.0, Sage: 0.75
    minConfidence: number;               // Rex: 0.65, Nova: 0.85, Sage: 0.75
    maxTxAmountSol: number;              // Rex: 0.2, Nova: 0.05, Sage: 0.1
    dailyVolumeCapSol: number;           // Rex: 1.0, Nova: 0.3, Sage: 0.5
    stopLossTriggerPct: number;          // Rex: -20, Nova: -10, Sage: -15
    llmDirective: string;
}

// Price Oracle 

export interface TokenPrice {
    usd: number;
    change24h: number;
}

export interface SpreadData {
    spreadPct: number;
    direction: string;
}

/**
 * ExecutionQuote
 * Real execution pricing from Jupiter Quote API.
 * Represents what an agent would actually receive for a given swap
 * at current pool depth, including slippage and price impact.
 */
export interface ExecutionQuote {
    fromToken: string;
    toToken: string;
    inAmount: number;               // Input in human units (e.g. 0.1 SOL)
    outAmount: number;              // Output in human units (e.g. 18.54 USDC)
    impliedPrice: number;           // outAmount / inAmount — execution rate
    priceImpactPct: number;         // Jupiter's price impact estimate
    slippageBps: number;            // Slippage tolerance used for the quote
    netSpreadVsMarket: number;      // (impliedPrice - marketPrice) / marketPrice
    worthTrading: boolean;          // netSpreadVsMarket > 0 after slippage
    fetchedAt: number;              // Unix ms — quotes expire quickly
    error?: string;                 // Set if Jupiter quote fetch failed
}

export interface PriceData {
    timestamp: number;
    stale: boolean;
    prices: Record<TokenSymbol, TokenPrice>;
    spreads: Record<string, SpreadData>;
    executionQuote?: ExecutionQuote; // Populated per cycle — Jupiter execution quote
}

// Strategist / LLM Decision 
export interface StrategistDecision {
    decision: DecisionAction;
    fromToken: TokenSymbol;
    toToken: TokenSymbol;
    amount: number;
    confidence: number;
    reasoning: string;
    riskFlags: string[];
}

// Guardian Audit ─

export interface GuardianAudit {
    verdict: GuardianVerdict;
    challenge: string;
    modifiedAmount: number | null;
}

// Policy Engine 
export type PolicyCheckName =
    | 'ACTION_WHITELIST'
    | 'TOKEN_WHITELIST'
    | 'MIN_CONFIDENCE'
    | 'VOLATILITY_SIZING'
    | 'DAILY_VOLUME_CAP'
    | 'RATE_LIMIT'
    | 'BALANCE_CHECK'
    | 'SPREAD_THRESHOLD'
    | 'STOP_LOSS_CIRCUIT';

export interface PolicyCheck {
    name: PolicyCheckName;
    passed: boolean;
    reason: string;
    /**
     * If the check results in a modification rather than a hard reject/pass,
     * this carries the adjusted value (e.g., clamped tx amount).
     */
    adjustedValue?: number;
}

export type PolicyOutcome = 'APPROVED' | 'REJECTED' | 'FORCE_HOLD' | 'QUEUED' | 'RESTRICTED';

export interface PolicyResult {
    approved: boolean;
    outcome: PolicyOutcome;
    checks: PolicyCheck[];
    failedOn?: PolicyCheckName;
    reason?: string;
    /** Final (possibly adjusted) decision after policy modifications */
    finalDecision: StrategistDecision;
}

// Proof of Reasoning 

export interface ProofPayload {
    agentId: AgentId;
    cycle: number;
    timestamp: number;
    strategistDecision: StrategistDecision;
    guardianVerdict: GuardianAudit;
    policyChecks: PolicyCheck[];
    priceSnapshot: PriceData;
}

export interface ProofRecord {
    hash: string;
    memoSignature: string;
    payloadSummary: string;
    payload: ProofPayload;
    anchoredAt: number;
}

// Vault ─

export interface EncryptedVaultFile {
    version: 1;
    agentId: AgentId;
    publicKey: string;
    /** hex-encoded AES-256-GCM IV */
    iv: string;
    /** hex-encoded auth tag */
    authTag: string;
    /** hex-encoded ciphertext */
    ciphertext: string;
    /** PBKDF2 salt — hex-encoded */
    salt: string;
    createdAt: number;
}

export interface AgentBalance {
    sol: number;
    tokens: Partial<Record<TokenSymbol, number>>;
    fetchedAt: number;
}

// Transaction ─

export interface TxRecord {
    signature: string;
    agentId: AgentId;
    fromToken: TokenSymbol;
    toToken: TokenSymbol;
    amountIn: number;
    amountOut: number;
    timestamp: number;
    cycle: number;
    proofHash: string;
}

export interface TxConfirmation {
    signature: string;
    fromToken: TokenSymbol;
    toToken: TokenSymbol;
    amount: number;
    output: number;
    confirmedAt: number;
}

// WebSocket Event Envelope 

export type WsEventType =
    | 'AGENT_STATUS'
    | 'AGENT_COMMAND'
    | 'PRICE_FETCHED'
    | 'AGENT_THINKING'
    | 'LLM_PARSE_ERROR'
    | 'GUARDIAN_AUDIT'
    | 'POLICY_PASS'
    | 'POLICY_FAIL'
    | 'PROOF_ANCHORED'
    | 'TX_SIGNING'
    | 'KORA_SIGNED'
    | 'TX_SUBMITTED'
    | 'TX_CONFIRMED'
    | 'TX_FAILED'
    | 'BALANCE_UPDATE';

// Kora Paymaster ─

export interface KoraSignResult {
    /** Base64-encoded fully co-signed transaction from Kora */
    transaction: string;
}

export interface KoraStatus {
    connected: boolean;
    payerAddress: string | null;
    latencyMs: number | null;
}

export interface WsEventEnvelope<T = unknown> {
    type: WsEventType;
    agentId: AgentId;
    timestamp: number;
    payload: T;
}

// Vault Interface (public API only) 

export interface IVault {
    getPublicKey(): PublicKey;
    getBalance(): Promise<AgentBalance>;
    signTransaction(tx: Uint8Array): Promise<Uint8Array>;
    getHistory(limit?: number): Promise<TxRecord[]>;
}

// Audit Log Entry 

export interface AuditEntry {
    ts: number;
    agentId: AgentId;
    cycle: number;
    event: string;
    data: Record<string, unknown>;
}

// Confirmed Swap Entry (for leaderboard queries)

export interface ConfirmedSwapEntry {
    agentId: AgentId;
    fromToken: TokenSymbol;
    toToken: TokenSymbol;
    amount: number;
    output: number;
    priceSnapshot: Record<string, { usd: number }>;
    confirmedAt: number;
}

// Volatility Sizing Detail (emitted in Policy Check 4)

export interface VolatilitySizingDetail {
    baseAmount: number;
    confidence: number;
    priceChange24h: number;
    volatilityPenalty: number;
    approvedAmount: number;
}