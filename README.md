# Solus Protocol

> **Autonomous AI agents that think, get audited, prove their reasoning on-chain, and trade — without human intervention.**

**Superteam Nigeria | DeFi Developer Challenge — Agentic Wallets for AI Agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Solus Protocol is a production-architecture, multi-agent autonomous wallet system built on Solana. Three AI agents — Rex, Nova, and Sage — each manage an encrypted Solana wallet, analyze live market data, and execute token swaps independently without human intervention.

This repository is a monorepo containing both the **Backend Engine** and the **Mission Control Dashboard (Frontend)**.

---

## Repository Structure

- [**backend (The 7-Layer Air-Gap Engine)**](./backend/README.md)
  The core trading engine, containing the LLM orchestration (DeepSeek & Gemini), Policy Engine, on-chain Proof-of-Reasoning, AES-256-GCM Vaults, and Kora Paymaster integration.
  
- [**frontend (Mission Control Dashboard)**](./frontend/README.md)
  The Next.js real-time observer dashboard. Connects via WebSocket to surface agent thinking, audits, policy checks, and live PnL in real time.

- **[Kora (Paymaster Service)](./backend/README.md#kora-paymaster-setup--integration)**
  The localized Solana gasless paymaster module, bundled with custom `kora.toml` and `signers.toml` configurations for immediate plug-and-play execution.

---

## Quick Start

To run the full stack locally:

### 1. Start the backend
```bash
cd backend
pnpm install
cp .env.example .env
# Important: Fill in your LLM, Kora, and Solana variables in .env
pnpm smoke:vault # Auto-funds the agents
pnpm dev
```

### 2. Start the frontend
In a new terminal:
```bash
cd frontend
pnpm install
cp .env.example .env
pnpm dev
```
Navigate to `http://localhost:3000` to view the dashboard!

### 3. Use the Solus CLI (Optional)
With the backend running, open a new terminal in the `backend/` directory:
```bash
pnpm solus status            # Fleet PnL leaderboard
pnpm solus tail rex          # Stream live 7-layer audit logs
pnpm solus pause nova        # Kill Switch: stop an agent
pnpm solus resume nova       # Resume a paused agent
pnpm solus fire sage         # Force an immediate cycle
```
*(If running via Docker, use `docker compose exec backend pnpm solus <command>` from the project root instead. No local `pnpm install` required.)*

---

## Docker Deployment (Recommended)

You can spin up the entire **Solus Protocol stack** (Backend, Frontend, Kora Paymaster, and Redis Cache) using a single Docker Compose command.

Ensure you have copied the `.env.example` to `.env` in both the `backend` and `frontend` directories, as well as configuring the `kora/.env`, then run:

```bash
docker-compose up --build -d
```

This will:
1. Build the Kora Rust binary and boot its Redis cache.
2. Build the Node.js API Engine and mount your local `wallets/` directory.
3. Build the Next.js Mission Control dashboard.
4. Auto-route internal DNS (`http://kora:8080`) between the completely air-gapped containers.

The dashboard will be live at `http://localhost:3000`.

---

## Technical Documentation

- **[backend Architecture & Setup](./backend/README.md)**
- **[frontend Architecture & Setup](./frontend/README.md)**
- **[Deep Dive: The 7-Layer Engine](./backend/DEEP_DIVE.md)**
- **[Agent Skills & Prompt Manual](./backend/SKILLS.md)**

---

*Built for the Superteam Nigeria DeFi Developer Challenge.*  
*Solus Protocol — Autonomous. Auditable. On-chain.*
