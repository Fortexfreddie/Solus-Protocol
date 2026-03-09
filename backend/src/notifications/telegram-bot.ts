/**
 * Solus Protocol — Telegram Bot
 * File: src/notifications/telegram-bot.ts
 *
 * Push notifications and remote fleet control for the Solus Protocol agent system.
 *
 * Design principles:
 *   Security  — All admin commands gated by TELEGRAM_ADMIN_ID.
 *   Signal    — "Silent Guardian" logic: routine APPROVE verdicts are never
 *               pushed. The channel only lights up when intervention is needed.
 *   UX        — Inline keyboards replace text commands. Every action has a
 *               confirmation step where appropriate.
 *   Safety    — All free-form LLM text (Guardian challenge, policy reason,
 *               error messages) is passed through escapeMd() before rendering
 *               to prevent Telegram Markdown parse errors on arbitrary content.
 */

import TelegramBot from 'node-telegram-bot-api';
import { eventBus } from '../events/event-bus';
import { AgentOrchestrator } from '../agent/agent-orchestrator';
import { getAuditLogger } from '../security/audit-logger';
import type { WsEventEnvelope, WsEventType, AgentId, GuardianVerdict } from '../types/agent-types';

const logger = getAuditLogger();

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_AGENTS: AgentId[] = ['rex', 'nova', 'sage'];
const EXPLORER_BASE = 'https://explorer.solana.com/tx';
const CLUSTER = 'devnet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramConfig {
    token:    string;
    chatId:   string;
    adminId?: string;
}

interface SendOptions {
    keyboard?:       TelegramBot.InlineKeyboardMarkup;
    disablePreview?: boolean;
}

// ─── Visual Identity ──────────────────────────────────────────────────────────

const AGENT_DOT: Record<AgentId, string> = {
    rex:  '🔴',
    nova: '🟣',
    sage: '🟢',
};

const AGENT_ROLE: Record<AgentId, string> = {
    rex:  'Aggressive',
    nova: 'Conservative',
    sage: 'Balanced',
};

const EVENT_ICON: Partial<Record<WsEventType, string>> = {
    TX_CONFIRMED:   '✅',
    TX_FAILED:      '🚫',
    GUARDIAN_AUDIT: '🛡',
    PROOF_ANCHORED: '⚓',
    POLICY_FAIL:    '🔴',
    BALANCE_UPDATE: '💰',
    AGENT_COMMAND:  '⚙️',
};

/** e.g.  🔴 *REX* */
const agentLabel = (id: AgentId): string =>
    `${AGENT_DOT[id] ?? '🤖'} *${id.toUpperCase()}*`;

/** e.g.  🔴 *REX* _(Aggressive)_ */
const agentLabelFull = (id: AgentId): string =>
    `${AGENT_DOT[id] ?? '🤖'} *${id.toUpperCase()}* _(${AGENT_ROLE[id]})_`;

const formatSol  = (n: number): string  => n.toFixed(4);
const shortKey   = (k: string, h = 6, t = 4): string => `${k.slice(0, h)}…${k.slice(-t)}`;
const explorerLink = (sig: string, label = 'View on Solana Explorer'): string =>
    `[${label}](${EXPLORER_BASE}/${sig}?cluster=${CLUSTER})`;
const ts = (): string =>
    new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

/**
 * Escapes free-form LLM/error text for Telegram legacy Markdown mode.
 *
 * Telegram's Markdown parser chokes on unmatched _ * ` [ characters.
 * Guardian challenge text and policy reasons are LLM output and can contain
 * any of these. We replace each with a visually identical Unicode lookalike
 * so the text renders cleanly without triggering the parser.
 *
 *   _  →  ‗  (U+2017 DOUBLE LOW LINE)
 *   *  →  ∗  (U+2217 ASTERISK OPERATOR)
 *   `  →  ʻ  (U+02BB MODIFIER LETTER TURNED COMMA)
 *   [  →  ［  (U+FF3B FULLWIDTH LEFT SQUARE BRACKET)
 *
 * Switching to MarkdownV2 would require escaping ~30 characters everywhere
 * (including dots and parentheses in all static copy). This targeted approach
 * is safer and requires no changes to existing message templates.
 */
function escapeMd(text: string): string {
    if (!text) return '';
    return text
        .replace(/_/g,  '‗')
        .replace(/\*/g, '∗')
        .replace(/`/g,  'ʻ')
        .replace(/\[/g, '［');
}

// ─── TelegramNotifier ─────────────────────────────────────────────────────────

export class TelegramNotifier {
    private readonly bot:          TelegramBot;
    private readonly chatId:       string;
    private readonly adminId:      string | null;
    private readonly orchestrator: AgentOrchestrator;
    private initialized = false;

    /** Only these event types trigger a push notification. */
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
        this.chatId       = config.chatId;
        this.adminId      = config.adminId ?? null;
        this.orchestrator = orchestrator;
        this.bot = new TelegramBot(config.token, { polling: true });
    }

    // ─── Keyboards ────────────────────────────────────────────────────────────

    /** Full fleet control panel — shows live pause/resume state per agent. */
    private fleetKeyboard(): TelegramBot.InlineKeyboardMarkup {
        const statuses = this.orchestrator.getAgentStatus();
        const agentRow = (id: AgentId) => {
            const active = statuses[id].operationalStatus === 'ACTIVE';
            return [
                active
                    ? { text: `⏸ Pause ${id.toUpperCase()}`,  callback_data: `pause:${id}` }
                    : { text: `▶️ Resume ${id.toUpperCase()}`, callback_data: `resume:${id}` },
                { text: `⚡ Run ${id.toUpperCase()}`, callback_data: `run:${id}` },
            ];
        };
        return {
            inline_keyboard: [
                agentRow('rex'),
                agentRow('nova'),
                agentRow('sage'),
                [
                    { text: '📊 Status',    callback_data: 'cmd:status' },
                    { text: '💰 Balances',  callback_data: 'cmd:balances' },
                    { text: '🔄 Refresh',   callback_data: 'cmd:refresh' },
                ],
                [
                    { text: '🚨 Stop All Agents', callback_data: 'cmd:stopall' },
                ],
            ],
        };
    }

    /** Single-agent action panel. */
    private agentKeyboard(id: AgentId): TelegramBot.InlineKeyboardMarkup {
        const active = this.orchestrator.getOperationalStatus(id) === 'ACTIVE';
        return {
            inline_keyboard: [
                [
                    active
                        ? { text: `⏸ Pause ${id.toUpperCase()}`,  callback_data: `pause:${id}` }
                        : { text: `▶️ Resume ${id.toUpperCase()}`, callback_data: `resume:${id}` },
                    { text: `⚡ Run ${id.toUpperCase()}`, callback_data: `run:${id}` },
                ],
                [{ text: '◀️ Fleet Control', callback_data: 'cmd:control' }],
            ],
        };
    }

    /** Yes/No confirmation keyboard. */
    private confirmKeyboard(
        confirmData: string,
        confirmLabel = '✅ Confirm',
    ): TelegramBot.InlineKeyboardMarkup {
        return {
            inline_keyboard: [[
                { text: confirmLabel, callback_data: confirmData },
                { text: '❌ Cancel',  callback_data: 'cmd:cancel' },
            ]],
        };
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    private _log(event: string, data: Record<string, unknown> = {}): void {
        logger.log({ agentId: 'rex', cycle: 0, event: `TELEGRAM_${event}`, data });
    }

    private _isAdmin(src: TelegramBot.Message | TelegramBot.CallbackQuery): boolean {
        if (!this.adminId) return true;
        return String(src.from?.id) === this.adminId;
    }

    private _send(text: string, opts: SendOptions = {}): void {
        this.bot
            .sendMessage(this.chatId, text, {
                parse_mode:               'Markdown',
                disable_web_page_preview: opts.disablePreview ?? true,
                reply_markup:             opts.keyboard,
            })
            .catch((err: Error) =>
                this._log('SEND_ERROR', { error: err.message, preview: text.slice(0, 200) }),
            );
    }

    private _reply(qid: string, text: string, alert = false): void {
        this.bot.answerCallbackQuery(qid, { text, show_alert: alert }).catch(() => {});
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    init(): void {
        if (this.initialized) return;
        this.initialized = true;

        this._registerEvents();
        this._registerCommands();
        this._registerCallbacks();

        this._log('STARTUP', { adminActive: !!this.adminId });

        const adminLine = this.adminId
            ? '🔐 Admin controls are *active*'
            : '⚠️ No `TELEGRAM_ADMIN_ID` — admin controls *disabled*';

        this._send(
            `🛡 *Solus Protocol is Online*\n` +
            `Three autonomous agents are now running on *Solana Devnet*.\n\n` +
            `${agentLabelFull('rex')}\n` +
            `${agentLabelFull('nova')}\n` +
            `${agentLabelFull('sage')}\n\n` +
            `${adminLine}\n\n` +
            `Use /help for commands, or /control for the live fleet panel.\n` +
            `🕐 \`${ts()}\``,
        );
    }

    // ─── Event Handling ───────────────────────────────────────────────────────

    private _registerEvents(): void {
        eventBus.onAny((event: WsEventEnvelope) => {
            try {
                if (this.HIGH_VALUE_EVENTS.includes(event.type)) this._handleEvent(event);
            } catch (err: any) {
                this._log('EVENT_ERROR', { error: err.message, eventType: event.type });
            }
        });
    }

    private _handleEvent(event: WsEventEnvelope): void {
        const { type, agentId, payload } = event;
        const p     = payload as any;
        const agent = agentLabel(agentId);
        const icon  = EVENT_ICON[type] ?? '🔔';

        switch (type) {

            // ── Swap confirmed ───────────────────────────────────────────────
            case 'TX_CONFIRMED': {
                this._send(
                    `${icon} ${agent} — *Swap Confirmed*\n` +
                    `📤 *Sold:*    \`${p.fromToken}\`\n` +
                    `📥 *Bought:*  \`${p.toToken}\`\n` +
                    `💎 *Amount:*  \`${formatSol(p.amount)} SOL\`\n` +
                    `🔑 *Sig:*     \`${shortKey(p.signature, 8, 6)}\`\n\n` +
                    `${explorerLink(p.signature)}\n` +
                    `🕐 \`${ts()}\``,
                    { keyboard: this.agentKeyboard(agentId) },
                );
                break;
            }

            // ── Swap failed ──────────────────────────────────────────────────
            case 'TX_FAILED': {
                this._send(
                    `${icon} ${agent} — *Swap Failed*\n` +
                    `The agent attempted a swap but it did not complete.\n\n` +
                    `❗ *Reason:*\n\`${escapeMd(p.reason ?? p.error ?? 'Unknown error')}\`\n\n` +
                    `No funds were lost. The agent will retry on the next cycle.\n` +
                    `🕐 \`${ts()}\``,
                    { keyboard: this.agentKeyboard(agentId) },
                );
                break;
            }

            // ── Guardian audit (VETO / MODIFY only — APPROVE is silent) ──────
            case 'GUARDIAN_AUDIT': {
                const verdict = p.verdict as GuardianVerdict;

                if (verdict === 'VETO') {
                    this._send(
                        `🚨 ${icon} ${agent} — *Guardian Blocked a Trade*\n` +
                        `The second AI (Guardian) reviewed the proposed trade and\n` +
                        `*rejected it* before any funds moved.\n\n` +
                        `📌 *Reason:*\n${escapeMd(p.challenge)}\n\n` +
                        `✅ No funds were moved. This is the safety system working correctly.\n` +
                        `🕐 \`${ts()}\``,
                        { keyboard: this.agentKeyboard(agentId) },
                    );
                } else if (verdict === 'MODIFY') {
                    this._send(
                        `⚠️ ${icon} ${agent} — *Guardian Adjusted Trade Size*\n` +
                        `The Guardian approved the trade direction but reduced the amount.\n\n` +
                        `✏️ *New amount:* \`${formatSol(p.modifiedAmount ?? 0)} SOL\`\n\n` +
                        `📌 *Reason:*\n${escapeMd(p.challenge)}\n` +
                        `🕐 \`${ts()}\``,
                        { keyboard: this.agentKeyboard(agentId) },
                    );
                }
                // APPROVE → silent by design (Silent Guardian pattern)
                break;
            }

            // ── Proof anchored ───────────────────────────────────────────────
            case 'PROOF_ANCHORED': {
                this._send(
                    `${icon} ${agent} — *Decision Recorded On-Chain*\n` +
                    `Before executing the swap, the agent's full reasoning was\n` +
                    `hashed and permanently stored on Solana.\n\n` +
                    `🔏 *Proof hash:* \`${shortKey(p.hash, 12, 8)}\`\n\n` +
                    `${explorerLink(p.memoSignature, 'View Proof on Explorer')}\n` +
                    `🕐 \`${ts()}\``,
                );
                break;
            }

            // ── Policy failure ───────────────────────────────────────────────
            case 'POLICY_FAIL': {
                if (p.check === 'STOP_LOSS_CIRCUIT') {
                    this._send(
                        `🔴 ${icon} ${agent} — *Stop-Loss Triggered*\n` +
                        `The agent's portfolio has dropped past its stop-loss threshold.\n` +
                        `It has been *automatically paused* to protect remaining funds.\n\n` +
                        `📌 *Details:*\n\`${escapeMd(p.reason)}\`\n\n` +
                        `Use the controls below to resume once conditions improve.\n` +
                        `🕐 \`${ts()}\``,
                        { keyboard: this.agentKeyboard(agentId) },
                    );
                } else {
                    this._send(
                        `⚠️ ${icon} ${agent} — *Policy Check Failed*\n` +
                        `A safety rule blocked this cycle's trade.\n\n` +
                        `🔍 *Rule:*    \`${p.check}\`\n` +
                        `📌 *Reason:* \`${escapeMd(p.reason ?? 'No details available')}\`\n` +
                        `🕐 \`${ts()}\``,
                        { keyboard: this.agentKeyboard(agentId) },
                    );
                }
                break;
            }

            // ── Low balance ──────────────────────────────────────────────────
            case 'BALANCE_UPDATE': {
                if (p.sol < 0.05) {
                    this._send(
                        `⚠️ ${icon} ${agent} — *Low Balance Warning*\n` +
                        `This agent is running low on SOL for transaction fees.\n\n` +
                        `💸 *Balance:*    \`${formatSol(p.sol)} SOL\`\n` +
                        `📊 *Minimum:*    \`0.0500 SOL\`\n\n` +
                        `Top up via [faucet.solana.com](https://faucet.solana.com) to keep the agent running.\n` +
                        `🕐 \`${ts()}\``,
                        { keyboard: this.agentKeyboard(agentId) },
                    );
                }
                break;
            }

            // ── Agent state change ───────────────────────────────────────────
            case 'AGENT_COMMAND': {
                const cmd = (p.command as string).toUpperCase();
                if (['PAUSE', 'RESUME', 'SET_STATUS'].includes(cmd)) {
                    const label     = cmd === 'SET_STATUS' ? (p.status ?? 'STATUS_UPDATE') : cmd;
                    const stateIcon = label === 'RESUME' ? '▶️' : label === 'PAUSE' ? '⏸' : '⚙️';
                    this._send(
                        `${stateIcon} ${agent} — *Agent ${label === 'RESUME' ? 'Resumed' : label === 'PAUSE' ? 'Paused' : 'Status Updated'}*\n` +
                        `🔄 *New status:* \`${label}\`\n` +
                        `🕐 \`${ts()}\``,
                    );
                }
                break;
            }

            default:
                break;
        }
    }

    // ─── Commands ─────────────────────────────────────────────────────────────

    private _registerCommands(): void {

        // /help
        this.bot.onText(/\/help/, () => {
            this._send(
                `🛡 *Solus Protocol — Help*\n` +
                `*What is this?*\n` +
                `Three AI agents (Rex, Nova, Sage) autonomously analyze Solana\n` +
                `markets and execute trades when conditions are right.\n\n` +
                `📋 *Commands — anyone can use these*\n` +
                `/status    — See what each agent is doing\n` +
                `/balances  — Check each agent's SOL balance\n` +
                `/agents    — Agent health and cycle counts\n` +
                `/control   — Interactive fleet control panel\n` +
                `/help      — This message\n\n` +
                `🔐 *Admin commands — restricted*\n` +
                `/pause rex   — Pause an agent\n` +
                `/resume rex  — Resume a paused agent\n` +
                `/run rex     — Trigger an immediate cycle\n` +
                `/stopall     — Emergency stop all agents\n\n` +
                `💡 _Tip: /control gives you buttons for everything above._`,
            );
        });

        // /status
        this.bot.onText(/\/status/, async () => {
            try {
                const map = this.orchestrator.getAgentStatus();
                let msg = `📊 *Fleet Status*\n`;
                for (const [id, s] of Object.entries(map)) {
                    const active = s.operationalStatus === 'ACTIVE';
                    msg +=
                        `\n${active ? '🟢' : '⏸'} ${agentLabelFull(id as AgentId)}\n` +
                        `   Status:  \`${active ? 'ACTIVE' : 'PAUSED'}\`\n` +
                        `   Cycles:  \`${s.cycleCount}\`\n` +
                        `   Wallet:  \`${shortKey(s.publicKey)}\`\n`;
                }
                msg += `\n🕐 \`${ts()}\``;
                this._send(msg, { keyboard: this.fleetKeyboard() });
            } catch (err: any) {
                this._log('STATUS_ERROR', { error: err.message });
                this._send('🚫 Could not fetch fleet status. Please try again.');
            }
        });

        // /balances
        this.bot.onText(/\/balances/, async () => {
            try {
                const map = this.orchestrator.getAgentStatus();
                let msg = `💰 *Agent Balances*\n`;
                for (const [id, s] of Object.entries(map)) {
                    let solBal = '_unavailable_';
                    try {
                        const bal = await this.orchestrator.getAgent(id as AgentId).getBalance();
                        solBal = `\`${formatSol(bal.sol)} SOL\``;
                    } catch {}
                    msg +=
                        `\n${agentLabelFull(id as AgentId)}\n` +
                        `   Wallet:  \`${shortKey(s.publicKey)}\`\n` +
                        `   Balance: ${solBal}\n`;
                }
                msg += `\n📈 _Full token breakdown is available on the dashboard._\n🕐 \`${ts()}\``;
                this._send(msg);
            } catch (err: any) {
                this._log('BALANCE_ERROR', { error: err.message });
                this._send('🚫 Could not fetch balances. Please try again.');
            }
        });

        // /agents
        this.bot.onText(/\/agents/, async () => {
            try {
                const map = this.orchestrator.getAgentStatus();
                let msg = `🤖 *Agent Health*\n`;
                for (const [id, s] of Object.entries(map)) {
                    const active = s.operationalStatus === 'ACTIVE';
                    msg +=
                        `\n${active ? '🟢' : '⏸'} ${agentLabelFull(id as AgentId)}\n` +
                        `   Status: \`${active ? 'ACTIVE' : 'PAUSED'}\`\n` +
                        `   Cycles: \`${s.cycleCount} completed\`\n`;
                }
                msg += `\n🕐 \`${ts()}\``;
                this._send(msg, { keyboard: this.fleetKeyboard() });
            } catch (err: any) {
                this._log('AGENTS_ERROR', { error: err.message });
                this._send('🚫 Could not fetch agent info. Please try again.');
            }
        });

        // /control
        this.bot.onText(/\/control/, () => {
            this._send(
                `⚙️ *Fleet Control Panel*\n` +
                `Manage all three agents from here.\n` +
                `Each button reflects the agent's current live state.\n\n` +
                `🔐 _Admin verification required for all actions._`,
                { keyboard: this.fleetKeyboard() },
            );
        });

        // /stopall
        this.bot.onText(/\/stopall/, (msg: TelegramBot.Message) => {
            if (!this._isAdmin(msg)) return this._send('⛔ This command requires admin access.');
            this._send(
                `🚨 *Emergency Stop — Confirm*\n` +
                `This will *immediately pause all three agents*.\n` +
                `No new trades will be initiated until you resume them.\n\n` +
                `Are you sure?`,
                { keyboard: this.confirmKeyboard('confirmed:stopall', '🚨 Yes, Stop All Agents') },
            );
        });

        // /pause <id>
        this.bot.onText(/\/pause(?:\s+(\w+))?/, async (msg: TelegramBot.Message, match) => {
            if (!this._isAdmin(msg)) return this._send('⛔ This command requires admin access.');
            const id = match?.[1]?.toLowerCase() as AgentId;
            if (!VALID_AGENTS.includes(id)) return this._send('ℹ️ Usage: `/pause rex` or `/pause nova` or `/pause sage`');
            try {
                this.orchestrator.setOperationalStatus(id, 'PAUSED');
                this._log('CMD_PAUSE', { agentId: id, adminId: msg.from?.id });
                this._send(`⏸ ${agentLabel(id)} has been *paused*.\n🕐 \`${ts()}\``, { keyboard: this.agentKeyboard(id) });
            } catch (err: any) {
                this._send(`🚫 Could not pause ${id}: \`${err.message}\``);
            }
        });

        // /resume <id>
        this.bot.onText(/\/resume(?:\s+(\w+))?/, async (msg: TelegramBot.Message, match) => {
            if (!this._isAdmin(msg)) return this._send('⛔ This command requires admin access.');
            const id = match?.[1]?.toLowerCase() as AgentId;
            if (!VALID_AGENTS.includes(id)) return this._send('ℹ️ Usage: `/resume rex` or `/resume nova` or `/resume sage`');
            try {
                this.orchestrator.setOperationalStatus(id, 'ACTIVE');
                this._log('CMD_RESUME', { agentId: id, adminId: msg.from?.id });
                this._send(`▶️ ${agentLabel(id)} has been *resumed* and is now active.\n🕐 \`${ts()}\``, { keyboard: this.agentKeyboard(id) });
            } catch (err: any) {
                this._send(`🚫 Could not resume ${id}: \`${err.message}\``);
            }
        });

        // /run <id>
        this.bot.onText(/\/run(?:\s+(\w+))?/, async (msg: TelegramBot.Message, match) => {
            if (!this._isAdmin(msg)) return this._send('⛔ This command requires admin access.');
            const id = match?.[1]?.toLowerCase() as AgentId;
            if (!VALID_AGENTS.includes(id)) return this._send('ℹ️ Usage: `/run rex` or `/run nova` or `/run sage`');
            try {
                await this.orchestrator.triggerCycle(id);
                this._log('CMD_RUN', { agentId: id, adminId: msg.from?.id });
                this._send(`⚡ ${agentLabel(id)} is running an *immediate cycle* now.\n🕐 \`${ts()}\``, { keyboard: this.agentKeyboard(id) });
            } catch (err: any) {
                this._send(`🚫 Could not trigger ${id}: \`${escapeMd(err.message)}\``);
            }
        });

        this.bot.on('polling_error', (err: any) => {
            this._log('POLLING_ERROR', { error: err.message, code: err.code });
        });
    }

    // ─── Callbacks ────────────────────────────────────────────────────────────

    private _registerCallbacks(): void {
        this.bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
            const data = query.data ?? '';

            if (!this._isAdmin(query)) {
                this._reply(query.id, '⛔ Admin access required.', true);
                return;
            }

            // ── Panel navigation & queries ────────────────────────────────────
            if (data === 'cmd:status')   { this._reply(query.id, 'Fetching status…');   return this._cbStatus(); }
            if (data === 'cmd:balances') { this._reply(query.id, 'Fetching balances…'); return this._cbBalances(); }
            if (data === 'cmd:refresh')  { this._reply(query.id, 'Refreshed ✓');        return this._cbStatus(); }
            if (data === 'cmd:cancel')   { this._reply(query.id, 'Cancelled.');          return; }
            if (data === 'cmd:control') {
                this._reply(query.id, 'Opening fleet panel.');
                return this._send(
                    `⚙️ *Fleet Control Panel*\n\nManage your agents below.`,
                    { keyboard: this.fleetKeyboard() },
                );
            }

            // ── Stop all (with inline confirmation) ───────────────────────────
            if (data === 'cmd:stopall') {
                this._reply(query.id, 'Confirm stop…');
                return this._send(
                    `🚨 *Emergency Stop — Confirm*\n` +
                    `This will *pause all three agents immediately*.\n` +
                    `Are you sure?`,
                    { keyboard: this.confirmKeyboard('confirmed:stopall', '🚨 Yes, Stop All Agents') },
                );
            }

            if (data === 'confirmed:stopall') {
                try {
                    for (const id of VALID_AGENTS) this.orchestrator.setOperationalStatus(id, 'PAUSED');
                    this._log('CMD_STOPALL', { adminId: query.from?.id });
                    this._reply(query.id, '🚨 All agents stopped.');
                    this._send(
                        `🚨 *All Agents Stopped*\n` +
                        `⏸ Rex, Nova, and Sage have been paused.\n` +
                        `No new trades will run until you resume them.\n` +
                        `🕐 \`${ts()}\``,
                        { keyboard: this.fleetKeyboard() },
                    );
                } catch (err: any) {
                    this._reply(query.id, `❌ Failed: ${err.message}`, true);
                }
                return;
            }

            // ── Agent actions: pause / resume / run ───────────────────────────
            const [action, agentId] = data.split(':') as [string, AgentId];
            if (['pause', 'resume', 'run'].includes(action) && VALID_AGENTS.includes(agentId)) {
                return this._cbAgentAction(action, agentId, query.id, query.from?.id);
            }

            this._reply(query.id, 'Unknown action.', true);
        });
    }

    private async _cbAgentAction(
        action:    string,
        id:        AgentId,
        queryId:   string,
        adminId?:  number,
    ): Promise<void> {
        try {
            if (action === 'pause') {
                this.orchestrator.setOperationalStatus(id, 'PAUSED');
                this._reply(queryId, `⏸ ${id.toUpperCase()} paused.`);
                this._log('CMD_PAUSE', { agentId: id, adminId });
                this._send(
                    `⏸ ${agentLabel(id)} has been *paused* via the control panel.\n🕐 \`${ts()}\``,
                    { keyboard: this.agentKeyboard(id) },
                );
            } else if (action === 'resume') {
                this.orchestrator.setOperationalStatus(id, 'ACTIVE');
                this._reply(queryId, `▶️ ${id.toUpperCase()} resumed.`);
                this._log('CMD_RESUME', { agentId: id, adminId });
                this._send(
                    `▶️ ${agentLabel(id)} has been *resumed* and is now active.\n🕐 \`${ts()}\``,
                    { keyboard: this.agentKeyboard(id) },
                );
            } else if (action === 'run') {
                await this.orchestrator.triggerCycle(id);
                this._reply(queryId, `⚡ ${id.toUpperCase()} cycle triggered.`);
                this._log('CMD_RUN', { agentId: id, adminId });
                this._send(
                    `⚡ ${agentLabel(id)} is running an *immediate cycle* now.\n🕐 \`${ts()}\``,
                    { keyboard: this.agentKeyboard(id) },
                );
            }
        } catch (err: any) {
            this._reply(queryId, `❌ ${action} failed: ${err.message}`, true);
            this._log(`CMD_${action.toUpperCase()}_ERROR`, { agentId: id, error: err.message });
        }
    }

    private async _cbStatus(): Promise<void> {
        try {
            const map = this.orchestrator.getAgentStatus();
            let msg = `📊 *Fleet Status*\n`;
            for (const [id, s] of Object.entries(map)) {
                const active = s.operationalStatus === 'ACTIVE';
                msg +=
                    `\n${active ? '🟢' : '⏸'} ${agentLabelFull(id as AgentId)}\n` +
                    `   Status:  \`${active ? 'ACTIVE' : 'PAUSED'}\`\n` +
                    `   Cycles:  \`${s.cycleCount}\`\n` +
                    `   Wallet:  \`${shortKey(s.publicKey)}\`\n`;
            }
            msg += `\n🕐 \`${ts()}\``;
            this._send(msg, { keyboard: this.fleetKeyboard() });
        } catch {
            this._send('🚫 Could not fetch status. Please try again.');
        }
    }

    private async _cbBalances(): Promise<void> {
        try {
            const map = this.orchestrator.getAgentStatus();
            let msg = `💰 *Agent Balances*\n`;
            for (const [id, s] of Object.entries(map)) {
                let solBal = '_unavailable_';
                try {
                    const bal = await this.orchestrator.getAgent(id as AgentId).getBalance();
                    solBal = `\`${formatSol(bal.sol)} SOL\``;
                } catch {}
                msg +=
                    `\n${agentLabelFull(id as AgentId)}\n` +
                    `   Wallet:  \`${shortKey(s.publicKey)}\`\n` +
                    `   Balance: ${solBal}\n`;
            }
            msg += `\n📈 _Full token breakdown on the dashboard._\n🕐 \`${ts()}\``;
            this._send(msg);
        } catch {
            this._send('🚫 Could not fetch balances. Please try again.');
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async stop(): Promise<void> {
        if (!this.initialized) return;
        this._send(
            `🔴 *Solus Protocol is Offline*\n` +
            `The agent bot has been stopped gracefully.\n` +
            `All three agents have completed their current cycles.\n` +
            `🕐 \`${ts()}\``,
        );
        await this.bot.stopPolling();
        this._log('STOPPED');
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createTelegramNotifier(
    orchestrator: AgentOrchestrator,
): TelegramNotifier | null {
    const token   = process.env.TELEGRAM_BOT_TOKEN;
    const chatId  = process.env.TELEGRAM_CHAT_ID;
    const adminId = process.env.TELEGRAM_ADMIN_ID;

    if (!token || !chatId) {
        getAuditLogger().log({
            agentId: 'rex',
            cycle:   0,
            event:   'TELEGRAM_CONFIG_MISSING',
            data: {
                message: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — Telegram bot disabled.',
                hint:    'Set both env vars to enable notifications.',
            },
        });
        return null;
    }

    return new TelegramNotifier({ token, chatId, adminId }, orchestrator);
}