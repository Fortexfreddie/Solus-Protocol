"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
    HTMLDivElement,
    TabsPrimitive.TabsListProps
>(({ className, ...props }, ref) => (
    <TabsPrimitive.List
        ref={ref}
        className={cn(
            "inline-flex items-center gap-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-1",
            className
        )}
        {...props}
    />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
    HTMLButtonElement,
    TabsPrimitive.TabsTriggerProps & { accentColor?: string }
>(({ className, accentColor, ...props }, ref) => (
    <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5",
            "text-[10px] font-bold font-mono uppercase tracking-wider",
            "text-slate-500 transition-all duration-200",
            "hover:text-slate-300 hover:bg-white/[0.04]",
            "data-[state=active]:bg-white/[0.08] data-[state=active]:text-white",
            "data-[state=active]:shadow-[0_0_12px_rgba(255,255,255,0.05)]",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
            accentColor,
            className
        )}
        {...props}
    />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
    HTMLDivElement,
    TabsPrimitive.TabsContentProps
>(({ className, ...props }, ref) => (
    <TabsPrimitive.Content
        ref={ref}
        className={cn(
            "mt-3 focus-visible:outline-none",
            "data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1",
            className
        )}
        {...props}
    />
));
TabsContent.displayName = "TabsContent";
