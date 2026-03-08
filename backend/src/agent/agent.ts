/**
 * agent.ts
 * Single autonomous agent — runs the complete 7-layer Air-Gap Engine each cycle.
 *
 * One Agent instance per agent identity (Rex, Nova, Sage). Each instance holds
 * its own Vault, personality profile, cycle counter, and pair rotation index.
 * Agents are completely isolated — no shared mutable state between them.
 *
 * The runCycle() method is the authoritative implementation of the decision flow
 * described in the master workflow spec. It emits WebSocket events at every layer
 * transition so the dashboard can display the pipeline in real time.
 *
 * Cycle flow:
 *   Layer 1   — CoinGecko prices + spread calculation
 *   Layer 1b  — Jupiter pre-scan: fetch execution quote for the NEXT pair in
 *               the rotation so the Strategist has real executable data before
 *               deciding. Rotation prevents all agents from evaluating the same
 *               pair every cycle when one pair consistently has negative spreads.
 *   Layer 2   — Strategist (DeepSeek) decides with Jupiter quote in context
 *   Layer 1c  — Re-fetch Jupiter quote for actual decided pair (if different from pre-scan)
 *   Layer 3   — Guardian AI (Gemini) audits with correct quote for proposed trade
 *   Layer 4   — Policy Engine: 9 deterministic checks
 *   Layer 5   — Proof-of-Reasoning anchored on-chain
 *   Layer 6   — Vault AES-256-GCM decrypt + partial sign
 *   Layer 7   — Kora co-sign + broadcast + confirmation
 *
 * Pair Rotation Strategy (Layer 1b)
 * ───────────────────────────────────
 * The previous implementation always picked the highest momentum divergence pair
 * for the pre-scan. In practice, USDC→RAY consistently had the highest CoinGecko
 * divergence but consistently negative Jupiter net spreads on Devnet — causing
 * every agent to HOLD every cycle because the 4-step Decision Rule correctly
 * rejects a negative executable spread at Step 1.
 *
 * The fix: maintain a per-agent rotation index across cycles. On each cycle, the
 * agent evaluates the NEXT non-neutral pair in the sorted rotation list. This
 * ensures all candidate pairs get evaluated over time:
 *   Cycle 1: highest divergence pair  (e.g. USDC→RAY)
 *   Cycle 2: second highest           (e.g. BONK→SOL)
 *   Cycle 3: third highest            (e.g. SOL→USDC)
 *   Cycle 4: wraps back to highest    (e.g. USDC→RAY)
 *
 * The rotation list is rebuilt each cycle from live spread data so it always
 * reflects current momentum — a pair that was third highest last cycle may be
 * first this cycle if market conditions changed.
 *
 * Cycle outcomes (any layer can end the cycle cleanly):
 *   LLM_PARSE_ERROR  — Strategist returned invalid JSON
 *   GUARDIAN_VETO    — Gemini rejected the decision
 *   POLICY_REJECTED  — a hard policy check failed
 *   POLICY_HOLD      — low confidence or spread, agent holds
 *   TX_FAILED        — swap submission or confirmation failed
 *   CYCLE_COMPLETE   — swap confirmed, proof anchored, balances updated
 */

import { Vault } from '../wallet/vault';
import { getPriceOracle } from '../price/price-oracle';
import { strategistService } from '../brain/strategist-service';
import { guardianService } from '../brain/guardian-service';
import { policyEngine } from '../security/policy-engine';
import { proofService } from '../proof/proof-service';
import { broadcastService } from '../protocol/broadcast-service';
import { getAuditLogger } from '../security/audit-logger';
import { eventBus } from '../events/event-bus';
import type {
    AgentId,
    PersonalityProfile,
    PriceData,
    StrategistDecision,
    TokenSymbol,
    TxRecord,
} from '../types/agent-types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MASTER_KEY = process.env.VAULT_MASTER_KEY ?? '';
const RPC_URL    = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CandidatePair {
    from:      string;
    to:        string;
    spreadPct: number;
}

// ─── Agent class ───────────────────────────────────────────────────────────────

export class Agent {
    private readonly agentId:  AgentId;
    private readonly profile:  PersonalityProfile;
    private readonly vault:    Vault;
    private cycleCount = 0;

    /**
     * Rotation index for the Layer 1b pair pre-scan.
     * Advances by 1 on every cycle, wrapping around the candidate list length.
     * Per-instance so Rex, Nova, and Sage rotate independently.
     */
    private prescanRotationIndex = 0;

    private constructor(profile: PersonalityProfile, vault: Vault) {
        this.agentId = profile.agentId;
        this.profile = profile;
        this.vault   = vault;
    }

    /**
     * Async factory — creates an Agent with its vault initialized.
     * Vault loading is async (supports both filesystem and DB backends).
     */
    static async create(profile: PersonalityProfile): Promise<Agent> {
        const vault = await Vault.loadOrCreate(profile.agentId, MASTER_KEY, RPC_URL);
        return new Agent(profile, vault);
    }

    getAgentId():    AgentId           { return this.agentId; }
    getProfile():    PersonalityProfile { return this.profile; }
    getCycleCount(): number             { return this.cycleCount; }
    getPublicKey():  string             { return this.vault.getPublicKey().toBase58(); }
    async getBalance()                  { return this.vault.getBalance(); }

    // ─── Main cycle ────────────────────────────────────────────────────────────

    /**
     * Executes one complete 7-layer Air-Gap Engine cycle.
     *
     * Never throws. All errors are caught, logged, and the cycle ends cleanly.
     * The orchestrator can safely call runCycle() on a fixed interval without
     * needing to handle exceptions.
     */
    async runCycle(): Promise<void> {
        this.cycleCount++;
        const cycle  = this.cycleCount;
        const logger = getAuditLogger();

        eventBus.emit('AGENT_STATUS', this.agentId, {
            status:    'cycle_start',
            cycle,
            publicKey: this.vault.getPublicKey().toBase58(),
        });

        try {
            // ── Layer 1: Price Oracle ─────────────────────────────────────────
            // Fetch CoinGecko prices and calculate momentum divergence spreads.
            // Shallow copy so we can safely attach executionQuote below.
            const priceData: PriceData = { ...await getPriceOracle().getPrices() };

            // ── Layer 1b: Jupiter Pre-scan (rotated) ──────────────────────────
            // Build the sorted candidate list and select the pair at the current
            // rotation index. Advance the index for next cycle regardless of
            // whether Jupiter succeeds — rotation must be unconditional so
            // a repeated Jupiter failure on one pair cannot stall the rotation.
            //
            // Non-fatal: if Jupiter fails the cycle continues without a quote
            // and the Strategist falls back to momentum divergence per SKILLS.md.
            const candidates = this.buildCandidateList(priceData);

            if (candidates.length > 0) {
                // Clamp index in case the candidate list shrank since last cycle.
                const idx     = this.prescanRotationIndex % candidates.length;
                const prescan = candidates[idx];

                // Advance rotation index BEFORE the await so a Jupiter timeout
                // or error still moves the rotation forward on the next cycle.
                this.prescanRotationIndex = (idx + 1) % candidates.length;

                logger.log({
                    agentId: this.agentId,
                    cycle,
                    event:   'PRESCAN_PAIR',
                    data:    { pair: `${prescan.from}→${prescan.to}`, rotationIndex: idx, spreadPct: prescan.spreadPct },
                });

                const prescanQuote = await getPriceOracle().getExecutionQuote(
                    prescan.from,
                    prescan.to,
                    0.1, // representative amount — not the final tx size
                    priceData.prices[prescan.from as TokenSymbol]?.usd ?? 0,
                    priceData.prices[prescan.to  as TokenSymbol]?.usd ?? 0,
                );
                priceData.executionQuote = prescanQuote;
            }

            // Emit Layer 1 event — includes pre-scan quote if available.
            eventBus.emit('PRICE_FETCHED', this.agentId, {
                prices:  priceData.prices,
                spreads: priceData.spreads,
                stale:   priceData.stale,
                executionQuote: priceData.executionQuote
                    ? priceData.executionQuote.error
                        ? { error: priceData.executionQuote.error }
                        : {
                            pair:               `${priceData.executionQuote.fromToken}→${priceData.executionQuote.toToken}`,
                            impliedPrice:       priceData.executionQuote.impliedPrice,
                            netSpreadVsMarket:  priceData.executionQuote.netSpreadVsMarket,
                            worthTrading:       priceData.executionQuote.worthTrading,
                            priceImpactPct:     priceData.executionQuote.priceImpactPct,
                        }
                    : undefined,
            });

            // ── Layer 2: Strategist (DeepSeek) ────────────────────────────────
            // Strategist receives priceData with executionQuote populated for the
            // rotated pair. It applies the 4-step Decision Rule from SKILLS.md.
            const balance    = await this.vault.getBalance();
            const txHistory  = logger.getLastNTransactions(5, this.agentId);

            const strategistResult = await strategistService.reason(
                this.agentId, this.profile, priceData, balance, txHistory, cycle,
            );

            if (!strategistResult.ok) {
                eventBus.emit('LLM_PARSE_ERROR', this.agentId, {
                    error:     strategistResult.error,
                    rawOutput: strategistResult.rawOutput,
                });
                logger.log({
                    agentId: this.agentId, cycle, event: 'LLM_PARSE_ERROR',
                    data: { error: strategistResult.error },
                });
                return;
            }

            // Work on a mutable copy — Guardian and Policy Engine may adjust amount.
            let decision: StrategistDecision = { ...strategistResult.decision };

            eventBus.emit('AGENT_THINKING', this.agentId, {
                decision:   decision.decision,
                fromToken:  decision.fromToken,
                toToken:    decision.toToken,
                amount:     decision.amount,
                reasoning:  decision.reasoning,
                confidence: decision.confidence,
                riskFlags:  decision.riskFlags,
            });

            logger.log({
                agentId: this.agentId, cycle, event: 'AGENT_THINKING',
                data: { decision, rawOutput: strategistResult.rawOutput },
            });

            // ── Layer 1c: Re-fetch Jupiter quote for actual decided pair ───────
            // If the Strategist chose a different pair than the pre-scan, fetch
            // a precise quote for the exact pair and amount before Guardian runs.
            // If the pairs match, skip the extra API call entirely.
            if (decision.decision === 'SWAP') {
                const alreadyCorrectPair =
                    priceData.executionQuote                                   &&
                    !priceData.executionQuote.error                            &&
                    priceData.executionQuote.fromToken === decision.fromToken  &&
                    priceData.executionQuote.toToken   === decision.toToken;

                if (!alreadyCorrectPair) {
                    const finalQuote = await getPriceOracle().getExecutionQuote(
                        decision.fromToken,
                        decision.toToken,
                        decision.amount,
                        priceData.prices[decision.fromToken as TokenSymbol]?.usd ?? 0,
                        priceData.prices[decision.toToken   as TokenSymbol]?.usd ?? 0,
                    );
                    priceData.executionQuote = finalQuote;

                    // Re-emit PRICE_FETCHED so the dashboard reflects the corrected quote.
                    eventBus.emit('PRICE_FETCHED', this.agentId, {
                        prices:  priceData.prices,
                        spreads: priceData.spreads,
                        stale:   priceData.stale,
                        executionQuote: finalQuote.error
                            ? { error: finalQuote.error }
                            : {
                                pair:              `${finalQuote.fromToken}→${finalQuote.toToken}`,
                                impliedPrice:      finalQuote.impliedPrice,
                                netSpreadVsMarket: finalQuote.netSpreadVsMarket,
                                worthTrading:      finalQuote.worthTrading,
                                priceImpactPct:    finalQuote.priceImpactPct,
                            },
                    });
                }
            }

            // ── Layer 3: Guardian AI (Gemini) ─────────────────────────────────
            // Guardian receives the Layer 1c corrected quote for the proposed trade.
            const guardianResult = await guardianService.audit(
                this.profile, decision, priceData, balance, cycle,
            );

            if (!guardianResult.ok) {
                eventBus.emit('GUARDIAN_AUDIT', this.agentId, {
                    verdict:   'VETO',
                    challenge: guardianResult.error,
                });
                logger.log({
                    agentId: this.agentId, cycle, event: 'GUARDIAN_SAFETY_VETO',
                    data: { error: guardianResult.error },
                });
                return;
            }

            const { audit } = guardianResult;

            eventBus.emit('GUARDIAN_AUDIT', this.agentId, {
                verdict:        audit.verdict,
                challenge:      audit.challenge,
                modifiedAmount: audit.modifiedAmount ?? undefined,
            });

            logger.log({
                agentId: this.agentId, cycle, event: 'GUARDIAN_AUDIT',
                data: { audit, rawOutput: guardianResult.rawOutput },
            });

            if (audit.verdict === 'VETO') return;

            if (audit.verdict === 'MODIFY' && audit.modifiedAmount !== null) {
                decision = { ...decision, amount: audit.modifiedAmount };
            }

            // ── Layer 4: Policy Engine (9 deterministic checks) ───────────────
            const dailyVolume = logger.getDailyVolumeSOL(this.agentId);
            const bestSpread  = Math.max(
                ...Object.values(priceData.spreads).map((s) => s.spreadPct),
            );

            const policyResult = policyEngine.check(
                decision, this.profile, balance, priceData, dailyVolume, bestSpread,
            );

            const policyEvent = policyResult.approved ? 'POLICY_PASS' : 'POLICY_FAIL';
            eventBus.emit(policyEvent, this.agentId, {
                checks:        policyResult.checks,
                approved:      policyResult.approved,
                outcome:       policyResult.outcome,
                failedOn:      policyResult.failedOn,
                reason:        policyResult.reason,
                finalDecision: policyResult.finalDecision,
            });

            logger.log({
                agentId: this.agentId, cycle, event: policyEvent,
                data: { outcome: policyResult.outcome, failedOn: policyResult.failedOn },
            });

            if (!policyResult.approved) return;

            // Use the Policy Engine's (possibly clamped) finalDecision from here on.
            const finalDecision = policyResult.finalDecision;

            // HOLD/SKIP decisions end cleanly here — no proof, no tx.
            if (finalDecision.decision !== 'SWAP') {
                eventBus.emit('AGENT_STATUS', this.agentId, { status: 'cycle_complete', cycle });
                return;
            }

            // ── Layer 5: Proof-of-Reasoning ───────────────────────────────────
            const proofRecord = await proofService.anchor(
                this.agentId,
                cycle,
                finalDecision,
                audit,
                policyResult.checks,
                priceData,
                this.vault.signAndSendMemo.bind(this.vault),
            );

            eventBus.emit('PROOF_ANCHORED', this.agentId, {
                hash:           proofRecord.hash,
                memoSignature:  proofRecord.memoSignature,
                payloadSummary: proofRecord.payloadSummary,
            });

            logger.log({
                agentId: this.agentId, cycle, event: 'PROOF_ANCHORED',
                data: {
                    hash:           proofRecord.hash,
                    memoSignature:  proofRecord.memoSignature,
                    payloadSummary: proofRecord.payloadSummary,
                    payload:        proofRecord.payload,
                },
            });

            // ── Layer 6: Vault signing ────────────────────────────────────────
            eventBus.emit('TX_SIGNING', this.agentId, {
                fromToken: finalDecision.fromToken,
                toToken:   finalDecision.toToken,
                amount:    finalDecision.amount,
            });

            // ── Layer 7: Kora co-sign + Broadcast ────────────────────────────
            try {
                const { signature, confirmation, koraSignerAddress } =
                    await broadcastService.executeSwap(
                        finalDecision,
                        this.vault.getPublicKey().toBase58(),
                        this.vault.partiallySignTransaction.bind(this.vault),
                    );

                eventBus.emit('KORA_SIGNED',    this.agentId, { agentId: this.agentId, koraSignerAddress });
                eventBus.emit('TX_SUBMITTED',   this.agentId, { signature });
                eventBus.emit('TX_CONFIRMED',   this.agentId, {
                    signature,
                    fromToken: confirmation.fromToken,
                    toToken:   confirmation.toToken,
                    amount:    confirmation.amount,
                    output:    confirmation.output,
                });

                const updatedBalance = await this.vault.getBalance();
                eventBus.emit('BALANCE_UPDATE', this.agentId, {
                    sol:    updatedBalance.sol,
                    tokens: updatedBalance.tokens,
                });

                const txRecord: TxRecord = {
                    signature,
                    agentId:   this.agentId,
                    fromToken: confirmation.fromToken,
                    toToken:   confirmation.toToken,
                    amountIn:  confirmation.amount,
                    amountOut: confirmation.output,
                    timestamp: confirmation.confirmedAt,
                    cycle,
                    proofHash: proofRecord.hash,
                };

                this.vault.recordTransaction(txRecord);

                logger.log({
                    agentId: this.agentId, cycle, event: 'TX_CONFIRMED',
                    data: {
                        ...txRecord,
                        koraSignerAddress,
                        proofHash:     proofRecord.hash,
                        memoSignature: proofRecord.memoSignature,
                    },
                });

            } catch (txErr) {
                eventBus.emit('TX_FAILED', this.agentId, {
                    signature: '',
                    error:     (txErr as Error).message,
                    retrying:  false,
                });
                logger.log({
                    agentId: this.agentId, cycle, event: 'TX_FAILED',
                    data: { error: (txErr as Error).message },
                });
                return;
            }

        } catch (err) {
            logger.log({
                agentId: this.agentId, cycle, event: 'CYCLE_ERROR',
                data: { error: (err as Error).message, stack: (err as Error).stack },
            });
        } finally {
            eventBus.emit('AGENT_STATUS', this.agentId, {
                status: 'cycle_complete',
                cycle,
            });
        }
    }

    // ─── Private helpers ───────────────────────────────────────────────────────

    /**
     * Builds a sorted list of non-neutral candidate pairs for the Layer 1b
     * pre-scan rotation, ordered by descending momentum divergence.
     *
     * Each entry includes the trade direction:
     *   fromToken = overpriced token (sell it)
     *   toToken   = underpriced token (buy it)
     *
     * Returns an empty array if all pairs are neutral — no pre-scan needed.
     *
     * The list is rebuilt from live spread data every cycle so it always
     * reflects current momentum conditions. A pair that was second-highest
     * last cycle may be first-highest this cycle.
     */
    private buildCandidateList(priceData: PriceData): CandidatePair[] {
        const candidates: CandidatePair[] = [];

        for (const [key, spread] of Object.entries(priceData.spreads)) {
            if (spread.direction === 'neutral') continue;

            const [tokenA, tokenB] = key.split('_') as [string, string];

            // Sell the overpriced token: fromToken = overpriced, toToken = underpriced.
            const pair: CandidatePair = spread.direction.startsWith(tokenA)
                ? { from: tokenA, to: tokenB, spreadPct: spread.spreadPct }
                : { from: tokenB, to: tokenA, spreadPct: spread.spreadPct };

            candidates.push(pair);
        }

        // Sort descending by momentum divergence so the highest-signal pairs
        // are evaluated most frequently (they appear at lower rotation indices
        // and are visited first on each full rotation).
        candidates.sort((a, b) => b.spreadPct - a.spreadPct);

        return candidates;
    }
}