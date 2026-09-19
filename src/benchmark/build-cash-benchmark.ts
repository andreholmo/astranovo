/**
 * Deterministic cash benchmark: a wallet that stays entirely in cash across
 * the same valuation instants used to evaluate a strategy.
 *
 * `agentId + initialCashMicros + valuedAt[] → CashBenchmark auditável`. This
 * is the first benchmark of M3 (`docs/ROADMAP.md`): a control with no
 * trades, no positions and no cost, so a strategy's equity series can later
 * be compared against "did nothing" using the exact same valuation and
 * summary primitives a strategy uses.
 *
 * Every rule is reused, never reimplemented:
 *
 * - {@link createWallet} builds the cash-only wallet;
 * - {@link valueWalletAt}, called once per timestamp with an empty snapshot
 *   list, proves each point holds no position, values equity as exactly the
 *   cash balance, and enforces that every `valuedAt` is a canonical
 *   timestamp;
 * - {@link summarizeEquitySeries} enforces the strictly-increasing,
 *   non-duplicate order of the timestamps and reduces the series to a
 *   summary that is always `FLAT` with zero drawdown, because every point's
 *   equity is identical by construction;
 * - `initialCashMicros` is never validated here: `valueWalletAt` already
 *   computes `equityMicros = addBounded(wallet.cashMicros, 0n, MAX_MICROS,
 *   ...)`, which rejects a non-bigint, negative, or over-limit cash balance
 *   fail-closed. Duplicating that check here would duplicate a monetary
 *   contract the task requires reusing.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. The
 * supplied timestamp collection is never mutated.
 */

import { createWallet } from "../portfolio/portfolio.js";
import { valueWalletAt, type EquityPoint } from "../metrics/value-wallet-at.js";
import { summarizeEquitySeries, type EquitySeriesSummary } from "../metrics/summarize-equity-series.js";
import type { Micros } from "../money/fixed-point.js";

/** An immutable, auditable cash-only control benchmark for one agent. */
export interface CashBenchmark {
  readonly kind: "CASH";
  readonly agentId: string;
  readonly initialCashMicros: Micros;
  /** One flat `EquityPoint` per entry of `valuedAt`, in the same order. */
  readonly points: readonly EquityPoint[];
  readonly summary: EquitySeriesSummary;
}

/**
 * Builds a cash benchmark: a wallet funded with `initialCashMicros` that
 * never trades, valued at every instant in `valuedAt`.
 *
 * `valuedAt` must be non-empty; canonical timestamp, ordering and duplicate
 * checks are enforced by {@link valueWalletAt} and {@link summarizeEquitySeries},
 * not repeated here.
 */
export function buildCashBenchmark(
  agentId: string,
  initialCashMicros: Micros,
  valuedAt: readonly string[]
): CashBenchmark {
  const wallet = createWallet(agentId, initialCashMicros);
  const points = valuedAt.map((instant) => valueWalletAt(wallet, instant, []));
  const summary = summarizeEquitySeries(points);

  return Object.freeze({
    kind: "CASH",
    agentId,
    initialCashMicros,
    points: Object.freeze(points),
    summary
  });
}
