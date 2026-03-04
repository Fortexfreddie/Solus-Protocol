# Solus Protocol Orchestrator (`agent-orchestrator.ts`)

**Location:** `src/agent/agent-orchestrator.ts`  
**Purpose:** The central heartbeat of the backend. It instantiates the three agent class objects (Rex, Nova, Sage) and manages their execution lifecycles in parallel.

---

## 1. Staggered Execution (T+0, T+20, T+40)
If all three agents fired at exactly `T+0` every minute, the backend would spike with three simultaneous LLM calls, three simultaneous Oracle fetches, and a cluster of WebSocket events, followed by 55 seconds of total silence.

To create a smooth, continuous dashboard experience and prevent RPC rate-limiting, the orchestrator staggers the agents:
* **Rex** starts immediately (`offset: 0`).
* **Nova** starts 20 seconds later (`offset: 20000`).
* **Sage** starts 40 seconds later (`offset: 40000`).

Once their initial offset is complete, each agent enters its own isolated 60-second `setInterval` loop. 

## 2. Crash Immunity
The `runAgentCycle` method wraps the `agent.runCycle()` call in a final `try/catch`. 
If a catastrophic failure occurs inside an agent that somehow bypasses the agent's internal error handling, the orchestrator catches it, writes an `ORCHESTRATOR_CYCLE_ERROR` to the `AuditLogger`, and allows the timer to continue. One agent crashing will never take down the other two, nor will it stop the broken agent from attempting its next cycle 60 seconds later.