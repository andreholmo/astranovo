/**
 * Deterministic, auditable consolidation of a strategy's two existing
 * benchmark comparisons into a single immutable report.
 *
 * `EquitySeriesSummary da estratégia + CashBenchmark + BuyAndHoldBenchmark →
 * StrategyBenchmarkReport`. This module composes {@link compareToCashBenchmark}
 * and {@link compareStrategyToBuyAndHold} — it never recomputes equity, P&L,
 * drawdown or comparison direction, and it never rebuilds either benchmark.
 * Both comparison functions are the only source of truth for their own
 * result: this module trusts their exact `Micros` values and comparison
 * directions verbatim, into the report, without touching them.
 *
 * All fail-closed compatibility and internal-consistency checks — same
 * `agentId`, `startedAt`, `endedAt`, `pointCount` and starting equity between
 * the strategy summary and each benchmark, plus each benchmark's own
 * structural consistency (forged `kind`, mismatched nested `summary.agentId`,
 * etc.) — are inherited entirely from the two comparison calls; nothing here
 * duplicates a rule or a monetary formula. Because both comparisons
 * independently require the strategy summary's `agentId`/`startedAt`/
 * `endedAt`/`pointCount`/`startingEquityMicros` to match their own benchmark,
 * calling both transitively guarantees the cash and buy-and-hold benchmarks
 * agree with each other on that same common experiment identification — no
 * extra cross-check between the two benchmarks is needed or added.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. None of
 * the three inputs is mutated, and the result is frozen.
 */

import { compareToCashBenchmark, type BenchmarkComparison } from "./compare-to-cash-benchmark.js";
import {
  compareStrategyToBuyAndHold,
  type StrategyVsBuyAndHoldComparison
} from "./compare-strategy-to-buy-and-hold.js";
import type { CashBenchmark } from "./build-cash-benchmark.js";
import type { BuyAndHoldBenchmark } from "./build-buy-and-hold-benchmark.js";
import type { EquitySeriesSummary } from "../metrics/summarize-equity-series.js";
import type { Micros } from "../money/fixed-point.js";

/**
 * An immutable, auditable report consolidating a strategy's `EquitySeriesSummary`
 * against both the cash and buy-and-hold benchmarks of the same experiment.
 */
export interface StrategyBenchmarkReport {
  readonly reportKind: "STRATEGY_BENCHMARK_REPORT";
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly startingEquityMicros: Micros;
  readonly strategyEndingEquityMicros: Micros;
  /** Produced verbatim by `compareToCashBenchmark`. */
  readonly vsCash: BenchmarkComparison;
  /** Produced verbatim by `compareStrategyToBuyAndHold`. */
  readonly vsBuyAndHold: StrategyVsBuyAndHoldComparison;
}

/**
 * Consolidates a strategy's `EquitySeriesSummary` against a `CashBenchmark`
 * and a `BuyAndHoldBenchmark` from the same experiment into a single
 * immutable report.
 *
 * Rejects fail-closed, before returning any report, whenever
 * `compareToCashBenchmark` or `compareStrategyToBuyAndHold` reject their own
 * inputs — an incompatible experiment, a forged benchmark, or an out-of-range
 * monetary value. No order, broker, risk gate or replay is executed here, and
 * neither benchmark is rebuilt.
 */
export function buildStrategyBenchmarkReport(
  strategySummary: EquitySeriesSummary,
  cashBenchmark: CashBenchmark,
  buyAndHoldBenchmark: BuyAndHoldBenchmark
): StrategyBenchmarkReport {
  const vsCash = compareToCashBenchmark(strategySummary, cashBenchmark);
  const vsBuyAndHold = compareStrategyToBuyAndHold(strategySummary, buyAndHoldBenchmark);

  return Object.freeze({
    reportKind: "STRATEGY_BENCHMARK_REPORT" as const,
    agentId: vsCash.agentId,
    startedAt: vsCash.startedAt,
    endedAt: vsCash.endedAt,
    pointCount: vsCash.pointCount,
    startingEquityMicros: strategySummary.startingEquityMicros,
    strategyEndingEquityMicros: vsCash.strategyEndingEquityMicros,
    vsCash,
    vsBuyAndHold
  });
}
