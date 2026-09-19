/**
 * Deterministic, auditable summary of an already-computed equity time series.
 *
 * `EquityPoint[] (canonical, chronological, one agent) → EquitySeriesSummary`.
 * Builds on `valueWalletAt` (`src/metrics/value-wallet-at.ts`): this module
 * never revalues a wallet, replays a cycle or fetches a price — it only
 * reduces a series of equity points already computed for one agent into a
 * final P&L and the largest absolute drawdown observed, with evidence of
 * where it happened. It does not compute percentage drawdown, win rate, fees
 * or benchmarks — that is later work built on top of this primitive.
 *
 * P&L is money-free by design: `pnlDirection` (`GAIN | LOSS | FLAT`) plus a
 * non-negative `pnlMagnitudeMicros` is enough to describe the exact
 * difference between ending and starting equity, so no signed monetary type
 * is introduced. Every monetary comparison reuses `src/money/fixed-point.ts`
 * (`subtractChecked`, `MAX_MICROS`); no formula is reimplemented, and no
 * money value is ever represented as a JavaScript `number`.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. The
 * input points and their own collections are never mutated.
 */

import { rejectContract } from "../domain/errors.js";
import { MAX_MICROS, subtractChecked, type Micros } from "../money/fixed-point.js";
import type { EquityPoint } from "./value-wallet-at.js";

const EQUITY_SERIES_SUMMARY = "EquitySeriesSummary";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Duplicated from the private check in `src/domain/contracts.ts` (not
 * exported there) and from the identical duplicates in
 * `src/risk/risk-manager.ts` and `src/metrics/value-wallet-at.ts` — this
 * task's scope is limited to creating `src/metrics/`. A canonical timestamp
 * must round-trip through `Date` unchanged, so two spellings of the same
 * instant can never disagree, and canonical timestamps compare correctly in
 * chronological order as plain strings.
 */
function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

/** Validates that a value is an in-range, non-negative equity amount. */
function assertValidEquityMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") {
    rejectContract(EQUITY_SERIES_SUMMARY, field, "must be a bigint");
  }
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(EQUITY_SERIES_SUMMARY, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/** Direction of the P&L between the first and last point, without a signed monetary type. */
export type PnlDirection = "GAIN" | "LOSS" | "FLAT";

/** An immutable, auditable summary of an agent's equity series. */
export interface EquitySeriesSummary {
  readonly agentId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly pointCount: number;
  readonly startingEquityMicros: Micros;
  readonly endingEquityMicros: Micros;
  /** `GAIN` if ending > starting, `LOSS` if ending < starting, else `FLAT`. */
  readonly pnlDirection: PnlDirection;
  /** Exact absolute difference between ending and starting equity. Zero when `FLAT`. */
  readonly pnlMagnitudeMicros: Micros;
  /** Highest equity observed across the series, including the first point. */
  readonly peakEquityMicros: Micros;
  /** Largest `peak - equity` observed at any point, never negative. */
  readonly maxDrawdownMicros: Micros;
  /** `valuedAt` of the peak that precedes the largest drawdown's trough. */
  readonly maxDrawdownPeakAt: string;
  /** `valuedAt` of the point where the largest drawdown was observed. */
  readonly maxDrawdownTroughAt: string;
}

/**
 * Summarises a non-empty, chronologically ordered series of `EquityPoint`s
 * for a single agent into a final P&L and the largest absolute drawdown.
 *
 * `points` must already be sorted by `valuedAt` by the caller; this function
 * validates that order rather than silently sorting, and rejects duplicate
 * or out-of-order timestamps, non-canonical timestamps, mixed agents and
 * out-of-range equity values. A single-point series always yields a `FLAT`
 * P&L and a zero drawdown. Neither `points` nor any point's own fields are
 * mutated.
 */
export function summarizeEquitySeries(points: readonly EquityPoint[]): EquitySeriesSummary {
  const firstPoint = points[0];
  if (firstPoint === undefined) {
    rejectContract(EQUITY_SERIES_SUMMARY, "points", "must contain at least one EquityPoint");
  }

  const agentId = firstPoint.agentId;
  const startedAt = firstPoint.valuedAt;

  let previousValuedAt: string | undefined;
  let peakEquityMicros: Micros | undefined;
  let peakAt = "";
  let maxDrawdownMicros: Micros = 0n;
  let maxDrawdownPeakAt = startedAt;
  let maxDrawdownTroughAt = startedAt;
  let endedAt = startedAt;
  let endingEquityMicros: Micros = 0n;

  for (const point of points) {
    if (point.agentId !== agentId) {
      rejectContract(EQUITY_SERIES_SUMMARY, "points", "must all belong to the same agentId");
    }
    if (!isCanonicalTimestamp(point.valuedAt)) {
      rejectContract(
        EQUITY_SERIES_SUMMARY,
        "valuedAt",
        "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z"
      );
    }
    if (previousValuedAt !== undefined && point.valuedAt <= previousValuedAt) {
      rejectContract(EQUITY_SERIES_SUMMARY, "valuedAt", "must be strictly increasing across points");
    }
    previousValuedAt = point.valuedAt;

    const equityMicros = assertValidEquityMicros(point.equityMicros, "equityMicros");

    if (peakEquityMicros === undefined || equityMicros >= peakEquityMicros) {
      peakEquityMicros = equityMicros;
      peakAt = point.valuedAt;
    }

    const drawdownMicros = subtractChecked(peakEquityMicros, equityMicros, "drawdownMicros");
    if (drawdownMicros > maxDrawdownMicros) {
      maxDrawdownMicros = drawdownMicros;
      maxDrawdownPeakAt = peakAt;
      maxDrawdownTroughAt = point.valuedAt;
    }

    endedAt = point.valuedAt;
    endingEquityMicros = equityMicros;
  }

  const startingEquityMicros = assertValidEquityMicros(firstPoint.equityMicros, "startingEquityMicros");

  let pnlDirection: PnlDirection;
  let pnlMagnitudeMicros: Micros;
  if (endingEquityMicros > startingEquityMicros) {
    pnlDirection = "GAIN";
    pnlMagnitudeMicros = subtractChecked(endingEquityMicros, startingEquityMicros, "pnlMagnitudeMicros");
  } else if (endingEquityMicros < startingEquityMicros) {
    pnlDirection = "LOSS";
    pnlMagnitudeMicros = subtractChecked(startingEquityMicros, endingEquityMicros, "pnlMagnitudeMicros");
  } else {
    pnlDirection = "FLAT";
    pnlMagnitudeMicros = 0n;
  }

  return Object.freeze({
    agentId,
    startedAt,
    endedAt,
    pointCount: points.length,
    startingEquityMicros,
    endingEquityMicros,
    pnlDirection,
    pnlMagnitudeMicros,
    peakEquityMicros: peakEquityMicros as Micros,
    maxDrawdownMicros,
    maxDrawdownPeakAt,
    maxDrawdownTroughAt
  });
}
