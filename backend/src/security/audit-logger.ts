/**
 * audit-logger.ts
 * Append-only structured audit logger for all Solus Protocol agent activity.
 *
 * Every layer of every agent cycle writes a log entry here. The log is the
 * authoritative record of system behaviour and the source of truth for the
 * /api/logs REST endpoint and the agent transaction history shown on the dashboard.
 *
 * Dual-mode persistence:
 *   development → Winston file (NDJSON) + in-memory buffer
 *   production  → Winston file + in-memory buffer + PostgreSQL (fire-and-forget)
 *
 * In production, query methods (getPaginated, getProofRecords, etc.) read from
 * the database so data survives restarts/redeploys. The in-memory buffer is still
 * maintained for fast hot-path reads during agent cycles (getLastN, getDailyVolumeSOL).
 */

import winston from 'winston';
import path from 'node:path';
import fs from 'node:fs';
import { isProduction, getPrisma } from '../config/db';
import type { AuditEntry, AgentId, TxRecord, ConfirmedSwapEntry } from '../types/agent-types';

// Constants

const DEFAULT_LOG_PATH = './logs/audit.jsonl';
const MAX_IN_MEMORY = 1000; // Circular in-memory buffer for fast history queries

// AuditLogger class

export class AuditLogger {
    private readonly fileLogger: winston.Logger;
    private readonly logPath: string;
    /** Circular in-memory buffer for fast getLastN() queries without disk reads. */
    private readonly buffer: AuditEntry[] = [];

    constructor(logPath?: string) {
        this.logPath = logPath ?? process.env.AUDIT_LOG_PATH ?? DEFAULT_LOG_PATH;

        // Ensure the log directory exists before Winston tries to open the file.
        fs.mkdirSync(path.dirname(this.logPath), { recursive: true });

        this.fileLogger = winston.createLogger({
            level: 'info',
            // No timestamp added by Winston — each AuditEntry carries its own ts field.
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.json(),
            ),
            transports: [
                new winston.transports.File({
                    filename: this.logPath,
                    // Append mode — never truncate the audit trail.
                    options: { flags: 'a' },
                }),
            ],
            // Prevent Winston from exiting the process on uncaught transport errors.
            exitOnError: false,
        });
    }

    // Write

    /**
     * Appends a structured AuditEntry to the file log, in-memory buffer, and
     * (in production) PostgreSQL. Never throws — all failures are logged to
     * stderr or the file logger but do not interrupt the agent cycle.
     */
    log(entry: Omit<AuditEntry, 'ts'>): void {
        const full: AuditEntry = { ts: Date.now(), ...entry };

        // Maintain in-memory circular buffer
        this.buffer.push(full);
        if (this.buffer.length > MAX_IN_MEMORY) {
            this.buffer.shift();
        }

        // Write to file asynchronously via Winston
        try {
            this.fileLogger.info(full);
        } catch (err) {
            process.stderr.write(
                `[AuditLogger] File write failed: ${(err as Error).message}\n`,
            );
        }

        // Production: fire-and-forget DB write.
        // Failed DB writes are caught and logged to the file — never silently lost.
        if (isProduction) {
            getPrisma().auditLog.create({
                data: {
                    agentId: full.agentId,
                    event: full.event,
                    cycle: full.cycle,
                    data: full.data as object,
                    ts: new Date(full.ts),
                },
            }).catch((err: unknown) => {
                this.fileLogger.error('[AuditLogger] DB write failed', {
                    error: (err as Error).message,
                    entry: full,
                });
            });
        }
    }

    // Query — hot path (always in-memory)

    /**
     * Returns the last N audit entries for a specific agent from the in-memory
     * buffer. Used by the Strategist to build the agent's recent transaction
     * history for the LLM prompt.
     */
    getLastN(n: number, agentId: AgentId): AuditEntry[] {
        return this.buffer
            .filter((e) => e.agentId === agentId)
            .slice(-n);
    }

    /**
     * Returns the last N confirmed transaction records for an agent.
     * Always reads from in-memory buffer for speed during agent cycles.
     */
    getLastNTransactions(n: number, agentId: AgentId): TxRecord[] {
        return this.buffer
            .filter((e) => e.agentId === agentId && e.event === 'TX_CONFIRMED' && (e.data as Record<string, unknown>)['signature'])
            .slice(-n)
            .map((e) => e.data as unknown as TxRecord);
    }

    /**
     * Returns the total SOL volume traded today by an agent.
     * Always reads from in-memory buffer — critical hot path during Policy Engine checks.
     */
    getDailyVolumeSOL(agentId: AgentId): number {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startTs = startOfDay.getTime();

        return this.buffer
            .filter(
                (e) =>
                    e.agentId === agentId &&
                    e.event === 'TX_CONFIRMED' &&
                    e.ts >= startTs &&
                    typeof (e.data as Record<string, unknown>)['amountIn'] === 'number',
            )
            .reduce((sum, e) => sum + ((e.data as Record<string, unknown>)['amountIn'] as number), 0);
    }

    // Query — REST endpoints (DB in production, buffer in dev)

    /**
     * Returns paginated audit log entries across all agents.
     * In production: reads from PostgreSQL (persists across restarts).
     * In development: reads from in-memory buffer.
     */
    async getPaginated(page: number, limit: number): Promise<{ entries: AuditEntry[]; total: number }> {
        if (isProduction) {
            const prisma = getPrisma();
            const [rows, total] = await Promise.all([
                prisma.auditLog.findMany({
                    orderBy: { ts: 'desc' },
                    skip: (page - 1) * limit,
                    take: limit,
                }),
                prisma.auditLog.count(),
            ]);

            const entries: AuditEntry[] = rows.map((r) => ({
                agentId: r.agentId as AgentId,
                event: r.event,
                cycle: r.cycle,
                data: r.data as Record<string, unknown>,
                ts: r.ts.getTime(),
            }));

            return { entries, total };
        }

        // Dev mode: read from in-memory buffer
        const total = this.buffer.length;
        const start = Math.max(0, total - page * limit);
        const end = Math.max(0, total - (page - 1) * limit);
        const entries = this.buffer.slice(start, end).reverse(); // Most recent first
        return { entries, total };
    }

    /**
     * Returns all proof records.
     * In production: reads from PostgreSQL.
     * In development: reads from in-memory buffer.
     */
    async getProofRecords(): Promise<AuditEntry[]> {
        if (isProduction) {
            const rows = await getPrisma().auditLog.findMany({
                where: { event: 'PROOF_ANCHORED' },
                orderBy: { ts: 'desc' },
            });

            return rows.map((r) => ({
                agentId: r.agentId as AgentId,
                event: r.event,
                cycle: r.cycle,
                data: r.data as Record<string, unknown>,
                ts: r.ts.getTime(),
            }));
        }

        return this.buffer.filter((e) => e.event === 'PROOF_ANCHORED');
    }

    /**
     * Looks up a proof record by its SHA-256 hash string.
     * In production: reads from PostgreSQL.
     * In development: reads from in-memory buffer.
     */
    async getProofByHash(hash: string): Promise<AuditEntry | undefined> {
        if (isProduction) {
            // ProofRecord table has a unique hash index for O(1) lookups.
            const proofRow = await getPrisma().proofRecord.findUnique({ where: { hash } });
            if (!proofRow) return undefined;

            return {
                agentId: proofRow.agentId as AgentId,
                event: 'PROOF_ANCHORED',
                cycle: proofRow.cycle,
                data: proofRow.payload as Record<string, unknown>,
                ts: proofRow.anchoredAt.getTime(),
            };
        }

        return this.buffer.find(
            (e) => e.event === 'PROOF_ANCHORED' && (e.data as Record<string, unknown>)['hash'] === hash,
        );
    }

    /**
     * Returns all TX_CONFIRMED audit entries that contain swap data.
     * In production: queries the AuditLog DB table filtered by event type
     * so that historical data survives restarts and redeploys.
     * In development: filters the in-memory buffer.
     */
    async getConfirmedSwaps(): Promise<ConfirmedSwapEntry[]> {
        if (isProduction) {
            const rows = await getPrisma().auditLog.findMany({
                where: { event: 'TX_CONFIRMED' },
                orderBy: { ts: 'desc' },
            });
            return rows.map((r) => ({
                agentId: (r.data as Record<string, unknown>)['agentId'] as AgentId,
                fromToken: (r.data as Record<string, unknown>)['fromToken'],
                toToken: (r.data as Record<string, unknown>)['toToken'],
                amount: (r.data as Record<string, unknown>)['amountIn'],
                output: (r.data as Record<string, unknown>)['amountOut'],
                priceSnapshot: (r.data as Record<string, unknown>)['priceSnapshot'] ?? {},
                confirmedAt: r.ts.getTime(),
            } as unknown as ConfirmedSwapEntry));
        }

        // Development: filter in-memory buffer.
        return this.buffer
            .filter((e) => e.event === 'TX_CONFIRMED')
            .map((e) => ({
                agentId: e.agentId,
                ...(e.data as Record<string, unknown>),
                confirmedAt: e.ts,
            } as unknown as ConfirmedSwapEntry));
    }

    /** Returns the number of entries currently held in the in-memory buffer. */
    getBufferSize(): number {
        return this.buffer.length;
    }
}

// Singleton

let _instance: AuditLogger | null = null;

/**
 * Returns the shared AuditLogger singleton.
 * Reads AUDIT_LOG_PATH from environment on first call.
 */
export function getAuditLogger(): AuditLogger {
    if (!_instance) {
        _instance = new AuditLogger();
    }
    return _instance;
}