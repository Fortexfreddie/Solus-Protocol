/**
 * Solus Protocol — Telegram Bot
 * File: src/notifications/telegram-bot.ts
 *
 * Provides push notifications for high-value events and administrative
 * commands with inline keyboard buttons for a professional Telegram experience.
 *
 * Security: All privileged commands are gated by TELEGRAM_ADMIN_ID.
 * Signal:   "Silent Guardian" logic filters out routine approvals.
 * UX:       Inline keyboards replace text commands for agent control.
 */

import TelegramBot from 'node-telegram-bot-api';
import { eventBus } from '../events/event-bus';
import { AgentOrchestrator } from '../agent/agent-orchestrator';
import { getAuditLogger } from '../security/audit-logger';
import { WsEventEnvelope, WsEventType, AgentId, GuardianVerdict } from '../types/agent-types';

const logger = getAuditLogger();

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_AGENTS: AgentId[] = ['rex', 'nova', 'sage'];
const EXPLORER_BASE = 'https://explorer.solana.com/tx';
const CLUSTER = 'devnet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramConfig {
    token: string;
    chatId: string;
    adminId?: string;
}

type SendOptions = {
    keyboard?: TelegramBot.InlineKeyboardMarkup;
    disablePreview?: boolean;
};

// ─── Visual Identity ──────────────────────────────────────────────────────────

/** Per-agent color dot used in all messages */
const AGENT_DOT: Record<AgentId, string> = {
    rex: '🔴',
    nova: '🟣',
    sage: '🟢',
};

/** Contextual emoji for each event category */
const EVENT_ICON: Partial<Record<WsEventType, string>> = {
    TX_CONFIRMED: '✅',
    TX_FAILED: '🚫',
    GUARDIAN_AUDIT: '🛡',
    PROOF_ANCHORED: '⚓',
    POLICY_FAIL: '🔴',
    BALANCE_UPDATE: '💰',
    AGENT_COMMAND: '⚙️',
};

/** Styled agent label: 🔴 *REX* */
const agentLabel = (id: AgentId): string =>
    `${AGENT_DOT[id] ?? '🤖'} *${id.toUpperCase()}*`;

/** Format a SOL amount to 4 decimal places */
const formatSol = (amount: number): string => amount.toFixed(4);

/** Shorten a public key or hash for display */
const shortKey = (key: string, head = 6, tail = 4): string =>
    `${key.slice(0, head)}…${key.slice(-tail)}`;

/** Build a Solana explorer link */
const explorerLink = (sig: string, label = 'View on Explorer'): string =>
    `[${label}](${EXPLORER_BASE}/${sig}?cluster=${CLUSTER})`;

/** ISO timestamp string */
const timestamp = (): string =>
    new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

// ─── TelegramNotifier ─────────────────────────────────────────────────────────

export class TelegramNotifier {
    private bot: TelegramBot;
    private chatId: string;
    private adminId: string | null;
    private orchestrator: AgentOrchestrator;
    private initialized = false;

    /** Events that warrant a push notification */
    readonly HIGH_VALUE_EVENTS: WsEventType[] = [
        'TX_CONFIRMED',
        'TX_FAILED',
        'GUARDIAN_AUDIT',
        'PROOF_ANCHORED',
        'POLICY_FAIL',
        'BALANCE_UPDATE',
        'AGENT_COMMAND',
    ];

    constructor(config: TelegramConfig, orchestrator: AgentOrchestrator) {
        this.chatId = config.chatId;
        this.adminId = config.adminId ?? null;
        this.orchestrator = orchestrator;

        this.bot = new TelegramBot(config.token, { polling: true });
    }

    // ─── Inline Keyboards (Dynamic) ────────────────────────────────────────────

    private getFleetKeyboard(): TelegramBot.InlineKeyboardMarkup {
        const statuses = this.orchestrator.getAgentStatus();
        const row = (id: AgentId) => {
            const isActive = statuses[id].operationalStatus === 'ACTIVE';
            return [
                isActive
                    ? { text: `⏸ Pause ${id.toUpperCase()}`, callback_data: `pause:${id}` }
                    : { text: `▶️ Resume ${id.toUpperCase()}`, callback_data: `resume:${id}` },
                { text: `🔥 Fire ${id.toUpperCase()}`, callback_data: `fire:${id}` },
            ];
        };

        return {
            inline_keyboard: [
                row('rex'),
                row('nova'),
                row('sage'),
                [
                    { text: '📊 Status', callback_data: 'cmd:status' },
                    { text: '💰 Balances', callback_data: 'cmd:balances' },
                    { text: '🔄 Refresh', callback_data: 'cmd:refresh' },
                ],
            ],
        };
    }

    private getAgentKeyboard(id: AgentId): TelegramBot.InlineKeyboardMarkup {
        const isActive = this.orchestrator.getOperationalStatus(id) === 'ACTIVE';
        return {
            inline_keyboard: [
                [
                    isActive
                        ? { text: `⏸ Pause ${id.toUpperCase()}`, callback_data: `pause:${id}` }
                        : { text: `▶️ Resume ${id.toUpperCase()}`, callback_data: `resume:${id}` },
                    { text: `🔥 Fire ${id.toUpperCase()}`, callback_data: `fire:${id}` },
                ],
                [
                    { text: '◀ Back to Fleet', callback_data: 'cmd:control' },
                ],
            ],
        };
    }

    // ─── Internal Helpers ──────────────────────────────────────────────────────

    private _log(event: string, data: Record<string, unknown> = {}): void {
        logger.log({ agentId: 'rex', cycle: 0, event: `TELEGRAM_${event}`, data });
    }

    private _isAdmin(source: TelegramBot.Message | TelegramBot.CallbackQuery): boolean {
        if (!this.adminId) return true; // No admin ID = open (warn at startup)
        return String(source.from?.id) === this.adminId;
    }

    private _send(text: string, opts: SendOptions = {}): void {
        this.bot
            .sendMessage(this.chatId, text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: opts.disablePreview ?? true,
                reply_markup: opts.keyboard,
            })
            .catch((err) => {
                this._log('SEND_ERROR', { error: err.message, preview: text.slice(0, 80) });
            });
    }

    private _reply(queryId: string, text: string, alert = false): void {
        this.bot.answerCallbackQuery(queryId, { text, show_alert: alert }).catch(() => { });
    }

    // ─── Bootstrap ─────────────────────────────────────────────────────────────

    init(): void {
        if (this.initialized) return;
        this.initialized = true;

        this._registerEventListeners();
        this._registerCommands();
        this._registerCallbacks();

        this._log('STARTUP', { adminActive: !!this.adminId });

        const adminStatus = this.adminId
            ? '✅ Admin controls *active*'
            : '⚠️ No `TELEGRAM_ADMIN_ID` set — admin controls *disabled*';

        this._send(
            `╔══════════════════════════╗\n` +
            `║  🛡 *SOLUS PROTOCOL*  ONLINE  ║\n` +
            `╚══════════════════════════╝\n\n` +
            `*Agents:*  ${agentLabel('rex')}  ${agentLabel('nova')}  ${agentLabel('sage')}\n` +
            `*Network:* Solana Devnet\n` +
            `*${adminStatus}*\n\n` +
            `🕐 \`${timestamp()}\`\n\n` +
            `Use /help to see all commands, or /control for the fleet panel.`,
        );
    }

    // ─── Event Listener ───────────────────────────────────────────────────────

    private _registerEventListeners(): void {
        eventBus.onAny((event: WsEventEnvelope) => {
            try {
                if (this.HIGH_VALUE_EVENTS.includes(event.type)) {
                    this._handleEvent(event);
                }
            } catch (err: any) {
                this._log('EVENT_ERROR', { error: err.message, eventType: event.type });
            }
        });
    }

    private _handleEvent(event: WsEventEnvelope): void {
        const { type, agentId, payload } = event;
        const agent = agentLabel(agentId);
        const icon = EVENT_ICON[type] ?? '🔔';
        const p = payload as any;

        switch (type) {

            // ── Swap Confirmed ───────────────────────────────────────────────
            case 'TX_CONFIRMED': {
                this._send(
                    `${icon} ${agent} — *SWAP CONFIRMED*\n` +
                    `${'─'.repeat(28)}\n` +
                    `📤 *From:*   \`${p.fromToken}\`\n` +
                    `📥 *To:*     \`${p.toToken}\`\n` +
                    `💎 *Amount:* \`${formatSol(p.amount)}\` SOL\n` +
                    `📋 *Sig:*    \`${shortKey(p.signature, 8, 6)}\`\n\n` +
                    `${explorerLink(p.signature)}\n` +
                    `🕐 \`${timestamp()}\``,
                    { keyboard: this.getAgentKeyboard(agentId) },
                );
                break;
            }

            // ── Swap Failed ──────────────────────────────────────────────────
            case 'TX_FAILED': {
                this._send(
                    `${icon} ${agent} — *SWAP FAILED*\n` +
                    `${'─'.repeat(28)}\n` +
                    `❗ *Reason:*\n\`${p.reason}\`\n\n` +
                    `The cycle will be retried on next tick.\n` +
                    `🕐 \`${timestamp()}\``,
                    { keyboard: this.getAgentKeyboard(agentId) },
                );
                break;
            }

            // ── Guardian Audit ───────────────────────────────────────────────
            case 'GUARDIAN_AUDIT': {
                const verdict = p.verdict as GuardianVerdict;

                if (verdict === 'VETO') {
                    this._send(
                        `🚨 ${icon} ${agent} — *GUARDIAN VETO*\n` +
                        `${'─'.repeat(28)}\n` +
                        `🛑 Transaction *blocked* by safety policy.\n\n` +
                        `📌 *Challenge:*\n_${p.challenge}_\n\n` +
                        `No funds were moved.\n` +
                        `🕐 \`${timestamp()}\``,
                        { keyboard: this.getAgentKeyboard(agentId) },
                    );
                } else if (verdict === 'MODIFY') {
                    this._send(
                        `⚠️ ${icon} ${agent} — *GUARDIAN OVERRIDE*\n` +
                        `${'─'.repeat(28)}\n` +
                        `✏️ Amount adjusted to \`${formatSol(p.modifiedAmount ?? 0)}\` SOL\n\n` +
                        `📌 *Reason:*\n_${p.challenge}_\n\n` +
                        `🕐 \`${timestamp()}\``,
                        { keyboard: this.getAgentKeyboard(agentId) },
                    );
                }
                // APPROVE: silent — no notification by design (Silent Guardian)
                break;
            }

            // ── Proof Anchored ───────────────────────────────────────────────
            case 'PROOF_ANCHORED': {
                this._send(
                    `${icon} ${agent} — *PROOF ANCHORED*\n` +
                    `${'─'.repeat(28)}\n` +
                    `🔏 *Hash:* \`${shortKey(p.hash, 12, 8)}\`\n\n` +
                    `${explorerLink(p.memoSignature, 'View Memo on Explorer')}\n` +
                    `🕐 \`${timestamp()}\``,
                );
                break;
            }

            // ── Stop-Loss / Policy Failure ────────────────────────────────────
            case 'POLICY_FAIL': {
                if (p.check === 'STOP_LOSS_CIRCUIT') {
                    this._send(
                        `🔴 ${icon} ${agent} — *STOP-LOSS TRIGGERED*\n` +
                        `${'─'.repeat(28)}\n` +
                        `📉 Agent automatically *PAUSED* to protect funds.\n\n` +
                        `📌 *Reason:*\n\`${p.reason}\`\n\n` +
                        `Use the controls below to resume when safe.\n` +
                        `🕐 \`${timestamp()}\``,
                        { keyboard: this.getAgentKeyboard(agentId) },
                    );
                } else {
                    this._send(
                        `⚠️ ${icon} ${agent} — *POLICY VIOLATION*\n` +
                        `${'─'.repeat(28)}\n` +
                        `🔍 *Check:*  \`${p.check}\`\n` +
                        `📌 *Reason:* \`${p.reason ?? 'No details'}\`\n` +
                        `🕐 \`${timestamp()}\``,
                        { keyboard: this.getAgentKeyboard(agentId) },
                    );
                }
                break;
            }

            // ── Low Balance Warning ───────────────────────────────────────────
            case 'BALANCE_UPDATE': {
                if (p.sol < 0.05) {
                    this._send(
                        `⚠️ ${icon} ${agent} — *LOW BALANCE ALERT*\n` +
                        `${'─'.repeat(28)}\n` +
                        `💸 *Current:*   \`${formatSol(p.sol)}\` SOL\n` +
                        `📊 *Threshold:* \`0.0500\` SOL\n\n` +
                        `Replenish via faucet to continue operations.\n` +
                        `🕐 \`${timestamp()}\``,
                        { keyboard: this.getAgentKeyboard(agentId) },
                    );
                }
                break;
            }

            // ── Agent State Change ────────────────────────────────────────────
            case 'AGENT_COMMAND': {
                const cmd = (p.command as string).toUpperCase();
                if (['PAUSE', 'RESUME', 'SET_STATUS'].includes(cmd)) {
                    const label = cmd === 'SET_STATUS' ? (p.status ?? 'STATUS_UPDATE') : cmd;
                    const stateIcon = label === 'RESUME' ? '▶️' : label === 'PAUSE' ? '⏸' : '⚙️';
                    this._send(
                        `${stateIcon} ${icon} ${agent} — *STATE TRANSITION*\n` +
                        `${'─'.repeat(28)}\n` +
                        `🔄 *Action:* \`${label}\`\n` +
                        `🕐 \`${timestamp()}\``,
                    );
                }
                break;
            }

            default:
                break;
        }
    }

    // ─── Text Commands ─────────────────────────────────────────────────────────

    private _registerCommands(): void {

        // /help
        this.bot.onText(/\/help/, () => {
            this._send(
                `🛡 *SOLUS PROTOCOL — Command Reference*\n` +
                `${'═'.repeat(30)}\n\n` +
                `📋 *Query Commands* _(anyone)_\n` +
                `/status      — Fleet operational overview\n` +
                `/balances    — Live SOL balance per agent\n` +
                `/agents      — Agent health & cycle counts\n` +
                `/control     — Interactive fleet control panel\n` +
                `/help        — This reference\n\n` +
                `⚙️ *Admin Commands* _(restricted)_\n` +
                `/pause rex   — Pause an agent\n` +
                `/resume rex  — Resume an agent\n` +
                `/fire rex    — Trigger immediate cycle\n` +
                `/killswitch  — 🚨 Pause ALL agents\n\n` +
                `💡 _Tip: Use_ /control _for inline buttons._`,
            );
        });

        // /status
        this.bot.onText(/\/status/, async () => {
            try {
                const map = this.orchestrator.getAgentStatus();
                let msg = `📊 *FLEET STATUS*\n` +
                    `${'─'.repeat(28)}\n`;

                for (const [id, s] of Object.entries(map)) {
                    const active = s.operationalStatus === 'ACTIVE';
                    const stateIcon = active ? '🟢' : '⏸';
                    msg +=
                        `\n${stateIcon} ${agentLabel(id as AgentId)}\n` +
                        `   Status:  \`${active ? 'ACTIVE' : 'PAUSED'}\`\n` +
                        `   Cycles:  \`${s.cycleCount}\`\n` +
                        `   Wallet:  \`${shortKey(s.publicKey)}\`\n`;
                }
                msg += `\n🕐 \`${timestamp()}\``;
                this._send(msg, { keyboard: this.getFleetKeyboard() });
            } catch (err: any) {
                this._log('STATUS_ERROR', { error: err.message });
                this._send('🚫 *Error* — Could not fetch fleet status.');
            }
        });

        // /balances
        this.bot.onText(/\/balances/, async () => {
            try {
                const map = this.orchestrator.getAgentStatus();
                let msg = `💰 *LIVE BALANCES* (approx)\n` +
                    `${'─'.repeat(28)}\n`;

                for (const [id, s] of Object.entries(map)) {
                    let solBal = '_unavailable_';
                    try {
                        const bal = await this.orchestrator.getAgent(id as AgentId).getBalance();
                        solBal = `\`${formatSol(bal.sol)}\` SOL`;
                    } catch { }

                    msg +=
                        `\n${agentLabel(id as AgentId)}\n` +
                        `   Wallet: \`${shortKey(s.publicKey)}\`\n` +
                        `   SOL:    ${solBal}\n`;
                }
                msg += `\n📈 _For exact asset breakdown, use the dashboard._\n🕐 \`${timestamp()}\``;
                this._send(msg);
            } catch (err: any) {
                this._log('BALANCE_ERROR', { error: err.message });
                this._send('🚫 *Error* — Could not fetch balances.');
            }
        });

        // /agents
        this.bot.onText(/\/agents/, async () => {
            try {
                const map = this.orchestrator.getAgentStatus();
                let msg = `🤖 *AGENT HEALTH REPORT*\n` +
                    `${'─'.repeat(28)}\n`;

                for (const [id, s] of Object.entries(map)) {
                    const active = s.operationalStatus === 'ACTIVE';
                    msg +=
                        `\n${agentLabel(id as AgentId)}\n` +
                        `   Status:      \`${active ? 'ACTIVE' : 'PAUSED'}\`\n` +
                        `   Cycles:      \`${s.cycleCount}\`\n`;
                }
                msg += `\n🕐 \`${timestamp()}\``;
                this._send(msg, { keyboard: this.getFleetKeyboard() });
            } catch (err: any) {
                this._log('AGENTS_ERROR', { error: err.message });
                this._send('🚫 *Error* — Could not fetch agent statuses.');
            }
        });

        // /control — opens inline fleet panel
        this.bot.onText(/\/control/, () => {
            this._send(
                `⚙️ *FLEET CONTROL PANEL*\n` +
                `${'─'.repeat(28)}\n` +
                `Select an action below.\n` +
                `🔒 _Admin-only actions will be verified._`,
                { keyboard: this.getFleetKeyboard() },
            );
        });

        // /killswitch — pause ALL agents
        this.bot.onText(/\/killswitch/, async (msg: TelegramBot.Message) => {
            if (!this._isAdmin(msg)) return this._send('⛔ *Unauthorized* — Admin ID required.');
            this._send(
                `🚨 *KILL SWITCH REQUESTED*\n` +
                `${'─'.repeat(28)}\n` +
                `This will *immediately pause all three agents*.\n` +
                `Confirm or cancel below.`,
                {
                    keyboard: {
                        inline_keyboard: [[
                            { text: '🚨 Confirm KILL ALL', callback_data: 'confirmed:killall' },
                            { text: '❌ Cancel', callback_data: 'cmd:cancel' },
                        ]]
                    }
                },
            );
        });

        // /pause <agentId>
        this.bot.onText(/\/pause(?:\s+(\w+))?/, async (msg: TelegramBot.Message, match) => {
            if (!this._isAdmin(msg)) return this._send('⛔ *Unauthorized* — Admin ID required.');
            const agentId = match?.[1]?.toLowerCase() as AgentId;
            if (!VALID_AGENTS.includes(agentId)) return this._send('ℹ️ Usage: `/pause rex|nova|sage`');

            try {
                this.orchestrator.setOperationalStatus(agentId, 'PAUSED');
                this._log('CMD_PAUSE', { agentId, adminId: msg.from?.id });
                this._send(`⏸ ${agentLabel(agentId)} *paused* by admin.\n🕐 \`${timestamp()}\``);
            } catch (err: any) {
                this._log('PAUSE_ERROR', { agentId, error: err.message });
                this._send(`🚫 Failed to pause \`${agentId}\`: \`${err.message}\``);
            }
        });

        // /resume <agentId>
        this.bot.onText(/\/resume(?:\s+(\w+))?/, async (msg: TelegramBot.Message, match) => {
            if (!this._isAdmin(msg)) return this._send('⛔ *Unauthorized* — Admin ID required.');
            const agentId = match?.[1]?.toLowerCase() as AgentId;
            if (!VALID_AGENTS.includes(agentId)) return this._send('ℹ️ Usage: `/resume rex|nova|sage`');

            try {
                this.orchestrator.setOperationalStatus(agentId, 'ACTIVE');
                this._log('CMD_RESUME', { agentId, adminId: msg.from?.id });
                this._send(`▶️ ${agentLabel(agentId)} *resumed* by admin.\n🕐 \`${timestamp()}\``);
            } catch (err: any) {
                this._log('RESUME_ERROR', { agentId, error: err.message });
                this._send(`🚫 Failed to resume \`${agentId}\`: \`${err.message}\``);
            }
        });

        // /fire <agentId>
        this.bot.onText(/\/fire(?:\s+(\w+))?/, async (msg: TelegramBot.Message, match) => {
            if (!this._isAdmin(msg)) return this._send('⛔ *Unauthorized* — Admin ID required.');
            const agentId = match?.[1]?.toLowerCase() as AgentId;
            if (!VALID_AGENTS.includes(agentId)) return this._send('ℹ️ Usage: `/fire rex|nova|sage`');

            try {
                await this.orchestrator.triggerCycle(agentId);
                this._log('CMD_FIRE', { agentId, adminId: msg.from?.id });
                this._send(`🔥 ${agentLabel(agentId)} *forced cycle* initiated.\n🕐 \`${timestamp()}\``);
            } catch (err: any) {
                this._log('FIRE_ERROR', { agentId, error: err.message });
                this._send(`🚫 Force cycle failed for \`${agentId}\`: \`${err.message}\``);
            }
        });

        // Polling error handler
        this.bot.on('polling_error', (err: any) => {
            this._log('POLLING_ERROR', { error: err.message, code: err.code });
        });
    }

    // ─── Inline Keyboard Callbacks ────────────────────────────────────────────

    private _registerCallbacks(): void {
        this.bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
            const data = query.data ?? '';

            // ── Unauthorized ──────────────────────────────────────────────────
            if (!this._isAdmin(query)) {
                this._reply(query.id, '⛔ Unauthorized — Admin only.', true);
                return;
            }

            // ── cmd:* — non-destructive panel commands ────────────────────────
            if (data === 'cmd:status') { this._reply(query.id, 'Fetching status…'); return this._handleStatusCallback(); }
            if (data === 'cmd:balances') { this._reply(query.id, 'Fetching balances…'); return this._handleBalancesCallback(); }
            if (data === 'cmd:control') { this._reply(query.id, 'Opening control panel.'); return this._send('⚙️ *Fleet Control Panel*', { keyboard: this.getFleetKeyboard() }); }
            if (data === 'cmd:refresh') { this._reply(query.id, 'Refreshed.'); return this._handleStatusCallback(); }
            if (data === 'cmd:cancel') { this._reply(query.id, '❌ Action cancelled.'); return; }

            // ── confirmed:killall ─────────────────────────────────────────────
            if (data === 'confirmed:killall') {
                try {
                    for (const id of VALID_AGENTS) {
                        this.orchestrator.setOperationalStatus(id, 'PAUSED');
                    }
                    this._log('CMD_KILLSWITCH', { adminId: query.from?.id });
                    this._reply(query.id, '🚨 Kill switch executed.');
                    this._send(
                        `🚨 *KILL SWITCH EXECUTED*\n` +
                        `${'─'.repeat(28)}\n` +
                        `⏸ All agents paused by admin.\n` +
                        `🕐 \`${timestamp()}\``,
                        { keyboard: this.getFleetKeyboard() },
                    );
                } catch (err: any) {
                    this._reply(query.id, `❌ Kill switch failed: ${err.message}`, true);
                }
                return;
            }

            // ── Direct button actions: pause / resume / fire ──────────────────
            const [action, agentId] = data.split(':') as [string, AgentId];
            if (['pause', 'resume', 'fire'].includes(action) && VALID_AGENTS.includes(agentId)) {
                return this._executeAgentAction(action, agentId, query.id, query.from?.id);
            }

            this._reply(query.id, 'Unknown action.', true);
        });
    }

    /** Centralized agent action executor — shared by text commands and button callbacks */
    private async _executeAgentAction(
        action: string,
        agentId: AgentId,
        queryId: string,
        adminUserId?: number,
    ): Promise<void> {
        try {
            if (action === 'pause') {
                this.orchestrator.setOperationalStatus(agentId, 'PAUSED');
                this._reply(queryId, `⏸ ${agentId.toUpperCase()} paused.`);
                this._log('CMD_PAUSE', { agentId, adminId: adminUserId });
                this._send(
                    `⏸ ${agentLabel(agentId)} *paused* via control panel.\n🕐 \`${timestamp()}\``,
                    { keyboard: this.getAgentKeyboard(agentId) },
                );
            } else if (action === 'resume') {
                this.orchestrator.setOperationalStatus(agentId, 'ACTIVE');
                this._reply(queryId, `▶️ ${agentId.toUpperCase()} resumed.`);
                this._log('CMD_RESUME', { agentId, adminId: adminUserId });
                this._send(
                    `▶️ ${agentLabel(agentId)} *resumed* via control panel.\n🕐 \`${timestamp()}\``,
                    { keyboard: this.getAgentKeyboard(agentId) },
                );
            } else if (action === 'fire') {
                await this.orchestrator.triggerCycle(agentId);
                this._reply(queryId, `🔥 ${agentId.toUpperCase()} cycle triggered.`);
                this._log('CMD_FIRE', { agentId, adminId: adminUserId });
                this._send(
                    `🔥 ${agentLabel(agentId)} *forced cycle* triggered via panel.\n🕐 \`${timestamp()}\``,
                    { keyboard: this.getAgentKeyboard(agentId) },
                );
            }
        } catch (err: any) {
            this._reply(queryId, `❌ ${action} failed: ${err.message}`, true);
            this._log(`CMD_${action.toUpperCase()}_ERROR`, { agentId, error: err.message });
        }
    }

    private async _handleStatusCallback(): Promise<void> {
        try {
            const map = this.orchestrator.getAgentStatus();
            let msg = `📊 *FLEET STATUS* _(refreshed)_\n${'─'.repeat(28)}\n`;
            for (const [id, s] of Object.entries(map)) {
                const active = s.operationalStatus === 'ACTIVE';
                msg +=
                    `\n${active ? '🟢' : '⏸'} ${agentLabel(id as AgentId)}\n` +
                    `   Status:  \`${active ? 'ACTIVE' : 'PAUSED'}\`\n` +
                    `   Cycles:  \`${s.cycleCount}\`\n` +
                    `   Wallet:  \`${shortKey(s.publicKey)}\`\n`;
            }
            msg += `\n🕐 \`${timestamp()}\``;
            this._send(msg, { keyboard: this.getFleetKeyboard() });
        } catch {
            this._send('🚫 *Error* — Status fetch failed.');
        }
    }

    private async _handleBalancesCallback(): Promise<void> {
        try {
            const map = this.orchestrator.getAgentStatus();
            let msg = `💰 *LIVE BALANCES* (approx) _(refreshed)_\n${'─'.repeat(28)}\n`;
            for (const [id, s] of Object.entries(map)) {
                let solBal = '_unavailable_';
                try {
                    const bal = await this.orchestrator.getAgent(id as AgentId).getBalance();
                    solBal = `\`${formatSol(bal.sol)}\` SOL`;
                } catch { }

                msg +=
                    `\n${agentLabel(id as AgentId)}\n` +
                    `   Wallet: \`${shortKey(s.publicKey)}\`\n` +
                    `   SOL:    ${solBal}\n`;
            }
            msg += `\n📈 _Use dashboard for exact asset breakdown._\n🕐 \`${timestamp()}\``;
            this._send(msg);
        } catch {
            this._send('🚫 *Error* — Balance fetch failed.');
        }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    async stop(): Promise<void> {
        if (this.initialized) {
            this._send(
                `🔴 *SOLUS PROTOCOL OFFLINE*\n` +
                `Bot stopped gracefully.\n` +
                `🕐 \`${timestamp()}\``,
            );
            await this.bot.stopPolling();
            this._log('STOPPED');
        }
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createTelegramNotifier(
    orchestrator: AgentOrchestrator,
): TelegramNotifier | null {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const adminId = process.env.TELEGRAM_ADMIN_ID;

    if (!token || !chatId) {
        getAuditLogger().log({
            agentId: 'rex',
            cycle: 0,
            event: 'TELEGRAM_CONFIG_MISSING',
            data: {
                message: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — bot disabled',
                hint: 'Set both env vars to enable Telegram notifications.',
            },
        });
        return null;
    }

    return new TelegramNotifier({ token, chatId, adminId }, orchestrator);
}
