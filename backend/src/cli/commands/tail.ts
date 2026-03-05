import { io, Socket } from 'socket.io-client';
import { THEME, div, formatTimestamp } from '../ui-helpers';
import type { AgentId } from '../../types/agent-types'; // Removed WsEventType

export async function tailCommand(agentId: AgentId, port: number = 3001) {
    const socket: Socket = io(`http://localhost:${port}`);
    const color = THEME[agentId] || THEME.label;

    console.log(THEME.header(` SOLUS PROTOCOL — LIVE AUDIT LOG: ${agentId.toUpperCase()} `));
    console.log(div());

    socket.on('connect', () => {
        console.log(THEME.success(`${formatTimestamp()} Connected to Mission Control EventBus`));
    });

    socket.on('event', (envelope: any) => {
        const { type, agentId: id, payload } = envelope;
        if (id !== agentId) return;

        switch (type) {
            case 'PRICE_FETCHED': {
                const { executionQuote } = payload;
                console.log(`${formatTimestamp()}${color('L1 Price Oracle')} — Prices synced (stale: ${payload.stale})`);
                if (executionQuote && !executionQuote.error) {
                    console.log(`   ${THEME.dim('Targeting:')} ${THEME.highlight(executionQuote.pair)} | ${THEME.dim('Net Spread:')} ${THEME.success(executionQuote.netSpreadVsMarket.toFixed(4) + '%')}`);
                }
                break;
            }
            case 'AGENT_THINKING': {
                console.log(`${formatTimestamp()}${color('L2 Strategist')} — ${THEME.highlight(payload.decision)} | Confidence: ${payload.confidence}`);
                console.log(`   ${THEME.dim('Reasoning:')} "${payload.reasoning}"`);
                break;
            }
            case 'GUARDIAN_AUDIT': {
                const isVeto = payload.verdict === 'VETO';
                const verdictColor = isVeto ? THEME.error : THEME.success;
                console.log(`${formatTimestamp()}${color('L3 Guardian')}   — Verdict: ${verdictColor(payload.verdict)}`);
                console.log(`   ${THEME.dim('Challenge:')} ${isVeto ? THEME.error(payload.challenge) : THEME.dim(payload.challenge)}`);
                break;
            }
            case 'PROOF_ANCHORED': {
                console.log(`${formatTimestamp()}${color('L5 Proof')}      — Anchored on Devnet | Hash: ${THEME.dim(payload.hash.slice(0, 16) + '...')}`);
                console.log(`   ${THEME.label('Memo Tx:')} ${THEME.dim('https://explorer.solana.com/tx/' + payload.memoSignature + '?cluster=devnet')}`);
                break;
            }
            case 'TX_CONFIRMED': {
                console.log(`${formatTimestamp()}${THEME.success('L7 BROADCAST — TRANSACTION CONFIRMED')}`);
                console.log(`   ${THEME.success('✓')} ${payload.fromToken} → ${payload.toToken} | Sig: ${THEME.dim(payload.signature.slice(0, 24) + '...')}`);
                console.log(div());
                break;
            }
            case 'TX_FAILED': {
                console.log(`${formatTimestamp()}${THEME.error('L7 BROADCAST — TRANSACTION FAILED')}`);
                console.log(`   ${THEME.error('✗')} Error: ${payload.error}`);
                console.log(div());
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(THEME.warning(`${formatTimestamp()} Disconnected from server.`));
    });
}