/**
 * Small, hand-checkable fixtures shared by the M1 tests.
 *
 * Everything is sized so the expected numbers can be verified with a pencil:
 * the asset has 2 decimal places, one whole unit costs exactly US$10, and a
 * wallet starts with US$100.
 */

import { parseExecutionPolicy, parseOrderIntent } from "../../src/domain/contracts.js";
import type { ExecutionPolicy, OrderIntent } from "../../src/domain/contracts.js";

/** Decimal places of the fixture asset. */
export const SCALE = 2;
/** One whole unit costs US$10 = 10_000_000 micros. */
export const PRICE_MICROS = "10000000";
/** A wallet starts with US$100 = 100_000_000 micros. */
export const START_CASH_MICROS = 100_000_000n;

export const AT = "2026-09-17T18:00:00.000Z";
export const LATER = "2026-09-17T18:15:00.000Z";

/** No fee, no spread, no slippage: the frictionless baseline. */
export const FREE_POLICY: ExecutionPolicy = parseExecutionPolicy({
  schemaVersion: 1,
  policyVersion: "free",
  feeBps: 0,
  spreadBps: 0,
  slippageBps: 0
});

/**
 * 1% fee, 2% spread (so 1% per side), no slippage.
 *
 * BUY price  = 10.00 * (1 + 0.01) = US$10.10
 * SELL price = 10.00 * (1 - 0.01) = US$9.90
 */
export const COSTED_POLICY: ExecutionPolicy = parseExecutionPolicy({
  schemaVersion: 1,
  policyVersion: "costed",
  feeBps: 100,
  spreadBps: 200,
  slippageBps: 0
});

export interface IntentOverrides {
  readonly orderId?: string;
  readonly cycleId?: string;
  readonly agentId?: string;
  readonly side?: string;
  readonly asset?: string;
  readonly quote?: string;
  readonly positionPct?: number;
  readonly referencePriceMicros?: string;
  readonly assetScale?: number;
  readonly createdAt?: string;
}

/** Builds a validated order intent over the fixture market. */
export function intent(overrides: IntentOverrides = {}): OrderIntent {
  return parseOrderIntent({
    schemaVersion: 1,
    orderId: "order-1",
    cycleId: "cycle-1",
    agentId: "trend-following",
    side: "BUY",
    asset: "ACME",
    quote: "USD",
    positionPct: 1,
    referencePriceMicros: PRICE_MICROS,
    assetScale: SCALE,
    createdAt: AT,
    ...overrides
  });
}
