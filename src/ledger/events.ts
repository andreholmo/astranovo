/**
 * Ledger events: the append-only record that is the accounting source of truth.
 *
 * Per D-008, wallets are *derived* from these events by replay; a wallet is a
 * cache, never an authority. Only a `FillEvent` moves cash or a position. A
 * `RejectionEvent` records that nothing happened and why.
 *
 * Every event is flat (only scalar fields), immutable and content-addressed:
 * `eventId` is a hash of the event's own canonical serialisation, so two
 * processes that compute the same fill agree on its identity without
 * coordinating. That is what makes replay idempotent.
 *
 * At the JSON boundary every `bigint` is a canonical decimal string, so the
 * serialised form here is exactly what a future JSONL adapter will write. No
 * file is written in this milestone.
 */

import { createHash } from "node:crypto";

import type { ExecutionPolicy, OrderSide } from "../domain/contracts.js";
import { formatIntegerString, type Atoms, type Micros } from "../money/fixed-point.js";

/** Length of `eventId` in hexadecimal characters (128 bits). */
export const EVENT_ID_LENGTH = 32;

/**
 * Stable rejection codes. These are part of the contract: they are stored in
 * the ledger and read back by analysis, so a code is never renamed silently.
 */
export const REJECTION_CODES = [
  /** The cash available to the order rounds down to nothing. */
  "INSUFFICIENT_CASH",
  /** The computed quantity, or its proceeds, rounds down to zero. */
  "QUANTITY_TOO_SMALL",
  /** A SELL was requested for an asset the wallet does not hold. */
  "NO_POSITION",
  /** Spread and slippage consume the whole reference price. */
  "COSTS_EXCEED_PRICE",
  /** The fee is larger than the gross proceeds of a SELL. */
  "COSTS_EXCEED_PROCEEDS",
  /** The order's asset scale disagrees with the held position's scale. */
  "ASSET_SCALE_MISMATCH"
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/** A simulated execution. The only event that changes a wallet. */
export interface FillEvent {
  readonly schemaVersion: 1;
  readonly type: "FILL";
  /** Content hash of every other field. Deterministic. */
  readonly eventId: string;
  readonly orderId: string;
  readonly cycleId: string;
  readonly agentId: string;
  readonly side: OrderSide;
  readonly asset: string;
  readonly quote: string;
  readonly assetScale: number;
  /** Quantity actually filled, in atomic units. Fills are total or nothing. */
  readonly quantityAtoms: Atoms;
  /** Price before costs, micros of quote per whole unit. */
  readonly referencePriceMicros: Micros;
  /** Price after spread and slippage, micros of quote per whole unit. */
  readonly effectivePriceMicros: Micros;
  /** Notional at the effective price, in micros. */
  readonly grossMicros: Micros;
  /** Fee charged on the gross notional, in micros. Always rounded up. */
  readonly feeMicros: Micros;
  /**
   * Total cash moved, in micros: `gross + fee` paid on a BUY, `gross - fee`
   * received on a SELL. Always non-negative; the direction comes from `side`.
   */
  readonly totalMicros: Micros;
  readonly feeBps: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly occurredAt: string;
  readonly policyVersion: string;
}

/** A refused order. Records why, and changes nothing. */
export interface RejectionEvent {
  readonly schemaVersion: 1;
  readonly type: "REJECTION";
  readonly eventId: string;
  readonly orderId: string;
  readonly cycleId: string;
  readonly agentId: string;
  readonly side: OrderSide;
  readonly asset: string;
  readonly quote: string;
  readonly code: RejectionCode;
  readonly occurredAt: string;
  readonly policyVersion: string;
}

export type LedgerEvent = FillEvent | RejectionEvent;

/** The JSON-boundary form of an event: scalars only, `bigint` as strings. */
export type SerializedEvent = Readonly<Record<string, string | number | boolean>>;

/**
 * Canonical JSON: keys sorted, no whitespace. Two objects with the same
 * entries always produce the same string, whatever order they were built in.
 */
function canonicalJson(payload: SerializedEvent): string {
  const keys = Object.keys(payload).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key])}`);
  return `{${entries.join(",")}}`;
}

function computeEventId(payload: SerializedEvent): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, EVENT_ID_LENGTH);
}

function fillPayload(event: Omit<FillEvent, "eventId">): SerializedEvent {
  return {
    schemaVersion: event.schemaVersion,
    type: event.type,
    orderId: event.orderId,
    cycleId: event.cycleId,
    agentId: event.agentId,
    side: event.side,
    asset: event.asset,
    quote: event.quote,
    assetScale: event.assetScale,
    quantityAtoms: formatIntegerString(event.quantityAtoms),
    referencePriceMicros: formatIntegerString(event.referencePriceMicros),
    effectivePriceMicros: formatIntegerString(event.effectivePriceMicros),
    grossMicros: formatIntegerString(event.grossMicros),
    feeMicros: formatIntegerString(event.feeMicros),
    totalMicros: formatIntegerString(event.totalMicros),
    feeBps: event.feeBps,
    spreadBps: event.spreadBps,
    slippageBps: event.slippageBps,
    occurredAt: event.occurredAt,
    policyVersion: event.policyVersion
  };
}

function rejectionPayload(event: Omit<RejectionEvent, "eventId">): SerializedEvent {
  return {
    schemaVersion: event.schemaVersion,
    type: event.type,
    orderId: event.orderId,
    cycleId: event.cycleId,
    agentId: event.agentId,
    side: event.side,
    asset: event.asset,
    quote: event.quote,
    code: event.code,
    occurredAt: event.occurredAt,
    policyVersion: event.policyVersion
  };
}

/** Builds a frozen `FillEvent`, computing its deterministic `eventId`. */
export function createFillEvent(draft: Omit<FillEvent, "eventId">): FillEvent {
  return Object.freeze({ ...draft, eventId: computeEventId(fillPayload(draft)) });
}

/** Builds a frozen `RejectionEvent`, computing its deterministic `eventId`. */
export function createRejectionEvent(draft: Omit<RejectionEvent, "eventId">): RejectionEvent {
  return Object.freeze({ ...draft, eventId: computeEventId(rejectionPayload(draft)) });
}

/** The JSON-boundary form of any event, `eventId` included. */
export function serializeEvent(event: LedgerEvent): SerializedEvent {
  const payload =
    event.type === "FILL" ? fillPayload(event) : rejectionPayload(event);
  return Object.freeze({ ...payload, eventId: event.eventId });
}

/** Convenience: the policy fields every event carries. */
export function policyFields(
  policy: ExecutionPolicy
): Pick<FillEvent, "feeBps" | "spreadBps" | "slippageBps" | "policyVersion"> {
  return {
    feeBps: policy.feeBps,
    spreadBps: policy.spreadBps,
    slippageBps: policy.slippageBps,
    policyVersion: policy.policyVersion
  };
}
