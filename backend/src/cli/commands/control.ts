import axios from 'axios';
import { THEME, formatTimestamp } from '../ui-helpers';
import type { AgentId } from '../../types/agent-types';

export async function toggleAgent(agentId: AgentId, action: 'ACTIVE' | 'PAUSED', port: number = 3001) {
    const API_URL = `http://localhost:${port}/api/agents/${agentId}/status`;

    try {
        await axios.patch(API_URL, { status: action });
        const color = THEME[agentId as keyof typeof THEME] || THEME.label;
        const statusText = action === 'ACTIVE' ? THEME.success('RESUMED') : THEME.error('PAUSED');

        console.log(`${formatTimestamp()}${color(agentId.toUpperCase())} has been ${statusText}.`);
    } catch (err) {
        console.error(THEME.error(`Failed to toggle agent: ${(err as Error).message}`));
    }
}

export async function forceRun(agentId: AgentId, port: number = 3001) {
    const API_URL = `http://localhost:${port}/api/agents/${agentId}/run`;

    try {
        console.log(`${formatTimestamp()}${THEME.warning('Requesting out-of-cycle run for ' + agentId.toUpperCase() + '...')}`);
        const res = await axios.post(API_URL);

        if (res.status === 202) {
            console.log(THEME.success('✓ Force run accepted. Agent is entering Layer 1.'));
        }
    } catch (err: any) {
        if (err.response?.status === 403) {
            console.error(THEME.error('✗ Denied: Agent is currently PAUSED. Resume it first.'));
        } else if (err.response?.status === 429) {
            console.error(THEME.warning('✗ Denied: Rate limit active. Wait 15s between force runs.'));
        } else {
            console.error(THEME.error(`Force run failed: ${err.message}`));
        }
    }
}