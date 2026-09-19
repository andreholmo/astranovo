/**
 * Deterministic, auditable consolidation of a strategy's three existing
 * benchmark comparisons into a single immutable triangular report.
 *
 * `EquitySeriesSummary da estratégia + CashBenchmark + BuyAndHoldBenchmark →
 * StrategyBenchmarkReport`. This module composes {@link compareToCashBenchmark},
 * {@link compareStrategyToBuyAndHold} and {@link compareBuyAndHoldToCash} — the
 * three pairwise comparisons among the strategy, the cash benchmark and the
 * buy-and-hold benchmark — it never recomputes equity, P&L, drawdown or
 * comparison direction, and it never rebuilds any benchmark. All three
 * comparison functions are the only source of truth for their own result:
 * this module trusts their exact `Micros` values and comparison directions
 * verbatim, into the report, without touching them.
 *
 * All fail-closed compatibility and internal-consistency checks — same
 * `agentId`, `startedAt`, `endedAt`, `pointCount` and starting equity between
 * the strategy summary and each benchmark, plus each benchmark's own
 * structural consistency (forged `kind`, mismatched nested `summary.agentId`,
 * etc.) — are inherited entirely from the three comparison calls; nothing
 * here duplicates a rule or a monetary formula. Because
 * `compareToCashBenchmark` and `compareStrategyToBuyAndHold` independently
 * require the strategy summary's `agentId`/`startedAt`/`endedAt`/`pointCount`/
 * `startingEquityMicros` to match their own benchmark, calling both
 * transitively guarantees the cash and buy-and-hold benchmarks agree with
 * each other on that same common experiment identification;
 * `compareBuyAndHoldToCash` is still called directly on the two benchmarks
 * because it also verifies an invariant neither of the other two calls
 * checks — that the cash benchmark's ending equity equals its own
 * `initialCashMicros` — so no extra cross-check is duplicated by hand here.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. None of
 * the three inputs is mutated, and the result is frozen.
 */

import { compareToCashBenchmark, type BenchmarkComparison } from "./compare-to-cash-benchmark.js";
import {
  compareStrategyToBuyAndHold,
  type StrategyVsBuyAndHoldComparison
} from "./compare-strategy-to-buy-and-hold.js";
import {
  compareBuyAndHoldToCash,
  type BuyAndHoldVsCashComparison
} from "./compare-buy-and-hold-to-cash.js";
import type { CashBenchmark } from "./build-cash-benchmark.js";
import type { BuyAndHoldBenchmark } from "./build-buy-and-hold-benchmark.js";
import type { EquitySeriesSummary } from "../metrics/summarize-equity-series.js";
import type { Micros } from "../money/fixed-point.js";

/**
 * An immutable, auditable report consolidating the three pairwise comparisons
 * among a strategy's `EquitySeriesSummary`, the cash benchmark and the
 * buy-and-hold benchmark of the same experiment.
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
  /** Produced verbatim by `compareBuyAndHoldToCash`. */
  readonly buyAndHoldVsCash: BuyAndHoldVsCashComparison;
}

/**
 * Consolidates a strategy's `EquitySeriesSummary` against a `CashBenchmark`
 * and a `BuyAndHoldBenchmark` from the same experiment into a single
 * immutable triangular report — the three pairwise comparisons among the
 * strategy, cash and buy-and-hold.
 *
 * Rejects fail-closed, before returning any report, whenever
 * `compareToCashBenchmark`, `compareStrategyToBuyAndHold` or
 * `compareBuyAndHoldToCash` reject their own inputs — an incompatible
 * experiment, a forged benchmark, or an out-of-range monetary value. No
 * order, broker, risk gate or replay is executed here, and no benchmark is
 * rebuilt.
 */
export function buildStrategyBenchmarkReport(
  strategySummary: EquitySeriesSummary,
  cashBenchmark: CashBenchmark,
  buyAndHoldBenchmark: BuyAndHoldBenchmark
): StrategyBenchmarkReport {
  const vsCash = compareToCashBenchmark(strategySummary, cashBenchmark);
  const vsBuyAndHold = compareStrategyToBuyAndHold(strategySummary, buyAndHoldBenchmark);
  const buyAndHoldVsCash = compareBuyAndHoldToCash(buyAndHoldBenchmark, cashBenchmark);

  return Object.freeze({
    reportKind: "STRATEGY_BENCHMARK_REPORT" as const,
    agentId: vsCash.agentId,
    startedAt: vsCash.startedAt,
    endedAt: vsCash.endedAt,
    pointCount: vsCash.pointCount,
    startingEquityMicros: strategySummary.startingEquityMicros,
    strategyEndingEquityMicros: vsCash.strategyEndingEquityMicros,
    vsCash,
    vsBuyAndHold,
    buyAndHoldVsCash
  });
}
