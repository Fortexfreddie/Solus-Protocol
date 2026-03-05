/**
 * agent.routes.ts
 * Express router for all Solus Protocol REST API endpoints.
 *
 * Routes:
 *   GET    /health                   — System health (RPC, Kora, prices, agents, WebSocket)
 *   GET    /api/agents               — All agent profiles and status
 *   GET    /api/agents/:id           — Single agent profile and status
 *   GET    /api/agents/:id/balance   — Live on-chain balance for an agent
 *   GET    /api/agents/:id/history   — Transaction history for an agent
 *   PATCH  /api/agents/:id/status    — Kill Switch — pause or resume an agent
 *   POST   /api/agents/:id/run       — Force Run — trigger an immediate agent cycle
 *   GET    /api/proofs               — All Proof-of-Reasoning records
 *   GET    /api/proofs/:hash         — Single proof record with verification
 *   GET    /api/logs                 — Paginated audit log
 *   GET    /api/prices               — Current cached price data
 *   GET    /api/leaderboard          — PnL leaderboard for all agents
 */

import { Router, type Router as RouterType } from 'express';
import {
    getHealth,
    getAgents,
    getAgentById,
    getAgentBalance,
    getAgentHistory,
    patchAgentStatus,
    postAgentRun,
    getProofs,
    getProofByHash,
    getLogs,
    getPrices,
    getLeaderboard,
} from '../controllers/agent.controller.js';

const router: RouterType = Router();

// Health (mounted at root, not /api)
router.get('/health', getHealth);

// Agent endpoints
router.get('/api/agents', getAgents);
router.get('/api/agents/:id', getAgentById);
router.get('/api/agents/:id/balance', getAgentBalance);
router.get('/api/agents/:id/history', getAgentHistory);

// Agent Command Center — Kill Switch + Force Run
router.patch('/api/agents/:id/status', patchAgentStatus);
router.post('/api/agents/:id/run', postAgentRun);

// Proof-of-Reasoning endpoints
router.get('/api/proofs', getProofs);
router.get('/api/proofs/:hash', getProofByHash);

// Audit log
router.get('/api/logs', getLogs);

// Price data
router.get('/api/prices', getPrices);

// Leaderboard
router.get('/api/leaderboard', getLeaderboard);

export default router;
