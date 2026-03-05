import useSWR from "swr";
import { getProofs } from "@/lib/api";
import type { ProofRecord, AgentId } from "@/types";

async function fetchProofs(): Promise<ProofRecord[]> {
    const { proofs } = await getProofs();

    return proofs.map(
        (p): ProofRecord => {
            const decision = p.payload.strategistDecision as { confidence?: number } | undefined;
            const cycle = p.payload.cycle;

            return {
                id: p.hash.slice(0, 12),
                blockNumber: p.memoSignature
                    ? `Memo ${p.memoSignature.slice(0, 8)}...`
                    : "Pending",
                hash: p.hash,
                memoSignature: p.memoSignature,
                confidence: decision?.confidence ?? null,
                status: p.memoSignature ? "verified" : "pending",
                agentId: p.payload.agentId as AgentId,
                timestamp: new Date(p.anchoredAt).toISOString(),
                cycle,
            };
        }
    );
}

export function useProofs() {
    const { data, error, isLoading, mutate } = useSWR<ProofRecord[]>(
        "proofs",
        fetchProofs,
        {
            refreshInterval: 20_000,
            revalidateOnFocus: false,
            dedupingInterval: 15_000,
        }
    );

    return {
        proofs: data ?? [],
        isLoading,
        error,
        mutate,
    };
}
