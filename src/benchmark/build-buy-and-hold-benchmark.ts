/**
 * Deterministic buy-and-hold benchmark: a single paper purchase at the first
 * replay instant, held and marked to market at every later instant.
 *
 * `snapshots + decisionTimes + capital + policy → BuyAndHoldBenchmark`. This
 * is the second benchmark of M3 (`docs/ROADMAP.md`): unlike
 * {@link buildCashBenchmark} it spends its starting cash exactly once, at the
 * first `decisionAt` of the series, and pays whatever the `PaperBroker` and
 * the supplied `ExecutionPolicy` say a 100% BUY costs — fee, spread and
 * slippage included. From there on it never trades again: it only values the
 * resulting position at every later instant, without look-ahead.
 *
 * Every rule is reused, never reimplemented:
 *
 * - {@link buildReplaySnapshotSeries} builds the anti-look-ahead evidence
 *   line over `decisionTimes` (D-009);
 * - {@link createWallet} builds the cash-only starting wallet;
 * - {@link parseOrderIntent} validates the single BUY order, and
 *   {@link microsFromUsdNumber}/`formatIntegerString`
 *   (`src/money/fixed-point.ts`) convert the first snapshot's price into the
 *   canonical decimal string an `OrderIntent` carries;
 * - `PaperBroker.execute` (`src/broker/paper-broker.ts`) is the only source
 *   of the fill's cost; no fee, spread or slippage formula is duplicated
 *   here;
 * - `applyEvent` (`src/portfolio/portfolio.ts`) is the only place cash and
 *   the resulting position are computed;
 * - {@link valueWalletAt} values the post-purchase wallet at every point, and
 *   {@link summarizeEquitySeries} reduces the resulting series — neither
 *   valuation nor P&L/drawdown math is reimplemented here;
 * - {@link parseExecutionPolicy} validates the cost model before it reaches
 *   the broker.
 *
 * No Risk Manager and no agent take part: this is a deterministic control,
 * not a strategy. A purchase that the broker rejects — insufficient cash, a
 * quantity too small to fill — fails the whole benchmark closed; it is never
 * silently turned into a cash benchmark. This benchmark never sells: its
 * final equity is a mark-to-market of the held position, and any exit cost a
 * real liquidation would pay is not included.
 *
 * Nothing here reads the clock, generates randomness or performs I/O. None of
 * `snapshots`, `decisionTimes` or the raw `executionPolicy` input is mutated.
 */

import type { ExecutionPolicy } from "../domain/contracts.js";
import { parseExecutionPolicy, parseOrderIntent } from "../domain/contracts.js";
import { rejectContract } from "../domain/errors.js";
import { formatIntegerString, microsFromUsdNumber, type Micros } from "../money/fixed-point.js";
import { PaperBroker } from "../broker/paper-broker.js";
import type { FillEvent } from "../ledger/events.js";
import { applyEvent, createWallet, type Wallet } from "../portfolio/portfolio.js";
import { buildReplaySnapshotSeries, type ReplaySnapshotPoint } from "../replay/build-replay-snapshot-series.js";
import { valueWalletAt, type EquityPoint } from "../metrics/value-wallet-at.js";
import { summarizeEquitySeries, type EquitySeriesSummary } from "../metrics/summarize-equity-series.js";

const BUY_AND_HOLD_BENCHMARK = "BuyAndHoldBenchmark";

/**
 * An immutable, auditable buy-and-hold control benchmark for one agent: one
 * paper purchase at the first replay instant, held and marked to market at
 * every later instant. No sale or exit cost is included.
 */
export interface BuyAndHoldBenchmark {
  readonly kind: "BUY_AND_HOLD";
  readonly agentId: string;
  readonly asset: string;
  readonly quote: string;
  readonly initialCashMicros: Micros;
  /** The `ExecutionPolicy` actually used, validated by `parseExecutionPolicy`. */
  readonly executionPolicy: ExecutionPolicy;
  /** The single fill that opened the position, at `series[0].decisionAt`. */
  readonly initialFill: FillEvent;
  /** The wallet immediately after the initial purchase. Never traded again. */
  readonly walletAfterPurchase: Wallet;
  /** The anti-look-ahead replay evidence line the benchmark was built over. */
  readonly series: readonly ReplaySnapshotPoint[];
  /** One `EquityPoint` per entry of `series`, in the same order. */
  readonly points: readonly EquityPoint[];
  readonly summary: EquitySeriesSummary;
}

/**
 * Builds a buy-and-hold benchmark: `initialCashMicros` spent entirely on
 * `asset` at the first instant of `decisionTimes`, through the `PaperBroker`
 * under `executionPolicy`, then marked to market — never sold — at every
 * instant of the series.
 *
 * `snapshots` is an untrusted, readonly collection; structural validation and
 * anti-look-ahead selection are delegated entirely to
 * {@link buildReplaySnapshotSeries}. `executionPolicy` is validated with
 * {@link parseExecutionPolicy} before use. Fails closed, before spending any
 * cash, when `quote` is not `"USD"`, when the replay series cannot be built,
 * or when the policy is invalid; fails closed after asking the broker to buy
 * when the purchase does not produce a `FILL`.
 */
export function buildBuyAndHoldBenchmark(
  agentId: string,
  initialCashMicros: Micros,
  snapshots: readonly unknown[],
  asset: string,
  quote: string,
  assetScale: number,
  decisionTimes: readonly string[],
  executionPolicy: unknown
): BuyAndHoldBenchmark {
  const series = buildReplaySnapshotSeries(snapshots, asset, quote, decisionTimes);

  if (quote !== "USD") {
    rejectContract(BUY_AND_HOLD_BENCHMARK, "quote", 'must be "USD"');
  }

  const startingWallet = createWallet(agentId, initialCashMicros);
  const policy = parseExecutionPolicy(executionPolicy);

  const firstPoint = series[0];
  if (firstPoint === undefined) {
    // Unreachable: buildReplaySnapshotSeries rejects an empty decisionTimes
    // fail-closed, so series always has at least one point. Asserted here
    // only to satisfy noUncheckedIndexedAccess without an unchecked cast.
    rejectContract(BUY_AND_HOLD_BENCHMARK, "series", "must contain at least one point");
  }

  const referencePriceMicros = microsFromUsdNumber(
    firstPoint.snapshot.price,
    BUY_AND_HOLD_BENCHMARK,
    "price"
  );

  const intent = parseOrderIntent({
    schemaVersion: 1,
    orderId: `${agentId}-buy-and-hold-${asset}`,
    cycleId: `${agentId}-buy-and-hold-${asset}`,
    agentId,
    side: "BUY",
    asset,
    quote,
    positionPct: 1,
    referencePriceMicros: formatIntegerString(referencePriceMicros),
    assetScale,
    createdAt: firstPoint.decisionAt
  });

  const outcome = new PaperBroker().execute({
    intent,
    wallet: startingWallet,
    policy,
    occurredAt: firstPoint.decisionAt
  });

  if (outcome.status !== "FILLED") {
    rejectContract(
      BUY_AND_HOLD_BENCHMARK,
      "initialFill",
      "the initial purchase must produce a FILL, not a broker rejection"
    );
  }

  const walletAfterPurchase = applyEvent(startingWallet, outcome.event);

  const points = series.map((point) =>
    valueWalletAt(walletAfterPurchase, point.decisionAt, [point.snapshot])
  );
  const summary = summarizeEquitySeries(points);

  return Object.freeze({
    kind: "BUY_AND_HOLD" as const,
    agentId,
    asset,
    quote,
    initialCashMicros,
    executionPolicy: policy,
    initialFill: outcome.event,
    walletAfterPurchase,
    series,
    points: Object.freeze(points),
    summary
  });
}
