# Solus Protocol

> **Autonomous AI agents that think, get audited, prove their reasoning on-chain, and trade — without human intervention.**

**Superteam Nigeria | DeFi Developer Challenge — Agentic Wallets for AI Agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![Solana](https://img.shields.io/badge/Solana-Devnet-purple)](https://solana.com)

> **[Mission Control Dashboard (frontend)](../frontend/README.md)** | **[Watch the 3-Minute Demo Video Here](link)**

---

## Table of Contents

- [What Is Solus Protocol](#what-is-solus-protocol)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [The 7-Layer Air-Gap Engine](#the-7-layer-air-gap-engine)
- [Agent Personalities](#agent-personalities)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Solus CLI](#solus-cli-command-line-interface)
- [Telegram Integration](#telegram-integration)
- [Docker Deployment](#docker-deployment)
- [Smoke Tests](#smoke-tests)
- [Deploying to Render](#deploying-to-render)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [Security Model](#security-model)
- [Tech Stack](#tech-stack)
- [Architecture Decision Records](#architecture-decision-records)
- [Contributing](#contributing)
- [License](#license)
- [Related Documentation](#related-documentation)

---

## What Is Solus Protocol

Solus Protocol is a production-architecture, multi-agent autonomous wallet system built on Solana. Three AI agents — Rex, Nova, and Sage — each manage an encrypted Solana wallet, analyze live market data, and execute token swaps independently without human intervention.

Every agent decision is processed through a strict **7-Layer Air-Gap Engine**:

1.  Live price data grounds the decision in real market conditions.
2.  A primary LLM (DeepSeek) reasons about the trading opportunity.
3.  A separate adversarial LLM (Google Gemini) audits and can veto the decision.
4.  A deterministic policy engine enforces hard spending rules and risk constraints.
5.  The full reasoning chain is SHA-256 hashed and anchored on-chain prior to execution.
6.  An AES-256-GCM encrypted vault signs the transaction; private keys never touch application logic.
7.  Kora (Solana Foundation's gasless infrastructure) pays the gas fee and submits the transaction to Devnet.

A live Next.js Mission Control dashboard allows observers to monitor all three agents as they think, receive audits, and execute — layer by layer — in real time.

---

## Architecture

The system follows a highly modular, event-driven architecture designed for security, observability, and robust agent isolation:

```mermaid
graph TD
    Client["Mission Control Dashboard (Next.js)"] -->|WebSocket Events| Bus["Event Bus (Socket.io)"]
    Client -->|REST API| API["Express API Server"]
    API --> Orchestrator["Agent Orchestrator"]
    Orchestrator --> AgentRex["Agent: Rex (Aggressive)"]
    Orchestrator --> AgentNova["Agent: Nova (Conservative)"]
    Orchestrator --> AgentSage["Agent: Sage (Balanced)"]
    
    subgraph 7-Layer Air-Gap Engine
        L1["L1: Price Oracle Service"]
        L2["L2: Strategist Service (DeepSeek)"]
        L3["L3: Guardian AI Service (Gemini)"]
        L4["L4: Policy Engine"]
        L5["L5: Proof-of-Reasoning Service"]
        L6["L6: Vault (Wallet Engine)"]
        L7["L7: Kora Paymaster + Broadcast"]
    end

    AgentRex -.-> L1
    L1 -.-> L2
    L2 -.-> L3
    L3 -.-> L4
    L4 -.-> L5
    L5 -.-> L6
    L6 -.-> L7

    L1 -->|HTTP| CoinGecko["CoinGecko Price API"]
    L1 -->|HTTP| JupiterQuote["Jupiter Quote API"]
    L2 -->|OpenAI SDK| DeepSeek["DeepSeek API"]
    L3 -->|OpenAI SDK| Gemini["Google Gemini API"]
    L5 -->|SPL Memo| Solana["Solana Devnet RPC"]
    L6 <-->|Encrypted Storage| DB[("PostgreSQL (Production) / Filesystem (Dev)")]
    L7 -->|RPC Sign| Kora["Kora Paymaster Node"]
    L7 -->|Submit Tx| Jupiter["Jupiter Swap API"]

```

### Core Components
-   **Agent Orchestrator**: Manages the staggered 60-second operational cycles across all three agents to ensure continuous dashboard activity and fair rate limiting.
-   **Price Oracle Service**: Maintains a 30-second TTL cache of live market prices (SOL, USDC, RAY, BONK) from CoinGecko and fetches real execution quotes from Jupiter Quote API for slippage-aware spread analysis.
-   **Strategist Service**: Constructs dynamic prompts using `SKILLS.md` and the agent's personality profile to generate trade decisions.
-   **Guardian Service**: Evaluates the Strategist's reasoning, returning `APPROVE`, `VETO`, or `MODIFY` based on strict risk criteria.
-   **Policy Engine**: Enforces immutable constraints, including daily volume caps, max transaction limits, and a stop-loss circuit.
-   **Proof-of-Reasoning Service**: Generates a tamper-evident SHA-256 hash of the full decision context and anchors it on-chain prior to execution.
-   **Vault**: Secures AES-256-GCM encrypted keypairs, decrypting only into memory buffers during signing and immediately zeroing the buffer afterward. Supports dual-mode persistence (Filesystem for local dev, PostgreSQL for production).
-   **Kora Paymaster**: Co-signs transactions as the fee payer, allowing agents to operate entirely in USDC and SPL tokens without requiring SOL for native swap gas.

---

## How It Works

```text
Agent Cycle (every 60 seconds, staggered across 3 agents)

Rex  → runs at T+0s
Nova → runs at T+20s
Sage → runs at T+40s

Each cycle:

  [L1]  Price Oracle    — fetch SOL/USDC/RAY/BONK prices from CoinGecko (30s TTL cache)
  [L1b] Execution Quote — fetch Jupiter quote for best candidate pair (net spread after slippage)
  [L2]  Strategist      — DeepSeek reasons: SWAP / HOLD / SKIP + confidence score
  [L3]  Guardian        — Gemini audits: APPROVE / VETO / MODIFY
  [L4]  Policy Engine   — 9 hard checks: amount caps, daily limits, stop-loss, rate limits
  [L5]  Proof-of-Reason — SHA-256 hash of full decision → Solana Memo tx (on-chain)
  [L6]  Vault           — AES-256-GCM decrypt → sign tx → zero key buffer
  [L7]  Kora + Broadcast— Kora co-signs as fee payer → submit to Devnet → confirm

Every step broadcasts a WebSocket event to the dashboard.
Every step is appended to the audit log.
```

---

## The 7-Layer Air-Gap Engine

### Layer 1 — Price Oracle
Fetches live prices from CoinGecko for SOL, USDC, RAY, and BONK. Calculates momentum divergence spreads between token pairs. Results are cached for 30 seconds and shared across all three agents. On API failure, it falls back to the last cached data with a `stale: true` flag.

### Layer 1b — Execution Quote
A Jupiter execution quote is fetched per agent cycle using a rotating pair selection strategy. All non-neutral momentum pairs are ranked by divergence, and each cycle evaluates the next pair in the rotation — ensuring all candidate pairs get real execution data over time rather than repeatedly evaluating the highest-divergence pair, which may have consistently negative executable spreads due to Devnet pool depth. Jupiter failure is non-fatal — the cycle continues with CoinGecko data only.

### Layer 2 — Strategist (DeepSeek)
Reads `SKILLS.md` from disk at call time and injects it as the base system prompt. Appends the agent's personality profile (Rex/Nova/Sage). Calls `deepseek-chat` via the OpenAI SDK with a strict JSON output schema. Output is validated with Zod before proceeding. Malformed output ends the cycle cleanly with a logged parse error.

### Layer 3 — Guardian AI (Google Gemini)
A completely separate AI provider from the Strategist. Gemini's sole objective is to challenge the Strategist's decision. It receives the full decision, reasoning, and market context, then returns `APPROVE`, `VETO`, or `MODIFY`. A VETO immediately halts the cycle. A MODIFY adjusts the transaction amount. Utilizing distinct providers ensures the models do not share the same failure modes or biases.

### Layer 4 — Policy Engine
Nine deterministic checks that neither LLM can circumvent:

| # | Check | Rex (Aggressive) | Nova (Conservative) | Sage (Balanced) |
|---|-------|------------------|---------------------|-----------------|
| 1 | Action whitelist | SWAP/HOLD/SKIP only | Same | Same |
| 2 | Token whitelist | SOL/USDC/RAY/BONK | Same | Same |
| 3 | Min confidence | 0.45 | 0.65 | 0.55 |
| 4 | Volatility-adjusted sizing | `safeAmt = max × conf × (1-penalty)` | Same formula | Same formula |
| 5 | Daily volume cap | 1.0 SOL | 0.3 SOL | 0.5 SOL |
| 6 | Rate limit | 5 tx/min | Same | Same |
| 7 | Balance check | amount + fee available | Same | Same |
| 8 | Spread threshold | >= 0.15% (net) | >= 0.5% (net) | >= 0.3% (net) |
| 9 | Stop-loss circuit | -20% drawdown | -10% | -15% |

### Layer 5 — Proof-of-Reasoning
Before any transaction is signed, a proof payload is constructed containing the complete Strategist decision, Guardian verdict, policy check results, and the price snapshot at the moment of decision. This payload is SHA-256 hashed and submitted as a Solana Memo transaction on Devnet. The on-chain hash aligns with the local audit log, making the process tamper-evident by design. Any external party can verify that the agent reasoned logically before executing.

### Layer 6 — Vault
Employs AES-256-GCM encryption with PBKDF2 key derivation (200,000 iterations, SHA-512). The encryption password is derived from `VAULT_MASTER_KEY::agentId` — ensuring uniqueness per agent. At signing time: decrypts the keypair into a temporary `Buffer`, signs the transaction, immediately executes `buffer.fill(0)`, and marks it ready for garbage collection. Private keys never touch LLM layers, do not log, and never transmit over the network.

**Dual-mode persistence:**
-   `NODE_ENV=development` — encrypted vault files are stored at `./wallets/*.vault.json`. PnL baselines saved alongside as `*.baseline.json`.
-   `NODE_ENV=production` — encrypted vault bytes and the agent's `startingBalanceSol` persist in a PostgreSQL `AgentWallet` table (Supabase) via Prisma, ensuring data survives redeploys.

### Layer 7 — Kora Paymaster + Broadcast
Kora serves as the Solana Foundation's official gasless signing infrastructure. The agent's Vault signs the transaction intent (proving authorization). Kora then co-signs as the fee payer. This means agents never need SOL for swap gas — Kora covers it entirely. A small SOL reserve is still required for Proof-of-Reasoning Memo transactions (Layer 5), which the agent pays for directly. Following the Kora co-sign, the completed transaction is submitted to Devnet RPC and polled for confirmation.

---

## Agent Personalities

| Property | Rex (Aggressive) | Nova (Conservative) | Sage (Balanced) |
|----------|------------------|---------------------|-----------------|
| **Cycle offset** | 0s | 20s | 40s |
| **Spread threshold** | >= 0.15% | >= 0.5% | >= 0.3% |
| **Min confidence** | 0.45 | 0.65 | 0.55 |
| **Max tx** | 0.2 SOL | 0.05 SOL | 0.1 SOL |
| **Daily cap** | 1.0 SOL | 0.3 SOL | 0.5 SOL |
| **Stop-loss** | -20% | -10% | -15% |
| **Token focus** | Any pair | Stablecoin pairs | Broad range |
| **Directive** | Act fast. Capture spreads aggressively. | Capital preservation. High certainty only. | Balance risk and opportunity. |

---

## Project Structure

```text
solus-protocol/
│
├── docker-compose.yml         # Full-stack orchestration (Kora, Redis, Backend, Frontend)
│
├── backend/
│   ├── src/
│   │   ├── agent/             # Single agent pipeline and multi-agent orchestrator
│   │   ├── api/               # Express REST routes and controllers
│   │   │   ├── controllers/   # Request handlers
│   │   │   └── routes/        # Route definitions
│   │   ├── brain/             # LLM orchestration (Strategist/Guardian)
│   │   ├── cli/               # Solus CLI (Commander.js)
│   │   │   ├── commands/      # Individual command implementations
│   │   │   │   ├── control.ts # pause / resume / fire commands
│   │   │   │   ├── status.ts  # Fleet leaderboard & PnL table
│   │   │   │   └── tail.ts    # Live WebSocket event log streamer
│   │   │   ├── index.ts       # CLI entry point (program.parse)
│   │   │   └── ui-helpers.ts  # Chalk theme & formatting utilities
│   │   ├── config/            # Runtime configuration (db.ts)
│   │   ├── events/            # WebSocket event bus (Socket.io)
│   │   ├── price/             # Price Oracle and caching mechanisms
│   │   ├── proof/             # SHA-256 and Solana Memo logic
│   │   ├── protocol/          # Kora Paymaster integration and broadcast
│   │   ├── scripts/           # Smoke test runners and utilities
│   │   ├── security/          # Policy Engine, profiles, audit logger
│   │   ├── types/             # Shared TypeScript definitions
│   │   ├── wallet/            # AES-256 Vault, KeyStore, and token management
│   │   ├── app.ts             # Express app setup, middleware, Socket.io, Swagger
│   │   └── index.ts           # Application entry point (bootstrap + orchestrator)
│   │
│   ├── docs/                  # Swagger / OpenAPI specification
│   │   └── swagger.json
│   ├── prisma/                # Database schema and migrations (PostgreSQL)
│   ├── wallets/               # Encrypted vault files for local dev
│   ├── logs/                  # Dev audit log output
│   ├── Dockerfile             # Multi-stage Node.js 20 Alpine image
│   ├── .dockerignore
│   ├── .env.example
│   ├── prisma.config.ts       # Prisma config for custom output paths
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── app/                   # Next.js App Router and dashboard layout
│   ├── components/            # UI pieces (Card, Pipeline, Thinking Panel, etc.)
│   ├── hooks/                 # Real-time WebSocket aggregators
│   ├── lib/                   # API clients (SWR setup)
│   ├── types/
│   ├── Dockerfile             # Next.js production image
│   ├── package.json
│   └── next.config.js
│
├── kora/                      # Bundled Kora Paymaster source & config
├── SKILLS.md                  # Agent operator manual (Dynamic prompt base)
├── DEEP_DIVE.md               # Technical architecture deep dive
└── README.md                  # System overview and setup guide
```

---

## Prerequisites

Before initialization, confirm you have the following installed:

-   **Node.js** 20 or higher
-   **pnpm** (recommended) or npm
-   **Git**

API keys required:
-   **DeepSeek:** For the Strategist LLM.
-   **Google Gemini:** For the Guardian LLM.
-   **Kora:** For the Solana gasless paymaster.
-   **PostgreSQL/Supabase:** Only required for production deployments.

---

## Installation

### 1. Clone the Repository
```bash
git clone https://github.com/Fortexfreddie/Solus-Protocol.git
cd Solus-Protocol
```

### 2. Install backend Dependencies
```bash
cd backend
pnpm install
```

### 3. Install frontend Dependencies
```bash
cd ../frontend
pnpm install
```

### 4. Set Environment Variables
```bash
cd ../backend
cp .env.example .env
```
Ensure all variables within the `.env` file are explicitly defined before starting the server.

### 5. Generate Prisma Client
```bash
pnpm prisma generate
```

*(Production only)* Run database migrations:
```bash
pnpm prisma migrate deploy
```

### 6. Build the Application
```bash
pnpm build
```

---

## Kora Paymaster Setup & Integration

Follow these steps to get your local gasless infrastructure running alongside **Solus Protocol**.

### 1. Installation & Build

The customized Kora CLI configuration is bundled directly within this monorepo to ensure seamless gasless integration. Note: you need Rust and Cargo installed to build it.

```bash
# Enter the Kora directory from the root
cd ../kora

# Install the Kora CLI using Cargo (Standard Rust installation)
cargo install --path crates/cli
```

### 2. Configuration (`.env`)

Create a `.env` file in the root of the **kora** folder and add your sensitive keys.

```bash
# Solana Network (Use a private RPC like Helius to avoid rate limits)
RPC_URL=https://api.devnet.solana.com

# The fee-payer wallet private key (e.g., your aDRu8... address)
KORA_PRIVATE_KEY=your_base58_private_key_here

# Authentication Secrets (Generate 32-character random strings)
KORA_API_KEY=your_generated_api_key_here
KORA_HMAC_SECRET=your_generated_hmac_secret_here
```

### 3. Signer & Validation Setup

Ensure your `signers.toml` and `kora.toml` are configured to use these environment variables.

**In `signers.toml`:**

```toml
[signer_pool]
strategy = "round_robin"

[[signers]]
name = "main_signer"
type = "memory"
private_key_env = "KORA_PRIVATE_KEY"
```

### 4. Running the Paymaster

You must start the Kora server before running the Solus backend so the agents have a service to talk to.

```bash
# Run the RPC server from the bundled kora directory
kora --config kora.toml rpc start --signers-config signers.toml
```

*Wait for the log: `INFO kora_lib::rpc_server::server: RPC server started on 0.0.0.0:8080`.*

### 5. Linking to Solus Protocol

Navigate back to your **backend** folder and update your `.env` to match the Kora credentials.

```bash
# Enter Solus backend
cd ../backend

# Add these to your .env
KORA_RPC_URL=http://localhost:8080
PUBLIC_KORA_API_KEY=your_generated_api_key_here
PUBLIC_KORA_HMAC_SECRET=your_generated_hmac_secret_here
```

### 6. Verify Connection

Run your test script to ensure the Solus backend can successfully authenticate with the Kora node.

```bash
npx tsx src/scripts/test-kora.ts
```

*You should see a success log indicating successful connection to the Kora server.*

---

## Environment Variables

The backend `.env` file configuration requires strict adherence:

```env
# ─── Solana ───────────────────────────────────────────────────────────────────
# Must contain "devnet" — mainnet URLs trigger a startup crash
SOLANA_RPC_URL=https://api.devnet.solana.com

# ─── Vault ────────────────────────────────────────────────────────────────────
# Master key used to derive per-agent encryption passwords
VAULT_MASTER_KEY=your_strong_random_hex_key_here

# ─── Funding ──────────────────────────────────────────────────────────────────
# Base58 secret key of the wallet you funded via faucet.solana.com
# Used by pnpm smoke:vault to top up Rex, Nova, and Sage to 0.5 SOL each
FUNDER_SECRET_KEY=your_base58_wallet_secret_key_here

# ─── Kora Paymaster ───────────────────────────────────────────────────────────
# Kora node URL (local or hosted)
KORA_RPC_URL=http://localhost:8080
KORA_API_KEY=your_kora_api_key

# ─── LLM Configuration ────────────────────────────────────────────────────────
DEEPSEEK_API_KEY=your_deepseek_api_key
GEMINI_API_KEY=your_gemini_api_key

# ─── Server Configuration ─────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development

# ─── Database (Production Only) ───────────────────────────────────────────────
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres

# ─── Jupiter Quote API ────────────────────────────────────────────────────────
JUPITER_API_KEY=your_jupiter_api_key_here
```

---

## Running Locally

### Backend Execution

1. Visit [faucet.solana.com](https://faucet.solana.com) — fund your main wallet with 2 SOL
2. Add `FUNDER_SECRET_KEY` to `.env` — this is the base58 secret key of the wallet you just funded
3. Run `pnpm smoke:vault` — auto-funds Rex, Nova, and Sage to 0.5 SOL each
4. Run `pnpm dev` — agents start with funded wallets

> **Note:** Local development defaults to filesystem storage (`/wallets`). No PostgreSQL database is required to run `pnpm dev`.

### Frontend Execution
```bash
cd ../Frontend
pnpm dev
```
Navigate to `http://localhost:3000` to interact with the Mission Control dashboard.

---

## Docker Deployment

The entire Solus Protocol stack can be spun up with a single command using Docker Compose. This is the recommended approach for consistent, reproducible environments.

### Prerequisites
-   **Docker** and **Docker Compose** installed.
-   `.env` files configured in `backend/`, `frontend/`, and `kora/` directories (see [Environment Variables](#environment-variables) and [Kora Paymaster Setup](#kora-paymaster-setup--integration)).

### Backend Dockerfile

The backend image is built from `Node.js 20 Alpine` with Prisma support:

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat   # Required by Prisma on Alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
# ... installs deps, generates Prisma client, builds TypeScript
CMD ["pnpm", "start"]
```

### Running with Docker Compose

From the **repository root**:

```bash
docker-compose up --build -d
```

This orchestrates four services:

| Service | Description | Port |
|---------|-------------|------|
| `redis` | Kora rate-limit cache (Redis 8 Alpine) | `6379` |
| `kora` | Solana gasless paymaster (Rust binary) | `8080` |
| `backend` | Solus Protocol API Engine (Node.js) | `3001` |
| `frontend` | Mission Control Dashboard (Next.js) | `3000` |

Inter-service routing is handled automatically via Docker's internal DNS (e.g., `http://kora:8080`). The backend's local `wallets/` directory is volume-mounted for dev key persistence.

### Useful Docker Commands

```bash
# View live logs across all services
docker-compose logs -f

# Rebuild and restart a single service
docker-compose up --build -d backend

# Tear down all containers and volumes
docker-compose down -v
```

## Smoke Tests

The project includes progressive smoke tests to validate configuration phases.

### Phase 1 — Vault and Solana Core
```bash
cd backend
pnpm smoke:vault
```
Verifies wallet generation, Devnet connection, Kora connectivity, and agent funding.

### Phase 2 — Price Oracle and LLM Layers
```bash
pnpm smoke:phase2
```
Confirms DeepSeek inference parsing and Google Gemini active monitoring.

### Phase 3 — Policy Engine and Proof-of-Reasoning
```bash
pnpm smoke:phase3
```
Validates the local hash and Devnet on-chain anchoring sequence.

### Phase 4 — Full 7-Layer Pipeline Evaluation
```bash
pnpm smoke:phase4
```
Executes a complete end-to-end agent cycle simulation.

---

## Deploying to Render

### backend Service
1.  Configure a generic Web Service.
2.  Set Root Directory to `backend`.
3.  Command: `pnpm install && pnpm build && pnpm prisma migrate deploy`
4.  Start Command: `pnpm start`
5.  Assign `NODE_ENV=production` alongside all `.env` specifications. Database URLs must securely route to the PostgreSQL cluster.

### frontend Service
1.  Configure a Static Site module.
2.  Set Root Directory to `frontend`.
3.  Command: `pnpm install && pnpm build`
4.  Publish Directory: `.next`
5.  Assign `NEXT_PUBLIC_backend_URL` to route correctly.

---

## Solus CLI (Command Line Interface)

The backend includes a fully-featured CLI for real-time portfolio monitoring and agent control directly from your terminal.

### Running Locally (No Docker)
Ensure the backend server is running (`pnpm dev`), then open a new terminal in the `backend` directory:

-   `pnpm solus status` — View the live fleet PnL leaderboard, aggregate swap counts, and active operational status.
-   `pnpm solus tail <agentId>` — Stream the live 7-layer event bus payloads for a specific agent (e.g., `pnpm solus tail rex`).
-   `pnpm solus pause <agentId>` — **Kill Switch:** Stop an agent from commencing future cycles.
-   `pnpm solus resume <agentId>` — Resume a paused agent.
-   `pnpm solus fire <agentId>` — **Force Run:** Trigger an immediate out-of-schedule cycle for an agent (bypasses the 60s timer, subject to a 15s rate limit).

### Running via Docker
If the Solus Protocol stack is running via Docker Compose, you **do not** need to `cd` into the backend or install dependencies locally. 

Instead, use the included wrapper scripts in the project root to execute the CLI directly inside the running `backend` container:

-   `./solus status` (or `.\solus status` on Windows PowerShell)
-   `./solus tail rex`
-   `./solus pause nova`

> **Note:** All commands target `localhost:3001` by default. You can override this using the `-p <port>` flag (e.g., `.\solus status -p 8080`).

---

---

## Telegram Integration

Solus Protocol supports out-of-band monitoring and remote control via a Telegram bot. The bot provides "High-Value" filtering to ensure alerts are actionable and low-noise.

### Features
- **Push Notifications**: Real-time alerts for swap confirmations, failed trades, Guardian vetoes, and stop-loss triggers.
- **Silent Guardian**: Only notifies on critical safety interventions (VETO/MODIFY), keeping approvals silent.
- **Remote Control**: Administrative commands to pause/resume agents or force manual cycles.

### Configuration
Add the following to your `.env`:
```env
TELEGRAM_BOT_TOKEN=your_token_from_botfather
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_ADMIN_ID=your_telegram_user_id  # Required for commands
```

### Commands
- `/status` — Fleet PnL and cycle counts.
- `/balances` — Live SOL balances.
- `/agents` — Operational health (ACTIVE/PAUSED).
- `/pause <id>` — Emergency Kill Switch (e.g., `/pause rex`).
- `/resume <id>` — Resume a paused agent.
- `/fire <id>` — Trigger an immediate out-of-schedule cycle.

---

## API Reference

All REST endpoints operate on JSON schemas.

### Core Metrics
-   `GET /health` — Verifies full system dependencies.
-   `GET /api/agents` — Exports live status, operational status, and active parameter mapping.
-   `GET /api/agents/:id` — Single agent profile, cycle count, and operational status.
-   `GET /api/agents/:id/balance` — Live on-chain balance (SOL + SPL tokens).
-   `GET /api/agents/:id/history` — Recent transaction history and swap records for an agent.
-   `GET /api/prices` — Current prices and momentum divergence spreads.

### Agent Command Center
-   `PATCH /api/agents/:id/status` — **Kill Switch** — pause or resume an agent. Body: `{ "status": "ACTIVE" | "PAUSED" }`.
-   `POST /api/agents/:id/run` — **Force Run** — trigger an immediate out-of-schedule cycle. Returns 202 (accepted), 403 (agent paused), or 429 (15s cooldown).

### Audit & Traceability
-   `GET /api/proofs` — Paginated history of on-chain proof anchors.
-   `GET /api/proofs/:hash` — Verification record for a specific proof hash.
-   `GET /api/logs?page=1&limit=50` — Paginated audit stream across all three agents.

### Leaderboard
-   `GET /api/leaderboard` — Returns all three agents ranked by net PnL (descending). Computes live portfolio valuation (SOL + USDC + RAY + BONK) against each agent's 0.5 SOL starting baseline.

---

## WebSocket Events

A comprehensive live stream emitted continuously via `ws://localhost:3001`.

**Event Structure:**
```typescript
{
  type: string,
  agentId: 'rex' | 'nova' | 'sage',
  timestamp: number,
  payload: object
}
```

Prominent events include `AGENT_THINKING`, `GUARDIAN_AUDIT`, `POLICY_PASS`, `PROOF_ANCHORED`, `TX_CONFIRMED`, and `AGENT_COMMAND` (emitted on Kill Switch status changes and Force Run triggers). The frontend utilizes these triggers to map real-time processing directly to the UI.

---

## Security Model

The security model operates on a principle of absolute isolation:

-   **Key Management:** AES-256-GCM encrypted vaults with PBKDF2-derived keys ensure private keys exist in plaintext only during the signing window — milliseconds — and are explicitly zeroed immediately after.
-   **Kora Gas Abstraction:** Restricts application spending authorization entirely to explicitly signed intents; Kora acts passively as fee payer only.
-   **Network Isolation:** A hard mainnet guard at vault construction time rejects any RPC URL that does not contain `devnet`. There is no code path that touches mainnet.
-   **Verification Chains:** Proof-of-Reasoning transactions embed immutable SHA-256 hashes on-chain before any swap is signed, creating a tamper-evident audit trail.

See [DEEP_DIVE.md](./DEEP_DIVE.md) for expanded protocol specifications.

---

## Tech Stack

**Backend Architecture:**
Node.js, TypeScript, Express.js, Socket.io, `@solana/web3.js`, `@solana/spl-token`, `@solana/kora`, `@jup-ag/api`, OpenAI SDK, Prisma, PostgreSQL, Zod, and Winston.

**Frontend Interface:**
Next.js 14, React, Tailwind CSS, Recharts, Framer Motion, SWR.

---

## Architecture Decision Records

Detailed explanations for all architectural decisions — including the dual-model adversarial AI pipeline, gasless abstractions, on-chain proof anchoring, and dual-mode persistence — can be found in [DEEP_DIVE.md](./DEEP_DIVE.md).

---

## Contributing

1.  Fork the repository.
2.  Checkout a feature branch: `git checkout -b feature/your-feature`.
3.  Run `pnpm tsc --noEmit` before submitting.
4.  Verify functionality running `pnpm smoke:phase4`.
5.  Submit a PR with a clear description of what changed and why.

---

## License

MIT — see [LICENSE](./LICENSE) for details.

---

## Related Documentation

-   [DEEP_DIVE.md](./DEEP_DIVE.md) — Comprehensive technical overview.
-   [SKILLS.md](./SKILLS.md) — Operational context injected into agent logic.

---

*Built for the Superteam Nigeria DeFi Developer Challenge.*  
*Solus Protocol — Autonomous. Auditable. On-chain.*