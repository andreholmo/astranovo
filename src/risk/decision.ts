/**
 * `RiskDecision`: the immutable, structured outcome of one risk evaluation.
 *
 * Mirrors the deterministic identity pattern of `src/ledger/events.ts`: `id`
 * is a hash of the decision's own canonical serialisation, computed from a
 * caller-supplied instant rather than the system clock, so the same
 * canonical order, wallet, policy and timestamp always produce the same
 * decision id. The hashing recipe (sha256 of sorted-key JSON, sliced to
 * `RISK_DECISION_ID_LENGTH` hex characters) intentionally matches
 * `src/ledger/events.ts`'s `computeEventId`; it is not exported from there,
 * so it is reproduced here rather than reached into a module TASK-004 does
 * not touch.
 */

import { createHash } from "node:crypto";

import type { OrderSide } from "../domain/contracts.js";

/** Length of `id` in hexadecimal characters (128 bits), matching `EVENT_ID_LENGTH`. */
export const RISK_DECISION_ID_LENGTH = 32;

/**
 * Stable rule codes, evaluated in this fixed, documented order. When more
 * than one rule is violated, `RiskDecision.codes` lists them in this order,
 * never in whichever order the checks happened to run, so a caller diffing
 * two decisions over the same input never sees code order as a source of
 * nondeterminism.
 */
export const RISK_RULE_CODES = [
  "CIRCUIT_BREAKER_ACTIVE",
  "ASSET_NOT_ALLOWED",
  "ORDER_SIZE_LIMIT_EXCEEDED",
  "ASSET_EXPOSURE_LIMIT_EXCEEDED",
  "MAX_OPEN_POSITIONS_REACHED"
] as const;
export type RiskRuleCode = (typeof RISK_RULE_CODES)[number];

/**
 * Reserved for input that cannot be evaluated at all: missing, incompatible,
 * negative, non-canonical or otherwise impossible to reason about. When this
 * code is present it is the *only* code, because no other rule can be
 * trusted once the input itself is not trustworthy.
 */
export const INVALID_RISK_INPUT_CODE = "INVALID_RISK_INPUT" as const;

export type RiskDecisionCode = RiskRuleCode | typeof INVALID_RISK_INPUT_CODE;

/** The immutable, structured outcome of one risk evaluation. */
export interface RiskDecision {
  readonly schemaVersion: 1;
  /** Content hash of every other field. Deterministic. */
  readonly id: string;
  readonly orderId: string;
  readonly cycleId: string;
  readonly agentId: string;
  readonly asset: string;
  readonly side: OrderSide;
  readonly approved: boolean;
  /** Ordered per {@link RISK_RULE_CODES}; empty exactly when `approved` is `true`. */
  readonly codes: readonly RiskDecisionCode[];
  readonly policyVersion: string;
  /** Canonical UTC instant supplied by the caller; never the system clock. */
  readonly evaluatedAt: string;
}

type SerializedDecision = Readonly<Record<string, string | number | boolean>>;

/**
 * Canonical JSON: keys sorted, no whitespace. Two objects with the same
 * entries always produce the same string, whatever order they were built in.
 */
function canonicalJson(payload: SerializedDecision): string {
  const keys = Object.keys(payload).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key])}`);
  return `{${entries.join(",")}}`;
}

function computeDecisionId(payload: SerializedDecision): string {
  return createHash("sha256")
    .update(canonicalJson(payload))
    .digest("hex")
    .slice(0, RISK_DECISION_ID_LENGTH);
}

function decisionPayload(draft: Omit<RiskDecision, "id">): SerializedDecision {
  return {
    schemaVersion: draft.schemaVersion,
    orderId: draft.orderId,
    cycleId: draft.cycleId,
    agentId: draft.agentId,
    asset: draft.asset,
    side: draft.side,
    approved: draft.approved,
    codes: draft.codes.join(","),
    policyVersion: draft.policyVersion,
    evaluatedAt: draft.evaluatedAt
  };
}

/** Builds a frozen `RiskDecision`, computing its deterministic `id`. */
export function createRiskDecision(draft: Omit<RiskDecision, "id">): RiskDecision {
  const codes = Object.freeze([...draft.codes]);
  const withFrozenCodes = { ...draft, codes };
  return Object.freeze({ ...withFrozenCodes, id: computeDecisionId(decisionPayload(withFrozenCodes)) });
}
