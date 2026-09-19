import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildBuyAndHoldBenchmark } from "../src/benchmark/build-buy-and-hold-benchmark.js";
import { compareStrategyToBuyAndHold } from "../src/benchmark/compare-strategy-to-buy-and-hold.js";
import type { EquitySeriesSummary } from "../src/metrics/summarize-equity-series.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";
import { AT, COSTED_POLICY, FREE_POLICY, LATER, SCALE, START_CASH_MICROS } from "./support/fixtures.js";

/** One instant strictly between `AT` and `LATER`. */
const MID = "2026-09-17T18:07:00.000Z";

const AGENT_ID = "trend-following";

function snapshotFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const availableAt = overrides.availableAt ?? AT;
  return {
    schemaVersion: 1,
    snapshotId: "snap-1",
    source: "fixture",
    asset: "ACME",
    quote: "USD",
    asOf: availableAt,
    availableAt,
    price: 10,
    spreadBps: 0,
    complete: true,
    ...overrides
  };
}

/** Buy-and-hold benchmark over `[AT, LATER]`, price rising 10 -> `endPrice`, frictionless. */
function buyAndHoldOverAtLater(endPrice: number, agentId = AGENT_ID) {
  const raws = [
    snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
    snapshotFor({ snapshotId: "close", price: endPrice, availableAt: LATER })
  ];
  return buildBuyAndHoldBenchmark(
    agentId,
    START_CASH_MICROS,
    raws,
    "ACME",
    "USD",
    SCALE,
    [AT, LATER],
    FREE_POLICY
  );
}

/** A minimal, valid strategy summary compatible with the `[AT, LATER]` buy-and-hold benchmark above. */
function strategySummary(overrides: Partial<EquitySeriesSummary> = {}): EquitySeriesSummary {
  return Object.freeze({
    agentId: AGENT_ID,
    startedAt: AT,
    endedAt: LATER,
    pointCount: 2,
    startingEquityMicros: START_CASH_MICROS,
    endingEquityMicros: START_CASH_MICROS,
    pnlDirection: "FLAT",
    pnlMagnitudeMicros: 0n,
    peakEquityMicros: START_CASH_MICROS,
    maxDrawdownMicros: 0n,
    maxDrawdownPeakAt: AT,
    maxDrawdownTroughAt: AT,
    ...overrides
  });
}

describe("strategy beats buy-and-hold", () => {
  it("reports OUTPERFORMED with the exact positive difference", () => {
    const summary = strategySummary({
      endingEquityMicros: 130_000_000n,
      pnlDirection: "GAIN",
      pnlMagnitudeMicros: 30_000_000n
    });

    const comparison = compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12));

    assert.equal(comparison.comparisonKind, "STRATEGY_VS_BUY_AND_HOLD");
    assert.equal(comparison.agentId, AGENT_ID);
    assert.equal(comparison.startedAt, AT);
    assert.equal(comparison.endedAt, LATER);
    assert.equal(comparison.pointCount, 2);
    assert.equal(comparison.strategyEndingEquityMicros, 130_000_000n);
    assert.equal(comparison.buyAndHoldEndingEquityMicros, 120_000_000n);
    assert.equal(comparison.result, "OUTPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 10_000_000n);
  });
});

describe("strategy loses to buy-and-hold", () => {
  it("reports UNDERPERFORMED with the exact positive difference", () => {
    const summary = strategySummary({
      endingEquityMicros: 90_000_000n,
      pnlDirection: "LOSS",
      pnlMagnitudeMicros: 10_000_000n
    });

    const comparison = compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12));

    assert.equal(comparison.strategyEndingEquityMicros, 90_000_000n);
    assert.equal(comparison.buyAndHoldEndingEquityMicros, 120_000_000n);
    assert.equal(comparison.result, "UNDERPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 30_000_000n);
  });
});

describe("tie", () => {
  it("reports TIED with zero difference when ending equities are equal", () => {
    const summary = strategySummary({ endingEquityMicros: 120_000_000n });

    const comparison = compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12));

    assert.equal(comparison.result, "TIED");
    assert.equal(comparison.differenceMagnitudeMicros, 0n);
  });
});

describe("exact difference in both directions", () => {
  it("computes the exact absolute difference when the strategy is one micro ahead", () => {
    const summary = strategySummary({ endingEquityMicros: 120_000_001n });

    const comparison = compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12));

    assert.equal(comparison.result, "OUTPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 1n);
  });

  it("computes the exact absolute difference when the strategy is one micro behind", () => {
    const summary = strategySummary({ endingEquityMicros: 119_999_999n });

    const comparison = compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12));

    assert.equal(comparison.result, "UNDERPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 1n);
  });
});

describe("fail-closed compatibility rules", () => {
  it("rejects a different agentId", () => {
    const summary = strategySummary({ agentId: "momentum" });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });

  it("rejects a different startedAt", () => {
    const summary = strategySummary({ startedAt: MID });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });

  it("rejects a different endedAt", () => {
    const summary = strategySummary({ endedAt: MID });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });

  it("rejects a different pointCount", () => {
    const raw = snapshotFor({ snapshotId: "open", price: 10, availableAt: AT });
    const buyAndHold = buildBuyAndHoldBenchmark(
      AGENT_ID,
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      FREE_POLICY
    );
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), buyAndHold),
      ContractValidationError
    );
  });

  it("rejects a different starting equity (initial capital)", () => {
    const summary = strategySummary({ startingEquityMicros: 90_000_000n });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });
});

describe("fail-closed on structurally inconsistent buy-and-hold benchmark", () => {
  it("rejects a forged kind", () => {
    const benchmark = { ...buyAndHoldOverAtLater(12), kind: "FORGED" as unknown as "BUY_AND_HOLD" };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), benchmark),
      ContractValidationError
    );
  });

  it("rejects an internal summary.agentId that diverges from the benchmark's own agentId", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, summary: { ...buyAndHold.summary, agentId: "momentum" } };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });

  it("rejects an initial fill that is not a BUY", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, side: "SELL" as const }
    };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });

  it("rejects an initial fill whose agentId diverges from the benchmark's agentId", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, agentId: "momentum" }
    };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });

  it("rejects an initial fill whose asset diverges from the benchmark's asset", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, asset: "OTHER" }
    };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });

  it("rejects an initial fill whose quote diverges from the benchmark's quote", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, quote: "EUR" }
    };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });

  it("rejects a last point that diverges from the benchmark's own summary.endingEquityMicros", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, summary: { ...buyAndHold.summary, endingEquityMicros: 999_000_000n } };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });
});

describe("fail-closed on invalid monetary values", () => {
  it("rejects a forged non-bigint strategy ending equity", () => {
    const summary = strategySummary({ endingEquityMicros: "120000000" as unknown as bigint });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });

  it("rejects a forged negative strategy ending equity", () => {
    const summary = strategySummary({ endingEquityMicros: -1n });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });

  it("rejects a forged strategy ending equity above the sanity bound", () => {
    const summary = strategySummary({ endingEquityMicros: MAX_MICROS + 1n });
    assert.throws(
      () => compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12)),
      ContractValidationError
    );
  });

  it("rejects a forged non-bigint initialCashMicros on the benchmark", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, initialCashMicros: "100000000" as unknown as bigint };
    assert.throws(
      () => compareStrategyToBuyAndHold(strategySummary(), forged),
      ContractValidationError
    );
  });
});

describe("entry costs below starting capital", () => {
  it("accepts a strategy compared against a buy-and-hold whose first point is below initial cash", () => {
    const raw = snapshotFor();
    const buyAndHold = buildBuyAndHoldBenchmark(
      AGENT_ID,
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      COSTED_POLICY
    );
    assert.ok(buyAndHold.points[0]!.equityMicros < START_CASH_MICROS);

    const summary = strategySummary({
      endedAt: AT,
      pointCount: 1,
      endingEquityMicros: 99_000_000n
    });

    const comparison = compareStrategyToBuyAndHold(summary, buyAndHold);

    assert.equal(comparison.result, "OUTPERFORMED");
    assert.equal(comparison.buyAndHoldEndingEquityMicros, 98_030_200n);
    assert.equal(comparison.differenceMagnitudeMicros, 969_800n);
  });
});

describe("immutability", () => {
  it("freezes the returned comparison", () => {
    const comparison = compareStrategyToBuyAndHold(strategySummary({ endingEquityMicros: 120_000_000n }), buyAndHoldOverAtLater(12));
    assert.ok(Object.isFrozen(comparison));
  });

  it("does not mutate the inputs", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const buyAndHold = buyAndHoldOverAtLater(12);
    const summaryBefore = { ...summary };
    const buyAndHoldBefore = { ...buyAndHold };

    compareStrategyToBuyAndHold(summary, buyAndHold);

    assert.deepEqual(summary, summaryBefore);
    assert.deepEqual(buyAndHold, buyAndHoldBefore);
  });
});

describe("determinism", () => {
  it("produces an identical comparison for the same canonical input", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const buyAndHold = buyAndHoldOverAtLater(12);

    const first = compareStrategyToBuyAndHold(summary, buyAndHold);
    const second = compareStrategyToBuyAndHold(summary, buyAndHold);

    assert.deepEqual(first, second);
  });
});

describe("offline", () => {
  it("uses only injected data, with no clock, network or randomness", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const comparison = compareStrategyToBuyAndHold(summary, buyAndHoldOverAtLater(12));

    assert.equal(typeof comparison.strategyEndingEquityMicros, "bigint");
    assert.equal(typeof comparison.buyAndHoldEndingEquityMicros, "bigint");
    assert.equal(typeof comparison.differenceMagnitudeMicros, "bigint");
  });
});
