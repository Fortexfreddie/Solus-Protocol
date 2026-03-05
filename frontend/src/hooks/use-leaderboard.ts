import useSWR from "swr";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import type { LeaderboardEntry as UILeaderboardEntry, AgentId } from "@/types";

const AGENT_NAMES: Record<string, string> = {
    rex: "Agent Rex",
    nova: "Agent Nova",
    sage: "Agent Sage",
};

async function fetchLeaderboard(): Promise<UILeaderboardEntry[]> {
    const { leaderboard } = await getLeaderboard();

    return leaderboard.map(
        (entry: LeaderboardEntry, i: number): UILeaderboardEntry => ({
            rank: i + 1,
            agentId: entry.agentId as AgentId,
            name: AGENT_NAMES[entry.agentId] ?? entry.agentId,
            netPnLUsd: entry.netPnLUsd,
            netPnLPct: entry.netPnLPct,
            liveValueUsd: entry.liveValueUsd,
            baselineUsd: entry.baselineUsd,
            solBalance: entry.balances.sol,
            usdcBalance: entry.balances.usdc,
            rayBalance: entry.balances.ray,
            bonkBalance: entry.balances.bonk,
            swapCount: entry.swapCount,
        })
    );
}

export function useLeaderboard() {
    const { data, error, isLoading, mutate } = useSWR<UILeaderboardEntry[]>(
        "leaderboard",
        fetchLeaderboard,
        {
            refreshInterval: 15_000,
            revalidateOnFocus: false,
            dedupingInterval: 10_000,
        }
    );

    return {
        entries: data ?? [],
        isLoading,
        error,
        mutate,
    };
}
