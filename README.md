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

- **[Telegram Bot (Out-of-band Monitoring & Control)](./backend/README.md#telegram-integration)**
  A fully integrated Telegram bot that pushes high-signal notifications directly to your phone — confirmed swaps, Guardian vetoes, stop-loss triggers, and low-balance alerts. Includes an inline fleet control panel so you can pause, resume, or force-cycle any agent without touching the dashboard.

  | What you get | How |
  |---|---|
  | Swap confirmed / failed | Push notification with Explorer link |
  | Guardian blocked a trade | Instant veto alert with reasoning |
  | Stop-loss triggered | Agent auto-paused, notification sent |
  | Low SOL balance | Alert before agent runs out of gas |
  | Fleet control | Inline buttons — pause / resume / run any agent |
  | `/status` `/balances` `/agents` | Live fleet data on demand |

  > **Silent Guardian** — routine approved cycles never send a notification. Your phone only buzzes when something needs attention.

- **[Kora (Paymaster Service)](./backend/README.md#kora-paymaster-setup--integration)**
  The localized Solana gasless paymaster module, bundled with custom `kora.toml` and `signers.toml` configurations for immediate plug-and-play execution.

- **[Watch the 3-Minute Demo Video Here](link)**

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
Navigate to `http://localhost:3000` to view the dashboard.

### 3. Enable the Telegram Bot (Optional)
Add these three variables to `backend/.env`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token      # From @BotFather
TELEGRAM_CHAT_ID=your_chat_id          # Your personal or group chat ID
TELEGRAM_ADMIN_ID=your_telegram_id     # Your Telegram user ID (enables admin controls)
```
The bot starts automatically with the backend. Send `/help` in Telegram to see all commands.

### 4. Use the Solus CLI (Optional)
With the backend running, open a new terminal in the `backend/` directory:
```bash
pnpm solus status            # Fleet PnL leaderboard
pnpm solus tail rex          # Stream live 7-layer audit logs
pnpm solus pause nova        # Kill Switch: stop an agent
pnpm solus resume nova       # Resume a paused agent
pnpm solus fire sage         # Force an immediate cycle
```
*(If running via Docker, you can run these directly from the project root using `./solus <command>` (Mac/Linux) or `.\solus <command>` (Windows PowerShell). No local `pnpm install` required.)*

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

- **[Backend Architecture & Setup](./backend/README.md)**
- **[Frontend Architecture & Setup](./frontend/README.md)**
- **[Deep Dive: The 7-Layer Engine](./backend/DEEP_DIVE.md)**
- **[Agent Skills & Prompt Manual](./backend/SKILLS.md)**

---

*Built for the Superteam Nigeria DeFi Developer Challenge.*
*Solus Protocol — Autonomous. Auditable. On-chain.*