/**
 * Deterministic assembly of a chronological replay evidence line.
 *
 * `snapshots + asset + quote + decisionTimes → série imutável de pontos de
 * replay`. This composes {@link selectLatestAvailableSnapshot} over a
 * strictly increasing sequence of decision instants, so that a historical
 * replay's evidence timeline can be built once and reused, instead of every
 * consumer re-deriving "what was known when" on its own (D-009).
 *
 * This module does not select BUY/SELL/HOLD, run an agent, or touch risk,
 * broker or portfolio state. It only materialises, for each `decisionAt`, the
 * one `MarketSnapshot` that was actually available at that instant.
 *
 * All snapshot selection is reused, never redefined, from
 * `selectLatestAvailableSnapshot` in `src/replay/select-latest-available-snapshot.ts`.
 * This module adds only the sequencing rule over `decisionTimes`:
 *
 * - the collection must not be empty;
 * - every entry must be a canonical UTC ISO-8601 timestamp;
 * - entries must be strictly increasing, with no duplicates and no
 *   out-of-order pair;
 * - any failure — an invalid instant, or a `selectLatestAvailableSnapshot`
 *   rejection (no eligible snapshot, a tie, or a malformed snapshot of the
 *   requested pair) — fails the whole series closed rather than returning a
 *   partial one.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. Neither
 * `snapshots` nor `decisionTimes` is sorted or mutated, and the result never
 * depends on the order `snapshots` was supplied in.
 */

import type { MarketSnapshot } from "../domain/contracts.js";
import { rejectContract } from "../domain/errors.js";
import { selectLatestAvailableSnapshot } from "./select-latest-available-snapshot.js";

const REPLAY_SNAPSHOT_SERIES = "ReplaySnapshotSeries";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Duplicated from the private check in `src/domain/contracts.ts` (not
 * exported there) and from the identical duplicates in
 * `src/risk/risk-manager.ts`, `src/metrics/value-wallet-at.ts` and
 * `src/replay/select-latest-available-snapshot.ts` — this task's scope is
 * limited to creating the new module. Because every canonical timestamp
 * shares this exact fixed-width format, plain string comparison already
 * agrees with chronological order, so strictly-increasing order below never
 * needs to parse an epoch.
 */
function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

/** One instant of the replay evidence timeline and the snapshot known at it. */
export interface ReplaySnapshotPoint {
  /** The canonical decision instant this point was built for. */
  readonly decisionAt: string;
  /**
   * The `MarketSnapshot` selected by `selectLatestAvailableSnapshot` for
   * `decisionAt`: the most recent one of the requested pair whose
   * `availableAt` is at or before `decisionAt`.
   */
  readonly snapshot: MarketSnapshot;
}

/**
 * Builds the chronological replay evidence series for `asset`/`quote` over
 * `decisionTimes`.
 *
 * `decisionTimes` must already be in strictly increasing chronological order;
 * this function validates that invariant but never sorts or otherwise
 * reorders it. Each instant is resolved independently via
 * `selectLatestAvailableSnapshot`, so a later point only ever picks up a
 * newer snapshot when one has actually become available — it never inherits
 * a snapshot from a neighbouring instant by construction.
 */
export function buildReplaySnapshotSeries(
  snapshots: readonly unknown[],
  asset: string,
  quote: string,
  decisionTimes: readonly string[]
): readonly ReplaySnapshotPoint[] {
  if (decisionTimes.length === 0) {
    rejectContract(REPLAY_SNAPSHOT_SERIES, "decisionTimes", "must not be empty");
  }

  const points: ReplaySnapshotPoint[] = [];
  let previous: string | undefined;

  for (const decisionAt of decisionTimes) {
    if (typeof decisionAt !== "string" || !isCanonicalTimestamp(decisionAt)) {
      rejectContract(
        REPLAY_SNAPSHOT_SERIES,
        "decisionTimes",
        "every entry must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z"
      );
    }
    if (previous !== undefined && decisionAt <= previous) {
      rejectContract(
        REPLAY_SNAPSHOT_SERIES,
        "decisionTimes",
        "must be strictly increasing with no duplicate or out-of-order entry"
      );
    }
    previous = decisionAt;

    const snapshot = selectLatestAvailableSnapshot(snapshots, asset, quote, decisionAt);
    points.push(Object.freeze({ decisionAt, snapshot }));
  }

  return Object.freeze(points);
}
