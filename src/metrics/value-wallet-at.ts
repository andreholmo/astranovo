/**
 * Deterministic, anti-look-ahead equity valuation of one wallet at an instant.
 *
 * `Wallet + MarketSnapshot(s) available at that instant → EquityPoint`. This
 * is the smallest metrics building block for M3 (`docs/ROADMAP.md`): it
 * values one instant only. It does not compute a time series, P&L, drawdown,
 * win rate or benchmark — that is later work built on top of this primitive.
 *
 * Every price conversion and rounding rule is reused, never reimplemented,
 * from `src/money/fixed-point.ts`, and every snapshot admissibility/
 * look-ahead check is reused from `parseMarketSnapshot` in
 * `src/domain/contracts.ts`. This module adds only the rules specific to
 * valuation:
 *
 * - a snapshot must be `complete` and quoted in `USD`;
 * - each position the wallet holds must have exactly one snapshot for its
 *   asset — zero or more than one both fail closed;
 * - a snapshot for an asset the wallet does not hold is rejected, not
 *   silently ignored;
 * - a price that cannot be represented exactly in six decimal places fails
 *   closed rather than rounding (`microsFromUsdNumber`).
 *
 * Nothing here reads the clock, generates randomness or performs I/O. The
 * wallet, its positions and the supplied snapshots are never mutated.
 */

import type { MarketSnapshot, MarketSnapshotOptions } from "../domain/contracts.js";
import { parseMarketSnapshot } from "../domain/contracts.js";
import type { Wallet } from "../portfolio/portfolio.js";
import { rejectContract } from "../domain/errors.js";
import {
  MAX_MICROS,
  addBounded,
  microsFromUsdNumber,
  mulDivFloor,
  scaleFactor,
  type Micros
} from "../money/fixed-point.js";

const EQUITY_POINT = "EquityPoint";

/** Canonical UTC ISO-8601 with milliseconds, mirroring `src/domain/contracts.ts`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Duplicated from the private check in `src/domain/contracts.ts` (not
 * exported there) and from the identical duplicate in
 * `src/risk/risk-manager.ts` — this task's scope is limited to creating
 * `src/metrics/`. A canonical timestamp must round-trip through `Date`
 * unchanged, so two spellings of the same instant can never disagree.
 */
function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

/** One held position, marked to market with the evidence used to price it. */
export interface PositionValuation {
  readonly asset: string;
  readonly quantityAtoms: bigint;
  readonly assetScale: number;
  /** Price per whole unit of `asset`, in micros of USD. */
  readonly priceMicros: Micros;
  /** `floor(quantityAtoms * priceMicros / 10^assetScale)`. */
  readonly valueMicros: Micros;
  readonly snapshotId: string;
  readonly snapshotAvailableAt: string;
}

/** An immutable, auditable equity valuation of one wallet at one instant. */
export interface EquityPoint {
  readonly agentId: string;
  readonly valuedAt: string;
  readonly cashMicros: Micros;
  /** Sorted by `asset`, so equal wallets always serialise identically. */
  readonly positions: readonly PositionValuation[];
  readonly positionsValueMicros: Micros;
  /** `cashMicros + positionsValueMicros`. */
  readonly equityMicros: Micros;
  /** `snapshotId` of every snapshot used, in the same order as `positions`. */
  readonly snapshotIds: readonly string[];
}

/**
 * Values `wallet` at `valuedAt` using only complete, USD-quoted snapshots
 * that were already available at or before that instant.
 *
 * `snapshots` may be supplied in any order; the result never depends on that
 * order. Neither the wallet, its positions, nor the supplied snapshots are
 * mutated.
 */
export function valueWalletAt(
  wallet: Wallet,
  valuedAt: string,
  snapshots: readonly unknown[]
): EquityPoint {
  if (!isCanonicalTimestamp(valuedAt)) {
    rejectContract(EQUITY_POINT, "valuedAt", "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z");
  }

  const options: MarketSnapshotOptions = { notAfter: valuedAt };
  const byAsset = new Map<string, MarketSnapshot>();
  for (const raw of snapshots) {
    const snapshot = parseMarketSnapshot(raw, options);
    if (!snapshot.complete) {
      rejectContract(EQUITY_POINT, "complete", "must be true");
    }
    if (snapshot.quote !== "USD") {
      rejectContract(EQUITY_POINT, "quote", "must be USD");
    }
    if (!wallet.positions.some((position) => position.asset === snapshot.asset)) {
      rejectContract(EQUITY_POINT, "snapshots", "must not reference an asset the wallet does not hold");
    }
    if (byAsset.has(snapshot.asset)) {
      rejectContract(EQUITY_POINT, "snapshots", "must not contain more than one snapshot for the same asset");
    }
    byAsset.set(snapshot.asset, snapshot);
  }

  let positionsValueMicros: Micros = 0n;
  const positions: PositionValuation[] = [];
  const snapshotIds: string[] = [];

  for (const position of wallet.positions) {
    const snapshot = byAsset.get(position.asset);
    if (snapshot === undefined) {
      rejectContract(EQUITY_POINT, "positions", "each held position must have exactly one snapshot for its asset");
    }
    const priceMicros = microsFromUsdNumber(snapshot.price, EQUITY_POINT, "price");
    const valueMicros = mulDivFloor(
      position.quantityAtoms,
      priceMicros,
      scaleFactor(position.assetScale)
    );
    positionsValueMicros = addBounded(
      positionsValueMicros,
      valueMicros,
      MAX_MICROS,
      "positionsValueMicros"
    );
    positions.push(
      Object.freeze({
        asset: position.asset,
        quantityAtoms: position.quantityAtoms,
        assetScale: position.assetScale,
        priceMicros,
        valueMicros,
        snapshotId: snapshot.snapshotId,
        snapshotAvailableAt: snapshot.availableAt
      })
    );
    snapshotIds.push(snapshot.snapshotId);
  }

  const equityMicros = addBounded(wallet.cashMicros, positionsValueMicros, MAX_MICROS, "equityMicros");

  return Object.freeze({
    agentId: wallet.agentId,
    valuedAt,
    cashMicros: wallet.cashMicros,
    positions: Object.freeze(positions),
    positionsValueMicros,
    equityMicros,
    snapshotIds: Object.freeze(snapshotIds)
  });
}
