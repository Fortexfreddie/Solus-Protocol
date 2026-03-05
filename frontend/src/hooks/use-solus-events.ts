"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useSWRConfig } from "swr";
import type { AgentId } from "@/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";

export interface SolusEvent {
    type: string;
    agentId: AgentId;
    timestamp: number;
    payload: Record<string, unknown>;
}

type EventHandler = (event: SolusEvent) => void;

/**
 * useSolusEvents — connects to the backend Socket.io server and listens
 * for real-time pipeline events. Automatically invalidates SWR caches
 * on key events so the UI stays fresh.
 */
export function useSolusEvents(onEvent?: EventHandler) {
    const socketRef = useRef<Socket | null>(null);
    const { mutate } = useSWRConfig();
    const [isConnected, setIsConnected] = useState(false);
    const handlerRef = useRef<EventHandler | undefined>(onEvent);
    handlerRef.current = onEvent;

    useEffect(() => {
        const socket = io(WS_URL, {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
        });

        socketRef.current = socket;

        socket.on("event", (envelope: SolusEvent) => {
            // Call user handler
            handlerRef.current?.(envelope);

            // SWR cache invalidation based on event type
            switch (envelope.type) {
                case "TX_CONFIRMED":
                case "BALANCE_UPDATE":
                    mutate("agents");
                    mutate("leaderboard");
                    break;
                case "PROOF_ANCHORED":
                    mutate("proofs");
                    break;
                case "PRICE_FETCHED":
                    mutate("prices");
                    break;
                case "AGENT_COMMAND":
                    mutate("agents");
                    break;
            }

            // Always refresh audit log on any event
            mutate("audit-log");
        });

        socket.on("connect", () => {
            console.log("[Solus WS] Connected");
            setIsConnected(true);
        });

        socket.on("disconnect", (reason) => {
            console.log("[Solus WS] Disconnected:", reason);
            setIsConnected(false);
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [mutate]);

    const emit = useCallback((event: string, data?: unknown) => {
        socketRef.current?.emit(event, data);
    }, []);

    return { emit, isConnected };
}
