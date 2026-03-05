# Solus Protocol Event Bus (`event-bus.ts`)

**Location:** `src/events/event-bus.ts`  
**Purpose:** A centralized, asynchronous telemetry hub. It routes internal backend state changes to the connected frontend dashboard in real time via WebSockets (Socket.io).

---

## 1. The Pub/Sub Architecture

To keep the system highly decoupled, individual agents do not know that a frontend dashboard exists. 
When an agent moves from Layer 2 (Strategist) to Layer 3 (Guardian), it simply shouts `"I am thinking!"` into the void by calling `eventBus.emit('AGENT_THINKING', ...)`.

The `EventBus` catches this payload, wraps it in a standardized `WsEventEnvelope`, appends a highly accurate Unix timestamp, and broadcasts it to any connected WebSocket clients.

## 2. The Envelope Standard

Every event sent to the frontend is strictly formatted so the React dashboard can easily route and animate the data:
```json
{
    "type": "TX_CONFIRMED",
    "agentId": "rex",
    "timestamp": 1708852345000,
    "payload": {
        "signature": "5K...",
        "amount": 0.2
    }
}