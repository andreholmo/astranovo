/**
 * Deterministic, anti-look-ahead snapshot selection for replay.
 *
 * `snapshots + asset + quote + decisionAt → MarketSnapshot` most recently
 * available at or before `decisionAt`. This is the small primitive M3 needs
 * so a historical decision's context can never read a snapshot that was not
 * yet observable at the instant being replayed (D-009).
 *
 * All structural validation is reused, never redefined, from
 * `parseMarketSnapshot` in `src/domain/contracts.ts`. This module adds only
 * the selection rule:
 *
 * - a raw entry whose `asset`/`quote` do not match the requested pair is
 *   ignored without being validated;
 * - every entry that *does* match the requested pair is validated in full —
 *   including one whose `availableAt` is after `decisionAt` — so a malformed
 *   future snapshot cannot hide behind the temporal filter;
 * - among the validated snapshots of the pair, the one with the greatest
 *   `availableAt` that is `<= decisionAt` is returned;
 * - no eligible snapshot, or two eligible snapshots tied on the greatest
 *   `availableAt`, both fail closed rather than guessing a winner.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. The
 * supplied snapshot collection is never sorted or mutated, and the result
 * never depends on the order it was supplied in.
 */

import type { MarketSnapshot } from "../domain/contracts.js";
import { parseMarketSnapshot } from "../domain/contracts.js";
import { rejectContract } from "../domain/errors.js";

const SNAPSHOT_SELECTION = "SnapshotSelection";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Duplicated from the private check in `src/domain/contracts.ts` (not
 * exported there) and from the identical duplicates in
 * `src/risk/risk-manager.ts` and `src/metrics/value-wallet-at.ts` — this
 * task's scope is limited to creating `src/replay/`. A canonical timestamp
 * must round-trip through `Date` unchanged, so two spellings of the same
 * instant can never disagree. Because every canonical timestamp shares this
 * exact fixed-width format, plain string comparison already agrees with
 * chronological order, so selection below never needs to parse an epoch.
 */
function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function isRequestedPair(raw: unknown, asset: string, quote: string): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  return record.asset === asset && record.quote === quote;
}

/**
 * Selects the `MarketSnapshot` of `asset`/`quote` with the greatest
 * `availableAt` that is at or before `decisionAt`.
 *
 * `snapshots` may hold raw entries for other pairs, in any order; those are
 * ignored without validation. Every entry that matches `asset` and `quote`
 * is validated in full, whether or not it turns out to be eligible, so a
 * malformed snapshot cannot be hidden by giving it a future `availableAt`.
 * Neither `snapshots` nor any entry within it is mutated, and the result
 * never depends on the order `snapshots` was supplied in.
 */
export function selectLatestAvailableSnapshot(
  snapshots: readonly unknown[],
  asset: string,
  quote: string,
  decisionAt: string
): MarketSnapshot {
  if (typeof decisionAt !== "string" || !isCanonicalTimestamp(decisionAt)) {
    rejectContract(
      SNAPSHOT_SELECTION,
      "decisionAt",
      "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z"
    );
  }

  let best: MarketSnapshot | undefined;
  let tiedWithBest = false;

  for (const raw of snapshots) {
    if (!isRequestedPair(raw, asset, quote)) continue;
    const candidate = parseMarketSnapshot(raw);

    if (candidate.availableAt > decisionAt) continue;

    if (best === undefined || candidate.availableAt > best.availableAt) {
      best = candidate;
      tiedWithBest = false;
    } else if (candidate.availableAt === best.availableAt) {
      tiedWithBest = true;
    }
  }

  if (best === undefined) {
    rejectContract(
      SNAPSHOT_SELECTION,
      "snapshots",
      "must contain a snapshot for the requested pair available at or before decisionAt"
    );
  }
  if (tiedWithBest) {
    rejectContract(
      SNAPSHOT_SELECTION,
      "snapshots",
      "must not contain two eligible snapshots tied on the greatest availableAt"
    );
  }

  return best;
}
