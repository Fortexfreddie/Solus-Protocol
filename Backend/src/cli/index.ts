#!/usr/bin/env tsx
import { Command } from 'commander';
import { tailCommand } from './commands/tail';
import { statusCommand } from './commands/status';
import { toggleAgent, forceRun } from './commands/control';
import { THEME } from './ui-helpers';

const program = new Command();

program
    .name('solus')
    .description('Solus Protocol CLI — Agentic Wallet Control')
    .version('2.0.0');

// solus status
program
    .command('status')
    .description('View fleet PnL leaderboard and operational status')
    .option('-p, --port <number>', 'Backend port', '3001')
    .action(async (options) => {
        await statusCommand(parseInt(options.port));
    });

// solus tail <agentId>
program
    .command('tail <agentId>')
    .description('Stream live 7-layer audit logs for an agent')
    .option('-p, --port <number>', 'Backend port', '3001')
    .action(async (agentId, options) => {
        await tailCommand(agentId as any, parseInt(options.port));
    });

// solus pause/resume <agentId>
program
    .command('pause <agentId>')
    .description('Kill Switch: Stop an agent from running cycles')
    .option('-p, --port <number>', 'Backend port', '3001')
    .action(async (agentId, options) => {
        await toggleAgent(agentId as any, 'PAUSED', parseInt(options.port));
    });

program
    .command('resume <agentId>')
    .description('Resume an agent to active status')
    .option('-p, --port <number>', 'Backend port', '3001')
    .action(async (agentId, options) => {
        await toggleAgent(agentId as any, 'ACTIVE', parseInt(options.port));
    });

// solus fire <agentId>
program
    .command('fire <agentId>')
    .description('Force an immediate cycle run (15s cooldown)')
    .option('-p, --port <number>', 'Backend port', '3001')
    .action(async (agentId, options) => {
        await forceRun(agentId as any, parseInt(options.port));
    });

// Global error handler for unhandled promise rejections (e.g. timeout)
process.on('unhandledRejection', (reason) => {
    console.error(THEME.error(`\n[Fatal Error] ${reason}`));
    process.exit(1);
});

program.parse(process.argv);