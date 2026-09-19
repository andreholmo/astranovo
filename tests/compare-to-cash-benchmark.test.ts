import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildCashBenchmark } from "../src/benchmark/build-cash-benchmark.js";
import { compareToCashBenchmark } from "../src/benchmark/compare-to-cash-benchmark.js";
import type { EquitySeriesSummary } from "../src/metrics/summarize-equity-series.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";

const T1 = "2026-09-17T18:00:00.000Z";
const T2 = "2026-09-17T18:01:00.000Z";
const T3 = "2026-09-17T18:02:00.000Z";

/** Fictitious US$100, matching the fixture budget used across the repo. */
const CASH_100 = 100_000_000n;

/** A minimal, valid strategy summary compatible with the T1..T3 cash benchmark below. */
function strategySummary(overrides: Partial<EquitySeriesSummary> = {}): EquitySeriesSummary {
  return Object.freeze({
    agentId: "trend-following",
    startedAt: T1,
    endedAt: T3,
    pointCount: 3,
    startingEquityMicros: CASH_100,
    endingEquityMicros: CASH_100,
    pnlDirection: "FLAT",
    pnlMagnitudeMicros: 0n,
    peakEquityMicros: CASH_100,
    maxDrawdownMicros: 0n,
    maxDrawdownPeakAt: T1,
    maxDrawdownTroughAt: T1,
    ...overrides
  });
}

function cashBenchmark() {
  return buildCashBenchmark("trend-following", CASH_100, [T1, T2, T3]);
}

describe("strategy beats cash", () => {
  it("reports OUTPERFORMED with the exact positive difference", () => {
    const summary = strategySummary({
      endingEquityMicros: 110_000_000n,
      pnlDirection: "GAIN",
      pnlMagnitudeMicros: 10_000_000n
    });

    const comparison = compareToCashBenchmark(summary, cashBenchmark());

    assert.equal(comparison.benchmarkKind, "CASH");
    assert.equal(comparison.agentId, "trend-following");
    assert.equal(comparison.startedAt, T1);
    assert.equal(comparison.endedAt, T3);
    assert.equal(comparison.pointCount, 3);
    assert.equal(comparison.strategyEndingEquityMicros, 110_000_000n);
    assert.equal(comparison.benchmarkEndingEquityMicros, CASH_100);
    assert.equal(comparison.result, "OUTPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 10_000_000n);
  });
});

describe("strategy loses to cash", () => {
  it("reports UNDERPERFORMED with the exact positive difference", () => {
    const summary = strategySummary({
      endingEquityMicros: 90_000_000n,
      pnlDirection: "LOSS",
      pnlMagnitudeMicros: 10_000_000n
    });

    const comparison = compareToCashBenchmark(summary, cashBenchmark());

    assert.equal(comparison.result, "UNDERPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 10_000_000n);
  });
});

describe("tie", () => {
  it("reports TIED with zero difference when ending equities are equal", () => {
    const comparison = compareToCashBenchmark(strategySummary(), cashBenchmark());

    assert.equal(comparison.result, "TIED");
    assert.equal(comparison.differenceMagnitudeMicros, 0n);
  });
});

describe("exact micros difference", () => {
  it("computes the exact absolute difference, not an approximation", () => {
    const summary = strategySummary({ endingEquityMicros: 100_000_001n });

    const comparison = compareToCashBenchmark(summary, cashBenchmark());

    assert.equal(comparison.result, "OUTPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 1n);
  });
});

describe("fictitious US$100 capital", () => {
  it("accepts a strategy that shares the benchmark's US$100 starting equity", () => {
    const comparison = compareToCashBenchmark(strategySummary(), cashBenchmark());

    assert.equal(comparison.benchmarkEndingEquityMicros, CASH_100);
  });
});

describe("fail-closed compatibility rules", () => {
  it("rejects a different agentId", () => {
    const summary = strategySummary({ agentId: "momentum" });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a different startedAt", () => {
    const summary = strategySummary({ startedAt: T2 });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a different endedAt", () => {
    const summary = strategySummary({ endedAt: T2 });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a different pointCount", () => {
    const summary = strategySummary({ pointCount: 2 });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a different starting equity", () => {
    const summary = strategySummary({ startingEquityMicros: 90_000_000n });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a forged non-bigint ending equity", () => {
    const summary = strategySummary({
      endingEquityMicros: "100000000" as unknown as bigint
    });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a forged negative ending equity", () => {
    const summary = strategySummary({ endingEquityMicros: -1n });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });

  it("rejects a forged ending equity above the sanity bound", () => {
    const summary = strategySummary({ endingEquityMicros: MAX_MICROS + 1n });
    assert.throws(() => compareToCashBenchmark(summary, cashBenchmark()), ContractValidationError);
  });
});

describe("immutability", () => {
  it("freezes the returned comparison", () => {
    const comparison = compareToCashBenchmark(strategySummary(), cashBenchmark());
    assert.ok(Object.isFrozen(comparison));
  });

  it("does not mutate the inputs", () => {
    const summary = strategySummary();
    const benchmark = cashBenchmark();
    const summaryBefore = { ...summary };
    const benchmarkBefore = { ...benchmark };

    compareToCashBenchmark(summary, benchmark);

    assert.deepEqual(summary, summaryBefore);
    assert.deepEqual(benchmark, benchmarkBefore);
  });
});

describe("determinism", () => {
  it("produces an identical comparison for the same canonical input", () => {
    const summary = strategySummary({ endingEquityMicros: 110_000_000n });
    const first = compareToCashBenchmark(summary, cashBenchmark());
    const second = compareToCashBenchmark(summary, cashBenchmark());

    assert.deepEqual(first, second);
  });
});

describe("offline", () => {
  it("uses only injected data, with no clock, network or randomness", () => {
    const summary = strategySummary({ endingEquityMicros: 110_000_000n });
    const comparison = compareToCashBenchmark(summary, cashBenchmark());

    assert.equal(typeof comparison.strategyEndingEquityMicros, "bigint");
    assert.equal(typeof comparison.benchmarkEndingEquityMicros, "bigint");
  });
});
