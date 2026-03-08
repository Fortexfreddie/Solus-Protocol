"use client";

import { ProofRecord, AgentId, ProofVerificationResult, ProofVerificationEntry } from "@/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/Dialog";
import {
    ShieldCheck, ExternalLink, Copy, Check, Hash, Fingerprint, Loader2,
    Search, X, CheckCircle2, XCircle, Brain, Shield, Eye, Activity,
    TrendingUp, TrendingDown, AlertTriangle,
} from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { verifyProof } from "@/lib/api";

// ─── Agent color tokens ──────────────────────────────────────────────────────

const AGENT_HOVER: Record<AgentId, string> = {
    rex: "hover:border-[#FF6B35]/30 hover:shadow-[0_0_12px_rgba(255,107,53,0.05)]",
    nova: "hover:border-[#7C5CFC]/30 hover:shadow-[0_0_12px_rgba(124,92,252,0.05)]",
    sage: "hover:border-[#00D68F]/30 hover:shadow-[0_0_12px_rgba(0,214,143,0.05)]",
};

const AGENT_DOT: Record<AgentId, string> = {
    rex: "bg-[#FF6B35]",
    nova: "bg-[#7C5CFC]",
    sage: "bg-[#00D68F]",
};

const AGENT_COLOR: Record<AgentId, string> = {
    rex: "#FF6B35",
    nova: "#7C5CFC",
    sage: "#00D68F",
};

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [text]);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    onClick={handleCopy}
                    className="text-slate-600 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.06]"
                >
                    {copied ? <Check className="w-3 h-3 text-[#00D68F]" /> : <Copy className="w-3 h-3" />}
                </button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copied!" : "Copy hash"}</TooltipContent>
        </Tooltip>
    );
}

// ─── Full Proof Detail Modal ──────────────────────────────────────────────────
// Shows the complete decoded payload from GET /api/proofs/:hash

function ProofFullDetailModal({
    result,
    hash,
}: {
    result: ProofVerificationResult;
    hash: string;
}) {
    const { entry, verified } = result;
    const d = entry.data;
    const strat = d.strategistDecision;
    const guard = d.guardianVerdict;
    const checks = d.policyChecks;
    const snap = d.priceSnapshot;
    const quote = snap.executionQuote;
    const agentId = entry.agentId as AgentId;

    const passedCount = checks.filter((c) => c.passed).length;

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-[#7C5CFC]" />
                    Proof-of-Reasoning — Decoded
                </DialogTitle>
                <DialogDescription>
                    Full on-chain payload for {entry.agentId.toUpperCase()} · Cycle #{entry.cycle}
                </DialogDescription>
            </DialogHeader>

            <div className="mt-3 space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {/* Verification Banner */}
                <div
                    className={cn(
                        "rounded-xl p-3 border flex items-center gap-3",
                        verified
                            ? "bg-[#00D68F]/[0.06] border-[#00D68F]/20"
                            : "bg-[#FF5A5A]/[0.06] border-[#FF5A5A]/20"
                    )}
                >
                    {verified ? (
                        <CheckCircle2 className="w-5 h-5 text-[#00D68F] shrink-0" />
                    ) : (
                        <XCircle className="w-5 h-5 text-[#FF5A5A] shrink-0" />
                    )}
                    <div>
                        <div className={cn("text-sm font-bold", verified ? "text-[#00D68F]" : "text-[#FF5A5A]")}>
                            {verified ? "Integrity Verified" : "Integrity Check Failed"}
                        </div>
                        <div className="text-[10px] text-slate-500">
                            {verified
                                ? "SHA-256 hash matches the payload — data has not been tampered with."
                                : "Hash mismatch detected — record may have been modified."}
                        </div>
                    </div>
                </div>

                {/* Hash */}
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
                        <Hash className="w-3 h-3" /> SHA-256 Proof Hash
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-300 break-all">{hash}</span>
                        <CopyButton text={hash} />
                    </div>
                </div>

                {/* Metadata row */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/[0.04] text-center">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Agent</div>
                        <div className="flex items-center justify-center gap-1.5">
                            <div
                                className={cn("w-2 h-2 rounded-full", AGENT_DOT[agentId])}
                                style={{ boxShadow: `0 0 6px ${AGENT_COLOR[agentId]}40` }}
                            />
                            <span className="text-sm font-mono font-bold text-white">{entry.agentId.toUpperCase()}</span>
                        </div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/[0.04] text-center">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Cycle</div>
                        <div className="text-sm font-mono font-bold text-white">#{entry.cycle}</div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/[0.04] text-center">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Timestamp</div>
                        <div className="text-[11px] font-mono font-bold text-white">{new Date(entry.ts).toLocaleTimeString()}</div>
                    </div>
                </div>

                {/* ─── Strategist Decision ─────────────────────────────────── */}
                <div className="bg-white/[0.03] rounded-xl border border-white/[0.04] overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[0.04] bg-white/[0.02] flex items-center gap-1.5">
                        <Brain className="w-3 h-3 text-[#7C5CFC]" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Strategist Decision
                        </span>
                    </div>
                    <div className="p-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn(
                                "px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border",
                                strat.decision === "SWAP"
                                    ? "bg-[#7C5CFC]/10 text-[#7C5CFC] border-[#7C5CFC]/25"
                                    : "bg-slate-500/10 text-slate-400 border-slate-500/25"
                            )}>
                                {strat.decision}
                            </span>
                            {strat.decision === "SWAP" && (
                                <span className="text-[11px] font-mono text-slate-300">
                                    {strat.amount} {strat.fromToken} → {strat.toToken}
                                </span>
                            )}
                            <span className={cn(
                                "text-[11px] font-mono font-bold ml-auto",
                                strat.confidence >= 0.9 ? "text-[#00D68F]"
                                    : strat.confidence >= 0.7 ? "text-[#FFB547]"
                                        : "text-[#FF5A5A]"
                            )}>
                                {(strat.confidence * 100).toFixed(0)}% confidence
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-400 leading-relaxed bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.03]">
                            {strat.reasoning}
                        </div>
                        {strat.riskFlags.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <AlertTriangle className="w-3 h-3 text-[#FFB547]" />
                                {strat.riskFlags.map((flag) => (
                                    <span key={flag} className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#FFB547]/10 text-[#FFB547] border border-[#FFB547]/20">
                                        {flag}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── Guardian Verdict ─────────────────────────────────────── */}
                <div className="bg-white/[0.03] rounded-xl border border-white/[0.04] overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[0.04] bg-white/[0.02] flex items-center gap-1.5">
                        <Eye className="w-3 h-3 text-[#00D68F]" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Guardian Verdict
                        </span>
                        <span className={cn(
                            "ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border",
                            guard.verdict === "APPROVE"
                                ? "bg-[#00D68F]/10 text-[#00D68F] border-[#00D68F]/25"
                                : guard.verdict === "VETO"
                                    ? "bg-[#FF5A5A]/10 text-[#FF5A5A] border-[#FF5A5A]/25"
                                    : "bg-[#FFB547]/10 text-[#FFB547] border-[#FFB547]/25"
                        )}>
                            {guard.verdict}
                        </span>
                    </div>
                    <div className="p-3">
                        <div className="text-[11px] text-slate-400 leading-relaxed bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.03]">
                            {guard.challenge}
                        </div>
                        {guard.modifiedAmount !== null && (
                            <div className="mt-2 text-[10px] text-[#FFB547] font-mono">
                                Modified amount → {guard.modifiedAmount} SOL
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── Policy Checks ───────────────────────────────────────── */}
                <div className="bg-white/[0.03] rounded-xl border border-white/[0.04] overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Shield className="w-3 h-3 text-[#7C5CFC]" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Policy Checks
                            </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">
                            {passedCount}/{checks.length} passed
                        </span>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                        {checks.map((check) => (
                            <div key={check.name} className="px-3 py-2 flex items-start gap-2.5">
                                {check.passed ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00D68F] shrink-0 mt-0.5" />
                                ) : (
                                    <XCircle className="w-3.5 h-3.5 text-[#FF5A5A] shrink-0 mt-0.5" />
                                )}
                                <div className="min-w-0">
                                    <div className="text-[10px] font-mono font-bold text-slate-300">{check.name}</div>
                                    <div className="text-[10px] text-slate-500 leading-relaxed">{check.reason}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ─── Price Snapshot ───────────────────────────────────────── */}
                <div className="bg-white/[0.03] rounded-xl border border-white/[0.04] overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[0.04] bg-white/[0.02] flex items-center gap-1.5">
                        <Activity className="w-3 h-3 text-[#FFB547]" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Price Snapshot
                        </span>
                    </div>
                    <div className="p-3 space-y-3">
                        {/* Token prices */}
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(snap.prices).map(([token, price]) => (
                                <div key={token} className="bg-white/[0.02] rounded-lg p-2 border border-white/[0.03] flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-slate-400">{token}</span>
                                    <div className="text-right">
                                        <div className="text-[11px] font-mono font-bold text-white">
                                            ${price.usd < 0.01 ? price.usd.toFixed(8) : price.usd.toFixed(2)}
                                        </div>
                                        <div className={cn(
                                            "text-[9px] font-mono flex items-center gap-0.5 justify-end",
                                            price.change24h >= 0 ? "text-[#00D68F]" : "text-[#FF5A5A]"
                                        )}>
                                            {price.change24h >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                            {price.change24h >= 0 ? "+" : ""}{price.change24h.toFixed(2)}%
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Execution Quote */}
                        {quote && (
                            <div className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.03]">
                                <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5">Jupiter Execution Quote</div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Route</span>
                                        <span className="font-mono text-slate-300">{quote.inAmount} {quote.fromToken} → {quote.outAmount} {quote.toToken}</span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Implied Price</span>
                                        <span className="font-mono text-slate-300">${quote.impliedPrice.toFixed(4)}</span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Net Spread</span>
                                        <span className={cn(
                                            "font-mono font-bold",
                                            quote.netSpreadVsMarket > 0 ? "text-[#00D68F]" : "text-[#FF5A5A]"
                                        )}>
                                            {quote.netSpreadVsMarket > 0 ? "+" : ""}{(quote.netSpreadVsMarket * 100).toFixed(4)}%
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Price Impact</span>
                                        <span className="font-mono text-slate-300">{quote.priceImpactPct.toFixed(6)}%</span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Worth Trading</span>
                                        <span className={cn("font-mono font-bold", quote.worthTrading ? "text-[#00D68F]" : "text-[#FF5A5A]")}>
                                            {quote.worthTrading ? "YES" : "NO"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Solana Explorer link */}
                {d.memoSignature && (
                    <a
                        href={`https://explorer.solana.com/tx/${d.memoSignature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 py-2 rounded-xl bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 text-xs font-bold text-[#7C5CFC] hover:bg-[#7C5CFC]/20 transition-colors"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View on Solana Explorer (Devnet)
                    </a>
                )}
            </div>
        </>
    );
}

// ─── Search Proof Component ──────────────────────────────────────────────────

function SearchProof() {
    const [query, setQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResult, setSearchResult] = useState<ProofVerificationResult | null>(null);
    const [searchHash, setSearchHash] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSearch = useCallback(async () => {
        const trimmed = query.trim();
        if (!trimmed) return;

        setIsSearching(true);
        setError(null);

        try {
            const res = await verifyProof(trimmed);
            setSearchResult(res);
            setSearchHash(trimmed);
            setSearchOpen(true);
        } catch (err) {
            if (err instanceof Error && err.message.includes("not found")) {
                setError("No proof record found for this hash");
            } else {
                setError(err instanceof Error ? err.message : "Network error");
            }
        } finally {
            setIsSearching(false);
        }
    }, [query]);

    const handleClear = useCallback(() => {
        setQuery("");
        setError(null);
        inputRef.current?.focus();
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") handleSearch();
            if (e.key === "Escape") handleClear();
        },
        [handleSearch, handleClear]
    );

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600 pointer-events-none" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setError(null); }}
                        onKeyDown={handleKeyDown}
                        placeholder="Paste SHA-256 hash to decode…"
                        className={cn(
                            "w-full bg-white/[0.04] border border-white/[0.08] rounded-lg",
                            "pl-7 pr-7 py-1.5 text-[11px] font-mono text-slate-300",
                            "placeholder:text-slate-700 focus:outline-none focus:border-[#7C5CFC]/40",
                            "transition-colors"
                        )}
                    />
                    {query && (
                        <button
                            onClick={handleClear}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
                <button
                    onClick={handleSearch}
                    disabled={!query.trim() || isSearching}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shrink-0",
                        "bg-[#7C5CFC]/10 text-[#7C5CFC] border border-[#7C5CFC]/20",
                        "hover:bg-[#7C5CFC]/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                >
                    {isSearching ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                        <ShieldCheck className="w-3 h-3" />
                    )}
                    Decode
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-xl p-2.5 border border-[#FF5A5A]/20 bg-[#FF5A5A]/[0.06] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <XCircle className="w-3.5 h-3.5 text-[#FF5A5A] shrink-0" />
                        <span className="text-[11px] text-[#FF5A5A]">{error}</span>
                    </div>
                    <button onClick={() => setError(null)} className="text-slate-600 hover:text-slate-400 transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}

            {/* Result Modal */}
            <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
                <DialogContent className="max-w-lg">
                    {searchResult && (
                        <ProofFullDetailModal result={searchResult} hash={searchHash} />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ─── Proof Row (clickable → opens full detail modal) ─────────────────────────

function ProofRow({ proof }: { proof: ProofRecord }) {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<ProofVerificationResult | null>(null);
    const [open, setOpen] = useState(false);

    const isVerified = proof.status === "verified";
    const isPending = proof.status === "pending";

    const confColor =
        proof.confidence === null
            ? "text-slate-500"
            : proof.confidence >= 0.9
                ? "text-[#00D68F]"
                : proof.confidence >= 0.7
                    ? "text-[#FFB547]"
                    : "text-[#FF5A5A]";

    const handleClick = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await verifyProof(proof.hash);
            setResult(res);
            setOpen(true);
        } catch (err) {
            toast.error("Failed to load proof details", {
                description: err instanceof Error ? err.message : "Network error",
            });
        } finally {
            setIsLoading(false);
        }
    }, [proof.hash]);

    return (
        <>
            <div
                onClick={handleClick}
                className={cn(
                    "bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 transition-all cursor-pointer",
                    AGENT_HOVER[proof.agentId],
                    isPending && "opacity-60",
                    isPending && "shimmer",
                    isVerified && "ring-1 ring-[#7C5CFC]/10",
                    isLoading && "pointer-events-none opacity-70"
                )}
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span
                                className={cn(
                                    "px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border",
                                    isVerified
                                        ? "bg-[#7C5CFC]/10 text-[#7C5CFC] border-[#7C5CFC]/25"
                                        : isPending
                                            ? "bg-slate-500/10 text-slate-500 border-slate-500/25"
                                            : "bg-[#FF5A5A]/10 text-[#FF5A5A] border-[#FF5A5A]/25"
                                )}
                            >
                                {proof.status}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <div
                                    className={cn("w-1.5 h-1.5 rounded-full", AGENT_DOT[proof.agentId])}
                                    style={{ boxShadow: `0 0 6px ${AGENT_COLOR[proof.agentId]}40` }}
                                />
                                <span className="text-[10px] text-slate-500 font-mono">
                                    {proof.agentId.toUpperCase()} · {proof.blockNumber}
                                </span>
                            </div>
                            {proof.cycle && (
                                <span className="text-[10px] text-slate-700 font-mono">
                                    Cycle #{proof.cycle}
                                </span>
                            )}
                            {isLoading && <Loader2 className="w-3 h-3 text-[#7C5CFC] animate-spin" />}
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="font-mono text-[11px] text-slate-400 truncate">
                                SHA-256:{" "}
                                <span className="text-slate-300">{proof.hash}</span>
                            </div>
                            {proof.memoSignature && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <a
                                            href={`https://explorer.solana.com/tx/${proof.memoSignature}?cluster=devnet`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[#7C5CFC]/60 hover:text-[#7C5CFC] transition-colors shrink-0"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </TooltipTrigger>
                                    <TooltipContent>View on Solana Explorer</TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    </div>

                    <div className="text-right shrink-0">
                        <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">
                            Confidence
                        </div>
                        <div className={cn("text-base font-mono font-bold", confColor)}>
                            {proof.confidence !== null ? proof.confidence.toFixed(2) : "—"}
                        </div>
                    </div>
                </div>
            </div>

            {/* Full detail modal */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    {result && <ProofFullDetailModal result={result} hash={proof.hash} />}
                </DialogContent>
            </Dialog>
        </>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProofOfReasoning({ proofs }: { proofs: ProofRecord[] }) {
    return (
        <div className="glass rounded-2xl flex flex-col overflow-hidden relative">
            {/* Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#7C5CFC]/[0.03] blur-[80px] rounded-full pointer-events-none" />

            {/* Header */}
            <div className="px-4 py-3 border-b border-edge bg-section-header flex items-center justify-between shrink-0 relative gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#7C5CFC]" />
                    Proof-of-Reasoning
                </h3>
                <span className="text-[10px] text-slate-600 font-mono">
                    {proofs.length} record{proofs.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Hash Search */}
            <div className="px-3 pt-3 shrink-0">
                <SearchProof />
            </div>

            {/* Records */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-64 relative">
                {proofs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Fingerprint className="w-5 h-5 text-slate-600 mb-2" />
                        <p className="text-[11px] font-mono text-slate-500">No proofs anchored yet</p>
                        <p className="text-[9px] font-mono text-slate-700 mt-1">SHA-256 hashes appear after agent cycles</p>
                    </div>
                ) : (
                    proofs.map((proof) => <ProofRow key={proof.id} proof={proof} />)
                )}
            </div>
        </div>
    );
}
