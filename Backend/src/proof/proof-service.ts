/**
 * proof-service.ts
 * Layer 5: Proof-of-Reasoning Service.
 *
 * Before any transaction is signed or submitted, this service constructs a
 * complete record of every prior layer's output, SHA-256 hashes it, and writes
 * the hash to the Solana Devnet blockchain via the Memo Program.
 *
 * The on-chain hash and the hash in the local audit log will always match for any
 * legitimate cycle. An external party with the hash can verify the agent reasoned
 * about specific data before any funds moved — tamper-evident by design.
 *
 * Process:
 *   1. Construct ProofPayload from Layer 1–4 outputs
 *   2. Deterministically serialize the payload (sorted keys for reproducibility)
 *   3. SHA-256 hash the serialized string using Node.js built-in crypto
 *   4. Invoke the Vault's signAndSendMemo() to submit the hash on-chain
 *      (keypair never leaves the Vault — only the memo content crosses the boundary)
 *   5. Return a ProofRecord with hash, memo signature, payload, and summary
 *
 * Security note: The proof service receives a signMemo callback, not a raw keypair.
 * This preserves the Vault's key isolation guarantee through Layer 5.
 *
 * WebSocket event emitted: PROOF_ANCHORED
 */

import crypto from 'node:crypto';

import { isProduction, getPrisma } from '../config/db';
import type {
    AgentId,
    StrategistDecision,
    GuardianAudit,
    PolicyCheck,
    PriceData,
    ProofPayload,
    ProofRecord,
} from '../types/agent-types';

// Constants 

// Prefix embedded in every on-chain memo so it is identifiable on Solana Explorer.
const MEMO_PREFIX = 'solus-protocol:proof:';

// Types 

/**
 * Callback signature for submitting the memo transaction.
 * The Vault implements this — the proof service calls it with the memo content
 * and receives the confirmed transaction signature.
 * This keeps the keypair fully inside the Vault at all times.
 */
export type SignMemoFn = (memoContent: string) => Promise<string>;

// Serialization helpers 

/**
 * Deterministically serializes a ProofPayload to JSON with sorted top-level keys.
 * Two independently constructed payloads with identical data produce identical bytes
 * and therefore identical SHA-256 hashes — essential for tamper-evidence verification.
 */
function serializePayload(payload: ProofPayload): string {
    return JSON.stringify(payload, Object.keys(payload).sort() as string[]);
}

/**
 * Computes the SHA-256 hash of a UTF-8 string.
 * Returns the lowercase hex digest (64 characters).
 */
function sha256(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Builds a human-readable single-line summary of the proof payload.
 * Stored in the audit log and emitted in the PROOF_ANCHORED WebSocket event
 * so the dashboard can display context without rendering the full JSON.
 */
function buildPayloadSummary(payload: ProofPayload): string {
    const d = payload.strategistDecision;
    const g = payload.guardianVerdict;
    const passed = payload.policyChecks.filter((c) => c.passed).length;
    return (
        `Agent: ${payload.agentId} | Cycle: ${payload.cycle} | ` +
        `Decision: ${d.decision} ${d.fromToken}→${d.toToken} ${d.amount} SOL | ` +
        `Confidence: ${d.confidence} | Guardian: ${g.verdict} | ` +
        `Policy: ${passed}/9 passed`
    );
}

// ProofService class 

export class ProofService {
    /**
     * Constructs the proof payload, hashes it, anchors the hash on Solana Devnet,
     * and returns a fully populated ProofRecord.
     *
     * @param agentId   - The agent running this cycle
     * @param cycle     - Current cycle counter for this agent
     * @param decision  - Final Strategist decision (post-Guardian MODIFY if applied)
     * @param guardian  - Guardian audit result
     * @param checks    - All 9 Policy Engine check results
     * @param priceData - Price snapshot from Layer 1 at the moment of decision
     * @param signMemo  - Vault callback: receives memo string, returns tx signature
     * @returns ProofRecord — hash, confirmed memo sig, full payload, and summary
     * @throws if the Vault memo signing fails or Devnet does not confirm in time
     */
    async anchor(
        agentId: AgentId,
        cycle: number,
        decision: StrategistDecision,
        guardian: GuardianAudit,
        checks: PolicyCheck[],
        priceData: PriceData,
        signMemo: SignMemoFn,
    ): Promise<ProofRecord> {
        // Step 1 — Build the full proof payload
        const payload: ProofPayload = {
            agentId,
            cycle,
            timestamp: Date.now(),
            strategistDecision: decision,
            guardianVerdict: guardian,
            policyChecks: checks,
            priceSnapshot: priceData,
        };

        // Step 2 — Deterministic serialization and SHA-256 hash
        const serialized = serializePayload(payload);
        const hash = sha256(serialized);

        // Step 3 — Submit hash to Solana Devnet via Vault's signAndSendMemo()
        // The keypair never crosses into this module — only the memo content string does.
        const memoContent = `${MEMO_PREFIX}${hash}`;
        const memoSignature = await signMemo(memoContent);

        // Step 4 — Assemble the proof record
        const proofRecord: ProofRecord = {
            hash,
            memoSignature,
            payloadSummary: buildPayloadSummary(payload),
            payload,
            anchoredAt: Date.now(),
        };

        // Step 5 — Persist to DB in production (fire-and-forget)
        if (isProduction) {
            getPrisma().proofRecord.create({
                data: {
                    agentId,
                    cycle,
                    hash,
                    memoSignature,
                    summary: proofRecord.payloadSummary,
                    payload: payload as unknown as object,
                    anchoredAt: new Date(proofRecord.anchoredAt),
                },
            }).catch((err: unknown) => {
                process.stderr.write(
                    `[ProofService] DB write failed: ${(err as Error).message}\n`,
                );
            });
        }

        return proofRecord;
    }

    /**
     * Verifies a proof record by re-deriving the SHA-256 hash from the stored payload
     * and comparing it against the claimed hash value.
     *
     * Returns true if the payload hashes correctly — confirming the record has not
     * been tampered with since it was created. Used by GET /api/proofs/:hash.
     */
    verify(payload: ProofPayload, expectedHash: string): boolean {
        const actualHash = sha256(serializePayload(payload));
        return actualHash === expectedHash;
    }
}

// Singleton 

export const proofService = new ProofService();