"use client";

import { ProofRecord, AgentId } from "@/types";
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
import { ShieldCheck, ExternalLink, Copy, Check, Hash, Fingerprint, Loader2 } from "lucide-react";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { verifyProof } from "@/lib/api";

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

function ProofDetailModal({ proof }: { proof: ProofRecord }) {
    const isVerified = proof.status === "verified";
    const [isVerifying, setIsVerifying] = useState(false);

    const handleVerify = async () => {
        try {
            setIsVerifying(true);
            const res = await verifyProof(proof.hash);
            if (res.verified) {
                toast.success("Integrity Verified", {
                    description: "Solus Protocol Hash matches On-Chain Data",
                });
            } else {
                toast.error("Integrity Verification Failed", {
                    description: "Hash mismatch detected. Record may be tampered.",
                });
            }
        } catch (err) {
            toast.error("Failed to verify proof", {
                description: err instanceof Error ? err.message : "Network error",
            });
        } finally {
            setIsVerifying(false);
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-[#7C5CFC]" />
                    Proof-of-Reasoning Detail
                </DialogTitle>
                <DialogDescription>
                    On-chain proof record for {proof.agentId.toUpperCase()} · Cycle #{proof.cycle}
                </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Status</div>
                        <div className={cn(
                            "text-sm font-mono font-bold capitalize",
                            isVerified ? "text-[#7C5CFC]" : proof.status === "pending" ? "text-slate-400" : "text-[#FF5A5A]"
                        )}>
                            {proof.status}
                        </div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Confidence</div>
                        <div className={cn(
                            "text-sm font-mono font-bold",
                            proof.confidence === null ? "text-slate-500"
                                : proof.confidence >= 0.9 ? "text-[#00D68F]"
                                    : proof.confidence >= 0.7 ? "text-[#FFB547]"
                                        : "text-[#FF5A5A]"
                        )}>
                            {proof.confidence !== null ? proof.confidence.toFixed(2) : "—"}
                        </div>
                    </div>
                </div>

                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1">
                        <Hash className="w-3 h-3" /> SHA-256 Hash
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-300 break-all">{proof.hash}</span>
                        <CopyButton text={proof.hash} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Block</div>
                        <div className="text-sm font-mono font-bold text-white">{proof.blockNumber}</div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Timestamp</div>
                        <div className="text-sm font-mono font-bold text-white">{proof.timestamp}</div>
                    </div>
                </div>

                {proof.memoSignature && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-edge">
                        <a
                            href={`https://explorer.solana.com/tx/${proof.memoSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs font-mono text-[#7C5CFC] hover:text-[#7C5CFC]/80 transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            View on Solana Explorer
                        </a>

                        <button
                            onClick={handleVerify}
                            disabled={isVerifying}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                "bg-[#00D68F]/10 text-[#00D68F] border border-[#00D68F]/20 hover:bg-[#00D68F]/20 disabled:opacity-50"
                            )}
                        >
                            {isVerifying ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <ShieldCheck className="w-3.5 h-3.5" />
                            )}
                            Verify Integrity
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}

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

            {/* Records */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-64 relative">
                {proofs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Fingerprint className="w-5 h-5 text-slate-600 mb-2" />
                        <p className="text-[11px] font-mono text-slate-500">No proofs anchored yet</p>
                        <p className="text-[9px] font-mono text-slate-700 mt-1">SHA-256 hashes appear after agent cycles</p>
                    </div>
                ) : (
                    proofs.map((proof) => {
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

                        return (
                            <Dialog key={proof.id}>
                                <DialogTrigger asChild>
                                    <div
                                        className={cn(
                                            "bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 transition-all cursor-pointer",
                                            AGENT_HOVER[proof.agentId],
                                            isPending && "opacity-60",
                                            isPending && "shimmer",
                                            isVerified && "ring-1 ring-[#7C5CFC]/10"
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
                                                            {proof.agentId.toUpperCase()} · Block {proof.blockNumber}
                                                        </span>
                                                    </div>
                                                    {proof.cycle && (
                                                        <span className="text-[10px] text-slate-700 font-mono">
                                                            Cycle #{proof.cycle}
                                                        </span>
                                                    )}
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
                                </DialogTrigger>
                                <DialogContent>
                                    <ProofDetailModal proof={proof} />
                                </DialogContent>
                            </Dialog>
                        );
                    })
                )}
            </div>
        </div>
    );
}
