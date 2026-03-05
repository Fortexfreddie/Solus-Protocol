# Solus Protocol — Mission Control Dashboard

> **Real-time observability into Rex, Nova, and Sage as they think, get audited, prove their reasoning on-chain, and trade — without human intervention.**

**Superteam Nigeria | DeFi Developer Challenge — Agentic Wallets for AI Agents**

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC)](https://tailwindcss.com)
[![Radix UI](https://img.shields.io/badge/Radix_UI-Primitives-161618)](https://www.radix-ui.com)
[![Socket.io](https://img.shields.io/badge/Socket.io-Client-010101)](https://socket.io)

> **[backend Engine & Full System Docs](../backend/README.md)**

---

## Table of Contents

- [What Is Mission Control](#what-is-mission-control)
- [Architecture](#architecture)
- [Data Pipeline](#data-pipeline)
- [Real-Time WebSocket Events](#real-time-websocket-events)
- [Agent Actions](#agent-actions)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Building for Production](#building-for-production)
- [Design System](#design-system)
- [Related Documentation](#related-documentation)

---

## What Is Mission Control

Mission Control is the live dashboard for Solus Protocol — a multi-agent autonomous wallet system on Solana. It renders the full 7-layer AI pipeline in real-time as three agents (Rex, Nova, Sage) independently analyze markets, reason about trades, get audited by adversarial AI, and execute swaps on Devnet.

The dashboard provides:

- **Agent Cards** — Live status, pipeline steps, PnL, kill switch, and force run controls
- **Strategist Terminal** — Real-time LLM reasoning output from DeepSeek
- **Policy Engine Panel** — 9 deterministic checks visualized per cycle
- **Audit Feed** — Filterable log of all system events with severity color-coding
- **Proof-of-Reasoning** — On-chain SHA-256 hash records with Solana Explorer links
- **Leaderboard** — Agents ranked by net PnL with live portfolio valuations
- **Live Prices** — Token prices (SOL, USDC, RAY, BONK) from CoinGecko + Jupiter
- **System Health** — RPC, Kora paymaster, Oracle, and WebSocket status

---

## Architecture

The frontend uses a dual data strategy: **SWR polling** for consistent state and **Socket.io WebSocket** for instant pipeline updates.

```text
┌──────────────────────────────────────────────────────────┐
│                    page.tsx (client)                       │
│                                                           │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │  useAgents()  │  │  usePrices()  │  │ useSolusEvents│  │
│  │  useLead..()  │  │  useProofs()  │  │   (WebSocket) │  │
│  │  useAudit()   │  │  useHealth()  │  │               │  │
│  │ useAgentHis() │  │               │  │               │  │
│  └──────┬────────┘  └──────┬────────┘  └───────┬───────┘  │
│         │                  │                   │          │
│         └──────────┐       │      ┌────────────┘          │
│                    ▼       ▼      ▼                       │
│              src/lib/api.ts                               │
│       (retry, typed errors, all endpoints)                │
│                    │              │                        │
└────────────────────┼──────────────┼────────────────────────┘
                     │              │
           REST (SWR poll)    WebSocket (socket.io)
                     │              │
                     ▼              ▼
            Express + Socket.io Backend
                 localhost:3001
```

### Core Components

- **API Client (`src/lib/api.ts`)**: Central fetch wrapper with 3-attempt exponential backoff retry on 5xx/network errors, typed `ApiError` class, and dedicated methods for all 9 backend endpoints.
- **SWR Hooks (`src/hooks/`)**: Each backend resource has a dedicated hook with optimized polling intervals and deduplication.
- **WebSocket Hook (`use-solus-events.ts`)**: Auto-reconnecting Socket.io client that invalidates SWR caches on key events — enabling instant UI updates without waiting for the next poll cycle.
- **Toast System**: Sonner-powered notifications with glassmorphism styling for all user actions (toggle, force run) with specific feedback for 403 (agent paused) and 429 (cooldown).

---

## Data Pipeline

Every UI component is fed by a dedicated SWR hook that polls the backend at optimized intervals:

| `useAgents()` | `GET /api/agents` + `/api/agents/:id/balance` | 10s | AgentCard, Header stats |
| `usePrices()` | `GET /api/prices` | 15s | LivePrices |
| `useLeaderboard()` | `GET /api/leaderboard` | 15s | Leaderboard, Header stats |
| `useProofs()` | `GET /api/proofs` | 20s | ProofOfReasoning, Header stats |
| `useAuditLog()` | `GET /api/logs?page=1&limit=50` | 10s | AuditFeed |
| `useSystemHealth()` | `GET /health` | 20s | SystemStatus |
| `useAgentHistory()` | `GET /api/agents/:id/history` | 15s | AgentCard (History Tab) |

### Error Handling & Retry

The API client implements a robust error strategy:

| Scenario | Behavior |
|----------|----------|
| Network failure / 5xx | Retry up to 3 times with exponential backoff (1s, 2s, 4s) |
| 4xx client errors | Fail immediately — no retry |
| 403 (agent paused) | Toast: "Agent is paused. Resume first." |
| 429 (cooldown) | Toast: "Cooldown active. Wait 15 seconds." |
| Backend offline | Loading spinner: "Connecting to Solus Protocol..." |

---

## Real-Time WebSocket Events

The WebSocket hook connects to the backend's Socket.io server and listens on the `event` channel. Each event follows the `WsEventEnvelope` shape:

```typescript
{
  type: WsEventType,
  agentId: 'rex' | 'nova' | 'sage',
  timestamp: number,
  payload: object
}
```

### Event → UI Mapping

| Event Type | Pipeline Step | SWR Cache Invalidated |
|------------|--------------|----------------------|
| `PRICE_FETCHED` | Price Oracle → done | `prices` |
| `AGENT_THINKING` | Strategist → done | — |
| `GUARDIAN_AUDIT` | Guardian → done | — |
| `POLICY_PASS` / `POLICY_FAIL` | Policy Engine → done/error | — |
| `PROOF_ANCHORED` | Proof-of-Reasoning → done | `proofs` |
| `TX_SIGNING` / `TX_CONFIRMED` | Vault Sign → done | `agents`, `leaderboard` |
| `BALANCE_UPDATE` | — | `agents`, `leaderboard` |
| `AGENT_COMMAND` | — | `agents` |

All events also trigger an `audit-log` cache refresh.

### Pipeline State Machine

When a `PRICE_FETCHED` event arrives for an agent, the pipeline resets and begins progressing step-by-step. Earlier steps are auto-completed when a later step event arrives (e.g., receiving `GUARDIAN_AUDIT` marks both `price` and `strategist` as done).

---

## Agent Actions

### Kill Switch (Toggle)

Optimistic UI update — the switch toggles immediately. On success, a toast confirms the action. On failure, the switch reverts.

```
User toggles switch → Optimistic UI update → PATCH /api/agents/:id/status
  → Success: toast("REX paused") + SWR revalidation
  → Failure: revert switch + toast.error(message)
```

### Force Run

Triggers an immediate out-of-schedule agent cycle. Pipeline resets to show the new cycle progressing.

```
User clicks Force Run → POST /api/agents/:id/run
  → 202: toast.success("Force run triggered") + reset pipeline
  → 403: toast.error("Agent is paused. Resume first.")
  → 429: toast.warning("Cooldown active. Wait 15 seconds.")
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 14 (App Router) | SSR, routing, React Server Components |
| **Styling** | Tailwind CSS v4 | Utility-first CSS with custom `@theme` tokens |
| **UI Primitives** | Radix UI | Accessible Switch, Dialog, DropdownMenu, Tabs, Tooltip |
| **Data Fetching** | SWR | Stale-while-revalidate polling with cache invalidation |
| **Real-Time** | Socket.io Client | WebSocket connection for live pipeline events |
| **Toasts** | Sonner | Lightweight toast notifications |
| **Theming** | next-themes | Light/dark mode with system preference detection |
| **Icons** | Lucide React | Consistent icon set |
| **Fonts** | Inter + JetBrains Mono | UI text + monospace for data/code |

---

## Project Structure

```text
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout, fonts, ThemeProvider, Toaster
│   │   ├── page.tsx                # Main dashboard (client) — hooks, state, actions
│   │   └── globals.css             # Design tokens, light/dark themes, animations
│   │
│   ├── components/
│   │   ├── Header.tsx              # Nav bar, session stats, Agent Vault dropdown, theme toggle
│   │   ├── AgentCard.tsx           # Agent status, pipeline/history toggle, and controls  
│   │   ├── StrategistPanel.tsx     # Real-time LLM reasoning output + policy engine checks
│   │   ├── Leaderboard.tsx         # PnL ranking with balance tooltips
│   │   ├── LivePrices.tsx          # Token prices with 24h change
│   │   ├── AuditFeed.tsx           # Filterable audit log (Radix Tabs per agent)
│   │   ├── ProofOfReasoning.tsx    # On-chain proof records with Verify Hash button
│   │   ├── SystemStatus.tsx        # RPC, Kora, Oracle, WebSocket health
│   │   ├── ThemeProvider.tsx       # next-themes wrapper
│   │   └── ui/                     # Radix UI wrappers
│   │       ├── Switch.tsx          # Kill switch with agent-colored glow
│   │       ├── Dialog.tsx          # Glassmorphism modal
│   │       ├── DropdownMenu.tsx    # Glass dropdown with slide animation
│   │       ├── Tabs.tsx            # Animated underline tabs
│   │       ├── Tooltip.tsx         # Directional tooltip
│   │       ├── Toaster.tsx         # Sonner toast with glass styling
│   │       └── primitives.tsx      # Badge, PingDot, Divider
│   │
│   ├── hooks/
│   │   ├── use-agents.ts           # SWR: agents + parallel balance fetches
│   │   ├── use-prices.ts           # SWR: token prices → TokenPrice[]
│   │   ├── use-leaderboard.ts      # SWR: PnL leaderboard
│   │   ├── use-proofs.ts           # SWR: proof-of-reasoning records
│   │   ├── use-audit-log.ts        # SWR: audit entries with severity inference
│   │   ├── use-system-health.ts    # SWR: /health endpoint → SystemStats
│   │   ├── use-agent-history.ts    # SWR: transaction history per agent
│   │   └── use-solus-events.ts     # Socket.io WebSocket + SWR cache invalidation
│   │
│   ├── lib/
│   │   ├── api.ts                  # Fetch wrapper (retry, ApiError, 9 endpoints)
│   │   └── utils.ts                # cn() utility (clsx + twMerge)
│   │
│   └── types/
│       └── index.ts                # Shared TypeScript definitions
│
├── public/                         # Static assets
├── .env.example                    # Environment variable template
├── next.config.ts                  # Next.js configuration
├── package.json
├── tsconfig.json
└── README.md                       # This file
```

---

## Prerequisites

- **Node.js** 20 or higher
- **pnpm** (recommended) or npm
- **backend running** on port 3001 — see [backend Setup](../backend/README.md)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/Fortexfreddie/Solus-Protocol.git
cd Solus-Protocol/Frontend

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
```

---

## Environment Variables

```env
# ─── REST API ─────────────────────────────────────────────────────────────────
# Base URL for all SWR data hooks (agents, prices, leaderboard, proofs, logs)
NEXT_PUBLIC_API_URL=http://localhost:3001/api

# ─── WebSocket ────────────────────────────────────────────────────────────────
# Socket.io connection for real-time pipeline events
# (AGENT_THINKING, TX_CONFIRMED, PROOF_ANCHORED, etc.)
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

> **Production:** Update both URLs to point to your deployed backend (e.g., Render).

---

## Running Locally

### 1. Start the backend

```bash
cd ../backend
pnpm install
pnpm dev
```

> The backend must be running on port 3001 before the frontend can display live data. See the [backend README](../backend/README.md) for full setup instructions (Kora paymaster, API keys, etc.).

### 2. Start the frontend

```bash
cd ../frontend
pnpm dev
```

Navigate to `http://localhost:3000` to view the Mission Control dashboard.

> **Without the backend:** The dashboard will show a loading spinner ("Connecting to Solus Protocol...") until the backend comes online.

---

## Building for Production

```bash
pnpm build
pnpm start
```

### Deploy to Render (Static Site)

1. Set Root Directory to `frontend`.
2. Build Command: `pnpm install && pnpm build`.
3. Start Command: `pnpm start`.
4. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to your backend's deployed URL.

---

## Design System

### Theme Architecture

The dashboard supports **light and dark modes** via `next-themes`. CSS custom properties define all colors in `:root` (dark) and `.light` class, with Tailwind `@theme` tokens for type-safe utility classes:

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `bg-surface` | `#050510` | `#f8f9fc` | Page background |
| `bg-panel` | `rgba(255,255,255,0.03)` | `rgba(0,0,0,0.02)` | Card/panel fills |
| `border-edge` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` | Subtle borders |
| `text-ink` | `#ffffff` | `#1a1a2e` | Primary text |
| `text-ink-muted` | `#94a3b8` | `#64748b` | Secondary text |

### Agent Color Palette

| Agent | Primary | Glow | Usage |
|-------|---------|------|-------|
| **Rex** (Aggressive) | `#FF6B35` | Orange | Borders, badges, switch glow |
| **Nova** (Conservative) | `#7C5CFC` | Violet | Borders, badges, switch glow |
| **Sage** (Balanced) | `#00D68F` | Mint | Borders, badges, switch glow |

### Glassmorphism

All panels use a `.glass` class with backdrop blur, semi-transparent backgrounds, and subtle borders — adapting automatically between light and dark themes.

---

## Related Documentation

- **[backend README](../backend/README.md)** — Full system architecture, API reference, WebSocket events, security model, and setup guide
- **[DEEP_DIVE.md](../backend/DEEP_DIVE.md)** — Comprehensive technical deep dive into the 7-layer air-gap engine
- **[SKILLS.md](../backend/SKILLS.md)** — Agent operator manual injected as LLM system prompt

---

*Built for the Superteam Nigeria DeFi Developer Challenge.*
*Solus Protocol — Autonomous. Auditable. On-chain.*
