import useSWR from "swr";
import { getAgentHistory } from "@/lib/api";
import type { AgentId, TxRecord } from "@/types";

export function useAgentHistory(agentId: AgentId, limit = 20) {
    const { data, error, isLoading, mutate } = useSWR<{ transactions: TxRecord[]; count: number }>(
        `agent-history-${agentId}-${limit}`,
        () => getAgentHistory(agentId, limit),
        {
            refreshInterval: 15_000, // Refresh history every 15s
            revalidateOnFocus: false,
        }
    );

    return {
        transactions: data?.transactions ?? [],
        count: data?.count ?? 0,
        isLoading,
        error,
        mutate,
    };
}
