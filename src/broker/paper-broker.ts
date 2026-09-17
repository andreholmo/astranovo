/**
 * Deterministic simulated execution.
 *
 * The same intent, wallet, policy and instant always produce the same event —
 * no clock, no randomness, no I/O. Fills are all-or-nothing in this milestone:
 * either the whole computed quantity executes, or the order is rejected with a
 * stable code.
 *
 * Safety properties this module is responsible for, each covered by a test:
 *
 * - a BUY never leaves cash negative, whatever `positionPct` is asked for —
 *   the quantity is reduced until the total cost fits the available cash;
 * - a SELL never sells more than the position held, and never produces
 *   negative cash;
 * - an order that would execute for nothing is rejected, not silently filled;
 * - a `HOLD` never arrives here at all: `orderIntentFromProposal` returns
 *   `null` for it, so no order and no event exist.
 *
 * Every formula used here lives in `./pricing.ts`; every conversion lives in
 * `src/money/fixed-point.ts`.
 */

import type { ExecutionPolicy, OrderIntent } from "../domain/contracts.js";
import type { Broker, ExecutionOutcome, ExecutionRequest } from "./broker.js";
import type { RejectionCode } from "../ledger/events.js";
import type { Wallet } from "../portfolio/portfolio.js";
import { createFillEvent, createRejectionEvent, policyFields } from "../ledger/events.js";
import { positionOf } from "../portfolio/portfolio.js";
import {
  MICROS_PER_UNIT,
  fractionToMicros,
  mulDivFloor,
  scaleFactor,
  type Atoms,
  type Micros
} from "../money/fixed-point.js";
import {
  buyPriceMicros,
  feeMicros,
  grossMicrosPaid,
  grossMicrosReceived,
  maxAffordableAtoms,
  sellPriceMicros
} from "./pricing.js";

function rejection(request: ExecutionRequest, code: RejectionCode): ExecutionOutcome {
  const { intent, policy, occurredAt } = request;
  return Object.freeze({
    status: "REJECTED" as const,
    event: createRejectionEvent({
      schemaVersion: 1,
      type: "REJECTION",
      orderId: intent.orderId,
      cycleId: intent.cycleId,
      agentId: intent.agentId,
      side: intent.side,
      asset: intent.asset,
      quote: intent.quote,
      code,
      occurredAt,
      policyVersion: policy.policyVersion
    })
  });
}

function fill(
  request: ExecutionRequest,
  values: {
    readonly quantityAtoms: Atoms;
    readonly effectivePriceMicros: Micros;
    readonly grossMicros: Micros;
    readonly feeMicros: Micros;
    readonly totalMicros: Micros;
  }
): ExecutionOutcome {
  const { intent, policy, occurredAt } = request;
  return Object.freeze({
    status: "FILLED" as const,
    event: createFillEvent({
      schemaVersion: 1,
      type: "FILL",
      orderId: intent.orderId,
      cycleId: intent.cycleId,
      agentId: intent.agentId,
      side: intent.side,
      asset: intent.asset,
      quote: intent.quote,
      assetScale: intent.assetScale,
      quantityAtoms: values.quantityAtoms,
      referencePriceMicros: intent.referencePriceMicros,
      effectivePriceMicros: values.effectivePriceMicros,
      grossMicros: values.grossMicros,
      feeMicros: values.feeMicros,
      totalMicros: values.totalMicros,
      occurredAt,
      ...policyFields(policy)
    })
  });
}

/** Cash this order is allowed to spend: `positionPct` of what the wallet holds. */
function budgetMicros(wallet: Wallet, intent: OrderIntent): Micros {
  const fraction = fractionToMicros(intent.positionPct, "OrderIntent", "positionPct");
  return mulDivFloor(wallet.cashMicros, fraction, MICROS_PER_UNIT);
}

function executeBuy(request: ExecutionRequest): ExecutionOutcome {
  const { intent, wallet, policy } = request;
  const budget = budgetMicros(wallet, intent);
  if (budget <= 0n) return rejection(request, "INSUFFICIENT_CASH");

  const factor = scaleFactor(intent.assetScale);
  const price = buyPriceMicros(intent.referencePriceMicros, policy);
  const quantityAtoms = maxAffordableAtoms(budget, price, factor, policy.feeBps);
  if (quantityAtoms === 0n) return rejection(request, "QUANTITY_TOO_SMALL");

  const gross = grossMicrosPaid(quantityAtoms, price, factor);
  const fee = feeMicros(gross, policy.feeBps);
  const total = gross + fee;
  // Guaranteed by maxAffordableAtoms; asserted so a future change cannot
  // quietly overdraw a wallet.
  if (total > budget || total > wallet.cashMicros) {
    return rejection(request, "INSUFFICIENT_CASH");
  }

  return fill(request, {
    quantityAtoms,
    effectivePriceMicros: price,
    grossMicros: gross,
    feeMicros: fee,
    totalMicros: total
  });
}

function executeSell(request: ExecutionRequest): ExecutionOutcome {
  const { intent, wallet, policy } = request;
  const held = positionOf(wallet, intent.asset);
  if (held === undefined || held.quantityAtoms <= 0n) return rejection(request, "NO_POSITION");
  if (held.assetScale !== intent.assetScale) return rejection(request, "ASSET_SCALE_MISMATCH");

  const fraction = fractionToMicros(intent.positionPct, "OrderIntent", "positionPct");
  const quantityAtoms = mulDivFloor(held.quantityAtoms, fraction, MICROS_PER_UNIT);
  if (quantityAtoms === 0n) return rejection(request, "QUANTITY_TOO_SMALL");
  // `positionPct` is at most 1, so this cannot exceed the position; asserted
  // rather than assumed.
  if (quantityAtoms > held.quantityAtoms) return rejection(request, "QUANTITY_TOO_SMALL");

  const price = sellPriceMicros(intent.referencePriceMicros, policy);
  if (price === null) return rejection(request, "COSTS_EXCEED_PRICE");

  const factor = scaleFactor(intent.assetScale);
  const gross = grossMicrosReceived(quantityAtoms, price, factor);
  if (gross === 0n) return rejection(request, "QUANTITY_TOO_SMALL");

  // Proceeds of exactly zero are refused too: giving up a position for
  // nothing is never an execution we want to simulate as successful.
  const fee = feeMicros(gross, policy.feeBps);
  if (fee >= gross) return rejection(request, "COSTS_EXCEED_PROCEEDS");

  return fill(request, {
    quantityAtoms,
    effectivePriceMicros: price,
    grossMicros: gross,
    feeMicros: fee,
    totalMicros: gross - fee
  });
}

/**
 * The paper broker. Simulates execution against a wallet without touching it.
 *
 * It holds no state, so one instance can serve every agent: isolation comes
 * from the wallet passed in, never from the broker.
 */
export class PaperBroker implements Broker {
  public readonly kind = "paper";

  public execute(request: ExecutionRequest): ExecutionOutcome {
    if (request.intent.agentId !== request.wallet.agentId) {
      throw new Error("PaperBroker: order and wallet belong to different agents");
    }
    return request.intent.side === "BUY" ? executeBuy(request) : executeSell(request);
  }
}

/** A conservative default policy: 10 bps fee, 4 bps spread, 5 bps slippage. */
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = Object.freeze({
  schemaVersion: 1 as const,
  policyVersion: "paper-v1",
  feeBps: 10,
  spreadBps: 4,
  slippageBps: 5
});
