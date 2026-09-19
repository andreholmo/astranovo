/**
 * Deterministic, auditable comparison between the buy-and-hold benchmark and
 * the cash benchmark from the same experiment.
 *
 * `BuyAndHoldBenchmark + CashBenchmark → BuyAndHoldVsCashComparison`. This
 * module only measures whether the buy-and-hold benchmark ended above, below
 * or tied with the cash benchmark — it never executes an order, never
 * rebuilds either benchmark and never touches a wallet. It builds on
 * {@link buildBuyAndHoldBenchmark} and {@link buildCashBenchmark}: neither
 * equity valuation nor any P&L/drawdown formula is reimplemented here.
 *
 * The two benchmarks are only compatible when they describe the exact same
 * experiment: same `agentId`, and the same `startedAt`, `endedAt` and
 * `pointCount` in their summaries. Because `BuyAndHoldBenchmark` and
 * `CashBenchmark` are only structural types at compile time, each benchmark's
 * own internal consistency is also verified before trusting it:
 *
 * - `kind` must be `"BUY_AND_HOLD"` / `"CASH"`;
 * - each summary's `agentId` must match its own benchmark's external
 *   `agentId`;
 * - the cash benchmark's starting and ending equity must both equal its own
 *   `initialCashMicros` — a cash-only wallet that never trades cannot move;
 * - the buy-and-hold benchmark's `initialFill` must be a `BUY` whose
 *   `agentId`, `asset` and `quote` match the benchmark's own external fields,
 *   and its last equity point must equal the ending equity its own summary
 *   reports.
 *
 * Any mismatch fails closed with the existing `ContractValidationError`,
 * because comparing two incompatible or forged inputs would silently
 * fabricate a result — there is no partial or best-effort comparison. The
 * result (`OUTPERFORMED`, `UNDERPERFORMED` or `TIED`) is always from the
 * buy-and-hold benchmark's perspective and comes only from the two ending
 * equity values; `differenceMagnitudeMicros` is their exact absolute
 * difference, computed with `bigint` and the existing monetary bounds from
 * `src/money/fixed-point.ts` — never a JavaScript `number`.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. Neither
 * input is mutated, and the result is frozen.
 */

import { rejectContract } from "../domain/errors.js";
import { MAX_MICROS, subtractChecked, type Micros } from "../money/fixed-point.js";
import type { BuyAndHoldBenchmark } from "./build-buy-and-hold-benchmark.js";
import type { CashBenchmark } from "./build-cash-benchmark.js";

const BUY_AND_HOLD_VS_CASH_COMPARISON = "BuyAndHoldVsCashComparison";

/** How the buy-and-hold benchmark's ending equity compares to cash's. */
export type BuyAndHoldVsCashResult = "OUTPERFORMED" | "UNDERPERFORMED" | "TIED";

/**
 * An immutable, auditable comparison between the buy-and-hold benchmark and
 * the cash benchmark of the same experiment, always from the buy-and-hold
 * benchmark's perspective.
 */
export interface BuyAndHoldVsCashComparison {
  readonly comparisonKind: "BUY_AND_HOLD_VS_CASH";
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly initialCashMicros: Micros;
  readonly buyAndHoldEndingEquityMicros: Micros;
  readonly cashEndingEquityMicros: Micros;
  readonly result: BuyAndHoldVsCashResult;
  /** Exact absolute difference between the two ending equities. Zero when `TIED`. */
  readonly differenceMagnitudeMicros: Micros;
}

/**
 * Validates that a value is an in-range, non-negative equity amount, the same
 * check `compareToCashBenchmark` performs — repeated here because
 * `BuyAndHoldBenchmark` and `CashBenchmark` are only structural types at
 * compile time, so nothing stops a caller from constructing one with a forged
 * monetary field.
 */
function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") {
    rejectContract(BUY_AND_HOLD_VS_CASH_COMPARISON, field, "must be a bigint");
  }
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(BUY_AND_HOLD_VS_CASH_COMPARISON, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/**
 * Compares a `BuyAndHoldBenchmark` to a `CashBenchmark` from the same
 * experiment, always from the buy-and-hold benchmark's perspective.
 *
 * Rejects fail-closed, before any comparison, when either benchmark carries a
 * monetary field that is not a `bigint` in `[0, MAX_MICROS]`, when either
 * benchmark is internally inconsistent (forged `kind`, a nested
 * `summary.agentId` that disagrees with the benchmark's own `agentId`, a cash
 * benchmark whose starting or ending equity disagrees with its own
 * `initialCashMicros`, or a buy-and-hold benchmark whose `initialFill` is not
 * a `BUY` matching its own `agentId`/`asset`/`quote`, or whose last equity
 * point disagrees with its own summary's ending equity), or when the two
 * benchmarks are not compatible: different `agentId`, `initialCashMicros`,
 * `startedAt`, `endedAt` or `pointCount`.
 */
export function compareBuyAndHoldToCash(
  buyAndHoldBenchmark: BuyAndHoldBenchmark,
  cashBenchmark: CashBenchmark
): BuyAndHoldVsCashComparison {
  const buyAndHoldSummary = buyAndHoldBenchmark.summary;
  const cashSummary = cashBenchmark.summary;

  const buyAndHoldInitialCashMicros = assertValidMicros(
    buyAndHoldBenchmark.initialCashMicros,
    "buyAndHoldBenchmark.initialCashMicros"
  );
  const cashInitialCashMicros = assertValidMicros(
    cashBenchmark.initialCashMicros,
    "cashBenchmark.initialCashMicros"
  );
  const cashStartingEquityMicros = assertValidMicros(
    cashSummary.startingEquityMicros,
    "cashBenchmark.summary.startingEquityMicros"
  );
  const cashEndingEquityMicros = assertValidMicros(
    cashSummary.endingEquityMicros,
    "cashBenchmark.summary.endingEquityMicros"
  );
  const buyAndHoldEndingEquityMicros = assertValidMicros(
    buyAndHoldSummary.endingEquityMicros,
    "buyAndHoldBenchmark.summary.endingEquityMicros"
  );

  const lastPoint = buyAndHoldBenchmark.points[buyAndHoldBenchmark.points.length - 1];
  if (lastPoint === undefined) {
    rejectContract(BUY_AND_HOLD_VS_CASH_COMPARISON, "buyAndHoldBenchmark.points", "must not be empty");
  }
  const buyAndHoldLastPointEquityMicros = assertValidMicros(
    lastPoint.equityMicros,
    "buyAndHoldBenchmark.points[last].equityMicros"
  );

  if (buyAndHoldBenchmark.kind !== "BUY_AND_HOLD") {
    rejectContract(BUY_AND_HOLD_VS_CASH_COMPARISON, "buyAndHoldBenchmark.kind", 'must be "BUY_AND_HOLD"');
  }
  if (cashBenchmark.kind !== "CASH") {
    rejectContract(BUY_AND_HOLD_VS_CASH_COMPARISON, "cashBenchmark.kind", 'must be "CASH"');
  }

  if (buyAndHoldSummary.agentId !== buyAndHoldBenchmark.agentId) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "buyAndHoldBenchmark.summary.agentId",
      "must match the buy-and-hold benchmark's agentId"
    );
  }
  if (cashSummary.agentId !== cashBenchmark.agentId) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "cashBenchmark.summary.agentId",
      "must match the cash benchmark's agentId"
    );
  }

  if (buyAndHoldBenchmark.agentId !== cashBenchmark.agentId) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "agentId",
      "must match between the buy-and-hold and cash benchmarks"
    );
  }
  if (buyAndHoldInitialCashMicros !== cashInitialCashMicros) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "initialCashMicros",
      "must match between the buy-and-hold and cash benchmarks"
    );
  }
  if (buyAndHoldSummary.startedAt !== cashSummary.startedAt) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "startedAt",
      "must match between the buy-and-hold and cash benchmarks"
    );
  }
  if (buyAndHoldSummary.endedAt !== cashSummary.endedAt) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "endedAt",
      "must match between the buy-and-hold and cash benchmarks"
    );
  }
  if (buyAndHoldSummary.pointCount !== cashSummary.pointCount) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "pointCount",
      "must match between the buy-and-hold and cash benchmarks"
    );
  }

  if (cashStartingEquityMicros !== cashInitialCashMicros) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "cashBenchmark.summary.startingEquityMicros",
      "must equal the cash benchmark's initialCashMicros"
    );
  }
  if (cashEndingEquityMicros !== cashInitialCashMicros) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "cashBenchmark.summary.endingEquityMicros",
      "must equal the cash benchmark's initialCashMicros"
    );
  }

  const initialFill = buyAndHoldBenchmark.initialFill;
  if (initialFill.side !== "BUY") {
    rejectContract(BUY_AND_HOLD_VS_CASH_COMPARISON, "buyAndHoldBenchmark.initialFill.side", 'must be "BUY"');
  }
  if (initialFill.agentId !== buyAndHoldBenchmark.agentId) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "buyAndHoldBenchmark.initialFill.agentId",
      "must match the buy-and-hold benchmark's agentId"
    );
  }
  if (initialFill.asset !== buyAndHoldBenchmark.asset) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "buyAndHoldBenchmark.initialFill.asset",
      "must match the buy-and-hold benchmark's asset"
    );
  }
  if (initialFill.quote !== buyAndHoldBenchmark.quote) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "buyAndHoldBenchmark.initialFill.quote",
      "must match the buy-and-hold benchmark's quote"
    );
  }
  if (buyAndHoldLastPointEquityMicros !== buyAndHoldEndingEquityMicros) {
    rejectContract(
      BUY_AND_HOLD_VS_CASH_COMPARISON,
      "buyAndHoldBenchmark.points[last].equityMicros",
      "must equal the buy-and-hold benchmark's summary.endingEquityMicros"
    );
  }

  let result: BuyAndHoldVsCashResult;
  let differenceMagnitudeMicros: Micros;
  if (buyAndHoldEndingEquityMicros > cashEndingEquityMicros) {
    result = "OUTPERFORMED";
    differenceMagnitudeMicros = subtractChecked(
      buyAndHoldEndingEquityMicros,
      cashEndingEquityMicros,
      "differenceMagnitudeMicros"
    );
  } else if (buyAndHoldEndingEquityMicros < cashEndingEquityMicros) {
    result = "UNDERPERFORMED";
    differenceMagnitudeMicros = subtractChecked(
      cashEndingEquityMicros,
      buyAndHoldEndingEquityMicros,
      "differenceMagnitudeMicros"
    );
  } else {
    result = "TIED";
    differenceMagnitudeMicros = 0n;
  }

  return Object.freeze({
    comparisonKind: "BUY_AND_HOLD_VS_CASH",
    agentId: buyAndHoldBenchmark.agentId,
    startedAt: buyAndHoldSummary.startedAt,
    endedAt: buyAndHoldSummary.endedAt,
    pointCount: buyAndHoldSummary.pointCount,
    initialCashMicros: buyAndHoldInitialCashMicros,
    buyAndHoldEndingEquityMicros,
    cashEndingEquityMicros,
    result,
    differenceMagnitudeMicros
  });
}
