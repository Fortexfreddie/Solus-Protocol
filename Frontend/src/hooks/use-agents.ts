import useSWR from "swr";
import { useMemo } from "react";
import { getAgents, getAgentBalance } from "@/lib/api";
import { useLeaderboard } from "@/hooks/use-leaderboard";
import { usePrices } from "@/hooks/use-prices";
import type { Agent, AgentId, PipelineStep } from "@/types";

const AGENT_NAMES: Record<string, string> = {
    rex: "Agent Rex",
    nova: "Agent Nova",
    sage: "Agent Sage",
};

const DEFAULT_PIPELINE: PipelineStep[] = [
    { id: "price", label: "Price Oracle", status: "pending" },
    { id: "signal", label: "Signal Analysis (L1b)", status: "pending" },
    { id: "strategist", label: "Strategist (DeepSeek)", status: "pending" },
    { id: "guardian", label: "Guardian (Gemini)", status: "pending" },
    { id: "policy", label: "Policy Engine (9 checks)", status: "pending" },
    { id: "proof", label: "Proof-of-Reasoning", status: "pending" },
    { id: "vault", label: "Vault Sign (AES-256)", status: "pending" },
];

// function truncateKey(key: string): string {
//     if (key.length <= 10) return key;
//     return `${key.slice(0, 4)}...${key.slice(-4)}`;
// }

interface RawAgentData {
    agent: any;
    solBalance: number;
    usdcBalance: number;
}

async function fetchAgentsAndBalances(): Promise<RawAgentData[]> {
    const { agents } = await getAgents();
    const balanceResults = await Promise.allSettled(
        agents.map((a) => getAgentBalance(a.agentId))
    );

    return agents.map((agent, i) => {
        const balResult = balanceResults[i];
        const balance = balResult?.status === "fulfilled" ? balResult.value.balance : null;
        return {
            agent,
            solBalance: balance?.sol ?? 0,
            usdcBalance: balance?.tokens?.USDC ?? 0,
        };
    });
}

export function useAgents() {
    const { entries: leaderboard } = useLeaderboard();
    const { prices } = usePrices();

    const { data: rawAgents, error, isLoading, mutate } = useSWR<RawAgentData[]>(
        "agents",
        fetchAgentsAndBalances,
        {
            refreshInterval: 10_000,
            revalidateOnFocus: false,
            dedupingInterval: 5_000,
        }
    );

    const agents = useMemo(() => {
        if (!rawAgents) return [];

        const solPrice = prices?.find(p => p.symbol === "SOL")?.price ?? 0;

        const leaderboardMap = new Map<string, any>();
        if (leaderboard) {
            for (const entry of leaderboard) {
                leaderboardMap.set(entry.agentId, entry);
            }
        }

        return rawAgents.map(({ agent, solBalance, usdcBalance }): Agent => {
            const lb = leaderboardMap.get(agent.agentId);
            const equity = lb?.liveValueUsd ?? (solBalance * solPrice + usdcBalance);
            const netPnLUsd = lb?.netPnLUsd ?? 0;
            const baselineUsd = lb?.baselineUsd ?? 0;
            const pnlPercent = baselineUsd > 0 ? (netPnLUsd / baselineUsd) * 100 : 0;

            return {
                id: agent.agentId as AgentId,
                name: AGENT_NAMES[agent.agentId] ?? agent.profile.name,
                publicKey: agent.publicKey,
                profile: {
                    agentId: agent.agentId as AgentId,
                    name: agent.profile.name,
                    riskProfile: agent.profile.riskProfile,
                    spreadThresholdPct: agent.profile.spreadThresholdPct,
                    minConfidence: agent.profile.minConfidence,
                    maxTxAmountSol: agent.profile.maxTxAmountSol,
                    dailyVolumeCapSol: agent.profile.dailyVolumeCapSol,
                    stopLossTriggerPct: agent.profile.stopLossTriggerPct,
                },
                operationalStatus: agent.operationalStatus,
                solBalance,
                usdcBalance,
                equity,
                netPnLUsd,
                pnlPercent,
                cycleCount: agent.cycleCount,
                pipeline: DEFAULT_PIPELINE.map((step) => ({ ...step })),
            };
        });
    }, [rawAgents, leaderboard, prices]);

    return {
        agents,
        isLoading,
        error,
        mutate,
    };
}
