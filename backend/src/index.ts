/**
 * index.ts
 * Application entry point for Solus Protocol.
 *
 * Executes the startup sequence:
 *   1. Load and validate environment variables (incl. DATABASE_URL in production)
 *   2. Connect to PostgreSQL (production only)
 *   3. Devnet guard — enforced inside getSolanaRPC()
 *   4. Initialise Solana RPC and verify with a test ping
 *   5. Connect to Kora Paymaster
 *   6. Warm price cache from CoinGecko and start 30s polling
 *   7. Initialise Audit Logger
 *   8. Initialise Agent Orchestrator (loads/creates vaults for Rex, Nova, Sage)
 *   9. Start Express + Socket.io server
 *  10. Start staggered agent cycles (Rex@0s, Nova@20s, Sage@40s)
 */

import 'dotenv/config';
import process from 'node:process';

import { isProduction, getPrisma, disconnectPrisma } from './config/db';
import { getSolanaRPC } from './protocol/solana-rpc';
import { getKoraPaymaster } from './protocol/kora-paymaster';
import { getPriceOracle } from './price/price-oracle';
import { getAuditLogger } from './security/audit-logger';
import { initOrchestrator } from './agent/agent-orchestrator';
import { startServer, PORT } from './app';
import { createTelegramNotifier } from './notifications/telegram-bot';


//  Required environment variables

const REQUIRED_ENV_VARS = [
  'SOLANA_RPC_URL',
  'VAULT_MASTER_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'KORA_RPC_URL',
] as const;

//  Startup

async function main(): Promise<void> {
  const logger = getAuditLogger();

  const storageMode = isProduction ? 'PostgreSQL (Supabase)' : 'Filesystem';

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              Solus Protocol — Starting Up                    ║');
  console.log('║   Multi-Agent Agentic Wallet System on Solana Devnet     ║');
  console.log(`║   Storage: ${storageMode.padEnd(45)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  //  Step 1: Validate environment
  console.log('[1/10] Validating environment variables...');
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in the required values.\n');
    process.exit(1);
  }

  // Hard crash if production but no DB connection string.
  if (isProduction && !process.env.POOLER_URL && !process.env.DATABASE_URL) {
    console.error('\n❌ DATABASE_URL or POOLER_URL is required when NODE_ENV=production.');
    console.error('   Wallets, audit logs, and proof records are persisted in PostgreSQL.\n');
    process.exit(1);
  }

  console.log('      ✓ All required environment variables are set.\n');

  //  Step 2: Database connection (production only)
  if (isProduction) {
    console.log('[2/10] Connecting to PostgreSQL (Supabase)...');
    const prisma = getPrisma();
    // Verify connection by counting wallet records
    const walletCount = await prisma.agentWallet.count();
    console.log(`      ✓ Database connected — ${walletCount} existing wallet(s) found.\n`);
  } else {
    console.log('[2/10] Skipping database (dev mode — using filesystem storage).\n');
  }

  //  Step 3: Devnet guard + RPC init
  console.log('[3/10] Initialising Solana RPC connection...');
  const rpc = getSolanaRPC(); // throws if URL does not contain "devnet"
  const { slot, latencyMs } = await rpc.ping();
  console.log(`      ✓ Connected to Devnet — slot: ${slot} (${latencyMs}ms)\n`);

  //  Step 4: Kora Paymaster
  console.log('[4/10] Connecting to Kora Paymaster...');
  const kora = getKoraPaymaster();
  const koraHealth = await kora.verifyConnection();
  if (koraHealth.connected) {
    console.log(`      ✓ Kora online — payer: ${koraHealth.signerAddress} (${koraHealth.latencyMs}ms)\n`);
  } else {
    console.warn(`      ⚠ Kora unreachable: ${koraHealth.error}`);
    console.warn('        Swap execution will fail at Layer 7. Ensure KORA_RPC_URL is correct.\n');
  }

  //  Step 5: Price Oracle
  console.log('[5/10] Warming price cache from CoinGecko...');
  const oracle = getPriceOracle();
  const prices = await oracle.getPrices();
  const topPairs = Object.entries(prices.prices)
    .map(([sym, p]) => `${sym}: $${p.usd.toFixed(4)}`)
    .join(' | ');
  console.log(`      ✓ Prices fetched (stale: ${prices.stale}) — ${topPairs}`);
  oracle.start(); // Begin 30-second polling loop
  console.log('      ✓ Oracle polling started (30s interval)\n');

  //  Step 6: Audit Logger
  console.log('[6/10] Initialising Audit Logger...');
  logger.log({
    agentId: 'rex', cycle: 0, event: 'SYSTEM_START',
    data: { slot, koraConnected: koraHealth.connected, storageMode },
  });
  console.log(`      ✓ Audit log ready at ${process.env.AUDIT_LOG_PATH ?? './logs/audit.jsonl'}`);
  if (isProduction) {
    console.log('      ✓ Audit entries also persisted to PostgreSQL');
  }
  console.log('');

  //  Step 7: Orchestrator (loads/creates vaults for Rex, Nova, Sage)
  console.log('[7/10] Initialising Agent Orchestrator and loading vaults...');
  const orchestrator = await initOrchestrator();
  const agentStatus = orchestrator.getAgentStatus();
  for (const [id, status] of Object.entries(agentStatus)) {
    console.log(`      ✓ ${id.toUpperCase().padEnd(5)} — ${status.publicKey}`);
  }
  console.log('');

  //  Step 7b: Telegram Notifier
  console.log('[7b/10] Initialising Telegram Notifier...');
  const telegram = createTelegramNotifier(orchestrator);
  if (telegram) {
    telegram.init();
  }


  //  Step 8: Start HTTP + WebSocket server
  console.log('[8/10] Starting Express + Socket.io server...');
  await startServer();
  console.log(`      ✓ Server listening on port ${PORT}`);
  console.log(`      ✓ REST API:   http://localhost:${PORT}/health`);
  console.log(`      ✓ Swagger UI: http://localhost:${PORT}/api-docs`);
  console.log(`      ✓ WebSocket:  ws://localhost:${PORT}\n`);

  //  Step 9: API endpoints summary
  console.log('[9/10] API Endpoints:');
  console.log('      GET  /health                   System health');
  console.log('      GET  /api/agents               All agent profiles');
  console.log('      GET  /api/agents/:id           Single agent');
  console.log('      GET  /api/agents/:id/balance   Live on-chain balance');
  console.log('      GET  /api/agents/:id/history   Transaction history');
  console.log('      PATCH /api/agents/:id/status   Kill Switch (pause/resume)');
  console.log('      POST  /api/agents/:id/run      Force agent cycle run');
  console.log('      GET  /api/proofs               All proof records');
  console.log('      GET  /api/proofs/:hash         Verify proof');
  console.log('      GET  /api/logs                 Paginated audit log');
  console.log('      GET  /api/prices               Current price data\n');

  //  Step 10: Start staggered agent cycles
  console.log('[10/10] Starting staggered agent cycles...');
  console.log('      Rex:  T+0s  → every 60s');
  console.log('      Nova: T+20s → every 60s');
  console.log('      Sage: T+40s → every 60s');
  orchestrator.start();
  console.log('');

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              ✅ Solus Protocol is RUNNING                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  //  Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Stopping agents...`);
    orchestrator.stop();
    oracle.stop();
    await telegram?.stop();

    logger.log({
      agentId: 'rex', cycle: 0, event: 'SYSTEM_SHUTDOWN',
      data: { signal },
    });
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

//  Uncaught error handlers

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

//  Run

main().catch((err: unknown) => {
  console.error('\n❌ Startup failed:', err);
  process.exit(1);
});