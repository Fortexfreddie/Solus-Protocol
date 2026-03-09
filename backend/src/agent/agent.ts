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
 *
 * Devnet note (Layer 7)
 * ──────────────────────
 * Jupiter's Swap API is mainnet-only. V0 transactions reference Address Lookup
 * Tables (ALTs) that do not exist on Devnet. Broadcast will fail with:
 *   "Failed to fetch lookup table: Account <address> not found"
 * This is suppressed as DEVNET_ALT_SKIP — not a TX_FAILED — so Telegram is not
 * spammed with false alarms during development. The proof is still anchored on
 * Devnet (Layer 5 memo transaction is unaffected). Switch SOLANA_RPC_URL to
 * mainnet to get real swap confirmations.
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

    static async create(profile: PersonalityProfile): Promise<Agent> {
        const vault = await Vault.loadOrCreate(profile.agentId, MASTER_KEY, RPC_URL);
        return new Agent(profile, vault);
    }

    getAgentId():    AgentId            { return this.agentId; }
    getProfile():    PersonalityProfile { return this.profile; }
    getCycleCount(): number             { return this.cycleCount; }
    getPublicKey():  string             { return this.vault.getPublicKey().toBase58(); }
    async getBalance()                  { return this.vault.getBalance(); }

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
            const priceData: PriceData = { ...await getPriceOracle().getPrices() };

            // ── Layer 1b: Jupiter Pre-scan (rotated) ──────────────────────────
            const candidates = this.buildCandidateList(priceData);

            if (candidates.length > 0) {
                const idx     = this.prescanRotationIndex % candidates.length;
                const prescan = candidates[idx];

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
                    0.1,
                    priceData.prices[prescan.from as TokenSymbol]?.usd ?? 0,
                    priceData.prices[prescan.to  as TokenSymbol]?.usd ?? 0,
                );
                priceData.executionQuote = prescanQuote;
            }

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

            const finalDecision = policyResult.finalDecision;

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

                eventBus.emit('KORA_SIGNED',  this.agentId, { agentId: this.agentId, koraSignerAddress });
                eventBus.emit('TX_SUBMITTED', this.agentId, { signature });
                eventBus.emit('TX_CONFIRMED', this.agentId, {
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
                const errMsg = (txErr as Error).message ?? '';

                // ── Devnet ALT limitation ─────────────────────────────────────
                // Jupiter V0 transactions reference Address Lookup Tables (ALTs)
                // that only exist on mainnet. On Devnet the RPC cannot resolve
                // them and rejects with "Failed to fetch lookup table: Account
                // <address> not found". This is not a real failure — the signing
                // pipeline (vault + kora) completed successfully. We suppress
                // TX_FAILED and log DEVNET_ALT_SKIP so Telegram is not spammed
                // during development. Switch SOLANA_RPC_URL to mainnet to get
                // real swap confirmations.
                if (errMsg.includes('Failed to fetch lookup table')) {
                    logger.log({
                        agentId: this.agentId, cycle, event: 'DEVNET_ALT_SKIP',
                        data: {
                            reason:    'Jupiter ALT accounts not present on Devnet — swap skipped',
                            error:     errMsg,
                            proofHash: proofRecord.hash,
                        },
                    });
                    return;
                }

                // All other broadcast errors are real failures — emit TX_FAILED.
                eventBus.emit('TX_FAILED', this.agentId, {
                    signature: '',
                    error:     errMsg,
                    retrying:  false,
                });
                logger.log({
                    agentId: this.agentId, cycle, event: 'TX_FAILED',
                    data: { error: errMsg },
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

    private buildCandidateList(priceData: PriceData): CandidatePair[] {
        const candidates: CandidatePair[] = [];

        for (const [key, spread] of Object.entries(priceData.spreads)) {
            if (spread.direction === 'neutral') continue;

            const [tokenA, tokenB] = key.split('_') as [string, string];

            const pair: CandidatePair = spread.direction.startsWith(tokenA)
                ? { from: tokenA, to: tokenB, spreadPct: spread.spreadPct }
                : { from: tokenB, to: tokenA, spreadPct: spread.spreadPct };

            candidates.push(pair);
        }

        candidates.sort((a, b) => b.spreadPct - a.spreadPct);

        return candidates;
    }
}