import useSWR from "swr";
import { getHealth, type HealthResponse } from "@/lib/api";
import type { SystemStats } from "@/types";

async function fetchHealth(): Promise<SystemStats> {
    const h: HealthResponse = await getHealth();

    // Count online agents as "verifiers" (real count from backend)
    const agentEntries = Object.values(h.agents ?? {});
    const activeCount = agentEntries.filter(
        (a) => a.operationalStatus === "ACTIVE"
    ).length;

    return {
        load: h.rpc.latencyMs
            ? Math.min(Math.round((h.rpc.latencyMs / 15000) * 100), 100)
            : 0,
        latencyMs: h.rpc.latencyMs ?? 0,
        verifiersOnline: activeCount,
        verifiersTotal: agentEntries.length,
        network: "Devnet",
        rpcConnected: h.rpc.connected,
        koraConnected: h.kora.connected,
        pricesFresh: h.prices.fresh,
    };
}

export function useSystemHealth() {
    const { data, error, isLoading, mutate } = useSWR<SystemStats>(
        "health",
        fetchHealth,
        {
            refreshInterval: 20_000,
            revalidateOnFocus: false,
            dedupingInterval: 15_000,
        }
    );

    return {
        stats: data ?? null,
        isLoading,
        error,
        mutate,
    };
}
