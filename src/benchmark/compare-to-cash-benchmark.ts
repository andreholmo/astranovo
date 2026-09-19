/**
 * Deterministic, auditable comparison between a strategy's equity summary and
 * a cash benchmark from the same experiment.
 *
 * `EquitySeriesSummary da estratégia + CashBenchmark → BenchmarkComparison`.
 * This module only measures whether a strategy ended above, below or tied
 * with the cash control — it never executes a trade and never ranks agents
 * against each other. It builds on {@link summarizeEquitySeries} and
 * {@link buildCashBenchmark}: neither timestamp validation nor any P&L or
 * equity formula is reimplemented here.
 *
 * A strategy summary is only compatible with a cash benchmark when both
 * describe the exact same experiment: same `agentId`, `startedAt`, `endedAt`,
 * `pointCount` and starting equity (the strategy's starting equity must equal
 * the benchmark's `initialCashMicros`). Any mismatch fails closed with the
 * existing `ContractValidationError`, because comparing two incompatible
 * series would silently fabricate a result. The direction (`OUTPERFORMED`,
 * `UNDERPERFORMED` or `TIED`) comes only from the two ending equity values;
 * `differenceMagnitudeMicros` is their exact absolute difference, computed
 * with `bigint` and the existing monetary bounds from
 * `src/money/fixed-point.ts` — never a JavaScript `number`.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. Neither
 * input is mutated, and the result is frozen.
 */

import { rejectContract } from "../domain/errors.js";
import { MAX_MICROS, subtractChecked, type Micros } from "../money/fixed-point.js";
import type { EquitySeriesSummary } from "../metrics/summarize-equity-series.js";
import type { CashBenchmark } from "./build-cash-benchmark.js";

const BENCHMARK_COMPARISON = "BenchmarkComparison";

/** How a strategy's ending equity compares to the cash benchmark's. */
export type BenchmarkComparisonResult = "OUTPERFORMED" | "UNDERPERFORMED" | "TIED";

/** An immutable, auditable comparison between a strategy and a cash benchmark. */
export interface BenchmarkComparison {
  readonly benchmarkKind: "CASH";
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly strategyEndingEquityMicros: Micros;
  readonly benchmarkEndingEquityMicros: Micros;
  readonly result: BenchmarkComparisonResult;
  /** Exact absolute difference between the two ending equities. Zero when `TIED`. */
  readonly differenceMagnitudeMicros: Micros;
}

/**
 * Validates that a value is an in-range, non-negative equity amount, the same
 * check `summarizeEquitySeries` performs on each `EquityPoint` — repeated
 * here because `EquitySeriesSummary` and `CashBenchmark` are only structural
 * types at compile time, so nothing stops a caller from constructing one with
 * a forged monetary field.
 */
function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") {
    rejectContract(BENCHMARK_COMPARISON, field, "must be a bigint");
  }
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(BENCHMARK_COMPARISON, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/**
 * Compares a strategy's `EquitySeriesSummary` to a `CashBenchmark` from the
 * same experiment.
 *
 * Rejects fail-closed, before any comparison, when either summary carries a
 * monetary field that is not a `bigint` in `[0, MAX_MICROS]`, or when the two
 * summaries are not compatible: different `agentId`, `startedAt`, `endedAt`,
 * `pointCount`, or a strategy starting equity that does not equal the
 * benchmark's `initialCashMicros`.
 */
export function compareToCashBenchmark(
  strategySummary: EquitySeriesSummary,
  cashBenchmark: CashBenchmark
): BenchmarkComparison {
  const benchmarkSummary = cashBenchmark.summary;

  const strategyStartingEquityMicros = assertValidMicros(
    strategySummary.startingEquityMicros,
    "strategySummary.startingEquityMicros"
  );
  const strategyEndingEquityMicros = assertValidMicros(
    strategySummary.endingEquityMicros,
    "strategySummary.endingEquityMicros"
  );
  const initialCashMicros = assertValidMicros(
    cashBenchmark.initialCashMicros,
    "cashBenchmark.initialCashMicros"
  );
  const benchmarkEndingEquityMicros = assertValidMicros(
    benchmarkSummary.endingEquityMicros,
    "cashBenchmark.summary.endingEquityMicros"
  );

  if (strategySummary.agentId !== cashBenchmark.agentId) {
    rejectContract(BENCHMARK_COMPARISON, "agentId", "must match the cash benchmark's agentId");
  }
  if (strategySummary.startedAt !== benchmarkSummary.startedAt) {
    rejectContract(BENCHMARK_COMPARISON, "startedAt", "must match the cash benchmark's startedAt");
  }
  if (strategySummary.endedAt !== benchmarkSummary.endedAt) {
    rejectContract(BENCHMARK_COMPARISON, "endedAt", "must match the cash benchmark's endedAt");
  }
  if (strategySummary.pointCount !== benchmarkSummary.pointCount) {
    rejectContract(BENCHMARK_COMPARISON, "pointCount", "must match the cash benchmark's pointCount");
  }
  if (strategyStartingEquityMicros !== initialCashMicros) {
    rejectContract(
      BENCHMARK_COMPARISON,
      "strategySummary.startingEquityMicros",
      "must match the cash benchmark's initialCashMicros"
    );
  }

  let result: BenchmarkComparisonResult;
  let differenceMagnitudeMicros: Micros;
  if (strategyEndingEquityMicros > benchmarkEndingEquityMicros) {
    result = "OUTPERFORMED";
    differenceMagnitudeMicros = subtractChecked(
      strategyEndingEquityMicros,
      benchmarkEndingEquityMicros,
      "differenceMagnitudeMicros"
    );
  } else if (strategyEndingEquityMicros < benchmarkEndingEquityMicros) {
    result = "UNDERPERFORMED";
    differenceMagnitudeMicros = subtractChecked(
      benchmarkEndingEquityMicros,
      strategyEndingEquityMicros,
      "differenceMagnitudeMicros"
    );
  } else {
    result = "TIED";
    differenceMagnitudeMicros = 0n;
  }

  return Object.freeze({
    benchmarkKind: cashBenchmark.kind,
    agentId: strategySummary.agentId,
    startedAt: strategySummary.startedAt,
    endedAt: strategySummary.endedAt,
    pointCount: strategySummary.pointCount,
    strategyEndingEquityMicros,
    benchmarkEndingEquityMicros,
    result,
    differenceMagnitudeMicros
  });
}
