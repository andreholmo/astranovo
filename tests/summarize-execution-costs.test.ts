import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import {
  REJECTION_CODES,
  createFillEvent,
  createRejectionEvent,
  type FillEvent,
  type LedgerEvent,
  type RejectionCode,
  type RejectionEvent
} from "../src/ledger/events.js";
import { summarizeExecutionCosts } from "../src/metrics/summarize-execution-costs.js";
import { MAX_ATOMS, MAX_MICROS } from "../src/money/fixed-point.js";
import { AT } from "./support/fixtures.js";

const AGENT = "trend-following";
const OTHER_AGENT = "momentum";

type FillDraft = Omit<FillEvent, "eventId">;
type RejectionDraft = Omit<RejectionEvent, "eventId">;

/** A hand-checkable BUY/SELL fill: no fee, no spread by default. */
function fill(overrides: Partial<FillDraft> = {}): FillEvent {
  const draft: FillDraft = {
    schemaVersion: 1,
    type: "FILL",
    orderId: "order-1",
    cycleId: "cycle-1",
    agentId: AGENT,
    side: "BUY",
    asset: "ACME",
    quote: "USD",
    assetScale: 2,
    quantityAtoms: 1000n,
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

function rejection(overrides: Partial<RejectionDraft> = {}): RejectionEvent {
  const draft: RejectionDraft = {
    schemaVersion: 1,
    type: "REJECTION",
    orderId: "order-2",
    cycleId: "cycle-1",
    agentId: AGENT,
    side: "SELL",
    asset: "ACME",
    quote: "USD",
    code: "NO_POSITION",
    occurredAt: AT,
    policyVersion: "free",
    ...overrides
  };
  return createRejectionEvent(draft);
}

function zeroRejectionCounts(): Record<RejectionCode, number> {
  return Object.fromEntries(REJECTION_CODES.map((code) => [code, 0])) as Record<RejectionCode, number>;
}

describe("empty list", () => {
  it("accepts an empty ledger and zeroes every count and total", () => {
    const summary = summarizeExecutionCosts(AGENT, []);

    assert.equal(summary.agentId, AGENT);
    assert.equal(summary.eventCount, 0);
    assert.equal(summary.fillCount, 0);
    assert.equal(summary.rejectionCount, 0);
    assert.equal(summary.buyFillCount, 0);
    assert.equal(summary.sellFillCount, 0);
    assert.equal(summary.totalGrossMicros, 0n);
    assert.equal(summary.totalFeeMicros, 0n);
    assert.equal(summary.totalExecutionImpactMicros, 0n);
    assert.deepEqual(summary.rejectionCounts, zeroRejectionCounts());
  });
});

describe("a single BUY fill", () => {
  it("counts it and totals its gross with zero impact", () => {
    const events: LedgerEvent[] = [
      fill({ side: "BUY", grossMicros: 100_000_000n, feeMicros: 1_000_000n })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    assert.equal(summary.fillCount, 1);
    assert.equal(summary.buyFillCount, 1);
    assert.equal(summary.sellFillCount, 0);
    assert.equal(summary.rejectionCount, 0);
    assert.equal(summary.totalGrossMicros, 100_000_000n);
    assert.equal(summary.totalFeeMicros, 1_000_000n);
    assert.equal(summary.totalExecutionImpactMicros, 0n);
  });
});

describe("a single SELL fill", () => {
  it("counts it and totals its gross with zero impact", () => {
    const events: LedgerEvent[] = [
      fill({ side: "SELL", grossMicros: 99_000_000n, feeMicros: 990_000n })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    assert.equal(summary.fillCount, 1);
    assert.equal(summary.buyFillCount, 0);
    assert.equal(summary.sellFillCount, 1);
    assert.equal(summary.totalGrossMicros, 99_000_000n);
    assert.equal(summary.totalFeeMicros, 990_000n);
    assert.equal(summary.totalExecutionImpactMicros, 0n);
  });
});

describe("multiple fills", () => {
  it("sums gross and fees across BUY and SELL fills", () => {
    const events: LedgerEvent[] = [
      fill({ orderId: "o-1", side: "BUY", grossMicros: 100_000_000n, feeMicros: 1_000_000n }),
      fill({ orderId: "o-2", side: "SELL", grossMicros: 50_000_000n, feeMicros: 500_000n })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    assert.equal(summary.fillCount, 2);
    assert.equal(summary.buyFillCount, 1);
    assert.equal(summary.sellFillCount, 1);
    assert.equal(summary.totalGrossMicros, 150_000_000n);
    assert.equal(summary.totalFeeMicros, 1_500_000n);
  });
});

describe("BUY execution impact", () => {
  it("computes the exact spread/slippage cost baked into the price", () => {
    const events: LedgerEvent[] = [
      fill({
        side: "BUY",
        assetScale: 2,
        quantityAtoms: 1000n,
        referencePriceMicros: 10_000_000n,
        effectivePriceMicros: 10_100_000n
      })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    assert.equal(summary.totalExecutionImpactMicros, 1_000_000n);
  });
});

describe("SELL execution impact", () => {
  it("computes the exact spread/slippage cost baked into the price", () => {
    const events: LedgerEvent[] = [
      fill({
        side: "SELL",
        assetScale: 2,
        quantityAtoms: 1000n,
        referencePriceMicros: 10_000_000n,
        effectivePriceMicros: 9_900_000n
      })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    assert.equal(summary.totalExecutionImpactMicros, 1_000_000n);
  });
});

describe("conservative floor rounding of the impact", () => {
  it("floors instead of rounding a genuine remainder", () => {
    const events: LedgerEvent[] = [
      fill({
        side: "BUY",
        assetScale: 2,
        quantityAtoms: 1n,
        referencePriceMicros: 10_000_000n,
        effectivePriceMicros: 13_333_333n
      })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    // floor(1 * 3_333_333 / 100) = 33_333, not 33_334.
    assert.equal(summary.totalExecutionImpactMicros, 33_333n);
  });
});

describe("rejections", () => {
  it("are counted but never change monetary totals", () => {
    const events: LedgerEvent[] = [
      fill({ orderId: "o-1", side: "BUY", grossMicros: 100_000_000n, feeMicros: 1_000_000n }),
      rejection({ orderId: "o-2", code: "INSUFFICIENT_CASH" })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    assert.equal(summary.fillCount, 1);
    assert.equal(summary.rejectionCount, 1);
    assert.equal(summary.totalGrossMicros, 100_000_000n);
    assert.equal(summary.totalFeeMicros, 1_000_000n);
    assert.equal(summary.totalExecutionImpactMicros, 0n);
  });

  it("counts each rejection code used in the fixture, in REJECTION_CODES order", () => {
    const events: LedgerEvent[] = [
      rejection({ orderId: "o-1", code: "INSUFFICIENT_CASH" }),
      rejection({ orderId: "o-2", code: "INSUFFICIENT_CASH" }),
      rejection({ orderId: "o-3", code: "NO_POSITION" })
    ];

    const summary = summarizeExecutionCosts(AGENT, events);

    const expected = zeroRejectionCounts();
    expected.INSUFFICIENT_CASH = 2;
    expected.NO_POSITION = 1;

    assert.deepEqual(summary.rejectionCounts, expected);
    assert.deepEqual(Object.keys(summary.rejectionCounts), [...REJECTION_CODES]);
    assert.equal(summary.rejectionCount, 3);
  });
});

describe("input order", () => {
  it("produces an identical result whatever order the events arrive in", () => {
    const events: LedgerEvent[] = [
      fill({ orderId: "o-1", side: "BUY", grossMicros: 100_000_000n }),
      fill({ orderId: "o-2", side: "SELL", grossMicros: 50_000_000n }),
      rejection({ orderId: "o-3", code: "NO_POSITION" })
    ];

    const forward = summarizeExecutionCosts(AGENT, events);
    const reversed = summarizeExecutionCosts(AGENT, [...events].reverse());

    assert.deepEqual(forward, reversed);
  });
});

describe("fail-closed input rules", () => {
  it("rejects an event that belongs to a different agent", () => {
    const events: LedgerEvent[] = [fill({ agentId: OTHER_AGENT })];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("rejects a repeated eventId", () => {
    const events: LedgerEvent[] = [fill(), fill()];
    assert.equal(events[0]?.eventId, events[1]?.eventId);

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("rejects a BUY fill priced below its reference price", () => {
    const events: LedgerEvent[] = [
      fill({ side: "BUY", referencePriceMicros: 10_000_000n, effectivePriceMicros: 9_999_999n })
    ];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("rejects a SELL fill priced above its reference price", () => {
    const events: LedgerEvent[] = [
      fill({ side: "SELL", referencePriceMicros: 10_000_000n, effectivePriceMicros: 10_000_001n })
    ];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("rejects a negative fill value", () => {
    // `createFillEvent` itself refuses a negative bigint while formatting the
    // eventId, so a real event can never carry one; this simulates a
    // hand-crafted event reaching the summary some other way.
    const events: LedgerEvent[] = [Object.freeze({ ...fill(), quantityAtoms: -1n })];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("rejects an invalid asset scale", () => {
    const events: LedgerEvent[] = [fill({ assetScale: 19 })];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("fails closed on overflow of the execution impact total", () => {
    const events: LedgerEvent[] = [
      fill({
        side: "BUY",
        assetScale: 0,
        quantityAtoms: MAX_ATOMS,
        referencePriceMicros: 0n,
        effectivePriceMicros: MAX_MICROS,
        grossMicros: 0n,
        feeMicros: 0n
      })
    ];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });

  it("fails closed on overflow of the gross total", () => {
    const events: LedgerEvent[] = [
      fill({ orderId: "o-1", grossMicros: MAX_MICROS, effectivePriceMicros: 10_000_000n }),
      fill({ orderId: "o-2", grossMicros: MAX_MICROS, effectivePriceMicros: 10_000_000n })
    ];

    assert.throws(() => summarizeExecutionCosts(AGENT, events), ContractValidationError);
  });
});

describe("immutability", () => {
  it("freezes the returned summary and its rejection counts", () => {
    const summary = summarizeExecutionCosts(AGENT, [fill()]);

    assert.ok(Object.isFrozen(summary));
    assert.ok(Object.isFrozen(summary.rejectionCounts));
  });

  it("does not mutate the events passed in", () => {
    const events: LedgerEvent[] = [fill({ orderId: "o-1" }), rejection({ orderId: "o-2" })];
    const before = events.map((event) => ({ ...event }));

    summarizeExecutionCosts(AGENT, events);

    const after = events.map((event) => ({ ...event }));
    assert.deepEqual(after, before);
  });
});

describe("determinism", () => {
  it("produces an identical summary for the same canonical input", () => {
    const events: LedgerEvent[] = [
      fill({ orderId: "o-1", side: "BUY", grossMicros: 100_000_000n }),
      rejection({ orderId: "o-2", code: "QUANTITY_TOO_SMALL" })
    ];

    const first = summarizeExecutionCosts(AGENT, events);
    const second = summarizeExecutionCosts(AGENT, events);

    assert.deepEqual(first, second);
  });
});
