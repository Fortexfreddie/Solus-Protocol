"use client";

import { LeaderboardEntry } from "@/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";
import { Trophy, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";

const RANK_COLORS = ["text-[#FFB547]", "text-slate-300", "text-slate-500"];
const AGENT_COLOR: Record<string, string> = {
    rex: "#FF6B35",
    nova: "#7C5CFC",
    sage: "#00D68F",
};

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
    return (
        <div className="glass rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Leaderboard
                </h3>
                <span className="text-[10px] font-mono text-slate-600">Net PnL (USD)</span>
            </div>

            <div className="space-y-1">
                {entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                        <BarChart3 className="w-5 h-5 text-slate-600 mb-2" />
                        <p className="text-[11px] font-mono text-slate-500">Connecting...</p>
                        <p className="text-[9px] font-mono text-slate-700 mt-1">Rankings appear after first cycle</p>
                    </div>
                ) : (
                    entries.map((entry, i) => {
                        const isFirst = i === 0;
                        const isPos = entry.netPnLUsd >= 0;

                        return (
                            <Tooltip key={entry.agentId}>
                                <TooltipTrigger asChild>
                                    <div
                                        className={cn(
                                            "flex items-center justify-between px-2.5 py-2 rounded-xl transition-all cursor-default",
                                            isFirst
                                                ? "bg-gradient-to-r from-white/[0.06] to-transparent border border-white/[0.06] shadow-[0_0_15px_rgba(255,181,71,0.04)]"
                                                : "hover:bg-white/[0.03] border border-transparent"
                                        )}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            {isFirst ? (
                                                <Trophy className="w-4 h-4 text-[#FFB547] shrink-0 drop-shadow-[0_0_4px_rgba(255,181,71,0.4)]" />
                                            ) : (
                                                <span className={cn("font-mono text-[11px] font-bold w-4 text-center", RANK_COLORS[i])}>
                                                    {i + 1}
                                                </span>
                                            )}
                                            <div
                                                className="w-2 h-2 rounded-full shrink-0 ring-2 ring-current/20"
                                                style={{
                                                    backgroundColor: AGENT_COLOR[entry.agentId],
                                                    boxShadow: `0 0 8px ${AGENT_COLOR[entry.agentId]}40`,
                                                }}
                                            />
                                            <span className={cn("text-sm font-medium", isFirst ? "text-white" : "text-slate-400")}>
                                                {entry.name}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            {isPos ? (
                                                <TrendingUp className="w-3 h-3 text-[#00D68F]" />
                                            ) : (
                                                <TrendingDown className="w-3 h-3 text-[#FF5A5A]" />
                                            )}
                                            <span
                                                className={cn(
                                                    "font-mono text-sm font-bold",
                                                    isPos ? "text-[#00D68F]" : "text-[#FF5A5A]"
                                                )}
                                            >
                                                {isPos ? "+" : ""}${Math.abs(entry.netPnLUsd).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                    <div className="space-y-1 min-w-[140px]">
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">SOL</span>
                                            <span className="font-bold">{entry.solBalance.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">USDC</span>
                                            <span className="font-bold">{entry.usdcBalance.toFixed(2)}</span>
                                        </div>
                                        <div className="h-px bg-white/[0.06] my-1" />
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Swaps</span>
                                            <span className="font-bold">{entry.swapCount}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Baseline</span>
                                            <span className="font-bold">${entry.baselineUsd.toFixed(0)}</span>
                                        </div>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        );
                    })
                )}
            </div>

            <div className="pt-2 border-t border-white/5 text-[9px] font-mono text-slate-700 text-center">
                Live portfolio vs. 2 SOL airdrop baseline
            </div>
        </div>
    );
}
