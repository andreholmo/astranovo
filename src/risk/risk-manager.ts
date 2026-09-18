/**
 * The deterministic, pre-trade risk gate between a validated `OrderIntent`
 * and the `PaperBroker`.
 *
 * `evaluateRisk` is a pure function: given the same intent, wallet snapshot,
 * policy and instant it always returns the same decision, never reads the
 * clock, never mutates its inputs and never reaches a broker. Per D-003 the
 * Risk Manager's veto prevails over any agent output; this slice only
 * approves or blocks the order exactly as proposed — it never resizes one.
 *
 * Isolation is structural, not merely tested: this module only ever accepts
 * one agent's own `Wallet`, never a `Portfolio`, so it has no way to read or
 * alter another agent's state.
 *
 * ## Exposure baseline
 *
 * `maxAssetExposureBps` is evaluated against a deliberately narrow baseline:
 * cash plus the value of the position in the asset being traded, both priced
 * at `intent.referencePriceMicros`. This slice receives no price for any
 * other asset the wallet might hold, so it cannot value total portfolio
 * equity; widening the baseline is future work for when market data reaches
 * this boundary, not a gap introduced here silently.
 *
 * ## Rounding
 *
 * Every basis-point figure computed here rounds against the trader — up
 * when rounding down could hide a limit breach — exactly the conservative
 * policy `src/money/fixed-point.ts` documents, so a limit is never crossed
 * by a rounding artefact.
 */

import type { OrderIntent } from "../domain/contracts.js";
import { positionOf, type Wallet } from "../portfolio/portfolio.js";
import {
  BPS_DENOMINATOR,
  MICROS_PER_UNIT,
  fractionToMicros,
  mulDivCeil,
  mulDivFloor,
  scaleFactor
} from "../money/fixed-point.js";
import type { RiskPolicy } from "./policy.js";
import {
  INVALID_RISK_INPUT_CODE,
  RISK_RULE_CODES,
  createRiskDecision,
  type RiskDecision,
  type RiskRuleCode
} from "./decision.js";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Everything one risk evaluation depends on. */
export interface RiskRequest {
  /** Already-validated order intent. Never mutated. */
  readonly intent: OrderIntent;
  /** Immutable snapshot of the *same agent's* wallet. Never mutated. */
  readonly wallet: Wallet;
  /** Already-validated risk policy. */
  readonly policy: RiskPolicy;
  /** Canonical UTC instant supplied by the caller; this module never reads the clock. */
  readonly evaluatedAt: string;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

/** Value of any currently-held position in `intent.asset`, priced at `intent.referencePriceMicros`. */
function heldValueMicros(wallet: Wallet, intent: OrderIntent): bigint {
  const held = positionOf(wallet, intent.asset);
  return held === undefined
    ? 0n
    : mulDivFloor(held.quantityAtoms, intent.referencePriceMicros, scaleFactor(intent.assetScale));
}

/**
 * Whether this request is even admissible to evaluate: the wallet must
 * belong to the same agent as the intent, a held position's scale must agree
 * with the intent's, the caller-supplied instant must be canonical, and — for
 * a BUY — the cash-plus-current-position exposure baseline must be nonzero,
 * since `projectedValue / equity` is undefined when that baseline is zero.
 * Anything else fails closed with `INVALID_RISK_INPUT` before any rule runs,
 * because no rule below can be trusted once these basics disagree.
 */
function hasEvaluableInput(request: RiskRequest): boolean {
  const { intent, wallet, evaluatedAt } = request;
  if (intent.agentId !== wallet.agentId) return false;
  if (!isCanonicalTimestamp(evaluatedAt)) return false;
  const held = positionOf(wallet, intent.asset);
  if (held !== undefined && held.assetScale !== intent.assetScale) return false;
  if (intent.side === "BUY" && wallet.cashMicros + heldValueMicros(wallet, intent) === 0n) return false;
  return true;
}

/** The order's own size, in basis points of the fraction it requests. */
function orderSizeBps(intent: OrderIntent): bigint {
  const fractionMicros = fractionToMicros(intent.positionPct, "OrderIntent", "positionPct");
  return mulDivCeil(fractionMicros, BPS_DENOMINATOR, MICROS_PER_UNIT);
}

/**
 * Projected exposure to `intent.asset` after a BUY, in basis points of the
 * cash-plus-current-position baseline described in the module docstring.
 * Only ever called for a BUY that already passed {@link hasEvaluableInput},
 * which guarantees that baseline is nonzero.
 */
function projectedAssetExposureBps(wallet: Wallet, intent: OrderIntent): bigint {
  const heldMicros = heldValueMicros(wallet, intent);
  const fractionMicros = fractionToMicros(intent.positionPct, "OrderIntent", "positionPct");
  const addedMicros = mulDivFloor(wallet.cashMicros, fractionMicros, MICROS_PER_UNIT);
  const projectedValueMicros = heldMicros + addedMicros;
  const equityMicros = wallet.cashMicros + heldMicros;
  return mulDivCeil(projectedValueMicros, BPS_DENOMINATOR, equityMicros);
}

/** A BUY creates a new position only when nothing is currently held. */
function isNewPosition(wallet: Wallet, intent: OrderIntent): boolean {
  const held = positionOf(wallet, intent.asset);
  return held === undefined || held.quantityAtoms === 0n;
}

function evaluateRules(request: RiskRequest): Record<RiskRuleCode, boolean> {
  const { intent, wallet, policy } = request;
  const isBuy = intent.side === "BUY";
  return {
    CIRCUIT_BREAKER_ACTIVE: policy.circuitBreaker,
    ASSET_NOT_ALLOWED: !policy.allowedAssets.includes(intent.asset),
    ORDER_SIZE_LIMIT_EXCEEDED: orderSizeBps(intent) > BigInt(policy.maxOrderPositionBps),
    ASSET_EXPOSURE_LIMIT_EXCEEDED:
      isBuy && projectedAssetExposureBps(wallet, intent) > BigInt(policy.maxAssetExposureBps),
    MAX_OPEN_POSITIONS_REACHED:
      isBuy && isNewPosition(wallet, intent) && wallet.positions.length >= policy.maxOpenPositions
  };
}

/**
 * Evaluates one order intent against one agent's wallet and risk policy.
 *
 * Pure and side-effect free: does not execute the broker, does not alter the
 * wallet, the ledger or any other agent's state, and reads no clock — the
 * instant is `request.evaluatedAt`, supplied by the caller.
 */
export function evaluateRisk(request: RiskRequest): RiskDecision {
  const { intent, policy, evaluatedAt } = request;
  const base = {
    schemaVersion: 1 as const,
    orderId: intent.orderId,
    cycleId: intent.cycleId,
    agentId: intent.agentId,
    asset: intent.asset,
    side: intent.side,
    policyVersion: policy.policyVersion,
    evaluatedAt
  };

  if (!hasEvaluableInput(request)) {
    return createRiskDecision({ ...base, approved: false, codes: [INVALID_RISK_INPUT_CODE] });
  }

  const triggered = evaluateRules(request);
  const codes = RISK_RULE_CODES.filter((code) => triggered[code]);
  return createRiskDecision({ ...base, approved: codes.length === 0, codes });
}
