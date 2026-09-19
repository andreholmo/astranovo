import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildCashBenchmark } from "../src/benchmark/build-cash-benchmark.js";
import { buildBuyAndHoldBenchmark } from "../src/benchmark/build-buy-and-hold-benchmark.js";
import { compareToCashBenchmark } from "../src/benchmark/compare-to-cash-benchmark.js";
import { compareStrategyToBuyAndHold } from "../src/benchmark/compare-strategy-to-buy-and-hold.js";
import { compareBuyAndHoldToCash } from "../src/benchmark/compare-buy-and-hold-to-cash.js";
import { buildStrategyBenchmarkReport } from "../src/benchmark/build-strategy-benchmark-report.js";
import type { EquitySeriesSummary } from "../src/metrics/summarize-equity-series.js";
import { AT, FREE_POLICY, LATER, SCALE, START_CASH_MICROS } from "./support/fixtures.js";

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

/** Cash benchmark over `[AT, LATER]`, matching the buy-and-hold's own experiment window. */
function cashBenchmark(agentId = AGENT_ID) {
  return buildCashBenchmark(agentId, START_CASH_MICROS, [AT, LATER]);
}

/** Buy-and-hold benchmark over `[AT, LATER]`, price rising 10 -> 12, frictionless: ends at 120_000_000n. */
function buyAndHoldBenchmark(agentId = AGENT_ID) {
  const raws = [
    snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
    snapshotFor({ snapshotId: "close", price: 12, availableAt: LATER })
  ];
  return buildBuyAndHoldBenchmark(agentId, START_CASH_MICROS, raws, "ACME", "USD", SCALE, [AT, LATER], FREE_POLICY);
}

/** A minimal, valid strategy summary compatible with both benchmarks above. */
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

describe("strategy beats both benchmarks", () => {
  it("consolidates OUTPERFORMED against cash and against buy-and-hold", () => {
    const summary = strategySummary({
      endingEquityMicros: 130_000_000n,
      pnlDirection: "GAIN",
      pnlMagnitudeMicros: 30_000_000n
    });

    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.equal(report.reportKind, "STRATEGY_BENCHMARK_REPORT");
    assert.equal(report.agentId, AGENT_ID);
    assert.equal(report.startedAt, AT);
    assert.equal(report.endedAt, LATER);
    assert.equal(report.pointCount, 2);
    assert.equal(report.startingEquityMicros, START_CASH_MICROS);
    assert.equal(report.strategyEndingEquityMicros, 130_000_000n);

    assert.equal(report.vsCash.result, "OUTPERFORMED");
    assert.equal(report.vsCash.differenceMagnitudeMicros, 30_000_000n);
    assert.equal(report.vsBuyAndHold.result, "OUTPERFORMED");
    assert.equal(report.vsBuyAndHold.differenceMagnitudeMicros, 10_000_000n);
    assert.equal(report.buyAndHoldVsCash.result, "OUTPERFORMED");
    assert.equal(report.buyAndHoldVsCash.differenceMagnitudeMicros, 20_000_000n);
  });
});

describe("distinct result combinations", () => {
  it("outperforms cash while underperforming buy-and-hold", () => {
    const summary = strategySummary({ endingEquityMicros: 110_000_000n });
    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.equal(report.vsCash.result, "OUTPERFORMED");
    assert.equal(report.vsBuyAndHold.result, "UNDERPERFORMED");
    assert.equal(report.buyAndHoldVsCash.result, "OUTPERFORMED");
  });

  it("ties cash while underperforming buy-and-hold", () => {
    const summary = strategySummary({ endingEquityMicros: START_CASH_MICROS });
    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.equal(report.vsCash.result, "TIED");
    assert.equal(report.vsCash.differenceMagnitudeMicros, 0n);
    assert.equal(report.vsBuyAndHold.result, "UNDERPERFORMED");
    assert.equal(report.buyAndHoldVsCash.result, "OUTPERFORMED");
  });

  it("ties buy-and-hold while outperforming cash", () => {
    const summary = strategySummary({ endingEquityMicros: 120_000_000n });
    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.equal(report.vsCash.result, "OUTPERFORMED");
    assert.equal(report.vsBuyAndHold.result, "TIED");
    assert.equal(report.vsBuyAndHold.differenceMagnitudeMicros, 0n);
    assert.equal(report.buyAndHoldVsCash.result, "OUTPERFORMED");
  });

  it("underperforms both benchmarks while buy-and-hold still beats cash", () => {
    const summary = strategySummary({ endingEquityMicros: 90_000_000n });
    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.equal(report.vsCash.result, "UNDERPERFORMED");
    assert.equal(report.vsBuyAndHold.result, "UNDERPERFORMED");
    assert.equal(report.buyAndHoldVsCash.result, "OUTPERFORMED");
  });

  it("ties buy-and-hold against cash when the buy-and-hold price never moves", () => {
    const flatRaws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "close", price: 10, availableAt: LATER })
    ];
    const flatBuyAndHold = buildBuyAndHoldBenchmark(
      AGENT_ID,
      START_CASH_MICROS,
      flatRaws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      FREE_POLICY
    );
    const summary = strategySummary({ endingEquityMicros: START_CASH_MICROS });

    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), flatBuyAndHold);

    assert.equal(report.buyAndHoldVsCash.result, "TIED");
    assert.equal(report.buyAndHoldVsCash.differenceMagnitudeMicros, 0n);
  });
});

describe("fail-closed propagation from the cash comparison", () => {
  it("propagates an incompatible strategy agentId", () => {
    const summary = strategySummary({ agentId: "momentum" });
    assert.throws(
      () => buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark()),
      ContractValidationError
    );
  });

  it("propagates a cash benchmark with a forged kind", () => {
    const forged = { ...cashBenchmark(), kind: "FORGED" as unknown as "CASH" };
    assert.throws(
      () => buildStrategyBenchmarkReport(strategySummary(), forged, buyAndHoldBenchmark()),
      ContractValidationError
    );
  });

  it("propagates a cash benchmark whose internal summary.agentId diverges from its own agentId", () => {
    const benchmark = cashBenchmark();
    const forged = { ...benchmark, summary: { ...benchmark.summary, agentId: "momentum" } };
    assert.throws(
      () => buildStrategyBenchmarkReport(strategySummary(), forged, buyAndHoldBenchmark()),
      ContractValidationError
    );
  });

  it("propagates a strategy starting equity that diverges from the cash benchmark's initialCashMicros", () => {
    const summary = strategySummary({ startingEquityMicros: 90_000_000n });
    assert.throws(
      () => buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark()),
      ContractValidationError
    );
  });
});

describe("fail-closed propagation from the buy-and-hold comparison", () => {
  it("propagates a buy-and-hold benchmark with a forged kind", () => {
    const forged = { ...buyAndHoldBenchmark(), kind: "FORGED" as unknown as "BUY_AND_HOLD" };
    assert.throws(
      () => buildStrategyBenchmarkReport(strategySummary(), cashBenchmark(), forged),
      ContractValidationError
    );
  });

  it("propagates a buy-and-hold benchmark whose initial fill is not a BUY", () => {
    const buyAndHold = buyAndHoldBenchmark();
    const forged = { ...buyAndHold, initialFill: { ...buyAndHold.initialFill, side: "SELL" as const } };
    assert.throws(
      () => buildStrategyBenchmarkReport(strategySummary(), cashBenchmark(), forged),
      ContractValidationError
    );
  });

  it("propagates a different pointCount between strategy and buy-and-hold", () => {
    const raw = snapshotFor({ snapshotId: "open", price: 10, availableAt: AT });
    const shortBuyAndHold = buildBuyAndHoldBenchmark(
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
      () => buildStrategyBenchmarkReport(strategySummary(), cashBenchmark(), shortBuyAndHold),
      ContractValidationError
    );
  });
});

describe("fail-closed propagation from the buy-and-hold-vs-cash comparison", () => {
  it("propagates a cash benchmark whose ending equity diverges from its own initialCashMicros", () => {
    const cash = cashBenchmark();
    const forged = {
      ...cash,
      summary: { ...cash.summary, endingEquityMicros: cash.summary.endingEquityMicros + 1n }
    };
    assert.throws(
      () => buildStrategyBenchmarkReport(strategySummary(), forged, buyAndHoldBenchmark()),
      ContractValidationError
    );
  });
});

describe("existing comparison functions are the source of truth", () => {
  it("carries compareToCashBenchmark's own result verbatim", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const cash = cashBenchmark();

    const report = buildStrategyBenchmarkReport(summary, cash, buyAndHoldBenchmark());
    const directComparison = compareToCashBenchmark(summary, cash);

    assert.deepEqual(report.vsCash, directComparison);
  });

  it("carries compareStrategyToBuyAndHold's own result verbatim", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const buyAndHold = buyAndHoldBenchmark();

    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHold);
    const directComparison = compareStrategyToBuyAndHold(summary, buyAndHold);

    assert.deepEqual(report.vsBuyAndHold, directComparison);
  });

  it("carries compareBuyAndHoldToCash's own result verbatim", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const cash = cashBenchmark();
    const buyAndHold = buyAndHoldBenchmark();

    const report = buildStrategyBenchmarkReport(summary, cash, buyAndHold);
    const directComparison = compareBuyAndHoldToCash(buyAndHold, cash);

    assert.deepEqual(report.buyAndHoldVsCash, directComparison);
  });
});

describe("immutability", () => {
  it("freezes the returned report", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.ok(Object.isFrozen(report));
  });

  it("does not mutate any of the three inputs", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const cash = cashBenchmark();
    const buyAndHold = buyAndHoldBenchmark();
    const summaryBefore = { ...summary };
    const cashBefore = { ...cash };
    const buyAndHoldBefore = { ...buyAndHold };

    buildStrategyBenchmarkReport(summary, cash, buyAndHold);

    assert.deepEqual(summary, summaryBefore);
    assert.deepEqual(cash, cashBefore);
    assert.deepEqual(buyAndHold, buyAndHoldBefore);
  });
});

describe("determinism", () => {
  it("produces an identical report for the same canonical input", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const cash = cashBenchmark();
    const buyAndHold = buyAndHoldBenchmark();

    const first = buildStrategyBenchmarkReport(summary, cash, buyAndHold);
    const second = buildStrategyBenchmarkReport(summary, cash, buyAndHold);

    assert.deepEqual(first, second);
  });
});

describe("offline", () => {
  it("uses only injected data, with no clock, network or randomness", () => {
    const summary = strategySummary({ endingEquityMicros: 130_000_000n });
    const report = buildStrategyBenchmarkReport(summary, cashBenchmark(), buyAndHoldBenchmark());

    assert.equal(typeof report.startingEquityMicros, "bigint");
    assert.equal(typeof report.strategyEndingEquityMicros, "bigint");
  });
});
