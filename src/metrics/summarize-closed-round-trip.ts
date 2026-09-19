/**
 * Deterministic, auditable realised result of one fully-closed paper round
 * trip: exactly one opening BUY `FillEvent` followed by exactly one closing
 * SELL `FillEvent` of the same quantity, asset and agent.
 *
 * `FillEvent BUY + FillEvent SELL → ClosedRoundTripResult`. This is the
 * smallest auditable primitive for realised P&L in M3: it never aggregates
 * multiple trades, never applies FIFO/LIFO, never handles a partial position
 * or a short, and never executes an order, a broker, risk or replay. That is
 * later work built on top of this primitive.
 *
 * The realised cost and proceeds are read exclusively from each fill's own
 * `totalMicros` — already `gross + fee` on the BUY and `gross - fee` on the
 * SELL per `src/ledger/events.ts` — so no fee is counted twice and no formula
 * from `src/money/fixed-point.ts` is reimplemented. `direction` and
 * `resultMagnitudeMicros` come from a single exact `bigint` comparison of
 * those two totals, reusing `subtractChecked`.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. Neither
 * fill, nor the result, is ever mutated.
 */

import { rejectContract } from "../domain/errors.js";
import {
  MAX_ATOMS,
  MAX_MICROS,
  parseAssetScale,
  subtractChecked,
  type Atoms,
  type Micros
} from "../money/fixed-point.js";
import type { FillEvent } from "../ledger/events.js";

const CLOSED_ROUND_TRIP_RESULT = "ClosedRoundTripResult";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Duplicated from the private check in `src/domain/contracts.ts` (not
 * exported there) and from the identical duplicates already registered in
 * `src/risk/risk-manager.ts`, `src/metrics/value-wallet-at.ts` and
 * `src/metrics/summarize-equity-series.ts` — this task's scope is limited to
 * creating `src/metrics/summarize-closed-round-trip.ts`. A canonical
 * timestamp must round-trip through `Date` unchanged, so two spellings of the
 * same instant can never disagree, and canonical timestamps compare
 * correctly in chronological order as plain strings.
 */
function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

/** Validates that a value is an in-range, non-negative monetary amount. */
function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") rejectContract(CLOSED_ROUND_TRIP_RESULT, field, "must be a bigint");
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

/** Validates that a value is an in-range, non-negative asset quantity. */
function assertValidAtoms(value: unknown, field: string): Atoms {
  if (typeof value !== "bigint") rejectContract(CLOSED_ROUND_TRIP_RESULT, field, "must be a bigint");
  if (value < 0n || value > MAX_ATOMS) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, field, `must be between 0 and ${MAX_ATOMS}`);
  }
  return value;
}

function assertCanonicalOccurredAt(value: unknown, field: string): string {
  if (typeof value !== "string" || !isCanonicalTimestamp(value)) {
    rejectContract(
      CLOSED_ROUND_TRIP_RESULT,
      field,
      "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z"
    );
  }
  return value as string;
}

/** Whether the closing SELL's net proceeds beat, tied, or fell short of the opening BUY's cost. */
export type ClosedRoundTripDirection = "WIN" | "LOSS" | "BREAK_EVEN";

/** An immutable, auditable realised result of one fully-closed paper round trip. */
export interface ClosedRoundTripResult {
  readonly agentId: string;
  readonly asset: string;
  readonly quote: string;
  readonly assetScale: number;
  readonly quantityAtoms: Atoms;
  readonly buyEventId: string;
  readonly sellEventId: string;
  readonly openedAt: string;
  readonly closedAt: string;
  /** `buyFill.totalMicros`: the realised cost of opening the position. */
  readonly realizedCostMicros: Micros;
  /** `sellFill.totalMicros`: the realised net proceeds of closing it. */
  readonly netProceedsMicros: Micros;
  readonly direction: ClosedRoundTripDirection;
  /** Exact absolute difference between `netProceedsMicros` and `realizedCostMicros`. Zero when `BREAK_EVEN`. */
  readonly resultMagnitudeMicros: Micros;
}

/**
 * Summarises the realised result of one fully-closed paper round trip: an
 * opening BUY `FillEvent` and a closing SELL `FillEvent` of the same
 * quantity, asset, quote, asset scale and agent.
 *
 * Every field this function relies on is revalidated defensively, even
 * though the parameters are typed `FillEvent` — nothing at compile time stops
 * a caller from constructing one by hand with a forged field, as the tests
 * for this module do to exercise each fail-closed path. Rejects, before any
 * computation: either fill not of `type: "FILL"`; `buyFill.side` other than
 * `"BUY"` or `sellFill.side` other than `"SELL"`; the two fills sharing the
 * same `eventId` (a repeated fill, not a round trip); a mismatched
 * `agentId`, `asset`, `quote`, `assetScale` or `quantityAtoms`; a non-
 * canonical `occurredAt` on either fill, or a `sellFill.occurredAt` that is
 * not strictly after `buyFill.occurredAt`; and a `totalMicros` on either
 * fill that is not a `bigint` in `[0, MAX_MICROS]`.
 */
export function summarizeClosedRoundTrip(buyFill: FillEvent, sellFill: FillEvent): ClosedRoundTripResult {
  if (buyFill.type !== "FILL") rejectContract(CLOSED_ROUND_TRIP_RESULT, "buyFill.type", 'must be "FILL"');
  if (sellFill.type !== "FILL") rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.type", 'must be "FILL"');

  if (buyFill.side !== "BUY") rejectContract(CLOSED_ROUND_TRIP_RESULT, "buyFill.side", 'must be "BUY"');
  if (sellFill.side !== "SELL") rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.side", 'must be "SELL"');

  if (buyFill.eventId === sellFill.eventId) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.eventId", "must not repeat buyFill.eventId");
  }

  if (buyFill.agentId !== sellFill.agentId) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.agentId", "must match buyFill.agentId");
  }
  if (buyFill.asset !== sellFill.asset) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.asset", "must match buyFill.asset");
  }
  if (buyFill.quote !== sellFill.quote) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.quote", "must match buyFill.quote");
  }

  const assetScale = parseAssetScale(buyFill.assetScale, CLOSED_ROUND_TRIP_RESULT, "buyFill.assetScale");
  const sellAssetScale = parseAssetScale(sellFill.assetScale, CLOSED_ROUND_TRIP_RESULT, "sellFill.assetScale");
  if (assetScale !== sellAssetScale) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.assetScale", "must match buyFill.assetScale");
  }

  const quantityAtoms = assertValidAtoms(buyFill.quantityAtoms, "buyFill.quantityAtoms");
  const sellQuantityAtoms = assertValidAtoms(sellFill.quantityAtoms, "sellFill.quantityAtoms");
  if (quantityAtoms !== sellQuantityAtoms) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.quantityAtoms", "must match buyFill.quantityAtoms");
  }
  if (quantityAtoms === 0n) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "buyFill.quantityAtoms", "must be greater than 0");
  }

  const openedAt = assertCanonicalOccurredAt(buyFill.occurredAt, "buyFill.occurredAt");
  const closedAt = assertCanonicalOccurredAt(sellFill.occurredAt, "sellFill.occurredAt");
  if (closedAt <= openedAt) {
    rejectContract(CLOSED_ROUND_TRIP_RESULT, "sellFill.occurredAt", "must be strictly after buyFill.occurredAt");
  }

  const realizedCostMicros = assertValidMicros(buyFill.totalMicros, "buyFill.totalMicros");
  const netProceedsMicros = assertValidMicros(sellFill.totalMicros, "sellFill.totalMicros");

  let direction: ClosedRoundTripDirection;
  let resultMagnitudeMicros: Micros;
  if (netProceedsMicros > realizedCostMicros) {
    direction = "WIN";
    resultMagnitudeMicros = subtractChecked(netProceedsMicros, realizedCostMicros, "resultMagnitudeMicros");
  } else if (netProceedsMicros < realizedCostMicros) {
    direction = "LOSS";
    resultMagnitudeMicros = subtractChecked(realizedCostMicros, netProceedsMicros, "resultMagnitudeMicros");
  } else {
    direction = "BREAK_EVEN";
    resultMagnitudeMicros = 0n;
  }

  return Object.freeze({
    agentId: buyFill.agentId,
    asset: buyFill.asset,
    quote: buyFill.quote,
    assetScale,
    quantityAtoms,
    buyEventId: buyFill.eventId,
    sellEventId: sellFill.eventId,
    openedAt,
    closedAt,
    realizedCostMicros,
    netProceedsMicros,
    direction,
    resultMagnitudeMicros
  });
}
