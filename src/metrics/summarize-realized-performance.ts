/**
 * Deterministic, auditable aggregation of several already-validated
 * `ClosedRoundTripResult`s for one agent.
 *
 * `agentId + ClosedRoundTripResult[] → RealizedPerformanceSummary`. This is
 * the smallest auditable aggregation of realised round trips in M3: it never
 * reconstructs fills, positions, FIFO/LIFO or a wallet, and never pairs a
 * BUY with a SELL itself — that already happened in
 * `summarizeClosedRoundTrip` (`src/metrics/summarize-closed-round-trip.ts`),
 * the sole source of every result aggregated here.
 *
 * Every monetary computation reuses `addBounded`/`subtractChecked`/
 * `MAX_MICROS` from `src/money/fixed-point.ts`; no formula is reimplemented
 * and no money value is ever represented as a JavaScript `number`. Win rate
 * is represented exactly, without floating point or rounding, as the integer
 * fraction `winRateNumerator / winRateDenominator` — the number of wins over
 * the number of closed trades, both zero for an empty list.
 *
 * Nothing here reads the clock, generates randomness or performs I/O.
 * Neither `results` nor any result's own fields are mutated. The result is
 * independent of the order `results` was supplied in: sums over non-negative
 * bounded amounts are order-independent, and duplicate-id/consistency
 * rejection depends only on set membership, never on position.
 */

import { rejectContract } from "../domain/errors.js";
import { addBounded, MAX_MICROS, subtractChecked, type Micros } from "../money/fixed-point.js";
import type { ClosedRoundTripDirection, ClosedRoundTripResult } from "./summarize-closed-round-trip.js";

const REALIZED_PERFORMANCE_SUMMARY = "RealizedPerformanceSummary";

/**
 * Validates that a value is an in-range, non-negative monetary amount.
 *
 * Duplicated from the identical private check in
 * `summarize-closed-round-trip.ts` and `summarize-execution-costs.ts` (not
 * exported from either) — this task's scope is limited to creating
 * `src/metrics/summarize-realized-performance.ts`. Every field this function
 * relies on is revalidated defensively, even though `results` is typed
 * `ClosedRoundTripResult[]`: nothing at compile time stops a caller from
 * constructing one by hand with a forged field, as the tests for this module
 * do to exercise each fail-closed path.
 */
function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") rejectContract(REALIZED_PERFORMANCE_SUMMARY, field, "must be a bigint");
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(REALIZED_PERFORMANCE_SUMMARY, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/** An immutable, auditable realised-performance aggregation for a single agent. */
export interface RealizedPerformanceSummary {
  readonly agentId: string;
  readonly closedTradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly breakEvenCount: number;
  /** Sum of `resultMagnitudeMicros` across every WIN result. */
  readonly totalGainMicros: Micros;
  /** Sum of `resultMagnitudeMicros` across every LOSS result, as a positive amount. */
  readonly totalLossMicros: Micros;
  /** Whether `totalGainMicros` exceeds, ties, or falls short of `totalLossMicros`. */
  readonly netResultDirection: ClosedRoundTripDirection;
  /** Exact absolute difference between `totalGainMicros` and `totalLossMicros`. Zero when `BREAK_EVEN`. */
  readonly netResultMagnitudeMicros: Micros;
  /** Number of wins: the exact win-rate numerator. Zero when `closedTradeCount` is zero. */
  readonly winRateNumerator: number;
  /** Number of closed trades: the exact win-rate denominator. Zero for an empty input. */
  readonly winRateDenominator: number;
}

/**
 * Aggregates the realised results of several fully-closed paper round trips
 * belonging to one agent into a deterministic performance summary.
 *
 * Accepts an empty `results` list. Every result must belong to `agentId` —
 * a mismatched agent fails closed rather than silently mixing agents. Every
 * `buyEventId` and `sellEventId` across the whole list, on either leg of any
 * result, must be seen at most once — a fill id reused anywhere, including
 * between two different legs, fails closed rather than risking the same
 * realised trade being counted twice. Each result's `direction` and
 * `resultMagnitudeMicros` are recomputed from its own `realizedCostMicros`
 * and `netProceedsMicros` (the same exact-`bigint`-comparison rule as
 * `summarizeClosedRoundTrip`) and must match what the result already
 * carries, so a forged or inconsistent result fails closed instead of being
 * trusted at face value.
 */
export function summarizeRealizedPerformance(
  agentId: string,
  results: readonly ClosedRoundTripResult[]
): RealizedPerformanceSummary {
  if (typeof agentId !== "string" || agentId.length === 0) {
    rejectContract(REALIZED_PERFORMANCE_SUMMARY, "agentId", "must be a non-empty string");
  }

  const seenEventIds = new Set<string>();

  let winCount = 0;
  let lossCount = 0;
  let breakEvenCount = 0;
  let totalGainMicros: Micros = 0n;
  let totalLossMicros: Micros = 0n;

  for (const result of results) {
    if (result.agentId !== agentId) {
      rejectContract(REALIZED_PERFORMANCE_SUMMARY, "agentId", "every result must belong to the requested agentId");
    }

    if (seenEventIds.has(result.buyEventId)) {
      rejectContract(REALIZED_PERFORMANCE_SUMMARY, "buyEventId", "must not repeat across results or legs");
    }
    seenEventIds.add(result.buyEventId);

    if (seenEventIds.has(result.sellEventId)) {
      rejectContract(REALIZED_PERFORMANCE_SUMMARY, "sellEventId", "must not repeat across results or legs");
    }
    seenEventIds.add(result.sellEventId);

    const realizedCostMicros = assertValidMicros(result.realizedCostMicros, "realizedCostMicros");
    const netProceedsMicros = assertValidMicros(result.netProceedsMicros, "netProceedsMicros");

    let expectedDirection: ClosedRoundTripDirection;
    let expectedMagnitudeMicros: Micros;
    if (netProceedsMicros > realizedCostMicros) {
      expectedDirection = "WIN";
      expectedMagnitudeMicros = subtractChecked(netProceedsMicros, realizedCostMicros, "resultMagnitudeMicros");
    } else if (netProceedsMicros < realizedCostMicros) {
      expectedDirection = "LOSS";
      expectedMagnitudeMicros = subtractChecked(realizedCostMicros, netProceedsMicros, "resultMagnitudeMicros");
    } else {
      expectedDirection = "BREAK_EVEN";
      expectedMagnitudeMicros = 0n;
    }

    if (result.direction !== expectedDirection) {
      rejectContract(
        REALIZED_PERFORMANCE_SUMMARY,
        "direction",
        "must match the sign of netProceedsMicros - realizedCostMicros"
      );
    }

    const resultMagnitudeMicros = assertValidMicros(result.resultMagnitudeMicros, "resultMagnitudeMicros");
    if (resultMagnitudeMicros !== expectedMagnitudeMicros) {
      rejectContract(
        REALIZED_PERFORMANCE_SUMMARY,
        "resultMagnitudeMicros",
        "must equal the exact difference between realizedCostMicros and netProceedsMicros"
      );
    }

    if (expectedDirection === "WIN") {
      winCount += 1;
      totalGainMicros = addBounded(totalGainMicros, resultMagnitudeMicros, MAX_MICROS, "totalGainMicros");
    } else if (expectedDirection === "LOSS") {
      lossCount += 1;
      totalLossMicros = addBounded(totalLossMicros, resultMagnitudeMicros, MAX_MICROS, "totalLossMicros");
    } else {
      breakEvenCount += 1;
    }
  }

  const closedTradeCount = results.length;

  let netResultDirection: ClosedRoundTripDirection;
  let netResultMagnitudeMicros: Micros;
  if (totalGainMicros > totalLossMicros) {
    netResultDirection = "WIN";
    netResultMagnitudeMicros = subtractChecked(totalGainMicros, totalLossMicros, "netResultMagnitudeMicros");
  } else if (totalGainMicros < totalLossMicros) {
    netResultDirection = "LOSS";
    netResultMagnitudeMicros = subtractChecked(totalLossMicros, totalGainMicros, "netResultMagnitudeMicros");
  } else {
    netResultDirection = "BREAK_EVEN";
    netResultMagnitudeMicros = 0n;
  }

  return Object.freeze({
    agentId,
    closedTradeCount,
    winCount,
    lossCount,
    breakEvenCount,
    totalGainMicros,
    totalLossMicros,
    netResultDirection,
    netResultMagnitudeMicros,
    winRateNumerator: winCount,
    winRateDenominator: closedTradeCount
  });
}
