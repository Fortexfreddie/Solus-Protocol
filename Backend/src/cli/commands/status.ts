import axios from 'axios';
import { table } from 'table';
import { THEME, div } from '../ui-helpers';

export async function statusCommand(port: number = 3001) {
    const API_URL = `http://localhost:${port}/api`;

    try {
        console.log(THEME.header(' SOLUS PROTOCOL — FLEET STATUS & LEADERBOARD '));

        // Fetch leaderboard (PnL) and general agent status
        const [leaderboardRes, agentsRes] = await Promise.all([
            axios.get(`${API_URL}/leaderboard`),
            axios.get(`${API_URL}/agents`)
        ]);

        const leaderboard = leaderboardRes.data.leaderboard || [];
        const agents = agentsRes.data.agents || [];

        const tableData = [
            [
                THEME.label('AGENT'),
                THEME.label('STATUS'),
                THEME.label('NET PnL (USD)'),
                THEME.label('SWAPS'),
                THEME.label('LAST SIG')
            ]
        ];

        leaderboard.forEach((entry: any) => {
            const agentInfo = agents.find((a: any) => a.agentId === entry.agentId);
            const agentColor = THEME[entry.agentId as 'rex' | 'nova' | 'sage'] || THEME.label;

            // Format PnL with colors
            const pnlValue = entry.netPnLUsd.toFixed(4);
            const pnlDisplay = entry.netPnLUsd >= 0
                ? THEME.success(`+$${pnlValue}`)
                : THEME.error(`-$${Math.abs(pnlValue)}`);

            tableData.push([
                agentColor(entry.agentId.toUpperCase()),
                agentInfo?.operationalStatus === 'ACTIVE' ? THEME.success('● ACTIVE') : THEME.error('○ PAUSED'),
                pnlDisplay,
                entry.swapCount.toString(),
                THEME.dim(entry.lastSignature ? entry.lastSignature.slice(0, 12) + '...' : 'N/A')
            ]);
        });

        console.log(table(tableData, {
            border: {
                topBody: THEME.dim('─'),
                topJoin: THEME.dim('┬'),
                topLeft: THEME.dim('┌'),
                topRight: THEME.dim('┐'),
                bottomBody: THEME.dim('─'),
                bottomJoin: THEME.dim('┴'),
                bottomLeft: THEME.dim('└'),
                bottomRight: THEME.dim('┘'),
                bodyLeft: THEME.dim('│'),
                bodyRight: THEME.dim('│'),
                bodyJoin: THEME.dim('│'),
                joinBody: THEME.dim('─'),
                joinLeft: THEME.dim('├'),
                joinRight: THEME.dim('┤'),
                joinJoin: THEME.dim('┼')
            }
        }));

        console.log(`${THEME.dim('Baseline:')} Total fleet performance calculated against initial SOL snapshots.`);
        console.log(div());

    } catch (err) {
        console.error(THEME.error(`Failed to fetch status: ${(err as Error).message}`));
        console.log(THEME.warning('Make sure the Solus backend is running on port ' + port));
    }
}