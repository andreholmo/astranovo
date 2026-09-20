/**
 * Deterministic, auditable consolidation of several agents' already-computed
 * paper results into one offline, comparable multi-agent report.
 *
 * `(EquitySeriesSummary + RealizedPerformanceSummary + ExecutionCostSummary +
 * StrategyBenchmarkReport) por agente → MultiAgentPerformanceReport`. This
 * module composes four existing summaries per agent into one row; it never
 * recomputes P&L, drawdown, win rate, fees, execution impact or benchmark
 * comparisons — every value in a row is carried verbatim from the summary
 * that already produced it, the same way `buildStrategyBenchmarkReport`
 * (`src/benchmark/build-strategy-benchmark-report.ts`) composes its own three
 * inputs without touching their fields.
 *
 * The number of agents is configuration, never code (D-006): nothing here
 * knows or assumes any particular roster size — `buildMultiAgentPerformanceReport`
 * accepts any non-empty list of entries. Because the four summaries of one
 * entry, and the nested comparisons inside `StrategyBenchmarkReport`, are only
 * structural types at compile time, nothing stops a caller from constructing
 * one with a forged field — the same situation every module under
 * `src/metrics/` and `src/benchmark/` already documents and defends against.
 * This module therefore revalidates, fail-closed, that all four summaries of
 * an entry agree on the same `agentId` and describe the same experiment
 * window (`startedAt`/`endedAt`/`pointCount`), that every agent across the
 * whole list shares that same window, that the win-rate fraction and closed
 * trade count are coherent non-negative safe integers (including that
 * `winCount` matches `winRateNumerator` and that `winCount + lossCount +
 * breakEvenCount` matches `closedTradeCount`), that `pnlDirection` and
 * `pnlMagnitudeMicros` match the sign and exact difference between starting
 * and ending equity, that each benchmark comparison's own
 * `strategyEndingEquityMicros` matches `equity.endingEquityMicros` and that
 * its `result`/`differenceMagnitudeMicros` match the sign and exact
 * difference of the two equities it compares, and that every consumed
 * monetary amount is a `bigint` in range — without duplicating any of the
 * formulas that produced them.
 *
 * Entries are never reordered or ranked: `rows` preserves exactly the order
 * `entries` was supplied in, with no winner, recommendation or sort by any
 * metric. Nothing here reads the clock, generates randomness or performs I/O.
 * Neither `entries` nor any entry's own summaries are mutated.
 */

import { rejectContract } from "../domain/errors.js";
import { MAX_MICROS, subtractChecked, type Micros } from "../money/fixed-point.js";
import type { EquitySeriesSummary, PnlDirection } from "./summarize-equity-series.js";
import type { RealizedPerformanceSummary } from "./summarize-realized-performance.js";
import type { ExecutionCostSummary } from "./summarize-execution-costs.js";
import type { BenchmarkComparison, BenchmarkComparisonResult } from "../benchmark/compare-to-cash-benchmark.js";
import type {
  StrategyVsBuyAndHoldComparison,
  StrategyVsBuyAndHoldResult
} from "../benchmark/compare-strategy-to-buy-and-hold.js";
import type { StrategyBenchmarkReport } from "../benchmark/build-strategy-benchmark-report.js";

const MULTI_AGENT_PERFORMANCE_REPORT = "MultiAgentPerformanceReport";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Duplicated from the private check in `src/domain/contracts.ts` (not
 * exported there) and from the identical duplicates already registered
 * throughout `src/metrics/`, `src/benchmark/` and `src/risk/` — this task's
 * scope is limited to creating `src/metrics/build-multi-agent-performance-report.ts`.
 */
function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function assertCanonicalTimestamp(value: unknown, field: string): string {
  if (!isCanonicalTimestamp(value)) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      field,
      "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z"
    );
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, "must be a non-empty string");
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, "must be a non-negative safe integer");
  }
  return value;
}

/** Validates that a value is an in-range, non-negative monetary amount. */
function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, "must be a bigint");
  }
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

function assertPnlDirection(value: unknown, field: string): PnlDirection {
  if (value !== "GAIN" && value !== "LOSS" && value !== "FLAT") {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, 'must be "GAIN", "LOSS" or "FLAT"');
  }
  return value;
}

function assertBenchmarkComparisonResult(value: unknown, field: string): BenchmarkComparisonResult {
  if (value !== "OUTPERFORMED" && value !== "UNDERPERFORMED" && value !== "TIED") {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, 'must be "OUTPERFORMED", "UNDERPERFORMED" or "TIED"');
  }
  return value;
}

function assertStrategyVsBuyAndHoldResult(value: unknown, field: string): StrategyVsBuyAndHoldResult {
  if (value !== "OUTPERFORMED" && value !== "UNDERPERFORMED" && value !== "TIED") {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, field, 'must be "OUTPERFORMED", "UNDERPERFORMED" or "TIED"');
  }
  return value;
}

/** One agent's already-computed paper results, reused without recomputation. */
export interface MultiAgentPerformanceEntry {
  readonly equity: EquitySeriesSummary;
  readonly realized: RealizedPerformanceSummary;
  readonly costs: ExecutionCostSummary;
  readonly benchmark: StrategyBenchmarkReport;
}

/**
 * One agent's row in the consolidated report. Every field is carried
 * verbatim from the matching `MultiAgentPerformanceEntry`; nothing here is
 * ranked, scored or recomputed.
 */
export interface MultiAgentPerformanceRow {
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly startingEquityMicros: Micros;
  readonly endingEquityMicros: Micros;
  readonly pnlDirection: PnlDirection;
  readonly pnlMagnitudeMicros: Micros;
  readonly maxDrawdownMicros: Micros;
  readonly closedTradeCount: number;
  readonly winRateNumerator: number;
  readonly winRateDenominator: number;
  readonly totalFeeMicros: Micros;
  readonly totalExecutionImpactMicros: Micros;
  readonly vsCash: BenchmarkComparison;
  readonly vsBuyAndHold: StrategyVsBuyAndHoldComparison;
}

/**
 * An immutable, auditable multi-agent report: one row per agent, in the exact
 * order `entries` was supplied, with no ranking, winner or recommendation.
 */
export interface MultiAgentPerformanceReport {
  readonly reportKind: "MULTI_AGENT_PERFORMANCE_REPORT";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly agentCount: number;
  readonly rows: readonly MultiAgentPerformanceRow[];
}

function buildRow(entry: MultiAgentPerformanceEntry, index: number): MultiAgentPerformanceRow {
  const path = `entries[${index}]`;
  const { equity, realized, costs, benchmark } = entry;

  const agentId = assertNonEmptyString(equity.agentId, `${path}.equity.agentId`);
  if (realized.agentId !== agentId) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.realized.agentId`, "must match equity.agentId");
  }
  if (costs.agentId !== agentId) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.costs.agentId`, "must match equity.agentId");
  }
  if (benchmark.agentId !== agentId) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.benchmark.agentId`, "must match equity.agentId");
  }
  if (benchmark.reportKind !== "STRATEGY_BENCHMARK_REPORT") {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.reportKind`,
      'must be "STRATEGY_BENCHMARK_REPORT"'
    );
  }

  const startedAt = assertCanonicalTimestamp(equity.startedAt, `${path}.equity.startedAt`);
  const endedAt = assertCanonicalTimestamp(equity.endedAt, `${path}.equity.endedAt`);
  const pointCount = assertNonNegativeInteger(equity.pointCount, `${path}.equity.pointCount`);

  if (benchmark.startedAt !== startedAt) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.benchmark.startedAt`, "must match equity.startedAt");
  }
  if (benchmark.endedAt !== endedAt) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.benchmark.endedAt`, "must match equity.endedAt");
  }
  if (benchmark.pointCount !== pointCount) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.benchmark.pointCount`, "must match equity.pointCount");
  }

  const startingEquityMicros = assertValidMicros(equity.startingEquityMicros, `${path}.equity.startingEquityMicros`);
  const endingEquityMicros = assertValidMicros(equity.endingEquityMicros, `${path}.equity.endingEquityMicros`);
  const pnlDirection = assertPnlDirection(equity.pnlDirection, `${path}.equity.pnlDirection`);
  const pnlMagnitudeMicros = assertValidMicros(equity.pnlMagnitudeMicros, `${path}.equity.pnlMagnitudeMicros`);
  const maxDrawdownMicros = assertValidMicros(equity.maxDrawdownMicros, `${path}.equity.maxDrawdownMicros`);

  let expectedPnlDirection: PnlDirection;
  let expectedPnlMagnitudeMicros: Micros;
  if (endingEquityMicros > startingEquityMicros) {
    expectedPnlDirection = "GAIN";
    expectedPnlMagnitudeMicros = subtractChecked(
      endingEquityMicros,
      startingEquityMicros,
      `${path}.equity.pnlMagnitudeMicros`
    );
  } else if (endingEquityMicros < startingEquityMicros) {
    expectedPnlDirection = "LOSS";
    expectedPnlMagnitudeMicros = subtractChecked(
      startingEquityMicros,
      endingEquityMicros,
      `${path}.equity.pnlMagnitudeMicros`
    );
  } else {
    expectedPnlDirection = "FLAT";
    expectedPnlMagnitudeMicros = 0n;
  }
  if (pnlDirection !== expectedPnlDirection) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.equity.pnlDirection`,
      "must match the sign of endingEquityMicros - startingEquityMicros"
    );
  }
  if (pnlMagnitudeMicros !== expectedPnlMagnitudeMicros) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.equity.pnlMagnitudeMicros`,
      "must equal the exact difference between startingEquityMicros and endingEquityMicros"
    );
  }

  const closedTradeCount = assertNonNegativeInteger(
    realized.closedTradeCount,
    `${path}.realized.closedTradeCount`
  );
  const winCount = assertNonNegativeInteger(realized.winCount, `${path}.realized.winCount`);
  const lossCount = assertNonNegativeInteger(realized.lossCount, `${path}.realized.lossCount`);
  const breakEvenCount = assertNonNegativeInteger(realized.breakEvenCount, `${path}.realized.breakEvenCount`);
  const winRateNumerator = assertNonNegativeInteger(realized.winRateNumerator, `${path}.realized.winRateNumerator`);
  const winRateDenominator = assertNonNegativeInteger(
    realized.winRateDenominator,
    `${path}.realized.winRateDenominator`
  );
  if (winRateDenominator !== closedTradeCount) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.realized.winRateDenominator`,
      "must equal realized.closedTradeCount"
    );
  }
  if (winRateNumerator > winRateDenominator) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.realized.winRateNumerator`,
      "must not exceed realized.winRateDenominator"
    );
  }
  if (winCount !== winRateNumerator) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.realized.winCount`,
      "must equal realized.winRateNumerator"
    );
  }
  if (winCount + lossCount + breakEvenCount !== closedTradeCount) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.realized.winCount`,
      "sum of winCount, lossCount and breakEvenCount must equal realized.closedTradeCount"
    );
  }

  const totalFeeMicros = assertValidMicros(costs.totalFeeMicros, `${path}.costs.totalFeeMicros`);
  const totalExecutionImpactMicros = assertValidMicros(
    costs.totalExecutionImpactMicros,
    `${path}.costs.totalExecutionImpactMicros`
  );

  const vsCash = benchmark.vsCash;
  if (vsCash.benchmarkKind !== "CASH") {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.benchmark.vsCash.benchmarkKind`, 'must be "CASH"');
  }
  if (vsCash.agentId !== agentId) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, `${path}.benchmark.vsCash.agentId`, "must match equity.agentId");
  }
  if (vsCash.startedAt !== startedAt || vsCash.endedAt !== endedAt || vsCash.pointCount !== pointCount) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsCash`,
      "must describe the same experiment window as equity"
    );
  }
  const vsCashStrategyEndingEquityMicros = assertValidMicros(
    vsCash.strategyEndingEquityMicros,
    `${path}.benchmark.vsCash.strategyEndingEquityMicros`
  );
  if (vsCashStrategyEndingEquityMicros !== endingEquityMicros) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsCash.strategyEndingEquityMicros`,
      "must equal equity.endingEquityMicros"
    );
  }
  const vsCashBenchmarkEndingEquityMicros = assertValidMicros(
    vsCash.benchmarkEndingEquityMicros,
    `${path}.benchmark.vsCash.benchmarkEndingEquityMicros`
  );
  const vsCashDifferenceMagnitudeMicros = assertValidMicros(
    vsCash.differenceMagnitudeMicros,
    `${path}.benchmark.vsCash.differenceMagnitudeMicros`
  );
  const vsCashResult = assertBenchmarkComparisonResult(vsCash.result, `${path}.benchmark.vsCash.result`);

  let expectedVsCashResult: BenchmarkComparisonResult;
  let expectedVsCashDifferenceMagnitudeMicros: Micros;
  if (vsCashStrategyEndingEquityMicros > vsCashBenchmarkEndingEquityMicros) {
    expectedVsCashResult = "OUTPERFORMED";
    expectedVsCashDifferenceMagnitudeMicros = subtractChecked(
      vsCashStrategyEndingEquityMicros,
      vsCashBenchmarkEndingEquityMicros,
      `${path}.benchmark.vsCash.differenceMagnitudeMicros`
    );
  } else if (vsCashStrategyEndingEquityMicros < vsCashBenchmarkEndingEquityMicros) {
    expectedVsCashResult = "UNDERPERFORMED";
    expectedVsCashDifferenceMagnitudeMicros = subtractChecked(
      vsCashBenchmarkEndingEquityMicros,
      vsCashStrategyEndingEquityMicros,
      `${path}.benchmark.vsCash.differenceMagnitudeMicros`
    );
  } else {
    expectedVsCashResult = "TIED";
    expectedVsCashDifferenceMagnitudeMicros = 0n;
  }
  if (vsCashResult !== expectedVsCashResult) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsCash.result`,
      "must match the sign of strategyEndingEquityMicros - benchmarkEndingEquityMicros"
    );
  }
  if (vsCashDifferenceMagnitudeMicros !== expectedVsCashDifferenceMagnitudeMicros) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsCash.differenceMagnitudeMicros`,
      "must equal the exact difference between strategyEndingEquityMicros and benchmarkEndingEquityMicros"
    );
  }

  const vsBuyAndHold = benchmark.vsBuyAndHold;
  if (vsBuyAndHold.comparisonKind !== "STRATEGY_VS_BUY_AND_HOLD") {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsBuyAndHold.comparisonKind`,
      'must be "STRATEGY_VS_BUY_AND_HOLD"'
    );
  }
  if (vsBuyAndHold.agentId !== agentId) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsBuyAndHold.agentId`,
      "must match equity.agentId"
    );
  }
  if (
    vsBuyAndHold.startedAt !== startedAt ||
    vsBuyAndHold.endedAt !== endedAt ||
    vsBuyAndHold.pointCount !== pointCount
  ) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsBuyAndHold`,
      "must describe the same experiment window as equity"
    );
  }
  const vsBuyAndHoldStrategyEndingEquityMicros = assertValidMicros(
    vsBuyAndHold.strategyEndingEquityMicros,
    `${path}.benchmark.vsBuyAndHold.strategyEndingEquityMicros`
  );
  if (vsBuyAndHoldStrategyEndingEquityMicros !== endingEquityMicros) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsBuyAndHold.strategyEndingEquityMicros`,
      "must equal equity.endingEquityMicros"
    );
  }
  const vsBuyAndHoldBuyAndHoldEndingEquityMicros = assertValidMicros(
    vsBuyAndHold.buyAndHoldEndingEquityMicros,
    `${path}.benchmark.vsBuyAndHold.buyAndHoldEndingEquityMicros`
  );
  const vsBuyAndHoldDifferenceMagnitudeMicros = assertValidMicros(
    vsBuyAndHold.differenceMagnitudeMicros,
    `${path}.benchmark.vsBuyAndHold.differenceMagnitudeMicros`
  );
  const vsBuyAndHoldResult = assertStrategyVsBuyAndHoldResult(
    vsBuyAndHold.result,
    `${path}.benchmark.vsBuyAndHold.result`
  );

  let expectedVsBuyAndHoldResult: StrategyVsBuyAndHoldResult;
  let expectedVsBuyAndHoldDifferenceMagnitudeMicros: Micros;
  if (vsBuyAndHoldStrategyEndingEquityMicros > vsBuyAndHoldBuyAndHoldEndingEquityMicros) {
    expectedVsBuyAndHoldResult = "OUTPERFORMED";
    expectedVsBuyAndHoldDifferenceMagnitudeMicros = subtractChecked(
      vsBuyAndHoldStrategyEndingEquityMicros,
      vsBuyAndHoldBuyAndHoldEndingEquityMicros,
      `${path}.benchmark.vsBuyAndHold.differenceMagnitudeMicros`
    );
  } else if (vsBuyAndHoldStrategyEndingEquityMicros < vsBuyAndHoldBuyAndHoldEndingEquityMicros) {
    expectedVsBuyAndHoldResult = "UNDERPERFORMED";
    expectedVsBuyAndHoldDifferenceMagnitudeMicros = subtractChecked(
      vsBuyAndHoldBuyAndHoldEndingEquityMicros,
      vsBuyAndHoldStrategyEndingEquityMicros,
      `${path}.benchmark.vsBuyAndHold.differenceMagnitudeMicros`
    );
  } else {
    expectedVsBuyAndHoldResult = "TIED";
    expectedVsBuyAndHoldDifferenceMagnitudeMicros = 0n;
  }
  if (vsBuyAndHoldResult !== expectedVsBuyAndHoldResult) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsBuyAndHold.result`,
      "must match the sign of strategyEndingEquityMicros - buyAndHoldEndingEquityMicros"
    );
  }
  if (vsBuyAndHoldDifferenceMagnitudeMicros !== expectedVsBuyAndHoldDifferenceMagnitudeMicros) {
    rejectContract(
      MULTI_AGENT_PERFORMANCE_REPORT,
      `${path}.benchmark.vsBuyAndHold.differenceMagnitudeMicros`,
      "must equal the exact difference between strategyEndingEquityMicros and buyAndHoldEndingEquityMicros"
    );
  }

  return Object.freeze({
    agentId,
    startedAt,
    endedAt,
    pointCount,
    startingEquityMicros,
    endingEquityMicros,
    pnlDirection,
    pnlMagnitudeMicros,
    maxDrawdownMicros,
    closedTradeCount,
    winRateNumerator,
    winRateDenominator,
    totalFeeMicros,
    totalExecutionImpactMicros,
    vsCash,
    vsBuyAndHold
  });
}

/**
 * Consolidates several agents' already-computed paper summaries into one
 * immutable, deterministic multi-agent report — one row per agent, in entry
 * order, with no ranking.
 *
 * Accepts any non-empty `entries` list; the roster size is never hard-coded.
 * Rejects fail-closed, before returning any report: an empty or non-array
 * `entries`; a duplicate `agentId`; an entry whose four summaries disagree on
 * `agentId`; an experiment window (`startedAt`/`endedAt`/`pointCount`) that
 * disagrees between an entry's own summaries or across different agents; an
 * incoherent win-rate fraction or count (including `winCount`/`lossCount`/
 * `breakEvenCount` disagreeing with `winRateNumerator` or
 * `closedTradeCount`); a `pnlDirection`/`pnlMagnitudeMicros` that disagrees
 * with the starting/ending equity; a benchmark comparison whose
 * `strategyEndingEquityMicros` disagrees with `equity.endingEquityMicros` or
 * whose `result`/`differenceMagnitudeMicros` disagrees with the two equities
 * it compares; a non-safe-integer count; and any consumed monetary field that
 * is not a `bigint` in `[0, MAX_MICROS]`. No P&L, drawdown, cost, win rate or
 * benchmark comparison is recomputed — every value is carried verbatim from
 * the summary that already computed it.
 */
export function buildMultiAgentPerformanceReport(
  entries: readonly MultiAgentPerformanceEntry[]
): MultiAgentPerformanceReport {
  if (!Array.isArray(entries) || entries.length === 0) {
    rejectContract(MULTI_AGENT_PERFORMANCE_REPORT, "entries", "must be a non-empty array");
  }

  const rows: MultiAgentPerformanceRow[] = [];
  const seenAgentIds = new Set<string>();
  let sharedStartedAt: string | undefined;
  let sharedEndedAt: string | undefined;
  let sharedPointCount: number | undefined;

  entries.forEach((entry, index) => {
    const row = buildRow(entry, index);

    if (seenAgentIds.has(row.agentId)) {
      rejectContract(
        MULTI_AGENT_PERFORMANCE_REPORT,
        `entries[${index}].equity.agentId`,
        "must not repeat another entry's agentId"
      );
    }
    seenAgentIds.add(row.agentId);

    if (sharedStartedAt === undefined || sharedEndedAt === undefined || sharedPointCount === undefined) {
      sharedStartedAt = row.startedAt;
      sharedEndedAt = row.endedAt;
      sharedPointCount = row.pointCount;
    } else {
      if (row.startedAt !== sharedStartedAt) {
        rejectContract(
          MULTI_AGENT_PERFORMANCE_REPORT,
          `entries[${index}].equity.startedAt`,
          "must match every other agent's startedAt"
        );
      }
      if (row.endedAt !== sharedEndedAt) {
        rejectContract(
          MULTI_AGENT_PERFORMANCE_REPORT,
          `entries[${index}].equity.endedAt`,
          "must match every other agent's endedAt"
        );
      }
      if (row.pointCount !== sharedPointCount) {
        rejectContract(
          MULTI_AGENT_PERFORMANCE_REPORT,
          `entries[${index}].equity.pointCount`,
          "must match every other agent's pointCount"
        );
      }
    }

    rows.push(row);
  });

  return Object.freeze({
    reportKind: "MULTI_AGENT_PERFORMANCE_REPORT" as const,
    startedAt: sharedStartedAt as string,
    endedAt: sharedEndedAt as string,
    pointCount: sharedPointCount as number,
    agentCount: rows.length,
    rows: Object.freeze(rows)
  });
}
