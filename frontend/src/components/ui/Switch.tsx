"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

interface SwitchProps {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    accentColor?: "emerald" | "amber" | "blue";
    className?: string;
}

const ACCENT_TRACK: Record<string, string> = {
    emerald: "data-[state=checked]:bg-[#00D68F] data-[state=checked]:border-[#00D68F]/40 data-[state=checked]:shadow-[0_0_10px_rgba(0,214,143,0.3)]",
    amber: "data-[state=checked]:bg-[#FF6B35] data-[state=checked]:border-[#FF6B35]/40 data-[state=checked]:shadow-[0_0_10px_rgba(255,107,53,0.3)]",
    blue: "data-[state=checked]:bg-[#7C5CFC] data-[state=checked]:border-[#7C5CFC]/40 data-[state=checked]:shadow-[0_0_10px_rgba(124,92,252,0.3)]",
};

export function Switch({
    checked,
    onCheckedChange,
    disabled = false,
    accentColor = "emerald",
    className,
}: SwitchProps) {
    return (
        <SwitchPrimitive.Root
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
                "border border-edge bg-panel transition-all duration-300",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                "disabled:cursor-not-allowed disabled:opacity-50",
                ACCENT_TRACK[accentColor],
                className
            )}
        >
            <SwitchPrimitive.Thumb
                className={cn(
                    "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-lg ring-0",
                    "transition-transform duration-300",
                    "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[3px]"
                )}
            />
        </SwitchPrimitive.Root>
    );
}
