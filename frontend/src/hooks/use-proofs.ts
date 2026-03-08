import useSWR from "swr";
import { getProofs } from "@/lib/api";
import type { ProofRecord, AgentId } from "@/types";

/**
 * Parse confidence from the payloadSummary string.
 * Example: "Agent: rex | Cycle: 1 | Decision: SWAP SOL→USDC 0.124 SOL | Confidence: 0.65 | ..."
 */
function parseConfidence(summary: string): number | null {
    const match = summary.match(/Confidence:\s*([\d.]+)/i);
    return match ? parseFloat(match[1]) : null;
}

async function fetchProofs(): Promise<ProofRecord[]> {
    const { proofs } = await getProofs();

    return proofs.map(
        (p): ProofRecord => ({
            id: p.data.hash.slice(0, 12),
            blockNumber: p.data.memoSignature
                ? `Memo ${p.data.memoSignature.slice(0, 8)}...`
                : "Pending",
            hash: p.data.hash,
            memoSignature: p.data.memoSignature,
            confidence: parseConfidence(p.data.payloadSummary ?? ""),
            status: p.data.memoSignature ? "verified" : "pending",
            agentId: p.agentId as AgentId,
            timestamp: new Date(p.ts).toISOString(),
            cycle: p.cycle,
        })
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
