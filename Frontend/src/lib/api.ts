// src/lib/api.ts
// Central API client for Solus Protocol backend.
// All REST calls go through apiFetch with retry, timeout, and typed errors.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
// Health endpoint is at server root, not under /api
const SERVER_BASE = API_BASE.replace(/\/api$/, "");

// ─── Error class ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// ─── Retry-aware fetch ────────────────────────────────────────────────────────

interface FetchOptions extends RequestInit {
    retries?: number;
    retryDelay?: number;
}

async function apiFetch<T>(
    path: string,
    options: FetchOptions = {},
    base = API_BASE,
): Promise<T> {
    const { retries = 3, retryDelay = 1000, ...init } = options;
    const url = `${base}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                ...init,
                headers: {
                    "Content-Type": "application/json",
                    ...init.headers,
                },
            });

            // Don't retry 4xx client errors
            if (res.status >= 400 && res.status < 500) {
                const body = await res.json().catch(() => ({}));
                throw new ApiError(res.status, body.error ?? res.statusText);
            }

            // Retry 5xx server errors
            if (!res.ok) {
                throw new ApiError(res.status, `Server error: ${res.status}`);
            }

            return (await res.json()) as T;
        } catch (err) {
            lastError = err as Error;

            // Don't retry client errors (4xx)
            if (err instanceof ApiError && err.status < 500) {
                throw err;
            }

            // Retry with exponential backoff
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, retryDelay * 2 ** attempt));
            }
        }
    }

    throw lastError ?? new Error("Request failed");
}

// ─── API Methods ──────────────────────────────────────────────────────────────

// Types for API responses
export interface AgentSummary {
    agentId: string;
    profile: {
        agentId: string;
        name: string;
        riskProfile: "aggressive" | "conservative" | "balanced";
        cycleOffsetSeconds: number;
        cycleIntervalSeconds: number;
        spreadThresholdPct: number;
        minConfidence: number;
        maxTxAmountSol: number;
        dailyVolumeCapSol: number;
        stopLossTriggerPct: number;
        llmDirective: string;
    };
    cycleCount: number;
    publicKey: string;
    operationalStatus: "ACTIVE" | "PAUSED";
    rateLimit: { used: number; limit: number; windowMs: number };
}

export interface AgentBalanceResponse {
    agentId: string;
    balance: {
        sol: number;
        tokens: Partial<Record<string, number>>;
        fetchedAt: number;
    };
}

export interface HealthResponse {
    status: string;
    timestamp: number;
    rpc: { connected: boolean; slot: number | null; latencyMs: number | null };
    kora: { connected: boolean; signerAddress?: string | null; latencyMs?: number | null };
    prices: { fresh: boolean; stale: boolean };
    agents: Record<string, { cycleCount: number; publicKey: string; operationalStatus: string }>;
    ws: { ready: boolean };
}

export interface PriceResponse {
    prices: {
        timestamp: number;
        stale: boolean;
        prices: Record<string, { usd: number; change24h: number }>;
        spreads: Record<string, { spreadPct: number; direction: string }>;
        executionQuote?: Record<string, unknown>;
    };
    fresh: boolean;
}

export interface LeaderboardEntry {
    agentId: string;
    netPnLUsd: number;
    netPnLPct: number;
    swapCount: number;
    liveValueUsd: number;
    baselineUsd: number;
    operationalStatus: string;
    balances: { sol: number; usdc: number; ray: number; bonk: number };
}

export interface LeaderboardResponse {
    leaderboard: LeaderboardEntry[];
    generatedAt: number;
}

export interface ProofResponse {
    proofs: Array<{
        hash: string;
        memoSignature: string;
        payloadSummary: string;
        payload: {
            agentId: string;
            cycle: number;
            timestamp: number;
            strategistDecision: Record<string, unknown>;
            guardianVerdict: Record<string, unknown>;
            policyChecks: Array<Record<string, unknown>>;
            priceSnapshot: Record<string, unknown>;
        };
        anchoredAt: number;
    }>;
    count: number;
}

export interface LogsResponse {
    entries: Array<{
        ts: number;
        agentId: string;
        cycle: number;
        event: string;
        data: Record<string, unknown>;
    }>;
    total: number;
    page: number;
    limit: number;
}

// ─── Endpoint functions ───────────────────────────────────────────────────────

/** GET /api/agents — all agent profiles + status */
export function getAgents() {
    return apiFetch<{ agents: AgentSummary[] }>("/agents");
}

/** GET /api/agents/:id/balance — live on-chain balance */
export function getAgentBalance(id: string) {
    return apiFetch<AgentBalanceResponse>(`/agents/${id}/balance`);
}

/** GET /health — full system health */
export function getHealth() {
    return apiFetch<HealthResponse>("/health", {}, SERVER_BASE);
}

/** GET /api/prices — cached price data */
export function getPrices() {
    return apiFetch<PriceResponse>("/prices");
}

/** GET /api/leaderboard — ranked agents by PnL */
export function getLeaderboard() {
    return apiFetch<LeaderboardResponse>("/leaderboard");
}

/** GET /api/proofs — all proof-of-reasoning records */
export function getProofs() {
    return apiFetch<ProofResponse>("/proofs");
}

/** GET /api/logs — paginated audit log */
export function getLogs(page = 1, limit = 50) {
    return apiFetch<LogsResponse>(`/logs?page=${page}&limit=${limit}`);
}

/** PATCH /api/agents/:id/status — kill switch */
export function patchAgentStatus(id: string, status: "ACTIVE" | "PAUSED") {
    return apiFetch<{ agentId: string; status: string; updatedAt: number }>(
        `/agents/${id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }), retries: 1 },
    );
}

/** POST /api/agents/:id/run — force run */
export function postForceRun(id: string) {
    return apiFetch<{ agentId: string; message: string; triggeredAt: number }>(
        `/agents/${id}/run`,
        { method: "POST", retries: 0 },
    );
}

/** GET /api/agents/:id/history — recent transactions */
export function getAgentHistory(id: string, limit = 20) {
    return apiFetch<{ agentId: string; transactions: import("@/types").TxRecord[]; count: number }>(
        `/agents/${id}/history?limit=${limit}`
    );
}

/** GET /api/proofs/:hash — verify an anchored proof hash */
export function verifyProof(hash: string) {
    return apiFetch<import("@/types").ProofVerificationResult>(`/proofs/${hash}`);
}
