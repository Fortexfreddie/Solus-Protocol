# Solus Protocol Audit Logger (`audit-logger.ts`)

**Location:** `src/brain/audit-logger.ts`
**Purpose:** Provides an append-only, tamper-evident record of every AI decision, policy check, and on-chain transaction.

---

## 1. The Single Source of Truth
To prove that our agents are safe, we must record everything they do. The `AuditLogger` outputs `NDJSON` (Newline-Delimited JSON) to `./logs/audit.jsonl`. 
Because Winston is configured with `{ flags: 'a' }` (append-only), the system physically cannot rewrite its own history. If an agent hallucinates, it stays in the log forever.

## 2. In-Memory Circular Buffer
Reading a massive JSON file from the disk every time the dashboard needs to render the agent's history would cripple the backend. 
To prevent this, the `AuditLogger` maintains a strict `MAX_IN_MEMORY = 1000` array. 
* All `GET /api/logs` requests hit this array instantly in `O(1)` time.
* As array length exceeds 1000, the oldest entries are efficiently shifted out of memory (while remaining safely on disk).

## 3. Policy Engine Interoperability
The `PolicyEngine` relies directly on the `AuditLogger` to enforce constraints. By querying the fast in-memory buffer via `getDailyVolumeSOL`, the engine can instantly calculate if an agent is about to breach their `dailyVolumeCapSol` limit without performing a single disk read.