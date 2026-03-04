/**
 * event-bus.ts
 * Centralised Socket.io event emitter for all Solus Protocol WebSocket events.
 *
 * Every layer of every agent cycle emits typed events through this bus. The
 * frontend dashboard subscribes to these events and renders the live 7-layer
 * pipeline visualization, agent cards, transaction feed, and balance charts.
 *
 * All events follow the WsEventEnvelope shape:
 *   { type, agentId, timestamp, payload }
 *
 * The bus is initialised once with the Socket.io Server instance in server.ts
 * and then used as a singleton by every module that needs to emit events.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { AgentId, WsEventType, WsEventEnvelope } from '../types/agent-types.js';

// EventBus class 

export class EventBus {
    private io: SocketIOServer | null = null;

    /**
     * Binds the Socket.io server instance to this bus.
     * Must be called once during server startup before any agent cycles begin.
     */
    init(io: SocketIOServer): void {
        this.io = io;
    }

    /**
     * Emits a typed event to all connected dashboard clients.
     *
     * Every event carries the agent identity and a Unix timestamp so the
     * frontend can sequence events correctly across the three concurrent agents.
     * If the bus has not been initialised (e.g. in smoke tests), the emit is
     * silently skipped — agent logic must never depend on event delivery.
     */
    emit<T>(type: WsEventType, agentId: AgentId, payload: T): void {
        if (!this.io) return;

        const envelope: WsEventEnvelope<T> = {
            type,
            agentId,
            timestamp: Date.now(),
            payload,
        };

        this.io.emit('event', envelope);
    }

    /**
     * Returns true if the bus has been initialised with a Socket.io server.
     * Used by the /health endpoint to report WebSocket readiness.
     */
    isReady(): boolean {
        return this.io !== null;
    }
}

// Singleton 

export const eventBus = new EventBus();