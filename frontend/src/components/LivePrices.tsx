"use client";

import { TokenPrice } from "@/types";
import { formatPrice } from "@/lib/utils";
import { PingDot } from "@/components/ui/primitives";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const TOKEN_EMOJI: Record<string, string> = {
    SOL: "◎",
    USDC: "$",
    RAY: "⚡",
    BONK: "🐕",
};

export function LivePrices({ prices }: { prices: TokenPrice[] }) {
    return (
        <div className="glass rounded-xl p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <span className="relative flex items-center">
                        <span className="w-3.5 h-3.5 text-slate-400">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <polyline points="1,8 4,4 7,10 10,6 13,9 15,7" />
                            </svg>
                        </span>
                    </span>
                    Live Prices
                </h3>
                <PingDot color="sage" />
            </div>

            {/* Price list */}
            <div className="space-y-3">
                {prices.map((token, i) => {
                    const isUp = token.direction === "up";
                    const isDown = token.direction === "down";

                    return (
                        <div key={token.symbol}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center justify-between group cursor-default">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm opacity-70">{TOKEN_EMOJI[token.symbol] ?? "•"}</span>
                                            <span className="font-bold text-sm text-white">{token.symbol}</span>
                                            <span className="text-[10px] mono text-slate-600">/USD</span>
                                        </div>
                                        <div className="text-right">
                                            <div
                                                className={cn(
                                                    "flex items-center justify-end gap-1 text-sm font-bold mono",
                                                    isUp ? "text-[#00D68F]" : isDown ? "text-[#FF5A5A]" : "text-slate-300"
                                                )}
                                            >
                                                <span>{formatPrice(token.price)}</span>
                                                {isUp && <TrendingUp className="w-3 h-3" />}
                                                {isDown && <TrendingDown className="w-3 h-3" />}
                                                {!isUp && !isDown && <Minus className="w-3 h-3" />}
                                            </div>
                                            <span
                                                className={cn(
                                                    "text-[10px] mono",
                                                    isUp ? "text-[#00D68F]/80" : isDown ? "text-[#FF5A5A]/80" : "text-slate-500"
                                                )}
                                            >
                                                {isUp ? "+" : ""}
                                                {token.change24h.toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                    <div className="space-y-0.5">
                                        <div>{token.symbol}/USD — 24h Change</div>
                                        <div className={cn("font-bold", isUp ? "text-[#00D68F]" : isDown ? "text-[#FF5A5A]" : "text-slate-300")}>
                                            {isUp ? "+" : ""}{token.change24h.toFixed(2)}%
                                        </div>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                            {i < prices.length - 1 && (
                                <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent w-full mt-3" />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="pt-3 border-t border-white/5 flex justify-between items-center text-[10px] text-slate-600 mono cursor-default">
                        <span>Spread: 12bps</span>
                        <span>Oracle: CoinGecko + Jupiter</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    Spread calculated from CoinGecko market data.
                    <br />
                    Jupiter quotes provide real execution pricing.
                </TooltipContent>
            </Tooltip>
        </div>
    );
}
