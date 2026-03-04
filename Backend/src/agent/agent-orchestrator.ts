/**
 * agent-orchestrator.ts
 * Manages the lifecycle of all three autonomous agents with staggered cycle timing.
 *
 * The orchestrator starts Rex, Nova, and Sage on offset intervals so the dashboard
 * always has at least one agent mid-pipeline — producing a continuous stream of
 * WebSocket events for live visualization rather than three agents all starting
 * simultaneously and leaving long idle gaps between cycles.
 *
 * Stagger schedule (from master spec):
 *   Rex:  T+0s  then every 60 seconds
 *   Nova: T+20s then every 60 seconds
 *   Sage: T+40s then every 60 seconds
 *
 * Cycle overlap is safe by design — each agent is completely isolated with its
 * own Vault, profile, and rate limiter. No shared mutable state between agents.
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Agent } from './agent';
import { AGENT_PROFILES } from './agent-profiles';
import { getAuditLogger } from '../security/audit-logger';
import { eventBus } from '../events/event-bus';
import { getSolanaRPC } from '../protocol/solana-rpc';
import type { AgentId, OperationalStatus } from '../types/agent-types';
import { getWalletStore } from '../wallet/wallet-store';

// Constants

const CYCLE_INTERVAL_MS = 60_000;

const AGENT_OFFSETS: Record<AgentId, number> = {
    rex: 0,
    nova: 20_000,
    sage: 40_000,
};

// AgentOrchestrator class

export class AgentOrchestrator {
    private readonly agents: Record<AgentId, Agent>;
    private readonly timers: ReturnType<typeof setTimeout>[] = [];
    private readonly intervals: ReturnType<typeof setInterval>[] = [];
    private running = false;

    // Kill Switch state — tracks whether each agent is ACTIVE or PAUSED.
    private readonly operationalStatus: Map<AgentId, OperationalStatus> = new Map([
        ['rex', 'ACTIVE'],
        ['nova', 'ACTIVE'],
        ['sage', 'ACTIVE'],
    ]);

    // Force Run cooldown — tracks the last cycle start time per agent to
    // prevent rapid-fire API abuse during demos.
    private readonly lastCycleStartedAt: Map<AgentId, number> = new Map([
        ['rex', 0],
        ['nova', 0],
        ['sage', 0],
    ]);

    // Initial SOL balance snapshot — captured once at startup, used as the
    // PnL baseline so the leaderboard reflects actual starting balances.
    private readonly initialBalanceSol: Map<AgentId, number> = new Map();

    /**
     * Private constructor — use `AgentOrchestrator.init()` instead.
     * Agents require async vault initialization (DB or filesystem).
     */
    private constructor(agents: Record<AgentId, Agent>) {
        this.agents = agents;
    }

    /**
     * Async factory — initializes all three agents (loads/creates vaults).
     * Vault loading is now async to support both filesystem and DB backends.
     */
    static async init(): Promise<AgentOrchestrator> {
        const [rex, nova, sage] = await Promise.all([
            Agent.create(AGENT_PROFILES['rex']),
            Agent.create(AGENT_PROFILES['nova']),
            Agent.create(AGENT_PROFILES['sage']),
        ]);

        const orchestrator = new AgentOrchestrator({ rex, nova, sage });

        // Auto-fund agents if below minimum SOL for Memo gas (Layer 5).
        // Each Memo tx costs ~5,000 lamports. 0.1 SOL threshold ensures
        // agents can run thousands of cycles before needing another airdrop.
        const MIN_SOL_FOR_GAS = 0.1;
        const rpc = getSolanaRPC();
        const connection = rpc.getConnection();
        for (const id of ['rex', 'nova', 'sage'] as AgentId[]) {
            const pubkey = new PublicKey(orchestrator.agents[id].getPublicKey());
            const currentBal = await connection.getBalance(pubkey, 'confirmed') / LAMPORTS_PER_SOL;
            if (currentBal < MIN_SOL_FOR_GAS) {
                try {
                    console.log(`      ⬆ ${id.toUpperCase().padEnd(5)} — balance ${currentBal.toFixed(4)} SOL < ${MIN_SOL_FOR_GAS} SOL, requesting airdrop...`);
                    const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
                    await connection.confirmTransaction(sig, 'confirmed');
                    console.log(`      ✓ ${id.toUpperCase().padEnd(5)} — airdrop confirmed (sig: ${sig.slice(0, 20)}...)`);
                } catch (err) {
                    console.warn(`      ⚠ ${id.toUpperCase().padEnd(5)} — airdrop failed (non-fatal): ${(err as Error).message}`);
                    console.warn(`  Fund manually via faucet.solana.com or pnpm smoke:vault`);
                }
            } else {
                console.log(`  ✓ ${id.toUpperCase()} — ${currentBal.toFixed(4)} SOL (funded)`);
            }
        }

        // Load or snapshot each agent's starting SOL balance.
        // Priority: persisted value (survives redeploy) > live on-chain > fallback 2 SOL.
        const store = getWalletStore();
        for (const id of ['rex', 'nova', 'sage'] as AgentId[]) {
            const persisted = await store.getStartingBalance(id);
            if (persisted !== null) {
                orchestrator.initialBalanceSol.set(id, persisted);
            } else {
                try {
                    const bal = await orchestrator.agents[id].getBalance();
                    orchestrator.initialBalanceSol.set(id, bal.sol);
                    // Persist so this survives future restarts / redeploys.
                    await store.saveStartingBalance(id, bal.sol);
                } catch {
                    orchestrator.initialBalanceSol.set(id, 2);
                }
            }
        }

        return orchestrator;
    }

    // Lifecycle

    /**
     * Starts all three agents with their staggered offsets.
     * Safe to call only once — subsequent calls are no-ops.
     */
    start(): void {
        if (this.running) return;
        this.running = true;

        const logger = getAuditLogger();

        for (const agentId of (['rex', 'nova', 'sage'] as AgentId[])) {
            const agent = this.agents[agentId];
            const offset = AGENT_OFFSETS[agentId];

            logger.log({
                agentId,
                cycle: 0,
                event: 'ORCHESTRATOR_START',
                data: { offset, cycleInterval: CYCLE_INTERVAL_MS },
            });

            // Start the agent after its stagger offset, then repeat every 60 seconds.
            const timer = setTimeout(() => {
                // First cycle fires immediately after the offset.
                void this.runAgentCycle(agent);

                // Subsequent cycles on a fixed 60-second interval.
                const interval = setInterval(() => {
                    void this.runAgentCycle(agent);
                }, CYCLE_INTERVAL_MS);

                this.intervals.push(interval);
            }, offset);

            this.timers.push(timer);
        }
    }

    /**
     * Stops all agent cycles immediately.
     * Clears all timers and intervals. In-flight cycles are not interrupted —
     * they complete normally and no new cycles are scheduled.
     */
    stop(): void {
        for (const timer of this.timers) clearTimeout(timer);
        for (const interval of this.intervals) clearInterval(interval);
        this.timers.length = 0;
        this.intervals.length = 0;
        this.running = false;
    }

    // Status

    isRunning(): boolean { return this.running; }

    getAgentStatus(): Record<AgentId, { cycleCount: number; publicKey: string; operationalStatus: OperationalStatus }> {
        return {
            rex: { cycleCount: this.agents.rex.getCycleCount(), publicKey: this.agents.rex.getPublicKey(), operationalStatus: this.operationalStatus.get('rex')! },
            nova: { cycleCount: this.agents.nova.getCycleCount(), publicKey: this.agents.nova.getPublicKey(), operationalStatus: this.operationalStatus.get('nova')! },
            sage: { cycleCount: this.agents.sage.getCycleCount(), publicKey: this.agents.sage.getPublicKey(), operationalStatus: this.operationalStatus.get('sage')! },
        };
    }

    /**
     * Returns the SOL balance that was snapshotted at startup for the given
     * agent. Used as the PnL baseline in the leaderboard.
     */
    getInitialBalance(agentId: AgentId): number {
        return this.initialBalanceSol.get(agentId) ?? 2;
    }

    getAgent(agentId: AgentId): Agent {
        return this.agents[agentId];
    }

    // Agent Command Center — Kill Switch + Force Run

    /**
     * Sets the operational status of a single agent (ACTIVE or PAUSED).
     * Takes effect on the very next scheduled cycle — in-flight cycles
     * complete normally.
     */
    setOperationalStatus(agentId: AgentId, status: OperationalStatus): void {
        if (!this.agents[agentId]) {
            throw new Error(`Agent ${agentId} not found.`);
        }
        this.operationalStatus.set(agentId, status);

        eventBus.emit('AGENT_COMMAND', agentId, {
            command: 'SET_STATUS',
            status,
            updatedAt: Date.now(),
        });

        getAuditLogger().log({
            agentId,
            cycle: this.agents[agentId].getCycleCount(),
            event: 'AGENT_STATUS_CHANGE',
            data: { newStatus: status },
        });
    }

    /**
     * Returns the current operational status of an agent.
     */
    getOperationalStatus(agentId: AgentId): OperationalStatus {
        return this.operationalStatus.get(agentId) ?? 'ACTIVE';
    }

    /**
     * Triggers an immediate out-of-schedule cycle for a single agent.
     * Rejects if the agent is on cooldown (15 seconds) or if the agent is PAUSED.
     */
    async triggerCycle(agentId: AgentId): Promise<void> {
        if (!this.agents[agentId]) {
            throw new Error(`Agent ${agentId} not found.`);
        }

        if (this.operationalStatus.get(agentId) === 'PAUSED') {
            throw new Error(`Agent ${agentId} is PAUSED. Resume the agent before triggering a manual cycle.`);
        }

        const COOLDOWN_MS = 15_000;
        const lastStart = this.lastCycleStartedAt.get(agentId) ?? 0;
        const elapsed = Date.now() - lastStart;

        if (elapsed < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
            throw new Error(
                `Agent ${agentId} cycle cooldown active. ${remaining}s remaining.`,
            );
        }

        eventBus.emit('AGENT_COMMAND', agentId, {
            command: 'FORCE_RUN',
            triggeredAt: Date.now(),
        });

        // Run the cycle asynchronously — do not block the HTTP response.
        this.runAgentCycle(this.agents[agentId]).catch((err) => {
            getAuditLogger().log({
                agentId,
                cycle: this.agents[agentId].getCycleCount(),
                event: 'MANUAL_CYCLE_ERROR',
                data: { error: (err as Error).message },
            });
        });
    }

    // Internal

    /**
     * Fires one agent cycle and catches any unexpected errors so they can never
     * crash the interval timer or prevent the next cycle from starting.
     */
    private async runAgentCycle(agent: Agent): Promise<void> {
        const agentId = agent.getAgentId();

        // Kill Switch: skip the cycle if the agent is PAUSED.
        if (this.operationalStatus.get(agentId) === 'PAUSED') {
            eventBus.emit('AGENT_STATUS', agentId, {
                status: 'skipped_paused',
                cycle: agent.getCycleCount(),
            });
            return;
        }

        // Record cycle start time for Force Run cooldown calculations.
        this.lastCycleStartedAt.set(agentId, Date.now());

        try {
            await agent.runCycle();
        } catch (err) {
            getAuditLogger().log({
                agentId,
                cycle: agent.getCycleCount(),
                event: 'ORCHESTRATOR_CYCLE_ERROR',
                data: { error: (err as Error).message },
            });
        }
    }
}

// Singleton

let _orchestrator: AgentOrchestrator | null = null;

/**
 * Returns the orchestrator singleton.
 * Must be called AFTER initOrchestrator() has completed.
 */
export function getOrchestrator(): AgentOrchestrator {
    if (!_orchestrator) {
        throw new Error(
            '[Orchestrator] Not initialized. Call initOrchestrator() during startup first.',
        );
    }
    return _orchestrator;
}

/**
 * Creates and caches the orchestrator singleton.
 * Called once during startup — loads/creates vaults for all three agents.
 */
export async function initOrchestrator(): Promise<AgentOrchestrator> {
    if (!_orchestrator) {
        _orchestrator = await AgentOrchestrator.init();
    }
    return _orchestrator;
}