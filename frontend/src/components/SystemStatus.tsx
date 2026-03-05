"use client";

import { SystemStats } from "@/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";
import { PingDot } from "@/components/ui/primitives";
import { Activity, Server, CheckCircle2, XCircle, Wifi, Database, Cpu } from "lucide-react";

interface StatusRowProps {
    label: string;
    ok: boolean;
    detail?: string;
    tooltip: string;
    icon: React.ReactNode;
}

function StatusRow({ label, ok, detail, tooltip, icon }: StatusRowProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="flex items-center justify-between py-1 cursor-default group">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        {icon}
                        {ok ? (
                            <CheckCircle2 className="w-3 h-3 text-[#00D68F]" />
                        ) : (
                            <XCircle className="w-3 h-3 text-[#FF5A5A]" />
                        )}
                        {label}
                    </span>
                    <div className="flex items-center gap-1.5">
                        <span className={cn("text-[10px] font-mono", ok ? "text-[#00D68F]" : "text-[#FF5A5A]")}>
                            {detail ?? (ok ? "Online" : "Offline")}
                        </span>
                        {ok && <PingDot color="sage" className="scale-75 opacity-60" />}
                    </div>
                </div>
            </TooltipTrigger>
            <TooltipContent side="left">{tooltip}</TooltipContent>
        </Tooltip>
    );
}

export function SystemStatus({ stats }: { stats: SystemStats }) {
    const loadColor =
        stats.load < 50 ? "bg-[#00D68F]" : stats.load < 80 ? "bg-[#FFB547]" : "bg-[#FF5A5A]";
    const loadLabel =
        stats.load < 50 ? "Normal" : stats.load < 80 ? "Elevated" : "High";
    const loadLabelColor =
        stats.load < 50 ? "text-[#00D68F]" : stats.load < 80 ? "text-[#FFB547]" : "text-[#FF5A5A]";

    return (
        <div className="glass rounded-2xl p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <Server className="w-3.5 h-3.5" />
                    System Health
                </h3>
                <span className={cn("text-[10px] font-mono font-bold", loadLabelColor)}>
                    {loadLabel}
                </span>
            </div>

            {/* Load bar */}
            <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                    <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        CPU Load
                    </span>
                    <span>{stats.load}%</span>
                </div>
                <div className="relative w-full bg-track rounded-full h-1.5 overflow-hidden">
                    <div
                        className={cn("h-1.5 rounded-full transition-all duration-1000", loadColor)}
                        style={{
                            width: `${stats.load}%`,
                            boxShadow: stats.load < 50
                                ? "0 0 8px rgba(0,214,143,0.3)"
                                : stats.load < 80
                                    ? "0 0 8px rgba(255,181,71,0.3)"
                                    : "0 0 8px rgba(255,90,90,0.3)",
                        }}
                    />
                </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2 py-2 border-y border-white/[0.04]">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="text-center cursor-default">
                            <div className="text-base font-mono font-bold text-white">{stats.latencyMs}ms</div>
                            <div className="text-[9px] text-slate-600 uppercase tracking-wider">Latency</div>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>RPC round-trip latency to Solana Devnet</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="text-center cursor-default">
                            <div className="text-base font-mono font-bold text-white">
                                {stats.verifiersOnline}
                                <span className="text-slate-600">/{stats.verifiersTotal}</span>
                            </div>
                            <div className="text-[9px] text-slate-600 uppercase tracking-wider">Verifiers</div>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>On-chain proof verifier nodes currently active</TooltipContent>
                </Tooltip>
            </div>

            {/* Status rows */}
            <div className="space-y-1">
                <StatusRow
                    label="Solana RPC"
                    ok={stats.rpcConnected}
                    detail="Devnet"
                    tooltip="Connection to Solana Devnet RPC endpoint"
                    icon={<Wifi className="w-3 h-3 text-slate-600" />}
                />
                <StatusRow
                    label="Kora Paymaster"
                    ok={stats.koraConnected}
                    tooltip="Kora gasless transaction relay for USDC/SPL-only operations"
                    icon={<Cpu className="w-3 h-3 text-slate-600" />}
                />
                <StatusRow
                    label="Price Oracle"
                    ok={stats.pricesFresh}
                    detail="CoinGecko + Jupiter"
                    tooltip="Dual-source price oracle: CoinGecko market data + Jupiter execution quotes"
                    icon={<Database className="w-3 h-3 text-slate-600" />}
                />
                <StatusRow
                    label="WebSocket"
                    ok={true}
                    detail="Socket.io"
                    tooltip="Real-time event bus for live agent cycle updates"
                    icon={<Activity className="w-3 h-3 text-slate-600" />}
                />
            </div>
        </div>
    );
}
