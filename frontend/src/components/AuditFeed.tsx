"use client";

import { AuditEntry, AgentId } from "@/types";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ScrollText, ExternalLink, Clock, AlertCircle } from "lucide-react";

const AGENT_COLORS: Record<AgentId | "sys", string> = {
    rex: "text-[#FF6B35]",
    nova: "text-[#7C5CFC]",
    sage: "text-[#00D68F]",
    sys: "text-slate-500",
};

const SEV_COLORS = {
    info: "text-slate-300",
    success: "text-[#00D68F]",
    warning: "text-[#FFB547]",
    error: "text-[#FF5A5A] font-semibold",
    system: "text-slate-500 italic",
};

const SEV_DOT = {
    info: "bg-slate-400",
    success: "bg-[#00D68F]",
    warning: "bg-[#FFB547]",
    error: "bg-[#FF5A5A]",
    system: "bg-slate-600",
};

const LEGEND = [
    { label: "REX", color: "bg-[#FF6B35]/60" },
    { label: "NOVA", color: "bg-[#7C5CFC]/60" },
    { label: "SAGE", color: "bg-[#00D68F]/60" },
];

function renderPayloadDetails(entry: AuditEntry) {
    const d = entry.data;

    if (entry.rawEvent === "AGENT_THINKING" && d.decision) {
        const dec = d.decision as Record<string, any>;
        return (
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.04] p-3 space-y-2 mt-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Strategist Decision</span>
                    <span className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border",
                        dec.decision === "SWAP" ? "bg-[#7C5CFC]/10 text-[#7C5CFC] border-[#7C5CFC]/25" : "bg-slate-500/10 text-slate-400 border-slate-500/25"
                    )}>
                        {dec.decision}
                    </span>
                </div>
                {dec.decision === "SWAP" && (
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div><span className="text-slate-500">Pair:</span> <span className="text-slate-300 font-mono">{dec.fromToken} → {dec.toToken}</span></div>
                        <div><span className="text-slate-500">Amount:</span> <span className="text-slate-300 font-mono">{dec.amount} {dec.fromToken}</span></div>
                        <div><span className="text-slate-500">Confidence:</span> <span className="text-[#00D68F] font-mono">{(dec.confidence * 100).toFixed(0)}%</span></div>
                    </div>
                )}
                {Array.isArray(dec.riskFlags) && dec.riskFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {dec.riskFlags.map((flag: string) => (
                            <span key={flag} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#FFB547]/10 text-[#FFB547] border border-[#FFB547]/20">
                                {flag}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (entry.rawEvent === "GUARDIAN_AUDIT" && d.audit) {
        const aud = d.audit as Record<string, any>;
        return (
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.04] p-3 space-y-2 mt-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Guardian Verdict</span>
                    <span className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border",
                        aud.verdict === "APPROVE" ? "bg-[#00D68F]/10 text-[#00D68F] border-[#00D68F]/25" : aud.verdict === "VETO" ? "bg-[#FF5A5A]/10 text-[#FF5A5A] border-[#FF5A5A]/25" : "bg-[#FFB547]/10 text-[#FFB547] border-[#FFB547]/25"
                    )}>
                        {aud.verdict}
                    </span>
                </div>
                {aud.challenge && (
                    <div className="text-[11px] text-slate-400 leading-relaxed font-mono">
                        {aud.challenge}
                    </div>
                )}
                {aud.modifiedAmount !== null && aud.modifiedAmount !== undefined && (
                    <div className="text-[10px] text-[#FFB547] font-mono mt-1 border-t border-white/[0.05] pt-1.5">
                        Amount restricted to → {aud.modifiedAmount} SOL
                    </div>
                )}
            </div>
        );
    }

    if ((entry.rawEvent === "POLICY_PASS" || entry.rawEvent === "POLICY_FAIL") && d.checks) {
        const checks = d.checks as Array<{ name: string, passed: boolean, reason: string }>;
        const passedCount = checks.filter(c => c.passed).length;
        return (
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.04] p-3 space-y-2 mt-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Policy Engine Checks</span>
                    <span className="text-[10px] font-mono text-slate-500">{passedCount}/{checks.length} passed</span>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {checks.map(c => (
                        <div key={c.name} className="flex items-start gap-2">
                            <span className={cn("text-[10px] mt-0.5", c.passed ? "text-[#00D68F]" : "text-[#FF5A5A]")}>
                                {c.passed ? "✓" : "✗"}
                            </span>
                            <div>
                                <div className="text-[10px] font-mono text-slate-300">{c.name}</div>
                                <div className="text-[9px] text-slate-500">{c.reason}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (entry.rawEvent === "TX_CONFIRMED") {
        return (
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.04] p-3 space-y-2 mt-3 text-[10px]">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                    <span className="text-[10px] font-bold text-[#00D68F] uppercase tracking-wider">Transaction Confirmed</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">Pair:</span> <span className="text-slate-300 font-mono">{d.fromToken as string} → {d.toToken as string}</span></div>
                    <div><span className="text-slate-500">Amount In:</span> <span className="text-slate-300 font-mono">{d.amountIn as number}</span></div>
                    <div><span className="text-slate-500">Final Output:</span> <span className="text-slate-300 font-mono">{d.amountOut as number}</span></div>
                </div>
                {typeof d.koraSignerAddress === "string" ? (
                    <div className="pt-1.5 border-t border-white/[0.05] text-[9px]">
                        <span className="text-slate-500">Kora Co-Signer:</span> <span className="font-mono text-slate-400">{d.koraSignerAddress as string}</span>
                    </div>
                ) : null}
            </div>
        );
    }

    // Default fallback dump for other events if they have complex data
    const nonTrivialKeys = Object.keys(d).filter(k => k !== 'signature' && k !== 'message' && k !== 'error' && typeof d[k] !== 'function');
    if (nonTrivialKeys.length > 0 && entry.rawEvent !== "AGENT_THINKING" && entry.rawEvent !== "GUARDIAN_AUDIT" && entry.rawEvent !== "POLICY_PASS" && entry.rawEvent !== "POLICY_FAIL" && entry.rawEvent !== "TX_CONFIRMED") {
        return (
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.04] p-3 space-y-2 mt-3">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-white/[0.05]">Event Data</div>
                <pre className="text-[9px] font-mono text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {JSON.stringify(d, null, 2)}
                </pre>
            </div>
        );
    }

    return null;
}

function AuditDetailModal({ entry }: { entry: AuditEntry }) {
    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-slate-400" />
                    Audit Entry Detail
                </DialogTitle>
            </DialogHeader>
            <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Agent</div>
                        <div className={cn("text-sm font-mono font-bold", AGENT_COLORS[entry.agentId])}>
                            {entry.agentLabel}
                        </div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Timestamp</div>
                        <div className="text-sm font-mono font-bold text-white flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            {entry.timestamp}
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5">Severity</div>
                        <div className="flex items-center gap-2">
                            <span className={cn("w-2 h-2 rounded-full", SEV_DOT[entry.severity])} />
                            <span className={cn("text-sm font-mono font-bold capitalize", SEV_COLORS[entry.severity])}>
                                {entry.severity}
                            </span>
                        </div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5">Event Type</div>
                        <div className="text-sm font-mono font-bold text-slate-300">
                            {entry.rawEvent}
                        </div>
                    </div>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5">Message</div>
                    <div className="text-xs font-mono text-slate-300 leading-relaxed break-words">
                        {entry.message}
                    </div>
                </div>

                {renderPayloadDetails(entry)}

                {entry.txLink && (
                    <a
                        href={entry.txLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs font-mono text-[#7C5CFC] hover:text-[#7C5CFC]/80 transition-colors mt-2"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View Transaction on Explorer
                    </a>
                )}
            </div>
        </>
    );
}

export function AuditFeed({ entries }: { entries: AuditEntry[] }) {
    const allEntries = entries;
    const rexEntries = entries.filter((e) => e.agentId === "rex");
    const novaEntries = entries.filter((e) => e.agentId === "nova");
    const sageEntries = entries.filter((e) => e.agentId === "sage");

    const renderEntries = (list: AuditEntry[]) => (
        <div className="space-y-0.5">
            {list.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Clock className="w-5 h-5 text-slate-600 mb-2" />
                    <p className="text-[11px] font-mono text-slate-500">Waiting for events...</p>
                    <p className="text-[9px] font-mono text-slate-700 mt-1">Events appear as agents cycle</p>
                </div>
            ) : (
                list.map((entry) => (
                    <Dialog key={entry.id}>
                        <DialogTrigger asChild>
                            <div className="flex items-start gap-2 p-1.5 rounded-lg hover:bg-white/[0.03] transition-colors group cursor-pointer">
                                <span className="font-mono text-[10px] text-slate-600 w-14 shrink-0 tabular-nums pt-0.5">
                                    {entry.timestamp}
                                </span>
                                <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", SEV_DOT[entry.severity])} />
                                <span
                                    className={cn(
                                        "font-mono text-[10px] font-bold w-10 shrink-0",
                                        AGENT_COLORS[entry.agentId]
                                    )}
                                >
                                    {entry.agentLabel}
                                </span>
                                <span
                                    className={cn(
                                        "font-mono text-[10px] leading-relaxed flex-1 min-w-0 break-words",
                                        SEV_COLORS[entry.severity]
                                    )}
                                >
                                    {entry.message}
                                </span>
                                {entry.txLink && (
                                    <ExternalLink className="w-3 h-3 text-slate-700 group-hover:text-slate-400 transition-colors shrink-0 mt-0.5" />
                                )}
                            </div>
                        </DialogTrigger>
                        <DialogContent>
                            <AuditDetailModal entry={entry} />
                        </DialogContent>
                    </Dialog>
                ))
            )}
        </div>
    );

    return (
        <div className="glass rounded-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-edge bg-section-header flex items-center justify-between shrink-0 gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <ScrollText className="w-3.5 h-3.5" />
                    Audit Feed
                </h3>
                <div className="flex gap-2 flex-wrap">
                    {LEGEND.map((l) => (
                        <span key={l.label} className="flex items-center gap-1 text-[9px] font-mono text-slate-600">
                            <span className={cn("w-1.5 h-1.5 rounded", l.color)} />
                            {l.label}
                        </span>
                    ))}
                </div>
            </div>

            {/* Tabs for agent filtering */}
            <Tabs defaultValue="all" className="flex flex-col flex-1">
                <div className="px-3 pt-2">
                    <TabsList>
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="rex" className="data-[state=active]:text-[#FF6B35]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" /> Rex
                        </TabsTrigger>
                        <TabsTrigger value="nova" className="data-[state=active]:text-[#7C5CFC]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#7C5CFC]" /> Nova
                        </TabsTrigger>
                        <TabsTrigger value="sage" className="data-[state=active]:text-[#00D68F]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#00D68F]" /> Sage
                        </TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto p-2 max-h-56">
                    <TabsContent value="all" className="mt-0">{renderEntries(allEntries)}</TabsContent>
                    <TabsContent value="rex" className="mt-0">{renderEntries(rexEntries)}</TabsContent>
                    <TabsContent value="nova" className="mt-0">{renderEntries(novaEntries)}</TabsContent>
                    <TabsContent value="sage" className="mt-0">{renderEntries(sageEntries)}</TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
