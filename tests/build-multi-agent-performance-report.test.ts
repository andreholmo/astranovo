import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import {
  buildMultiAgentPerformanceReport,
  type MultiAgentPerformanceEntry
} from "../src/metrics/build-multi-agent-performance-report.js";
import type { EquitySeriesSummary, PnlDirection } from "../src/metrics/summarize-equity-series.js";
import type { RealizedPerformanceSummary } from "../src/metrics/summarize-realized-performance.js";
import type { ExecutionCostSummary } from "../src/metrics/summarize-execution-costs.js";
import { REJECTION_CODES, type RejectionCode } from "../src/ledger/events.js";
import { buildCashBenchmark } from "../src/benchmark/build-cash-benchmark.js";
import { buildBuyAndHoldBenchmark } from "../src/benchmark/build-buy-and-hold-benchmark.js";
import { buildStrategyBenchmarkReport, type StrategyBenchmarkReport } from "../src/benchmark/build-strategy-benchmark-report.js";
import { loadAgentsConfig, enabledAgents } from "../src/config/load-agents.js";
import { AT, LATER, FREE_POLICY, SCALE, START_CASH_MICROS } from "./support/fixtures.js";

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

/** `[AT, LATER]` cash benchmark, matching the fixture window used throughout this file. */
function cashBenchmarkFor(agentId: string) {
  return buildCashBenchmark(agentId, START_CASH_MICROS, [AT, LATER]);
}

/** `[AT, LATER]` buy-and-hold benchmark, price rising 10 -> 12, frictionless: ends at 120_000_000n. */
function buyAndHoldBenchmarkFor(agentId: string) {
  const raws = [
    snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
    snapshotFor({ snapshotId: "close", price: 12, availableAt: LATER })
  ];
  return buildBuyAndHoldBenchmark(agentId, START_CASH_MICROS, raws, "ACME", "USD", SCALE, [AT, LATER], FREE_POLICY);
}

function emptyRejectionCounts(): Record<RejectionCode, number> {
  return Object.fromEntries(REJECTION_CODES.map((code) => [code, 0])) as Record<RejectionCode, number>;
}

function formatUsd(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** A fictitious, hand-checkable set of per-agent paper results, all sharing the `[AT, LATER]` window. */
interface DemoAgentFixture {
  readonly agentId: string;
  readonly endingEquityMicros: bigint;
  readonly maxDrawdownMicros: bigint;
  readonly closedTradeCount: number;
  readonly winCount: number;
  readonly totalFeeMicros: bigint;
  readonly totalExecutionImpactMicros: bigint;
}

/** The six agents of `config/agents.json`, each with distinct, entirely fictitious demo numbers. */
const DEMO_AGENTS: readonly DemoAgentFixture[] = [
  {
    agentId: "trend-following",
    endingEquityMicros: 115_000_000n,
    maxDrawdownMicros: 5_000_000n,
    closedTradeCount: 10,
    winCount: 6,
    totalFeeMicros: 500_000n,
    totalExecutionImpactMicros: 300_000n
  },
  {
    agentId: "mean-reversion",
    endingEquityMicros: 108_000_000n,
    maxDrawdownMicros: 2_000_000n,
    closedTradeCount: 14,
    winCount: 9,
    totalFeeMicros: 700_000n,
    totalExecutionImpactMicros: 450_000n
  },
  {
    agentId: "breakout",
    endingEquityMicros: 100_000_000n,
    maxDrawdownMicros: 12_000_000n,
    closedTradeCount: 8,
    winCount: 3,
    totalFeeMicros: 620_000n,
    totalExecutionImpactMicros: 500_000n
  },
  {
    agentId: "momentum",
    endingEquityMicros: 94_000_000n,
    maxDrawdownMicros: 9_000_000n,
    closedTradeCount: 11,
    winCount: 4,
    totalFeeMicros: 550_000n,
    totalExecutionImpactMicros: 400_000n
  },
  {
    agentId: "volatility-filtered",
    endingEquityMicros: 121_000_000n,
    maxDrawdownMicros: 3_000_000n,
    closedTradeCount: 6,
    winCount: 5,
    totalFeeMicros: 300_000n,
    totalExecutionImpactMicros: 150_000n
  },
  {
    agentId: "conservative-baseline",
    endingEquityMicros: 101_500_000n,
    maxDrawdownMicros: 500_000n,
    closedTradeCount: 3,
    winCount: 2,
    totalFeeMicros: 100_000n,
    totalExecutionImpactMicros: 50_000n
  }
];

function equitySummaryFor(fixture: DemoAgentFixture): EquitySeriesSummary {
  const startingEquityMicros = START_CASH_MICROS;
  const endingEquityMicros = fixture.endingEquityMicros;

  let pnlDirection: PnlDirection;
  let pnlMagnitudeMicros: bigint;
  if (endingEquityMicros > startingEquityMicros) {
    pnlDirection = "GAIN";
    pnlMagnitudeMicros = endingEquityMicros - startingEquityMicros;
  } else if (endingEquityMicros < startingEquityMicros) {
    pnlDirection = "LOSS";
    pnlMagnitudeMicros = startingEquityMicros - endingEquityMicros;
  } else {
    pnlDirection = "FLAT";
    pnlMagnitudeMicros = 0n;
  }

  const higher = startingEquityMicros > endingEquityMicros ? startingEquityMicros : endingEquityMicros;

  return Object.freeze({
    agentId: fixture.agentId,
    startedAt: AT,
    endedAt: LATER,
    pointCount: 2,
    startingEquityMicros,
    endingEquityMicros,
    pnlDirection,
    pnlMagnitudeMicros,
    peakEquityMicros: higher + fixture.maxDrawdownMicros,
    maxDrawdownMicros: fixture.maxDrawdownMicros,
    maxDrawdownPeakAt: AT,
    maxDrawdownTroughAt: LATER
  });
}

function realizedSummaryFor(fixture: DemoAgentFixture): RealizedPerformanceSummary {
  const lossCount = fixture.closedTradeCount - fixture.winCount;
  const totalGainMicros = 2_000_000n * BigInt(fixture.winCount);
  const totalLossMicros = 1_500_000n * BigInt(lossCount);

  let netResultDirection: RealizedPerformanceSummary["netResultDirection"];
  let netResultMagnitudeMicros: bigint;
  if (totalGainMicros > totalLossMicros) {
    netResultDirection = "WIN";
    netResultMagnitudeMicros = totalGainMicros - totalLossMicros;
  } else if (totalGainMicros < totalLossMicros) {
    netResultDirection = "LOSS";
    netResultMagnitudeMicros = totalLossMicros - totalGainMicros;
  } else {
    netResultDirection = "BREAK_EVEN";
    netResultMagnitudeMicros = 0n;
  }

  return Object.freeze({
    agentId: fixture.agentId,
    closedTradeCount: fixture.closedTradeCount,
    winCount: fixture.winCount,
    lossCount,
    breakEvenCount: 0,
    totalGainMicros,
    totalLossMicros,
    netResultDirection,
    netResultMagnitudeMicros,
    winRateNumerator: fixture.winCount,
    winRateDenominator: fixture.closedTradeCount
  });
}

function costsSummaryFor(fixture: DemoAgentFixture): ExecutionCostSummary {
  const fillCount = fixture.closedTradeCount * 2;

  return Object.freeze({
    agentId: fixture.agentId,
    eventCount: fillCount,
    fillCount,
    rejectionCount: 0,
    buyFillCount: fixture.closedTradeCount,
    sellFillCount: fixture.closedTradeCount,
    totalGrossMicros: fixture.totalFeeMicros * 50n,
    totalFeeMicros: fixture.totalFeeMicros,
    totalExecutionImpactMicros: fixture.totalExecutionImpactMicros,
    rejectionCounts: Object.freeze(emptyRejectionCounts())
  });
}

function benchmarkReportFor(fixture: DemoAgentFixture, equity: EquitySeriesSummary): StrategyBenchmarkReport {
  return buildStrategyBenchmarkReport(equity, cashBenchmarkFor(fixture.agentId), buyAndHoldBenchmarkFor(fixture.agentId));
}

function demoEntryFor(fixture: DemoAgentFixture): MultiAgentPerformanceEntry {
  const equity = equitySummaryFor(fixture);
  return {
    equity,
    realized: realizedSummaryFor(fixture),
    costs: costsSummaryFor(fixture),
    benchmark: benchmarkReportFor(fixture, equity)
  };
}

describe("composition over a configurable list of agents", () => {
  it("builds one row per agent, preserving every value verbatim", () => {
    const fixtures = DEMO_AGENTS.slice(0, 3);
    const entries = fixtures.map(demoEntryFor);

    const report = buildMultiAgentPerformanceReport(entries);

    assert.equal(report.reportKind, "MULTI_AGENT_PERFORMANCE_REPORT");
    assert.equal(report.agentCount, 3);
    assert.equal(report.startedAt, AT);
    assert.equal(report.endedAt, LATER);
    assert.equal(report.pointCount, 2);
    assert.equal(report.rows.length, 3);

    report.rows.forEach((row, index) => {
      const entry = entries[index] as MultiAgentPerformanceEntry;
      assert.equal(row.agentId, entry.equity.agentId);
      assert.equal(row.startedAt, entry.equity.startedAt);
      assert.equal(row.endedAt, entry.equity.endedAt);
      assert.equal(row.pointCount, entry.equity.pointCount);
      assert.equal(row.startingEquityMicros, entry.equity.startingEquityMicros);
      assert.equal(row.endingEquityMicros, entry.equity.endingEquityMicros);
      assert.equal(row.pnlDirection, entry.equity.pnlDirection);
      assert.equal(row.pnlMagnitudeMicros, entry.equity.pnlMagnitudeMicros);
      assert.equal(row.maxDrawdownMicros, entry.equity.maxDrawdownMicros);
      assert.equal(row.closedTradeCount, entry.realized.closedTradeCount);
      assert.equal(row.winRateNumerator, entry.realized.winRateNumerator);
      assert.equal(row.winRateDenominator, entry.realized.winRateDenominator);
      assert.equal(row.totalFeeMicros, entry.costs.totalFeeMicros);
      assert.equal(row.totalExecutionImpactMicros, entry.costs.totalExecutionImpactMicros);
      assert.deepEqual(row.vsCash, entry.benchmark.vsCash);
      assert.deepEqual(row.vsBuyAndHold, entry.benchmark.vsBuyAndHold);
    });
  });
});

describe("order preservation without ranking", () => {
  it("keeps the exact entry order even when a later agent clearly outperforms an earlier one", () => {
    const worst = DEMO_AGENTS.find((fixture) => fixture.agentId === "momentum") as DemoAgentFixture;
    const best = DEMO_AGENTS.find((fixture) => fixture.agentId === "volatility-filtered") as DemoAgentFixture;

    const report = buildMultiAgentPerformanceReport([demoEntryFor(worst), demoEntryFor(best)]);

    assert.deepEqual(
      report.rows.map((row) => row.agentId),
      [worst.agentId, best.agentId]
    );
    assert.ok(!("rank" in report));
    assert.ok(!("winner" in report));
    report.rows.forEach((row) => {
      assert.ok(!("rank" in row));
    });
  });
});

describe("fail-closed validation", () => {
  it("rejects an empty entries list", () => {
    assert.throws(() => buildMultiAgentPerformanceReport([]), ContractValidationError);
  });

  it("rejects a duplicate agentId across entries", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    assert.throws(
      () => buildMultiAgentPerformanceReport([demoEntryFor(fixture), demoEntryFor(fixture)]),
      ContractValidationError
    );
  });

  it("rejects an entry whose realized.agentId diverges from equity.agentId", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: { ...entry.realized, agentId: "someone-else" }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects an entry whose costs.agentId diverges from equity.agentId", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      costs: { ...entry.costs, agentId: "someone-else" }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects an entry whose benchmark.agentId diverges from equity.agentId", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: { ...entry.benchmark, agentId: "someone-else" }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects an entry whose benchmark window diverges from its own equity window", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      equity: { ...entry.equity, endedAt: "2026-09-17T19:00:00.000Z" }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects an entry whose benchmark pointCount diverges from its own equity pointCount", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      equity: { ...entry.equity, pointCount: 3 }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects two agents whose experiment windows are incompatible with each other", () => {
    const shortFixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const shortEntry = demoEntryFor(shortFixture);

    const MID = "2026-09-17T18:10:00.000Z";
    const longFixture: DemoAgentFixture = { ...(DEMO_AGENTS[1] as DemoAgentFixture) };
    const longCash = buildCashBenchmark(longFixture.agentId, START_CASH_MICROS, [AT, MID, LATER]);
    const longRaws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "mid", price: 11, availableAt: MID }),
      snapshotFor({ snapshotId: "close", price: 12, availableAt: LATER })
    ];
    const longBuyAndHold = buildBuyAndHoldBenchmark(
      longFixture.agentId,
      START_CASH_MICROS,
      longRaws,
      "ACME",
      "USD",
      SCALE,
      [AT, MID, LATER],
      FREE_POLICY
    );
    const longEquity: EquitySeriesSummary = {
      ...equitySummaryFor(longFixture),
      pointCount: 3
    };
    const longEntry: MultiAgentPerformanceEntry = {
      equity: longEquity,
      realized: realizedSummaryFor(longFixture),
      costs: costsSummaryFor(longFixture),
      benchmark: buildStrategyBenchmarkReport(longEquity, longCash, longBuyAndHold)
    };

    assert.throws(() => buildMultiAgentPerformanceReport([shortEntry, longEntry]), ContractValidationError);
  });

  it("rejects a winRateDenominator that does not equal closedTradeCount", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: { ...entry.realized, winRateDenominator: entry.realized.winRateDenominator + 1 }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a winRateNumerator that exceeds winRateDenominator", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: {
        ...entry.realized,
        winRateNumerator: entry.realized.winRateDenominator + 1,
        winRateDenominator: entry.realized.winRateDenominator + 1
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a pnlDirection that disagrees with the sign of ending minus starting equity", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    // starting 100, ending 90 => LOSS 10, but pnlDirection is forged to GAIN with the correct magnitude.
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      equity: {
        ...entry.equity,
        endingEquityMicros: 90_000_000n,
        pnlDirection: "GAIN",
        pnlMagnitudeMicros: 10_000_000n
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a pnlMagnitudeMicros that disagrees with the exact difference between starting and ending equity", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    // starting 100, ending 90 => LOSS 10, but pnlMagnitudeMicros is forged to a different amount.
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      equity: {
        ...entry.equity,
        endingEquityMicros: 90_000_000n,
        pnlDirection: "LOSS",
        pnlMagnitudeMicros: 5_000_000n
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a realized.winCount that disagrees with realized.winRateNumerator", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: { ...entry.realized, winCount: entry.realized.winCount + 1 }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects winCount + lossCount + breakEvenCount that disagrees with realized.closedTradeCount", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: { ...entry.realized, lossCount: entry.realized.lossCount + 1 }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a closedTradeCount above Number.MAX_SAFE_INTEGER", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: { ...entry.realized, closedTradeCount: Number.MAX_SAFE_INTEGER + 1 }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a winCount above Number.MAX_SAFE_INTEGER", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      realized: { ...entry.realized, winCount: Number.MAX_SAFE_INTEGER + 1 }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects vsCash.strategyEndingEquityMicros diverging from equity.endingEquityMicros", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: {
        ...entry.benchmark,
        vsCash: {
          ...entry.benchmark.vsCash,
          strategyEndingEquityMicros: entry.benchmark.vsCash.strategyEndingEquityMicros + 1n
        }
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects vsBuyAndHold.strategyEndingEquityMicros diverging from equity.endingEquityMicros", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: {
        ...entry.benchmark,
        vsBuyAndHold: {
          ...entry.benchmark.vsBuyAndHold,
          strategyEndingEquityMicros: entry.benchmark.vsBuyAndHold.strategyEndingEquityMicros + 1n
        }
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a vsCash.result incompatible with the two compared ending equities", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: {
        ...entry.benchmark,
        vsCash: { ...entry.benchmark.vsCash, result: "TIED" }
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a vsCash.differenceMagnitudeMicros incompatible with the two compared ending equities", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: {
        ...entry.benchmark,
        vsCash: {
          ...entry.benchmark.vsCash,
          differenceMagnitudeMicros: entry.benchmark.vsCash.differenceMagnitudeMicros + 1n
        }
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a vsBuyAndHold.result incompatible with the two compared ending equities", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: {
        ...entry.benchmark,
        vsBuyAndHold: { ...entry.benchmark.vsBuyAndHold, result: "TIED" }
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a vsBuyAndHold.differenceMagnitudeMicros incompatible with the two compared ending equities", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      benchmark: {
        ...entry.benchmark,
        vsBuyAndHold: {
          ...entry.benchmark.vsBuyAndHold,
          differenceMagnitudeMicros: entry.benchmark.vsBuyAndHold.differenceMagnitudeMicros + 1n
        }
      }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a non-bigint monetary field", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged = {
      ...entry,
      costs: { ...entry.costs, totalFeeMicros: 500_000 as unknown as bigint }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });

  it("rejects a negative monetary field", () => {
    const fixture = DEMO_AGENTS[0] as DemoAgentFixture;
    const entry = demoEntryFor(fixture);
    const forged: MultiAgentPerformanceEntry = {
      ...entry,
      costs: { ...entry.costs, totalExecutionImpactMicros: -1n }
    };
    assert.throws(() => buildMultiAgentPerformanceReport([forged]), ContractValidationError);
  });
});

describe("immutability", () => {
  it("freezes the report, the rows collection and every row", () => {
    const entries = DEMO_AGENTS.slice(0, 2).map(demoEntryFor);
    const report = buildMultiAgentPerformanceReport(entries);

    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.rows));
    report.rows.forEach((row) => assert.ok(Object.isFrozen(row)));
  });

  it("does not mutate any supplied entry", () => {
    const entries = DEMO_AGENTS.slice(0, 2).map(demoEntryFor);
    const before = structuredClone(entries);

    buildMultiAgentPerformanceReport(entries);

    assert.deepEqual(entries, before);
  });
});

describe("determinism", () => {
  it("produces an identical report for the same canonical input", () => {
    const entries = DEMO_AGENTS.slice(0, 4).map(demoEntryFor);

    const first = buildMultiAgentPerformanceReport(entries);
    const second = buildMultiAgentPerformanceReport(entries);

    assert.deepEqual(first, second);
  });
});

describe("no clock, timer, randomness, network or I/O", () => {
  it("consolidates entries purely from its arguments, offline and synchronously", () => {
    const originalDateNow = Date.now;
    const originalMathRandom = Math.random;
    const originalSetTimeout = globalThis.setTimeout;
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;

    Date.now = () => {
      throw new Error("Date.now must not be called");
    };
    Math.random = () => {
      throw new Error("Math.random must not be called");
    };
    globalThis.setTimeout = (() => {
      throw new Error("setTimeout must not be called");
    }) as unknown as typeof globalThis.setTimeout;
    (globalThis as { fetch?: unknown }).fetch = () => {
      throw new Error("fetch must not be called");
    };

    try {
      const entries = DEMO_AGENTS.slice(0, 2).map(demoEntryFor);
      const report = buildMultiAgentPerformanceReport(entries);
      assert.equal(report.agentCount, 2);
    } finally {
      Date.now = originalDateNow;
      Math.random = originalMathRandom;
      globalThis.setTimeout = originalSetTimeout;
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });
});

describe("demonstração offline com os seis agentes de config/agents.json", () => {
  it("consolida números fictícios distintos e explícitos, visíveis no log da CI", async () => {
    const config = await loadAgentsConfig();
    const agents = enabledAgents(config);

    assert.deepEqual(
      agents.map((agent) => agent.id),
      DEMO_AGENTS.map((fixture) => fixture.agentId)
    );
    agents.forEach((agent) => assert.equal(agent.initialBudgetUsd, 100));

    const entries = DEMO_AGENTS.map(demoEntryFor);
    const report = buildMultiAgentPerformanceReport(entries);

    assert.equal(report.agentCount, 6);
    assert.deepEqual(
      report.rows.map((row) => row.agentId),
      DEMO_AGENTS.map((fixture) => fixture.agentId)
    );

    const table = report.rows.map((row) => ({
      agentId: row.agentId,
      startingEquityUsd: formatUsd(row.startingEquityMicros),
      endingEquityUsd: formatUsd(row.endingEquityMicros),
      pnl: `${row.pnlDirection} ${formatUsd(row.pnlMagnitudeMicros)}`,
      maxDrawdownUsd: formatUsd(row.maxDrawdownMicros),
      closedTradeCount: row.closedTradeCount,
      winRate: `${row.winRateNumerator}/${row.winRateDenominator}`,
      feesUsd: formatUsd(row.totalFeeMicros),
      executionImpactUsd: formatUsd(row.totalExecutionImpactMicros),
      vsCash: row.vsCash.result,
      vsBuyAndHold: row.vsBuyAndHold.result
    }));

    // eslint-disable-next-line no-console
    console.log("TASK-025 — demonstração offline, dados 100% fictícios, exclusivamente paper:");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(table, null, 2));

    assert.equal(table[0]?.agentId, "trend-following");
    assert.equal(table[0]?.startingEquityUsd, "100.000000");
    assert.equal(table[0]?.endingEquityUsd, "115.000000");
    assert.equal(table[0]?.pnl, "GAIN 15.000000");
    assert.equal(table[0]?.maxDrawdownUsd, "5.000000");
    assert.equal(table[0]?.closedTradeCount, 10);
    assert.equal(table[0]?.winRate, "6/10");
    assert.equal(table[0]?.feesUsd, "0.500000");
    assert.equal(table[0]?.executionImpactUsd, "0.300000");
    assert.equal(table[0]?.vsCash, "OUTPERFORMED");
    assert.equal(table[0]?.vsBuyAndHold, "UNDERPERFORMED");

    assert.equal(table[2]?.agentId, "breakout");
    assert.equal(table[2]?.pnl, "FLAT 0.000000");
    assert.equal(table[2]?.vsCash, "TIED");
    assert.equal(table[2]?.vsBuyAndHold, "UNDERPERFORMED");

    assert.equal(table[3]?.agentId, "momentum");
    assert.equal(table[3]?.pnl, "LOSS 6.000000");
    assert.equal(table[3]?.vsCash, "UNDERPERFORMED");
    assert.equal(table[3]?.vsBuyAndHold, "UNDERPERFORMED");

    assert.equal(table[4]?.agentId, "volatility-filtered");
    assert.equal(table[4]?.endingEquityUsd, "121.000000");
    assert.equal(table[4]?.vsCash, "OUTPERFORMED");
    assert.equal(table[4]?.vsBuyAndHold, "OUTPERFORMED");

    assert.equal(table[5]?.agentId, "conservative-baseline");
    assert.equal(table[5]?.vsCash, "OUTPERFORMED");
    assert.equal(table[5]?.vsBuyAndHold, "UNDERPERFORMED");
  });
});
