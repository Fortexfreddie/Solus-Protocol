"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Leaderboard } from "@/components/Leaderboard";
import { LivePrices } from "@/components/LivePrices";
import { SystemStatus } from "@/components/SystemStatus";
import { AgentCard } from "@/components/AgentCard";
import { StrategistPanel } from "@/components/StrategistPanel";
import { AuditFeed } from "@/components/AuditFeed";
import { ProofOfReasoning } from "@/components/ProofOfReasoning";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { patchAgentStatus, postForceRun, ApiError } from "@/lib/api";
import { useAgents } from "@/hooks/use-agents";
import { usePrices } from "@/hooks/use-prices";
import { useLeaderboard } from "@/hooks/use-leaderboard";
import { useProofs } from "@/hooks/use-proofs";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useSystemHealth } from "@/hooks/use-system-health";
import { useSolusEvents, type SolusEvent } from "@/hooks/use-solus-events";
import type { AgentId, StrategistLine, PolicyCheck, Agent } from "@/types";

// ─── Pipeline step mapping from WS event types ──────────────────────────────

const PIPELINE_MAP: Record<string, string> = {
  PRICE_FETCHED: "price",
  AGENT_THINKING: "strategist",
  GUARDIAN_AUDIT: "guardian",
  POLICY_PASS: "policy",
  POLICY_FAIL: "policy",
  PROOF_ANCHORED: "proof",
  TX_SIGNING: "vault",
  KORA_SIGNED: "vault",
  TX_SUBMITTED: "vault",
  TX_CONFIRMED: "vault",
};

const STEP_ORDER = ["price", "signal", "strategist", "guardian", "policy", "proof", "vault"];

function updatePipelineFromEvent(
  agents: Agent[],
  event: SolusEvent,
): Agent[] {
  const stepId = PIPELINE_MAP[event.type];
  if (!stepId) return agents;

  return agents.map((agent) => {
    if (agent.id !== event.agentId) return agent;

    const pipeline = agent.pipeline.map((step) => {
      if (step.id === stepId) {
        const isError = event.type.includes("FAIL") || event.type.includes("ERROR");
        return { ...step, status: isError ? ("error" as const) : ("done" as const) };
      }

      // Mark earlier steps as done implicitly
      const eventIdx = STEP_ORDER.indexOf(stepId);
      const stepIdx = STEP_ORDER.indexOf(step.id);
      if (stepIdx < eventIdx && step.status === "pending") {
        return { ...step, status: "done" as const };
      }

      // Mark the next step as running
      if (stepIdx === eventIdx + 1 && step.status === "pending") {
        return { ...step, status: "running" as const };
      }

      return step;
    });

    return { ...agent, pipeline };
  });
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function MissionControlPage() {
  // ─── Data hooks ──────────────────────────────────────────────────────────
  const { agents: fetchedAgents, isLoading: agentsLoading, mutate: mutateAgents } = useAgents();
  const { prices, isLoading: pricesLoading } = usePrices();
  const { entries: leaderboard, isLoading: leaderboardLoading } = useLeaderboard();
  const { proofs } = useProofs();
  const { entries: auditEntries } = useAuditLog();
  const { stats: systemStats } = useSystemHealth();

  // ─── Local agent state (for optimistic UI + pipeline updates) ────────────
  const [agents, setAgents] = useState<Agent[]>([]);
  const prevFetchRef = useRef<string>("");

  // Sync fetched agents → local state (preserve pipeline progress)
  useEffect(() => {
    const key = JSON.stringify(fetchedAgents.map((a) => `${a.id}-${a.operationalStatus}-${a.cycleCount}`));
    if (key !== prevFetchRef.current && fetchedAgents.length > 0) {
      prevFetchRef.current = key;
      setAgents((prev) => {
        if (prev.length === 0) return fetchedAgents;
        // Merge: keep pipeline state from local, update everything else from server
        return fetchedAgents.map((fetched) => {
          const existing = prev.find((p) => p.id === fetched.id);
          if (!existing) return fetched;
          return {
            ...fetched,
            pipeline: existing.pipeline,
          };
        });
      });
    }
  }, [fetchedAgents]);

  // ─── Strategist lines + policy checks from WS events ────────────────────
  const [strategistLines, setStrategistLines] = useState<StrategistLine[]>([]);
  const [policyChecks, setPolicyChecks] = useState<PolicyCheck[]>([]);

  // ─── WebSocket event handler ─────────────────────────────────────────────
  const handleWsEvent = useCallback((event: SolusEvent) => {
    // Update pipeline steps
    setAgents((prev) => updatePipelineFromEvent(prev, event));

    // Update strategist lines from AGENT_THINKING events
    if (event.type === "AGENT_THINKING") {
      const p = event.payload;
      const reasoning = (p.reasoning as string) ?? "";
      const decision = (p.decision as string) ?? "";
      const confidence = p.confidence as number | undefined;
      const newLines: StrategistLine[] = [
        { type: "comment", text: `# [L2] ${event.agentId.toUpperCase()} reasoning...` },
        ...(reasoning ? [{ type: "result" as const, text: reasoning.slice(0, 200) }] : []),
        ...(decision ? [{ type: "pass" as const, text: `> DECISION: ${decision}` }] : []),
        ...(confidence != null ? [{ type: "pass" as const, text: `> CONFIDENCE (${confidence.toFixed(2)}) ≥ threshold` }] : []),
      ];
      setStrategistLines(newLines);
    }

    if (event.type === "GUARDIAN_AUDIT") {
      const p = event.payload;
      const verdict = (p.verdict as string) ?? "";
      const challenge = (p.challenge as string) ?? "";

      setStrategistLines((prev) => [
        ...prev,
        { type: "comment" as const, text: `# [L3] ${event.agentId.toUpperCase()} Guardian Verdict: ${verdict}` },
        ...(challenge ? [{ type: verdict === "APPROVE" ? "pass" as const : (verdict === "VETO" ? "warn" as const : "result" as const), text: `> ${challenge.slice(0, 200)}` }] : []),
      ]);
    }

    // Update policy checks from POLICY_PASS/POLICY_FAIL events
    if (event.type === "POLICY_PASS" || event.type === "POLICY_FAIL") {
      const checks = (event.payload.checks as Array<{
        name: string;
        passed: boolean;
        reason: string;
        adjustedValue?: number;
      }>) ?? [];

      setPolicyChecks(checks.map((c, i) => ({
        id: i + 1,
        name: c.name,
        label: c.name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        detail: c.reason,
        status: c.passed ? "pass" as const : "fail" as const,
      })));
    }

    // Reset pipeline on new cycle start
    if (event.type === "PRICE_FETCHED") {
      setAgents((prev) =>
        prev.map((agent) => {
          if (agent.id !== event.agentId) return agent;
          return {
            ...agent,
            pipeline: agent.pipeline.map((step, i) => ({
              ...step,
              status: i === 0 ? ("done" as const) : i === 1 ? ("running" as const) : ("pending" as const),
            })),
          };
        })
      );
    }
  }, []);

  useSolusEvents(handleWsEvent);

  // ─── Agent actions ───────────────────────────────────────────────────────
  const handleToggle = useCallback(
    async (id: AgentId, active: boolean) => {
      const newStatus = active ? "ACTIVE" : "PAUSED";

      // Optimistic update
      setAgents((prev) =>
        prev.map((a) => (a.id === id ? { ...a, operationalStatus: newStatus } : a))
      );

      try {
        await patchAgentStatus(id, newStatus as "ACTIVE" | "PAUSED");
        toast.success(`${id.toUpperCase()} ${active ? "resumed" : "paused"}`);
        mutateAgents();
      } catch (err) {
        // Revert on error
        setAgents((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, operationalStatus: active ? "PAUSED" : "ACTIVE" } : a
          )
        );
        const msg = err instanceof ApiError ? err.message : "Failed to update agent";
        toast.error(msg);
      }
    },
    [mutateAgents]
  );

  const handleForceRun = useCallback(
    async (id: AgentId) => {
      try {
        await postForceRun(id);
        toast.success(`Force run triggered for ${id.toUpperCase()}`);
        // Reset pipeline to show new cycle starting
        setAgents((prev) =>
          prev.map((agent) => {
            if (agent.id !== id) return agent;
            return {
              ...agent,
              pipeline: agent.pipeline.map((step) => ({
                ...step,
                status: "pending" as const,
              })),
            };
          })
        );
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 403) {
            toast.error(`${id.toUpperCase()} is paused. Resume first.`);
          } else if (err.status === 429) {
            toast.warning("Cooldown active. Wait 15 seconds.");
          } else {
            toast.error(err.message);
          }
        } else {
          toast.error("Force run failed");
        }
      }
    },
    []
  );

  // ─── Loading state ───────────────────────────────────────────────────────
  const isLoading = agentsLoading && agents.length === 0;

  // ─── Header stats (computed from real data) ────────────────────────────────
  const headerStats = {
    totalCycles: agents.reduce((sum, a) => sum + a.cycleCount, 0),
    totalSwaps: leaderboard.reduce((sum, e) => sum + e.swapCount, 0),
    totalProofs: proofs.length,
    walletAddress: agents[0]?.publicKey,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col">
        <Header stats={headerStats} />

        <main className="flex-1 px-4 py-5 md:px-6 max-w-[1920px] mx-auto w-full">
          {isLoading ? (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[#7C5CFC] border-t-transparent rounded-full animate-spin" />
                <p className="text-ink-dim font-mono text-sm">
                  Connecting to Solus Protocol...
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-5">
              {/* Left sidebar */}
              <aside className="col-span-12 lg:col-span-3 flex flex-col gap-5">
                <Leaderboard entries={leaderboard} />
                <LivePrices prices={prices} />
                {systemStats && <SystemStatus stats={systemStats} />}
              </aside>

              {/* Main content */}
              <div className="col-span-12 lg:col-span-9 flex flex-col gap-5">
                {/* Agent cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {agents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onToggle={handleToggle}
                      onForceRun={handleForceRun}
                    />
                  ))}
                </div>

                {/* Strategist reasoning */}
                <StrategistPanel
                  lines={strategistLines}
                  checks={policyChecks}
                  activeContext="Rex/Strat_04"
                />

                {/* Audit feed + Proofs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <AuditFeed entries={auditEntries} />
                  <ProofOfReasoning proofs={proofs} />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
