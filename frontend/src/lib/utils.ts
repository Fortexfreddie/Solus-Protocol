import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatPrice(price: number): string {
    if (price < 0.001) return `$${price.toFixed(7)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPnL(pnl: number): string {
    const sign = pnl >= 0 ? "+" : "";
    return `${sign}${pnl.toFixed(2)} SOL`;
}

export function formatPercent(pct: number): string {
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
}

export function formatEquity(equity: number): string {
    return `$${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
