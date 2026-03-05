"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
    const { resolvedTheme } = useTheme();

    return (
        <SonnerToaster
            theme={resolvedTheme as "light" | "dark" | undefined}
            position="bottom-right"
            toastOptions={{
                duration: 5000,
                style: {
                    background: "var(--bg-glass-strong)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    backdropFilter: "blur(16px)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                },
            }}
            closeButton
            richColors
        />
    );
}
