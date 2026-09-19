/**
 * Deterministic, auditable summary of execution costs for one agent's ledger.
 *
 * `agentId + LedgerEvent[] (any order, possibly empty) → ExecutionCostSummary`.
 * Reduces the raw fills and rejections already recorded in
 * `src/ledger/events.ts` into counts, fees and execution impact — it never
 * reconstructs a wallet, replays a cycle or computes win rate/realised P&L.
 * That is later work built on top of this primitive.
 *
 * Execution impact measures the spread/slippage baked into the effective
 * price, separately from the fee:
 *
 * - BUY:  `effectivePriceMicros - referencePriceMicros`;
 * - SELL: `referencePriceMicros - effectivePriceMicros`;
 * - cost of a fill: `floor(quantityAtoms * deltaPriceMicros / 10^assetScale)`;
 * - total: the protected sum of every fill's cost.
 *
 * Every monetary computation reuses `src/money/fixed-point.ts`
 * (`mulDivFloor`, `addBounded`, `subtractChecked`, `MAX_MICROS`, `MAX_ATOMS`);
 * no formula is reimplemented, and no money value is ever represented as a
 * JavaScript `number`. Nothing here reads the clock, generates randomness or
 * performs I/O. Neither `events` nor any event's own fields are mutated.
 */

import { rejectContract } from "../domain/errors.js";
import {
  MAX_ATOMS,
  MAX_MICROS,
  addBounded,
  mulDivFloor,
  parseAssetScale,
  scaleFactor,
  subtractChecked,
  type Atoms,
  type Micros
} from "../money/fixed-point.js";
import { REJECTION_CODES, type LedgerEvent, type RejectionCode } from "../ledger/events.js";

const EXECUTION_COST_SUMMARY = "ExecutionCostSummary";

/** Deterministic, per-code rejection counts, in `REJECTION_CODES` order. */
export type RejectionCounts = Readonly<Record<RejectionCode, number>>;

/** An immutable, auditable summary of one agent's execution costs. */
export interface ExecutionCostSummary {
  readonly agentId: string;
  readonly eventCount: number;
  readonly fillCount: number;
  readonly rejectionCount: number;
  readonly buyFillCount: number;
  readonly sellFillCount: number;
  /** Sum of `grossMicros` across every fill. */
  readonly totalGrossMicros: Micros;
  /** Sum of `feeMicros` across every fill. */
  readonly totalFeeMicros: Micros;
  /** Sum of the per-fill spread/slippage cost defined above. */
  readonly totalExecutionImpactMicros: Micros;
  readonly rejectionCounts: RejectionCounts;
}

function assertValidMicros(value: unknown, field: string): Micros {
  if (typeof value !== "bigint") rejectContract(EXECUTION_COST_SUMMARY, field, "must be a bigint");
  if (value < 0n || value > MAX_MICROS) {
    rejectContract(EXECUTION_COST_SUMMARY, field, `must be between 0 and ${MAX_MICROS}`);
  }
  return value;
}

function assertValidAtoms(value: unknown, field: string): Atoms {
  if (typeof value !== "bigint") rejectContract(EXECUTION_COST_SUMMARY, field, "must be a bigint");
  if (value < 0n || value > MAX_ATOMS) {
    rejectContract(EXECUTION_COST_SUMMARY, field, `must be between 0 and ${MAX_ATOMS}`);
  }
  return value;
}

function emptyRejectionCounts(): Record<RejectionCode, number> {
  return Object.fromEntries(REJECTION_CODES.map((code) => [code, 0])) as Record<RejectionCode, number>;
}

/**
 * Summarises the fills and rejections of one agent's ledger.
 *
 * Every event must belong to `agentId` and carry an `eventId` seen only once
 * — a mismatched agent or a repeated `eventId` fails closed rather than
 * risking double counting. A BUY fill with `effectivePriceMicros` below
 * `referencePriceMicros`, or a SELL fill above it, is directionally invalid
 * and fails closed. Input order never changes the result: an empty list
 * yields every count and total at zero.
 */
export function summarizeExecutionCosts(
  agentId: string,
  events: readonly LedgerEvent[]
): ExecutionCostSummary {
  const seenEventIds = new Set<string>();
  const rejectionCounts = emptyRejectionCounts();

  let fillCount = 0;
  let rejectionCount = 0;
  let buyFillCount = 0;
  let sellFillCount = 0;
  let totalGrossMicros: Micros = 0n;
  let totalFeeMicros: Micros = 0n;
  let totalExecutionImpactMicros: Micros = 0n;

  for (const event of events) {
    if (event.agentId !== agentId) {
      rejectContract(EXECUTION_COST_SUMMARY, "agentId", "every event must belong to the requested agentId");
    }
    if (seenEventIds.has(event.eventId)) {
      rejectContract(EXECUTION_COST_SUMMARY, "eventId", "must not repeat across events");
    }
    seenEventIds.add(event.eventId);

    if (event.type === "REJECTION") {
      if (!(REJECTION_CODES as readonly string[]).includes(event.code)) {
        rejectContract(EXECUTION_COST_SUMMARY, "code", "must be one of the stable REJECTION_CODES");
      }
      rejectionCount += 1;
      rejectionCounts[event.code] += 1;
      continue;
    }

    fillCount += 1;
    if (event.side === "BUY") buyFillCount += 1;
    else sellFillCount += 1;

    const quantityAtoms = assertValidAtoms(event.quantityAtoms, "quantityAtoms");
    const referencePriceMicros = assertValidMicros(event.referencePriceMicros, "referencePriceMicros");
    const effectivePriceMicros = assertValidMicros(event.effectivePriceMicros, "effectivePriceMicros");
    const grossMicros = assertValidMicros(event.grossMicros, "grossMicros");
    const feeMicros = assertValidMicros(event.feeMicros, "feeMicros");
    const assetScale = parseAssetScale(event.assetScale, EXECUTION_COST_SUMMARY, "assetScale");

    let deltaPriceMicros: Micros;
    if (event.side === "BUY") {
      if (effectivePriceMicros < referencePriceMicros) {
        rejectContract(
          EXECUTION_COST_SUMMARY,
          "effectivePriceMicros",
          "must be at least referencePriceMicros for a BUY fill"
        );
      }
      deltaPriceMicros = subtractChecked(effectivePriceMicros, referencePriceMicros, "deltaPriceMicros");
    } else {
      if (effectivePriceMicros > referencePriceMicros) {
        rejectContract(
          EXECUTION_COST_SUMMARY,
          "effectivePriceMicros",
          "must be at most referencePriceMicros for a SELL fill"
        );
      }
      deltaPriceMicros = subtractChecked(referencePriceMicros, effectivePriceMicros, "deltaPriceMicros");
    }

    const impactMicros = mulDivFloor(quantityAtoms, deltaPriceMicros, scaleFactor(assetScale));

    totalGrossMicros = addBounded(totalGrossMicros, grossMicros, MAX_MICROS, "totalGrossMicros");
    totalFeeMicros = addBounded(totalFeeMicros, feeMicros, MAX_MICROS, "totalFeeMicros");
    totalExecutionImpactMicros = addBounded(
      totalExecutionImpactMicros,
      impactMicros,
      MAX_MICROS,
      "totalExecutionImpactMicros"
    );
  }

  return Object.freeze({
    agentId,
    eventCount: events.length,
    fillCount,
    rejectionCount,
    buyFillCount,
    sellFillCount,
    totalGrossMicros,
    totalFeeMicros,
    totalExecutionImpactMicros,
    rejectionCounts: Object.freeze(rejectionCounts)
  });
}
