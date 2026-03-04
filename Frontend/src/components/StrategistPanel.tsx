"use client";

import { StrategistLine, PolicyCheck } from "@/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Terminal, CheckCircle2, XCircle, AlertTriangle, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

const LINE_STYLE: Record<StrategistLine["type"], string> = {
    comment: "text-slate-500",
    pass: "text-[#00D68F]",
    warn: "text-[#FFB547]",
    result: "text-white font-bold",
};

const CHECK_ICON = {
    pass: <CheckCircle2 className="w-3 h-3 text-[#00D68F] shrink-0" />,
    fail: <XCircle className="w-3 h-3 text-[#FF5A5A] shrink-0" />,
    warn: <AlertTriangle className="w-3 h-3 text-[#FFB547] shrink-0" />,
};

const CHECK_VALUE = {
    pass: <span className="text-[#00D68F] font-bold">OK</span>,
    fail: <span className="text-[#FF5A5A] font-bold">FAIL</span>,
    warn: <span className="text-[#FFB547] font-bold">WARN</span>,
};

const CHECK_TOOLTIP: Record<string, string> = {
    action_whitelist: "Only SWAP, HOLD, SKIP actions are permitted",
    token_whitelist: "Only SOL, USDC, RAY, BONK tokens are permitted",
    min_confidence: "LLM confidence must exceed the agent's configured threshold",
    volatility_sizing: "Amount adjusted: safeAmt = maxTx × confidence × (1 - volPenalty)",
    daily_volume_cap: "Total daily volume must not exceed the agent's limit",
    rate_limit: "Maximum 5 transactions per minute per agent",
    balance_check: "Agent balance must cover amount + fee reserve",
    spread_threshold: "Net spread (after slippage) must exceed agent threshold",
    stop_loss_circuit: "If wallet drawdown exceeds threshold → HOLD-only mode",
};

interface StrategistPanelProps {
    lines: StrategistLine[];
    checks: PolicyCheck[];
    activeContext?: string;
}

export function StrategistPanel({
    lines,
    checks,
    activeContext = "Rex/Strat_04",
}: StrategistPanelProps) {
    const passed = checks.filter((c) => c.status === "pass").length;
    const total = checks.length;
    const allPass = passed === total;

    const terminalContent = (
        <div className="p-3 h-40 overflow-y-auto space-y-0.5 font-mono text-[11px]">
            {lines.map((line, i) => (
                <div key={i} className={cn("leading-relaxed", LINE_STYLE[line.type])}>
                    {line.text}
                </div>
            ))}
            <span className="inline-block w-2 h-4 bg-[#FFB547]/80 cursor-blink align-middle" />
        </div>
    );

    return (
        <div className="glass rounded-2xl p-4 md:p-5 flex flex-col gap-4">
            {/* Header with agent tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.05] pb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5" />
                    Strategist Reasoning
                </h3>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Agent tabs */}
                    <Tabs defaultValue="rex">
                        <TabsList>
                            <TabsTrigger value="rex" className="data-[state=active]:text-[#FF6B35] data-[state=active]:shadow-[0_0_8px_rgba(255,107,53,0.15)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" />
                                Rex
                            </TabsTrigger>
                            <TabsTrigger value="nova" className="data-[state=active]:text-[#7C5CFC] data-[state=active]:shadow-[0_0_8px_rgba(124,92,252,0.15)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#7C5CFC]" />
                                Nova
                            </TabsTrigger>
                            <TabsTrigger value="sage" className="data-[state=active]:text-[#00D68F] data-[state=active]:shadow-[0_0_8px_rgba(0,214,143,0.15)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#00D68F]" />
                                Sage
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <span
                        className={cn(
                            "px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono border",
                            allPass
                                ? "bg-[#00D68F]/10 text-[#00D68F] border-[#00D68F]/30"
                                : "bg-[#FF5A5A]/10 text-[#FF5A5A] border-[#FF5A5A]/30"
                        )}
                    >
                        {passed}/{total} Checks {allPass ? "PASSED" : "FAILED"}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Terminal window */}
                <div className="bg-inset rounded-xl border border-edge flex flex-col overflow-hidden relative">
                    <div className="flex items-center justify-between gap-1.5 px-3 py-2 border-b border-white/[0.04] bg-white/[0.02]">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#FF5A5A]/60" />
                            <span className="w-2.5 h-2.5 rounded-full bg-[#FFB547]/60" />
                            <span className="w-2.5 h-2.5 rounded-full bg-[#00D68F]/60" />
                            <span className="text-[10px] font-mono text-slate-600 ml-2">strategist.log</span>
                        </div>
                        {/* Fullscreen modal */}
                        <Dialog>
                            <DialogTrigger asChild>
                                <button className="text-slate-600 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.06]">
                                    <Maximize2 className="w-3 h-3" />
                                </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        <Terminal className="w-4 h-4 text-[#FFB547]" />
                                        Strategist Reasoning — Full Output
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="mt-4 bg-inset rounded-xl border border-edge overflow-hidden">
                                    <div className="p-4 max-h-[60vh] overflow-y-auto space-y-1 font-mono text-[11px]">
                                        {lines.map((line, i) => (
                                            <div key={i} className={cn("leading-relaxed", LINE_STYLE[line.type])}>
                                                {line.text}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                    {terminalContent}
                </div>

                {/* Policy Engine checks */}
                <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[0.04] bg-white/[0.02] flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Policy Engine — 9 Checks
                        </span>
                    </div>
                    <div className="p-2 h-40 overflow-y-auto space-y-0.5">
                        {checks.map((check, i) => (
                            <Tooltip key={check.id}>
                                <TooltipTrigger asChild>
                                    <div
                                        className={cn(
                                            "px-2 py-1 rounded-lg transition-colors cursor-default",
                                            i === 3 && "bg-[#00D68F]/[0.06] ring-1 ring-[#00D68F]/15"
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                {CHECK_ICON[check.status]}
                                                <span
                                                    className={cn(
                                                        "text-[10px] font-mono truncate",
                                                        i === 3 ? "text-white font-semibold" : "text-slate-400"
                                                    )}
                                                >
                                                    {check.id}. {check.label}
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono shrink-0">{CHECK_VALUE[check.status]}</span>
                                        </div>
                                        {check.detail && (
                                            <div className="text-[9px] font-mono text-slate-600 pl-5 mt-0.5 border-l border-slate-700/50 ml-1.5 truncate">
                                                {check.detail}
                                            </div>
                                        )}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                    {CHECK_TOOLTIP[check.name] ?? check.label}
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
