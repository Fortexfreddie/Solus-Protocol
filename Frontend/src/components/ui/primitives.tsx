"use client";

import { cn } from "@/lib/utils";
import type { AgentId } from "@/types";

// ─── Badge ────────────────────────────────────────────────────────────────────

interface BadgeProps {
    children: React.ReactNode;
    variant?: "emerald" | "amber" | "red" | "blue" | "violet" | "slate" | "rex" | "nova" | "sage";
    glow?: boolean;
    className?: string;
}

const BADGE_COLORS: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-[#00D68F] border-emerald-500/20",
    amber: "bg-amber-500/10 text-[#FFB547] border-amber-500/20",
    red: "bg-red-500/10 text-[#FF5A5A] border-red-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    violet: "bg-violet-500/10 text-[#7C5CFC] border-violet-500/20",
    slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    rex: "bg-[#FF6B35]/10 text-[#FF6B35] border-[#FF6B35]/25",
    nova: "bg-[#7C5CFC]/10 text-[#7C5CFC] border-[#7C5CFC]/25",
    sage: "bg-[#00D68F]/10 text-[#00D68F] border-[#00D68F]/25",
};

const BADGE_GLOW: Record<string, string> = {
    rex: "shadow-[0_0_12px_rgba(255,107,53,0.15)]",
    nova: "shadow-[0_0_12px_rgba(124,92,252,0.15)]",
    sage: "shadow-[0_0_12px_rgba(0,214,143,0.15)]",
    emerald: "shadow-[0_0_12px_rgba(0,214,143,0.15)]",
    amber: "shadow-[0_0_12px_rgba(255,181,71,0.15)]",
};

export function Badge({ children, variant = "slate", glow = false, className }: BadgeProps) {
    return (
        <span
            className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border tracking-wider uppercase",
                BADGE_COLORS[variant],
                glow && BADGE_GLOW[variant],
                className
            )}
        >
            {children}
        </span>
    );
}

// ─── PingDot ──────────────────────────────────────────────────────────────────

interface PingDotProps {
    color?: "emerald" | "amber" | "red" | "blue" | "violet" | "rex" | "nova" | "sage";
    size?: "sm" | "md";
    className?: string;
}

const PING_COLORS: Record<string, string> = {
    emerald: "bg-[#00D68F]",
    amber: "bg-[#FFB547]",
    red: "bg-[#FF5A5A]",
    blue: "bg-blue-500",
    violet: "bg-[#7C5CFC]",
    rex: "bg-[#FF6B35]",
    nova: "bg-[#7C5CFC]",
    sage: "bg-[#00D68F]",
};

export function PingDot({ color = "emerald", size = "sm", className }: PingDotProps) {
    const sizeClass = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";

    return (
        <span className={cn("relative flex", sizeClass, className)}>
            <span
                className={cn(
                    "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
                    PING_COLORS[color]
                )}
            />
            <span
                className={cn(
                    "relative inline-flex rounded-full",
                    sizeClass,
                    PING_COLORS[color]
                )}
            />
        </span>
    );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

interface DividerProps {
    className?: string;
    gradient?: boolean;
}

export function Divider({ className, gradient }: DividerProps) {
    return (
        <div
            className={cn(
                "h-4 w-px mx-2",
                gradient
                    ? "bg-gradient-to-b from-transparent via-white/10 to-transparent"
                    : "bg-white/10",
                className
            )}
        />
    );
}

// ─── Agent color map ──────────────────────────────────────────────────────────

export const AGENT_COLOR: Record<AgentId, string> = {
    rex: "#FF6B35",
    nova: "#7C5CFC",
    sage: "#00D68F",
};

export const AGENT_BADGE_VARIANT: Record<AgentId, BadgeProps["variant"]> = {
    rex: "rex",
    nova: "nova",
    sage: "sage",
};
