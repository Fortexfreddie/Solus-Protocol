/**
 * agent.controller.ts
 * REST controller handlers for all Solus Protocol API endpoints.
 *
 * Each handler is a standalone function that can be mounted by the router.
 * Read-only endpoints serve agent state; write endpoints support the Agent
 * Command Center (kill switch, force run) and the PnL Leaderboard.
 */

import type { Request, Response } from 'express';

import { getSolanaRPC } from '../../protocol/solana-rpc.js';
import { getKoraPaymaster } from '../../protocol/kora-paymaster.js';
import { priceCache } from '../../price/price-cache.js';
import { getAuditLogger } from '../../security/audit-logger.js';
import { policyEngine } from '../../security/policy-engine.js';
import { proofService } from '../../proof/proof-service.js';
import { getOrchestrator } from '../../agent/agent-orchestrator.js';
import { AGENT_PROFILES } from '../../agent/agent-profiles.js';
import { eventBus } from '../../events/event-bus.js';
import type { AgentId, OperationalStatus, ProofPayload } from '../../types/agent-types.js';

const AGENT_IDS: AgentId[] = ['rex', 'nova', 'sage'];

//  Health 

export async function getHealth(_req: Request, res: Response): Promise<void> {
    try {
        const [rpcStatus, koraStatus] = await Promise.allSettled([
            getSolanaRPC().ping(),
            getKoraPaymaster().verifyConnection(),
        ]);

        const rpc = rpcStatus.status === 'fulfilled' ? rpcStatus.value : { slot: null, latencyMs: null };
        const kora = koraStatus.status === 'fulfilled' ? koraStatus.value : { connected: false };

        const prices = priceCache.get();
        const orchestrator = getOrchestrator();

        res.json({
            status: 'ok',
            timestamp: Date.now(),
            rpc: { connected: rpcStatus.status === 'fulfilled', ...rpc },
            kora: { ...kora },
            prices: { fresh: priceCache.isFresh(), stale: prices?.stale ?? true },
            agents: orchestrator.getAgentStatus(),
            ws: { ready: eventBus.isReady() },
        });
    } catch (err) {
        res.status(500).json({ status: 'error', error: (err as Error).message });
    }
}

//  Agents 

export function getAgents(_req: Request, res: Response): void {
    const orchestrator = getOrchestrator();
    const status = orchestrator.getAgentStatus();

    const agents = AGENT_IDS.map((id) => ({
        agentId: id,
        profile: AGENT_PROFILES[id],
        cycleCount: status[id].cycleCount,
        publicKey: status[id].publicKey,
        operationalStatus: status[id].operationalStatus,
        rateLimit: policyEngine.getRateLimitStatus(id),
    }));

    res.json({ agents });
}

export function getAgentById(req: Request, res: Response): void {
    const agentId = req.params['id'] as AgentId;
    if (!AGENT_IDS.includes(agentId)) {
        res.status(404).json({ error: `Unknown agent: ${agentId}` });
        return;
    }

    const orchestrator = getOrchestrator();
    const status = orchestrator.getAgentStatus();

    res.json({
        agentId,
        profile: AGENT_PROFILES[agentId],
        cycleCount: status[agentId].cycleCount,
        publicKey: status[agentId].publicKey,
        operationalStatus: status[agentId].operationalStatus,
        rateLimit: policyEngine.getRateLimitStatus(agentId),
    });
}

export async function getAgentBalance(req: Request, res: Response): Promise<void> {
    const agentId = req.params['id'] as AgentId;
    if (!AGENT_IDS.includes(agentId)) {
        res.status(404).json({ error: `Unknown agent: ${agentId}` });
        return;
    }

    try {
        const agent = getOrchestrator().getAgent(agentId);
        const balance = await agent.getBalance();
        res.json({ agentId, balance });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
}

export function getAgentHistory(req: Request, res: Response): void {
    const agentId = req.params['id'] as AgentId;
    if (!AGENT_IDS.includes(agentId)) {
        res.status(404).json({ error: `Unknown agent: ${agentId}` });
        return;
    }

    const limit = parseInt(req.query['limit'] as string ?? '20', 10);
    const txs = getAuditLogger().getLastNTransactions(limit, agentId);
    res.json({ agentId, transactions: txs, count: txs.length });
}

//  Agent Command Center — Kill Switch + Force Run 

/**
 * PATCH /api/agents/:id/status
 * Pauses or resumes a single agent. Takes effect on the next scheduled cycle.
 * Body: { "status": "ACTIVE" | "PAUSED" }
 */
export function patchAgentStatus(req: Request, res: Response): void {
    const agentId = req.params['id'] as AgentId;
    if (!AGENT_IDS.includes(agentId)) {
        res.status(404).json({ error: `Unknown agent: ${agentId}` });
        return;
    }

    const { status } = req.body as { status?: string };
    if (!status || !['ACTIVE', 'PAUSED'].includes(status)) {
        res.status(400).json({ error: 'Invalid status. Must be ACTIVE or PAUSED.' });
        return;
    }

    try {
        const orchestrator = getOrchestrator();
        orchestrator.setOperationalStatus(agentId, status as OperationalStatus);
        res.json({ agentId, status, updatedAt: Date.now() });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
}

/**
 * POST /api/agents/:id/run
 * Triggers an immediate out-of-schedule cycle for a single agent.
 * Returns 202 immediately — cycle runs asynchronously.
 * 403 if agent is PAUSED. 429 if last cycle started within 15 seconds.
 */
export async function postAgentRun(req: Request, res: Response): Promise<void> {
    const agentId = req.params['id'] as AgentId;
    if (!AGENT_IDS.includes(agentId)) {
        res.status(404).json({ error: `Unknown agent: ${agentId}` });
        return;
    }

    try {
        await getOrchestrator().triggerCycle(agentId);
        res.status(202).json({
            agentId,
            message: 'Cycle triggered. Watch the dashboard for live updates.',
            triggeredAt: Date.now(),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';

        // PAUSED agent returns 403 Forbidden.
        if (message.includes('PAUSED')) {
            res.status(403).json({ error: message });
            return;
        }

        // Cooldown violation returns 429 Too Many Requests.
        if (message.includes('cooldown')) {
            res.status(429).json({ error: message });
            return;
        }

        res.status(500).json({ error: message });
    }
}

//  Proofs 

export async function getProofs(_req: Request, res: Response): Promise<void> {
    const proofs = await getAuditLogger().getProofRecords();
    res.json({ proofs, count: proofs.length });
}

export async function getProofByHash(req: Request, res: Response): Promise<void> {
    const hash = req.params['hash'] as string;
    const entry = await getAuditLogger().getProofByHash(hash);

    if (!entry) {
        res.status(404).json({ error: `Proof not found for hash: ${hash}` });
        return;
    }

    const proofData = entry.data as Record<string, unknown>;

    // Dev mode: payload is nested under data.payload
    // Production: data IS the payload directly (from DB ProofRecord.payload)
    const payload = (proofData['payload'] ?? (proofData['strategistDecision'] ? proofData : undefined)) as unknown as ProofPayload;
    const verified = payload ? proofService.verify(payload, hash) : false;

    res.json({ entry, verified });
}

//  Logs 

export async function getLogs(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query['page'] as string ?? '1', 10);
    const limit = parseInt(req.query['limit'] as string ?? '50', 10);
    const result = await getAuditLogger().getPaginated(page, limit);
    res.json({ ...result, page, limit });
}

//  Prices 

export function getPrices(_req: Request, res: Response): void {
    const prices = priceCache.get() ?? priceCache.getStale();
    if (!prices) {
        res.status(503).json({ error: 'Price data not yet available. Cache is empty.' });
        return;
    }
    res.json({ prices, fresh: priceCache.isFresh() });
}

//  Leaderboard 

/**
 * GET /api/leaderboard
 * Returns all three agents ranked by net PnL descending.
 * PnL = current portfolio USD value minus starting baseline USD value.
 * Uses live portfolio valuation (SOL + USDC + RAY + BONK at live prices)
 * rather than per-trade slippage math.
 */
export async function getLeaderboard(_req: Request, res: Response): Promise<void> {
    try {
        const prices = priceCache.get() ?? priceCache.getStale();
        if (!prices) {
            res.status(503).json({ error: 'Price data not yet available.' });
            return;
        }

        const livePrices = prices.prices;
        const orchestrator = getOrchestrator();
        const logger = getAuditLogger();

        const leaderboard = await Promise.all(
            AGENT_IDS.map(async (agentId) => {
                const agent = orchestrator.getAgent(agentId);
                const balance = await agent.getBalance();

                // Baseline is the actual SOL balance snapshotted at server
                // startup, valued at the current live SOL price.
                const initialSol = orchestrator.getInitialBalance(agentId);
                const baselineUsd = initialSol * livePrices.SOL.usd;

                // Total portfolio value in USD using live prices.
                // USDC is treated as $1.00 exactly to avoid peg noise.
                const solBalance = balance.sol;
                const usdcBalance = balance.tokens.USDC ?? 0;
                const rayBalance = balance.tokens.RAY ?? 0;
                const bonkBalance = balance.tokens.BONK ?? 0;

                const liveValueUsd =
                    solBalance * livePrices.SOL.usd +
                    usdcBalance +                       // $1.00 peg
                    rayBalance * livePrices.RAY.usd +
                    bonkBalance * livePrices.BONK.usd;

                const netPnLUsd = Number((liveValueUsd - baselineUsd).toFixed(4));
                const netPnLPct = baselineUsd > 0
                    ? Number(((netPnLUsd / baselineUsd) * 100).toFixed(2))
                    : 0;

                const swaps = await logger.getConfirmedSwaps();
                const swapCount = swaps.filter((s) => s.agentId === agentId).length;

                return {
                    agentId,
                    netPnLUsd,
                    netPnLPct,
                    swapCount,
                    liveValueUsd: Number(liveValueUsd.toFixed(4)),
                    baselineUsd: Number(baselineUsd.toFixed(4)),
                    operationalStatus: orchestrator.getOperationalStatus(agentId),
                    balances: { sol: solBalance, usdc: usdcBalance, ray: rayBalance, bonk: bonkBalance },
                };
            }),
        );

        // Rank by net PnL descending.
        leaderboard.sort((a, b) => b.netPnLUsd - a.netPnLUsd);

        res.json({ leaderboard, generatedAt: Date.now() });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Leaderboard query failed';
        res.status(500).json({ error: message });
    }
}
