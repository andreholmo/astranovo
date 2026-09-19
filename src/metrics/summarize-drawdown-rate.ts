/**
 * Deterministic, auditable percentage drawdown of an already-computed equity
 * time series.
 *
 * `EquityPoint[] (canonical, chronological, one agent) → DrawdownRateSummary`.
 * Builds directly on `summarizeEquitySeries`
 * (`src/metrics/summarize-equity-series.ts`): this module never revalues a
 * wallet, replays a cycle or reimplements peak/trough detection. It only
 * expresses the absolute drawdown that `summarizeEquitySeries` already found
 * as an integer basis-point ratio against the exact monetary peak the
 * drawdown fell from.
 *
 * The peak used for the ratio is the equity of the point identified by
 * `maxDrawdownPeakAt`, looked up directly in `points` — never the series'
 * overall final peak (`EquitySeriesSummary.peakEquityMicros`), which can be a
 * later, higher peak than the one the largest drawdown actually fell from.
 *
 * The ratio is computed with `bigint` multiplication and division only,
 * reusing `mulDivFloor` from `src/money/fixed-point.ts` (floor rounding); it
 * is converted to a `number` only once proven to be an integer in
 * `[0, 10_000]`. A zero drawdown always yields `maxDrawdownBps = 0`.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. The
 * input points and their own collections are never mutated.
 */

import { rejectContract } from "../domain/errors.js";
import { MAX_MICROS, mulDivFloor, type Micros } from "../money/fixed-point.js";
import { summarizeEquitySeries } from "./summarize-equity-series.js";
import type { EquityPoint } from "./value-wallet-at.js";

const DRAWDOWN_RATE_SUMMARY = "DrawdownRateSummary";

/** Basis-point denominator: 10_000 bps = 100%. */
const BPS_DENOMINATOR = 10_000n;

/**
 * Validates that a value is an in-range, non-negative equity amount.
 *
 * Duplicated from the identical check in `summarize-equity-series.ts` (not
 * exported there) — this task's scope is limited to creating
 * `src/metrics/summarize-drawdown-rate.ts`. `summarizeEquitySeries` already
 * validated every point's `equityMicros` before returning, but the value
 * looked up here comes from indexing back into the raw `points` array rather
 * than from a field of the trusted `EquitySeriesSummary`, so it is
 * re-validated defensively, the same way `summarizeEquitySeries` itself
 * re-validates equity values a caller could have constructed by hand.
 */
function assertValidEquityMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") {
    rejectContract(DRAWDOWN_RATE_SUMMARY, field, "must be a bigint");
  }
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(DRAWDOWN_RATE_SUMMARY, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/** An immutable, auditable percentage-drawdown summary for a single agent. */
export interface DrawdownRateSummary {
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  /** Largest absolute drawdown observed, exactly as computed by `summarizeEquitySeries`. */
  readonly maxDrawdownMicros: Micros;
  /**
   * Equity of the exact point identified by `maxDrawdownPeakAt` — the peak
   * the largest drawdown actually fell from, never just the series' overall
   * final peak.
   */
  readonly maxDrawdownPeakEquityMicros: Micros;
  readonly maxDrawdownPeakAt: string;
  readonly maxDrawdownTroughAt: string;
  /**
   * `floor(maxDrawdownMicros * 10_000 / maxDrawdownPeakEquityMicros)`, an
   * integer in `[0, 10_000]`. Zero when there is no drawdown.
   */
  readonly maxDrawdownBps: number;
  readonly rounding: "FLOOR";
}

/**
 * Reduces a non-empty, chronologically ordered series of `EquityPoint`s for a
 * single agent into a deterministic percentage-drawdown summary.
 *
 * Delegates every input-consistency check and the peak/trough detection
 * itself to `summarizeEquitySeries`; this function only looks up the exact
 * monetary peak the largest drawdown fell from and expresses it as an
 * integer basis-point ratio, floored. Neither `points` nor any point's own
 * fields are mutated.
 */
export function summarizeDrawdownRate(points: readonly EquityPoint[]): DrawdownRateSummary {
  const summary = summarizeEquitySeries(points);

  const peakPoint = points.find((point) => point.valuedAt === summary.maxDrawdownPeakAt);
  if (peakPoint === undefined) {
    rejectContract(
      DRAWDOWN_RATE_SUMMARY,
      "maxDrawdownPeakAt",
      "must match the valuedAt of one of the supplied points"
    );
  }
  const maxDrawdownPeakEquityMicros = assertValidEquityMicros(
    peakPoint.equityMicros,
    "maxDrawdownPeakEquityMicros"
  );

  let maxDrawdownBps = 0;
  if (summary.maxDrawdownMicros > 0n) {
    if (maxDrawdownPeakEquityMicros === 0n) {
      rejectContract(
        DRAWDOWN_RATE_SUMMARY,
        "maxDrawdownPeakEquityMicros",
        "must not be zero when maxDrawdownMicros is positive"
      );
    }
    const bps = mulDivFloor(summary.maxDrawdownMicros, BPS_DENOMINATOR, maxDrawdownPeakEquityMicros);
    if (bps < 0n || bps > BPS_DENOMINATOR) {
      rejectContract(DRAWDOWN_RATE_SUMMARY, "maxDrawdownBps", `must be between 0 and ${BPS_DENOMINATOR}`);
    }
    maxDrawdownBps = Number(bps);
  }

  return Object.freeze({
    agentId: summary.agentId,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    pointCount: summary.pointCount,
    maxDrawdownMicros: summary.maxDrawdownMicros,
    maxDrawdownPeakEquityMicros,
    maxDrawdownPeakAt: summary.maxDrawdownPeakAt,
    maxDrawdownTroughAt: summary.maxDrawdownTroughAt,
    maxDrawdownBps,
    rounding: "FLOOR"
  });
}
