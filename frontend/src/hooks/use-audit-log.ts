import useSWR from "swr";
import { getLogs } from "@/lib/api";
import type { AuditEntry, AgentId, AuditSeverity } from "@/types";

function inferSeverity(event: string): AuditSeverity {
    if (event.includes("FAIL") || event.includes("ERROR") || event.includes("VETO"))
        return "error";
    if (event.includes("WARNING") || event.includes("MODIFY")) return "warning";
    if (event.includes("CONFIRMED") || event.includes("APPROVE") || event.includes("PASS"))
        return "success";
    if (event.includes("HEARTBEAT") || event.includes("SYSTEM")) return "system";
    return "info";
}

function formatMessage(entry: { event: string; data: Record<string, unknown> }): string {
    const d = entry.data;
    // Error events (CYCLE_ERROR, GUARDIAN_SAFETY_VETO, etc.)
    if (d.error && typeof d.error === "string") return d.error.slice(0, 120);
    // AGENT_THINKING — reasoning is nested in decision object
    const decision = d.decision as Record<string, unknown> | undefined;
    if (decision?.reasoning && typeof decision.reasoning === "string")
        return decision.reasoning.slice(0, 120);
    // Direct message field
    if (d.message && typeof d.message === "string") return d.message;
    if (d.challenge && typeof d.challenge === "string")
        return d.challenge.slice(0, 120);
    if (d.reason && typeof d.reason === "string") return d.reason;
    return entry.event.replace(/_/g, " ");
}

async function fetchAuditLog(): Promise<AuditEntry[]> {
    const { entries } = await getLogs(1, 50);

    return entries.map(
        (entry): AuditEntry => ({
            id: entry.id || `${entry.agentId}-${entry.ts}-${entry.event.slice(0, 5)}`,
            timestamp: new Date(entry.ts).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
            agentId: (entry.agentId === "system" ? "sys" : entry.agentId) as
                | AgentId
                | "sys",
            agentLabel:
                entry.agentId === "system"
                    ? "SYS"
                    : entry.agentId.toUpperCase(),
            message: formatMessage(entry),
            severity: inferSeverity(entry.event),
            txLink: entry.data.signature
                ? `https://explorer.solana.com/tx/${entry.data.signature}?cluster=devnet`
                : undefined,
        })
    );
}

export function useAuditLog() {
    const { data, error, isLoading, mutate } = useSWR<AuditEntry[]>(
        "audit-log",
        fetchAuditLog,
        {
            refreshInterval: 10_000,
            revalidateOnFocus: false,
            dedupingInterval: 5_000,
        }
    );

    return {
        entries: data ?? [],
        isLoading,
        error,
        mutate,
    };
}
