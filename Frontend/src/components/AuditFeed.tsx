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

function AuditDetailModal({ entry }: { entry: AuditEntry }) {
    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-slate-400" />
                    Audit Entry Detail
                </DialogTitle>
            </DialogHeader>
            <div className="mt-4 space-y-4">
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
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5">Message</div>
                    <div className="text-xs font-mono text-slate-300 leading-relaxed break-words">
                        {entry.message}
                    </div>
                </div>
                {entry.txLink && (
                    <a
                        href={entry.txLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs font-mono text-[#7C5CFC] hover:text-[#7C5CFC]/80 transition-colors"
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
