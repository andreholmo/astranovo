import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { createFillEvent, type FillEvent } from "../src/ledger/events.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";
import {
  summarizeClosedRoundTrip,
  type ClosedRoundTripResult
} from "../src/metrics/summarize-closed-round-trip.js";
import { summarizeRealizedPerformance } from "../src/metrics/summarize-realized-performance.js";
import { AT, LATER } from "./support/fixtures.js";

const AGENT = "trend-following";
const OTHER_AGENT = "momentum";
const ASSET = "ACME";
const QUOTE = "USD";
const SCALE = 2;
const QUANTITY_ATOMS = 1000n;

type FillDraft = Omit<FillEvent, "eventId">;

/** A hand-checkable opening BUY: no fee, no spread by default. */
function buyFill(id: number, overrides: Partial<FillDraft> = {}): FillEvent {
  const draft: FillDraft = {
    schemaVersion: 1,
    type: "FILL",
    orderId: `order-buy-${id}`,
    cycleId: `cycle-${id}`,
    agentId: AGENT,
    side: "BUY",
    asset: ASSET,
    quote: QUOTE,
    assetScale: SCALE,
    quantityAtoms: QUANTITY_ATOMS,
    referencePriceMicros: 10_000_000n,
    effectivePriceMicros: 10_000_000n,
    grossMicros: 100_000_000n,
    feeMicros: 0n,
    totalMicros: 100_000_000n,
    feeBps: 0,
    spreadBps: 0,
    slippageBps: 0,
    occurredAt: AT,
    policyVersion: "free",
    ...overrides
  };
  return createFillEvent(draft);
}

/** A hand-checkable closing SELL of the same quantity/asset/agent as {@link buyFill}. */
function sellFill(id: number, overrides: Partial<FillDraft> = {}): FillEvent {
  const draft: FillDraft = {
    schemaVersion: 1,
    type: "FILL",
    orderId: `order-sell-${id}`,
    cycleId: `cycle-${id}`,
    agentId: AGENT,
    side: "SELL",
    asset: ASSET,
    quote: QUOTE,
    assetScale: SCALE,
    quantityAtoms: QUANTITY_ATOMS,
    referencePriceMicros: 10_000_000n,
    effectivePriceMicros: 10_000_000n,
    grossMicros: 100_000_000n,
    feeMicros: 0n,
    totalMicros: 100_000_000n,
    feeBps: 0,
    spreadBps: 0,
    slippageBps: 0,
    occurredAt: LATER,
    policyVersion: "free",
    ...overrides
  };
  return createFillEvent(draft);
}

/** A genuine, real `ClosedRoundTripResult` — round trip `id` closed with `netProceedsMicros`. */
function roundTrip(id: number, netProceedsMicros: bigint): ClosedRoundTripResult {
  return summarizeClosedRoundTrip(
    buyFill(id, { totalMicros: 100_000_000n }),
    sellFill(id, { grossMicros: netProceedsMicros, totalMicros: netProceedsMicros })
  );
}

const WIN = (id: number) => roundTrip(id, 110_000_000n); // +10_000_000
const LOSS = (id: number) => roundTrip(id, 90_000_000n); // -10_000_000
const TIE = (id: number) => roundTrip(id, 100_000_000n); // 0

describe("empty list", () => {
  it("returns every count and total at zero, and a zero-over-zero win rate", () => {
    const summary = summarizeRealizedPerformance(AGENT, []);

    assert.equal(summary.agentId, AGENT);
    assert.equal(summary.closedTradeCount, 0);
    assert.equal(summary.winCount, 0);
    assert.equal(summary.lossCount, 0);
    assert.equal(summary.breakEvenCount, 0);
    assert.equal(summary.totalGainMicros, 0n);
    assert.equal(summary.totalLossMicros, 0n);
    assert.equal(summary.netResultDirection, "BREAK_EVEN");
    assert.equal(summary.netResultMagnitudeMicros, 0n);
    assert.equal(summary.winRateNumerator, 0);
    assert.equal(summary.winRateDenominator, 0);
  });
});

describe("homogeneous lists", () => {
  it("aggregates a list of only wins", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1), WIN(2), WIN(3)]);

    assert.equal(summary.closedTradeCount, 3);
    assert.equal(summary.winCount, 3);
    assert.equal(summary.lossCount, 0);
    assert.equal(summary.breakEvenCount, 0);
    assert.equal(summary.totalGainMicros, 30_000_000n);
    assert.equal(summary.totalLossMicros, 0n);
    assert.equal(summary.winRateNumerator, 3);
    assert.equal(summary.winRateDenominator, 3);
  });

  it("aggregates a list of only losses", () => {
    const summary = summarizeRealizedPerformance(AGENT, [LOSS(1), LOSS(2)]);

    assert.equal(summary.closedTradeCount, 2);
    assert.equal(summary.winCount, 0);
    assert.equal(summary.lossCount, 2);
    assert.equal(summary.breakEvenCount, 0);
    assert.equal(summary.totalGainMicros, 0n);
    assert.equal(summary.totalLossMicros, 20_000_000n);
    assert.equal(summary.winRateNumerator, 0);
    assert.equal(summary.winRateDenominator, 2);
  });

  it("aggregates a list of only ties", () => {
    const summary = summarizeRealizedPerformance(AGENT, [TIE(1), TIE(2), TIE(3), TIE(4)]);

    assert.equal(summary.closedTradeCount, 4);
    assert.equal(summary.winCount, 0);
    assert.equal(summary.lossCount, 0);
    assert.equal(summary.breakEvenCount, 4);
    assert.equal(summary.totalGainMicros, 0n);
    assert.equal(summary.totalLossMicros, 0n);
    assert.equal(summary.winRateNumerator, 0);
    assert.equal(summary.winRateDenominator, 4);
  });
});

describe("mixed win, loss and tie", () => {
  it("counts and sums each direction independently", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1), LOSS(2), TIE(3), WIN(4)]);

    assert.equal(summary.closedTradeCount, 4);
    assert.equal(summary.winCount, 2);
    assert.equal(summary.lossCount, 1);
    assert.equal(summary.breakEvenCount, 1);
    assert.equal(summary.totalGainMicros, 20_000_000n);
    assert.equal(summary.totalLossMicros, 10_000_000n);
    assert.equal(summary.winRateNumerator, 2);
    assert.equal(summary.winRateDenominator, 4);
  });
});

describe("net result direction", () => {
  it("reports WIN when total gains exceed total losses", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1), WIN(2), LOSS(3)]);

    assert.equal(summary.netResultDirection, "WIN");
    assert.equal(summary.netResultMagnitudeMicros, 10_000_000n);
  });

  it("reports LOSS when total losses exceed total gains", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1), LOSS(2), LOSS(3)]);

    assert.equal(summary.netResultDirection, "LOSS");
    assert.equal(summary.netResultMagnitudeMicros, 10_000_000n);
  });

  it("reports BREAK_EVEN when total gains exactly equal total losses", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1), LOSS(2)]);

    assert.equal(summary.netResultDirection, "BREAK_EVEN");
    assert.equal(summary.netResultMagnitudeMicros, 0n);
  });
});

describe("exact 1 micro difference", () => {
  it("aggregates a gain of exactly 1 micro", () => {
    const summary = summarizeRealizedPerformance(AGENT, [roundTrip(1, 100_000_001n)]);

    assert.equal(summary.winCount, 1);
    assert.equal(summary.totalGainMicros, 1n);
    assert.equal(summary.netResultDirection, "WIN");
    assert.equal(summary.netResultMagnitudeMicros, 1n);
  });

  it("aggregates a loss of exactly 1 micro", () => {
    const summary = summarizeRealizedPerformance(AGENT, [roundTrip(1, 99_999_999n)]);

    assert.equal(summary.lossCount, 1);
    assert.equal(summary.totalLossMicros, 1n);
    assert.equal(summary.netResultDirection, "LOSS");
    assert.equal(summary.netResultMagnitudeMicros, 1n);
  });
});

describe("exact win rate fraction", () => {
  it("represents win rate as winCount over closedTradeCount, including ties in the denominator", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1), WIN(2), LOSS(3), TIE(4), TIE(5)]);

    assert.equal(summary.winRateNumerator, 2);
    assert.equal(summary.winRateDenominator, 5);
    // 2/5, never reduced, never rendered as a float.
  });

  it("never reduces the fraction: a single win among one trade is 1/1, not simplified further", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1)]);

    assert.equal(summary.winRateNumerator, 1);
    assert.equal(summary.winRateDenominator, 1);
  });
});

describe("rejection by divergent agent", () => {
  it("rejects a result belonging to a different agent", () => {
    const foreign = Object.freeze({ ...WIN(1), agentId: OTHER_AGENT });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [foreign]), ContractValidationError);
  });

  it("rejects when only one of several results diverges", () => {
    const foreign = Object.freeze({ ...WIN(2), agentId: OTHER_AGENT });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [WIN(1), foreign]), ContractValidationError);
  });
});

describe("rejection by reused eventId", () => {
  it("rejects a buyEventId reused across two different results", () => {
    const first = WIN(1);
    const second = Object.freeze({ ...WIN(2), buyEventId: first.buyEventId });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [first, second]), ContractValidationError);
  });

  it("rejects a sellEventId reused across two different results", () => {
    const first = WIN(1);
    const second = Object.freeze({ ...WIN(2), sellEventId: first.sellEventId });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [first, second]), ContractValidationError);
  });

  it("rejects an id reused across distinct legs (one result's buyEventId as another's sellEventId)", () => {
    const first = WIN(1);
    const second = Object.freeze({ ...WIN(2), sellEventId: first.buyEventId });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [first, second]), ContractValidationError);
  });
});

describe("rejection by inconsistent direction or magnitude", () => {
  it("rejects a result whose direction disagrees with its own costs and proceeds", () => {
    const forged = Object.freeze({ ...WIN(1), direction: "LOSS" as const });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [forged]), ContractValidationError);
  });

  it("rejects a result whose resultMagnitudeMicros disagrees with its own costs and proceeds", () => {
    const forged = Object.freeze({ ...WIN(1), resultMagnitudeMicros: 1n });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [forged]), ContractValidationError);
  });

  it("rejects invalid money on a result", () => {
    const forged = Object.freeze({ ...WIN(1), realizedCostMicros: -1n });

    assert.throws(() => summarizeRealizedPerformance(AGENT, [forged]), ContractValidationError);
  });
});

describe("overflow protection", () => {
  it("rejects when total gains would exceed MAX_MICROS", () => {
    const hugeWin = Object.freeze({
      ...WIN(1),
      realizedCostMicros: 0n,
      netProceedsMicros: MAX_MICROS,
      resultMagnitudeMicros: MAX_MICROS
    });
    const anotherWin = Object.freeze({
      ...WIN(2),
      realizedCostMicros: 0n,
      netProceedsMicros: 1n,
      resultMagnitudeMicros: 1n
    });

    assert.throws(
      () => summarizeRealizedPerformance(AGENT, [hugeWin, anotherWin]),
      ContractValidationError
    );
  });

  it("rejects when total losses would exceed MAX_MICROS", () => {
    const hugeLoss = Object.freeze({
      ...LOSS(1),
      realizedCostMicros: MAX_MICROS,
      netProceedsMicros: 0n,
      resultMagnitudeMicros: MAX_MICROS
    });
    const anotherLoss = Object.freeze({
      ...LOSS(2),
      realizedCostMicros: 1n,
      netProceedsMicros: 0n,
      resultMagnitudeMicros: 1n
    });

    assert.throws(
      () => summarizeRealizedPerformance(AGENT, [hugeLoss, anotherLoss]),
      ContractValidationError
    );
  });
});

describe("order invariance, immutability, non-mutation and determinism", () => {
  it("produces the same summary regardless of input order", () => {
    const a = WIN(1);
    const b = LOSS(2);
    const c = TIE(3);

    const forward = summarizeRealizedPerformance(AGENT, [a, b, c]);
    const reversed = summarizeRealizedPerformance(AGENT, [c, b, a]);

    assert.deepEqual(forward, reversed);
  });

  it("freezes the returned summary", () => {
    const summary = summarizeRealizedPerformance(AGENT, [WIN(1)]);

    assert.ok(Object.isFrozen(summary));
  });

  it("does not mutate any result passed in", () => {
    const results = [WIN(1), LOSS(2), TIE(3)];
    const before = results.map((result) => ({ ...result }));

    summarizeRealizedPerformance(AGENT, results);

    results.forEach((result, index) => assert.deepEqual({ ...result }, before[index]));
  });

  it("produces an identical result for the same canonical input", () => {
    const results = [WIN(1), LOSS(2)];

    const first = summarizeRealizedPerformance(AGENT, results);
    const second = summarizeRealizedPerformance(AGENT, results);

    assert.deepEqual(first, second);
  });
});
