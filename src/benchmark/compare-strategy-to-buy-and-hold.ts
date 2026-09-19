/**
 * Deterministic, auditable comparison between a strategy's equity summary and
 * the buy-and-hold benchmark from the same experiment.
 *
 * `EquitySeriesSummary da estratégia + BuyAndHoldBenchmark →
 * StrategyVsBuyAndHoldComparison`. This module only measures whether the
 * strategy ended above, below or tied with the buy-and-hold control — it
 * never executes an order, never rebuilds the benchmark and never touches a
 * wallet. It builds on {@link summarizeEquitySeries} and
 * {@link buildBuyAndHoldBenchmark}: neither equity valuation nor any P&L
 * formula is reimplemented here.
 *
 * A strategy summary is only compatible with a buy-and-hold benchmark when
 * both describe the exact same experiment: same `agentId`, `startedAt`,
 * `endedAt`, `pointCount` and starting equity (the strategy's starting equity
 * must equal the benchmark's `initialCashMicros`). Because `BuyAndHoldBenchmark`
 * is only a structural type at compile time, the benchmark's own internal
 * consistency is also verified before trusting it, reusing the same checks
 * `compareBuyAndHoldToCash` already performs on it:
 *
 * - `kind` must be `"BUY_AND_HOLD"`;
 * - the nested `summary.agentId` must match the benchmark's own `agentId`;
 * - `initialFill` must be a `BUY` whose `agentId`, `asset` and `quote` match
 *   the benchmark's own external fields;
 * - the last equity point must equal the ending equity its own summary
 *   reports.
 *
 * Any mismatch fails closed with the existing `ContractValidationError`,
 * because comparing two incompatible or forged inputs would silently
 * fabricate a result — there is no partial or best-effort comparison. The
 * result (`OUTPERFORMED`, `UNDERPERFORMED` or `TIED`) is always from the
 * strategy's perspective and comes only from the two ending equity values;
 * `differenceMagnitudeMicros` is their exact absolute difference, computed
 * with `bigint` and the existing monetary bounds from
 * `src/money/fixed-point.ts` — never a JavaScript `number`.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. Neither
 * input is mutated, and the result is frozen. No order, broker, risk gate or
 * replay is executed here.
 */

import { rejectContract } from "../domain/errors.js";
import { MAX_MICROS, subtractChecked, type Micros } from "../money/fixed-point.js";
import type { EquitySeriesSummary } from "../metrics/summarize-equity-series.js";
import type { BuyAndHoldBenchmark } from "./build-buy-and-hold-benchmark.js";

const STRATEGY_VS_BUY_AND_HOLD_COMPARISON = "StrategyVsBuyAndHoldComparison";

/** How the strategy's ending equity compares to the buy-and-hold benchmark's. */
export type StrategyVsBuyAndHoldResult = "OUTPERFORMED" | "UNDERPERFORMED" | "TIED";

/**
 * An immutable, auditable comparison between a strategy and the buy-and-hold
 * benchmark of the same experiment, always from the strategy's perspective.
 */
export interface StrategyVsBuyAndHoldComparison {
  readonly comparisonKind: "STRATEGY_VS_BUY_AND_HOLD";
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly strategyEndingEquityMicros: Micros;
  readonly buyAndHoldEndingEquityMicros: Micros;
  readonly result: StrategyVsBuyAndHoldResult;
  /** Exact absolute difference between the two ending equities. Zero when `TIED`. */
  readonly differenceMagnitudeMicros: Micros;
}

/**
 * Validates that a value is an in-range, non-negative equity amount, the same
 * check `compareBuyAndHoldToCash` performs — repeated here because
 * `EquitySeriesSummary` and `BuyAndHoldBenchmark` are only structural types at
 * compile time, so nothing stops a caller from constructing one with a forged
 * monetary field.
 */
function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") {
    rejectContract(STRATEGY_VS_BUY_AND_HOLD_COMPARISON, field, "must be a bigint");
  }
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(STRATEGY_VS_BUY_AND_HOLD_COMPARISON, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/**
 * Compares a strategy's `EquitySeriesSummary` to a `BuyAndHoldBenchmark` from
 * the same experiment, always from the strategy's perspective.
 *
 * Rejects fail-closed, before any comparison, when either input carries a
 * monetary field that is not a `bigint` in `[0, MAX_MICROS]`, when the
 * `buyAndHoldBenchmark` itself is internally inconsistent (forged `kind`, a
 * nested `summary.agentId` that disagrees with its own `agentId`, an
 * `initialFill` that is not a `BUY` matching its own
 * `agentId`/`asset`/`quote`, or a last equity point that disagrees with its
 * own summary's ending equity), or when the two inputs are not compatible:
 * different `agentId`, `startedAt`, `endedAt`, `pointCount`, or a strategy
 * starting equity that does not equal the benchmark's `initialCashMicros`.
 */
export function compareStrategyToBuyAndHold(
  strategySummary: EquitySeriesSummary,
  buyAndHoldBenchmark: BuyAndHoldBenchmark
): StrategyVsBuyAndHoldComparison {
  const buyAndHoldSummary = buyAndHoldBenchmark.summary;

  const strategyStartingEquityMicros = assertValidMicros(
    strategySummary.startingEquityMicros,
    "strategySummary.startingEquityMicros"
  );
  const strategyEndingEquityMicros = assertValidMicros(
    strategySummary.endingEquityMicros,
    "strategySummary.endingEquityMicros"
  );
  const initialCashMicros = assertValidMicros(
    buyAndHoldBenchmark.initialCashMicros,
    "buyAndHoldBenchmark.initialCashMicros"
  );
  const buyAndHoldEndingEquityMicros = assertValidMicros(
    buyAndHoldSummary.endingEquityMicros,
    "buyAndHoldBenchmark.summary.endingEquityMicros"
  );

  const lastPoint = buyAndHoldBenchmark.points[buyAndHoldBenchmark.points.length - 1];
  if (lastPoint === undefined) {
    rejectContract(STRATEGY_VS_BUY_AND_HOLD_COMPARISON, "buyAndHoldBenchmark.points", "must not be empty");
  }
  const buyAndHoldLastPointEquityMicros = assertValidMicros(
    lastPoint.equityMicros,
    "buyAndHoldBenchmark.points[last].equityMicros"
  );

  if (buyAndHoldBenchmark.kind !== "BUY_AND_HOLD") {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.kind",
      'must be "BUY_AND_HOLD"'
    );
  }
  if (buyAndHoldSummary.agentId !== buyAndHoldBenchmark.agentId) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.summary.agentId",
      "must match the buy-and-hold benchmark's agentId"
    );
  }

  const initialFill = buyAndHoldBenchmark.initialFill;
  if (initialFill.side !== "BUY") {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.initialFill.side",
      'must be "BUY"'
    );
  }
  if (initialFill.agentId !== buyAndHoldBenchmark.agentId) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.initialFill.agentId",
      "must match the buy-and-hold benchmark's agentId"
    );
  }
  if (initialFill.asset !== buyAndHoldBenchmark.asset) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.initialFill.asset",
      "must match the buy-and-hold benchmark's asset"
    );
  }
  if (initialFill.quote !== buyAndHoldBenchmark.quote) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.initialFill.quote",
      "must match the buy-and-hold benchmark's quote"
    );
  }
  if (buyAndHoldLastPointEquityMicros !== buyAndHoldEndingEquityMicros) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "buyAndHoldBenchmark.points[last].equityMicros",
      "must equal the buy-and-hold benchmark's summary.endingEquityMicros"
    );
  }

  if (strategySummary.agentId !== buyAndHoldBenchmark.agentId) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "agentId",
      "must match the buy-and-hold benchmark's agentId"
    );
  }
  if (strategySummary.startedAt !== buyAndHoldSummary.startedAt) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "startedAt",
      "must match the buy-and-hold benchmark's startedAt"
    );
  }
  if (strategySummary.endedAt !== buyAndHoldSummary.endedAt) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "endedAt",
      "must match the buy-and-hold benchmark's endedAt"
    );
  }
  if (strategySummary.pointCount !== buyAndHoldSummary.pointCount) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "pointCount",
      "must match the buy-and-hold benchmark's pointCount"
    );
  }
  if (strategyStartingEquityMicros !== initialCashMicros) {
    rejectContract(
      STRATEGY_VS_BUY_AND_HOLD_COMPARISON,
      "strategySummary.startingEquityMicros",
      "must match the buy-and-hold benchmark's initialCashMicros"
    );
  }

  let result: StrategyVsBuyAndHoldResult;
  let differenceMagnitudeMicros: Micros;
  if (strategyEndingEquityMicros > buyAndHoldEndingEquityMicros) {
    result = "OUTPERFORMED";
    differenceMagnitudeMicros = subtractChecked(
      strategyEndingEquityMicros,
      buyAndHoldEndingEquityMicros,
      "differenceMagnitudeMicros"
    );
  } else if (strategyEndingEquityMicros < buyAndHoldEndingEquityMicros) {
    result = "UNDERPERFORMED";
    differenceMagnitudeMicros = subtractChecked(
      buyAndHoldEndingEquityMicros,
      strategyEndingEquityMicros,
      "differenceMagnitudeMicros"
    );
  } else {
    result = "TIED";
    differenceMagnitudeMicros = 0n;
  }

  return Object.freeze({
    comparisonKind: "STRATEGY_VS_BUY_AND_HOLD" as const,
    agentId: strategySummary.agentId,
    startedAt: strategySummary.startedAt,
    endedAt: strategySummary.endedAt,
    pointCount: strategySummary.pointCount,
    strategyEndingEquityMicros,
    buyAndHoldEndingEquityMicros,
    result,
    differenceMagnitudeMicros
  });
}
