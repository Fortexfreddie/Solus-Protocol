# Solus Protocol

> **Autonomous AI agents that think, get audited, prove their reasoning on-chain, and trade — without human intervention.**

**Superteam Nigeria | DeFi Developer Challenge — Agentic Wallets for AI Agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Solus Protocol is a production-architecture, multi-agent autonomous wallet system built on Solana. Three AI agents — Rex, Nova, and Sage — each manage an encrypted Solana wallet, analyze live market data, and execute token swaps independently without human intervention.

This repository is a monorepo containing both the **Backend Engine** and the **Mission Control Dashboard (Frontend)**.

---

## Repository Structure

- [**Backend (The 7-Layer Air-Gap Engine)**](./Backend/README.md)
  The core trading engine, containing the LLM orchestration (DeepSeek & Gemini), Policy Engine, on-chain Proof-of-Reasoning, AES-256-GCM Vaults, and Kora Paymaster integration.
  
- [**Frontend (Mission Control Dashboard)**](./Frontend/README.md)
  The Next.js real-time observer dashboard. Connects via WebSocket to surface agent thinking, audits, policy checks, and live PnL in real time.

---

## Quick Start

To run the full stack locally:

### 1. Start the Backend
```bash
cd Backend
pnpm install
cp .env.example .env
# Important: Fill in your LLM, Kora, and Solana variables in .env
pnpm smoke:vault # Auto-funds the agents
pnpm dev
```

### 2. Start the Frontend
In a new terminal:
```bash
cd Frontend
pnpm install
cp .env.example .env
pnpm dev
```
Navigate to `http://localhost:3000` to view the dashboard!

---

## Technical Documentation

- **[Backend Architecture & Setup](./Backend/README.md)**
- **[Frontend Architecture & Setup](./Frontend/README.md)**
- **[Deep Dive: The 7-Layer Engine](./Backend/DEEP_DIVE.md)**
- **[Agent Skills & Prompt Manual](./Backend/SKILLS.md)**

---

*Built for the Superteam Nigeria DeFi Developer Challenge.*  
*Solus Protocol — Autonomous. Auditable. On-chain.*
