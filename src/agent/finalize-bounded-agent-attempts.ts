/**
 * The smallest pure, offline transformation that turns an already-produced
 * {@link BoundedAgentAttemptsResult} (`./run-bounded-agent-attempts.js`) into
 * the agent's final, safe outcome for one cycle:
 *
 * ```text
 * ACCEPTED            → ACCEPTED (accepted proposal preserved, unchanged)
 * ATTEMPTS_EXHAUSTED  → HOLD (closed reason: ATTEMPTS_EXHAUSTED)
 * ```
 *
 * This module represents a decision already made by the retry loop; it never
 * makes, retries or judges an attempt itself. It never calls an
 * `AgentAdapter`, `RiskManager` or `Broker`, never touches a wallet or
 * ledger, and has no clock, randomness, network, SDK, environment variable or
 * persistence of any kind. HOLD is the safe, explicit, auditable stand-in for
 * "no proposal could be trusted" — it never fabricates an `AgentProposal`,
 * price, position, confidence or evidence.
 *
 * `value` is never trusted as an already-valid `BoundedAgentAttemptsResult`
 * just because of its declared TypeScript type: every field this module
 * reads is revalidated fail-closed at runtime, including a fully forged
 * union. Every evaluation entry's `capture` is recomputed from scratch with
 * `evaluateAgentResponseCapture` (`./evaluate-agent-response-capture.js`),
 * and the entry's own declared `status`/`code`/`proposal` — and, for
 * `ACCEPTED`, the top-level `result` — must match that recomputation
 * exactly, field for field, with no extra or missing own property (including
 * one present only with an `undefined` value). A declared `ATTEMPTS_EXHAUSTED`
 * union may not contain an `ACCEPTED` evaluation; a declared `ACCEPTED` union
 * may not contain an `ACCEPTED` evaluation anywhere but last, and its
 * `result` must match that last evaluation exactly. `evaluations` must hold
 * between one and `MAX_AGENT_RETRY_ATTEMPTS` entries — never empty, never
 * more than the policy could ever allow.
 *
 * The whole revalidation runs inside a single fail-closed boundary: any
 * exception raised while reading or recomputing a forged value — including
 * one thrown by a `Proxy` trap or throwing getter nested arbitrarily deep
 * (an already-`ContractValidationError` or not) — is converted at this
 * module's edge into a sanitized `ContractValidationError` with no payload,
 * message, stack or cause from the original exception, so a secret embedded
 * in a forged input can never surface through this function's result or
 * thrown error.
 *
 * Reuses `evaluateAgentResponseCapture` for recomputation and
 * `MIN_AGENT_RETRY_ATTEMPTS`/`MAX_AGENT_RETRY_ATTEMPTS`
 * (`./retry-policy.js`) for the entry-count bound, rather than duplicating
 * either module's logic. Does not alter the public contract of
 * `runBoundedAgentAttempts`, `evaluateAgentResponseCapture` or
 * `AgentRetryPolicy`.
 */

import { rejectContract, ContractValidationError } from "../domain/errors.js";
import { type AgentProposal } from "../domain/contracts.js";
import { type AgentResponseCapture } from "./capture-agent-response.js";
import {
  evaluateAgentResponseCapture,
  type AcceptedAgentResponseEvaluation,
  type AgentResponseEvaluation,
  type AgentResponseRejectionCode,
  type RejectedAgentResponseEvaluation
} from "./evaluate-agent-response-capture.js";
import { readProperty, requireInputObject } from "./internal/attempt-input-validation.js";
import { MAX_AGENT_RETRY_ATTEMPTS, MIN_AGENT_RETRY_ATTEMPTS } from "./retry-policy.js";
import { type BoundedAgentAttemptsResult } from "./run-bounded-agent-attempts.js";

export { ContractValidationError } from "../domain/errors.js";

const FINALIZE_BOUNDED_AGENT_ATTEMPTS = "FinalizeBoundedAgentAttempts";

/** Exact own keys the top-level union may have for each discriminant. Nothing more, nothing less. */
const ACCEPTED_INPUT_KEYS = ["status", "evaluations", "result"] as const;
const EXHAUSTED_INPUT_KEYS = ["status", "evaluations", "rejectionCodes"] as const;

/** Exact own keys one evaluation entry may have for each discriminant. */
const REJECTED_EVALUATION_KEYS = ["status", "capture", "code"] as const;
const ACCEPTED_EVALUATION_KEYS = ["status", "capture", "proposal"] as const;

/** Exact own keys a declared proposal may have — matches {@link AgentProposal} field for field. */
const PROPOSAL_KEYS = [
  "schemaVersion",
  "proposalId",
  "cycleId",
  "agentId",
  "action",
  "asset",
  "confidence",
  "positionPct",
  "reason",
  "veto",
  "evidenceIds",
  "promptVersion",
  "model"
] as const;

/** Closed set of reasons a finalized outcome may HOLD for. Only one exists today. */
export const AGENT_ATTEMPTS_HOLD_REASONS = ["ATTEMPTS_EXHAUSTED"] as const;
export type AgentAttemptsHoldReason = (typeof AGENT_ATTEMPTS_HOLD_REASONS)[number];

/** The accepted proposal from a bounded run, preserved unchanged. */
export interface FinalizedAcceptedAgentAttempts {
  readonly status: "ACCEPTED";
  /** Every evaluation made, in order, including the accepted one. */
  readonly evaluations: readonly AgentResponseEvaluation[];
  /** The accepted evaluation, capture and proposal included, for audit. */
  readonly result: AcceptedAgentResponseEvaluation;
}

/** The safe, explicit stand-in for "no proposal could be trusted" after every attempt was rejected. */
export interface FinalizedHoldAgentAttempts {
  readonly status: "HOLD";
  /** Closed reason. Only ever `ATTEMPTS_EXHAUSTED`; never free text. */
  readonly reason: "ATTEMPTS_EXHAUSTED";
  /** Every rejected evaluation made, in order. Never an accepted one. */
  readonly evaluations: readonly RejectedAgentResponseEvaluation[];
  /** Closed, safe rejection codes only, in order — never a raw response or arbitrary text. */
  readonly rejectionCodes: readonly AgentResponseRejectionCode[];
}

/** Immutable, closed union: exactly what {@link finalizeBoundedAgentAttempts} returns. */
export type FinalizedBoundedAgentAttemptsResult =
  | FinalizedAcceptedAgentAttempts
  | FinalizedHoldAgentAttempts;

/**
 * Fails closed unless `value`'s own enumerable keys are exactly
 * `expectedKeys` — no missing key and no extra one, including a key present
 * only with an `undefined` value.
 */
function requireExactOwnKeys(value: Record<string, unknown>, expectedKeys: readonly string[], field: string): void {
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key) => !expectedKeys.includes(key))) {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, field, "must have exactly the expected properties");
  }
}

/**
 * Reads `value[key]` defensively for a `value` whose type is not yet known to
 * be a non-null object: returns `undefined` for a primitive, `null`, or a
 * property read that throws (a forged getter or `Proxy` trap), exactly like
 * {@link readProperty} does once a value is already known to be an object.
 */
function readSafe(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return readProperty(value, key);
}

/**
 * Reads every entry of an array-shaped value by index via {@link readProperty}
 * rather than `for...of` or `Array.prototype.map`, so a forged array-like (a
 * `Proxy` over a real array, or any object that merely passes
 * `Array.isArray`) cannot make `length`, an index read, or `Symbol.iterator`
 * leak an arbitrary thrown value — a throwing read is treated exactly like a
 * missing entry.
 */
function readArrayEntries(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, field, "must be an array");
  }
  const length = readProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, field, "must be an array");
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    entries.push(readProperty(value, String(index)));
  }
  return entries;
}

/** {@link readArrayEntries} for `evaluations`, additionally bounded to `[MIN_AGENT_RETRY_ATTEMPTS, MAX_AGENT_RETRY_ATTEMPTS]`. */
function requireEvaluationEntries(value: unknown): readonly unknown[] {
  const entries = readArrayEntries(value, "evaluations");
  if (entries.length < MIN_AGENT_RETRY_ATTEMPTS || entries.length > MAX_AGENT_RETRY_ATTEMPTS) {
    rejectContract(
      FINALIZE_BOUNDED_AGENT_ATTEMPTS,
      "evaluations",
      `must hold between ${MIN_AGENT_RETRY_ATTEMPTS} and ${MAX_AGENT_RETRY_ATTEMPTS} entries`
    );
  }
  return entries;
}

/**
 * Structurally compares a caller-declared proposal against a trustworthy one,
 * field for field. Never trusts the declared value's shape: a non-object, an
 * extra injected property, a wrong-length `evidenceIds` or any differing
 * field fails.
 */
function proposalMatches(declared: unknown, expected: AgentProposal): boolean {
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return false;
  const candidateKeys = Object.keys(declared);
  if (candidateKeys.length !== PROPOSAL_KEYS.length || candidateKeys.some((key) => !(PROPOSAL_KEYS as readonly string[]).includes(key))) {
    return false;
  }
  const candidate = declared as Record<string, unknown>;
  if (
    candidate.schemaVersion !== expected.schemaVersion ||
    candidate.proposalId !== expected.proposalId ||
    candidate.cycleId !== expected.cycleId ||
    candidate.agentId !== expected.agentId ||
    candidate.action !== expected.action ||
    candidate.asset !== expected.asset ||
    candidate.confidence !== expected.confidence ||
    candidate.positionPct !== expected.positionPct ||
    candidate.reason !== expected.reason ||
    candidate.veto !== expected.veto ||
    candidate.promptVersion !== expected.promptVersion ||
    candidate.model !== expected.model
  ) {
    return false;
  }
  const evidenceIds = candidate.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.length !== expected.evidenceIds.length) return false;
  return evidenceIds.every((id, index) => id === expected.evidenceIds[index]);
}

/**
 * Recomputes one declared evaluation entry from scratch, using only its
 * nested `capture`, then requires the entry's own declared `status`, `code`
 * and `proposal` to be exactly consistent with that recomputed evaluation —
 * same discriminant, same safe code (for `REJECTED`), same proposal (for
 * `ACCEPTED`), and no payload or property that belongs to the other outcome.
 * A forged or corrupted entry throws here rather than being silently
 * replaced by the recomputed value.
 */
function recomputeDeclaredEvaluation(entry: unknown): AgentResponseEvaluation {
  const recomputed = evaluateAgentResponseCapture(readSafe(entry, "capture"));
  if (readSafe(entry, "status") !== recomputed.status) {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "status", "must match the recomputed evaluation");
  }
  const source = entry as Record<string, unknown>;
  if (recomputed.status === "REJECTED") {
    requireExactOwnKeys(source, REJECTED_EVALUATION_KEYS, "evaluations");
    if (readSafe(entry, "code") !== recomputed.code) {
      rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "code", "must match the recomputed rejection code");
    }
    return recomputed;
  }
  requireExactOwnKeys(source, ACCEPTED_EVALUATION_KEYS, "evaluations");
  if (!proposalMatches(readSafe(entry, "proposal"), recomputed.proposal)) {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "proposal", "must match the recomputed proposal");
  }
  return recomputed;
}

function captureEqual(a: AgentResponseCapture, b: AgentResponseCapture): boolean {
  return (
    a.responseId === b.responseId &&
    a.rawResponse === b.rawResponse &&
    a.promptVersion === b.promptVersion &&
    a.model === b.model &&
    a.request.agentId === b.request.agentId &&
    a.request.cycleId === b.request.cycleId &&
    a.request.snapshotId === b.request.snapshotId
  );
}

/** Structural equality between two already-trustworthy, recomputed evaluations. */
function evaluationsEqual(a: AgentResponseEvaluation, b: AgentResponseEvaluation): boolean {
  if (a.status !== b.status || !captureEqual(a.capture, b.capture)) return false;
  if (a.status === "ACCEPTED" && b.status === "ACCEPTED") return proposalMatches(a.proposal, b.proposal);
  if (a.status === "REJECTED" && b.status === "REJECTED") return a.code === b.code;
  return false;
}

/**
 * Fails closed unless every evaluation is `REJECTED` except, optionally, the
 * last one — the only position an `ACCEPTED` evaluation may occupy.
 */
function requireOnlyLastMayBeAccepted(evaluations: readonly AgentResponseEvaluation[]): void {
  evaluations.forEach((evaluation, index) => {
    if (evaluation.status === "ACCEPTED" && index !== evaluations.length - 1) {
      rejectContract(
        FINALIZE_BOUNDED_AGENT_ATTEMPTS,
        "evaluations",
        "must not contain an evaluation after an ACCEPTED evaluation"
      );
    }
  });
}

function finalizeAccepted(source: Record<string, unknown>): FinalizedAcceptedAgentAttempts {
  requireExactOwnKeys(source, ACCEPTED_INPUT_KEYS, "value");
  const rawEntries = requireEvaluationEntries(readProperty(source, "evaluations"));
  const evaluations = rawEntries.map(recomputeDeclaredEvaluation);
  requireOnlyLastMayBeAccepted(evaluations);

  const last = evaluations[evaluations.length - 1];
  if (last === undefined || last.status !== "ACCEPTED") {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "evaluations", "must end with an ACCEPTED evaluation");
  }

  const recomputedResult = recomputeDeclaredEvaluation(readProperty(source, "result"));
  if (recomputedResult.status !== "ACCEPTED" || !evaluationsEqual(recomputedResult, last)) {
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "result", "must match the accepted evaluation");
  }

  const finalized: FinalizedAcceptedAgentAttempts = {
    status: "ACCEPTED",
    evaluations: Object.freeze([...evaluations]),
    result: recomputedResult
  };
  return Object.freeze(finalized);
}

function finalizeHold(source: Record<string, unknown>): FinalizedHoldAgentAttempts {
  requireExactOwnKeys(source, EXHAUSTED_INPUT_KEYS, "value");
  const rawEntries = requireEvaluationEntries(readProperty(source, "evaluations"));
  const evaluations = rawEntries.map(recomputeDeclaredEvaluation);

  const rejectedEvaluations = evaluations.map((evaluation) => {
    if (evaluation.status !== "REJECTED") {
      rejectContract(
        FINALIZE_BOUNDED_AGENT_ATTEMPTS,
        "evaluations",
        "must be entirely REJECTED when attempts are exhausted"
      );
    }
    return evaluation;
  });

  const expectedCodes = rejectedEvaluations.map((evaluation) => evaluation.code);
  const declaredCodes = readArrayEntries(readProperty(source, "rejectionCodes"), "rejectionCodes");
  if (
    declaredCodes.length !== expectedCodes.length ||
    declaredCodes.some((code, index) => code !== expectedCodes[index])
  ) {
    rejectContract(
      FINALIZE_BOUNDED_AGENT_ATTEMPTS,
      "rejectionCodes",
      "must match the recomputed rejection codes in order"
    );
  }

  const finalized: FinalizedHoldAgentAttempts = {
    status: "HOLD",
    reason: "ATTEMPTS_EXHAUSTED",
    evaluations: Object.freeze([...rejectedEvaluations]),
    rejectionCodes: Object.freeze([...expectedCodes])
  };
  return Object.freeze(finalized);
}

/**
 * Finalizes a bounded sequence of agent attempts into the agent's final, safe
 * outcome. Synchronous, pure and deterministic: no clock, no randomness, no
 * I/O, no persistence, no adapter, no retry, no Risk Manager and no broker.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates `value` itself and reads its `status` fail-closed;
 * 2. for `ACCEPTED`: requires the exact expected top-level keys, recomputes
 *    and revalidates every evaluation from its own capture, requires every
 *    evaluation but the last to be `REJECTED` and the last to be `ACCEPTED`,
 *    and requires the declared `result` to match that last evaluation
 *    exactly — returning a frozen `ACCEPTED` outcome with every evaluation
 *    preserved in order;
 * 3. for `ATTEMPTS_EXHAUSTED`: requires the exact expected top-level keys,
 *    recomputes and revalidates every evaluation from its own capture,
 *    requires every evaluation to be `REJECTED`, and requires the declared
 *    `rejectionCodes` to match the recomputed codes exactly, in order —
 *    returning a frozen `HOLD` outcome with the closed reason
 *    `ATTEMPTS_EXHAUSTED`, never fabricating a proposal;
 * 4. any other declared `status`, or `evaluations` empty or holding more than
 *    `MAX_AGENT_RETRY_ATTEMPTS` entries, fails closed;
 * 5. any exception raised anywhere in the above — a genuine
 *    `ContractValidationError` or an arbitrary value thrown by a forged
 *    getter/`Proxy` nested anywhere in `value` — surfaces from this function
 *    only as a sanitized `ContractValidationError`, with no payload,
 *    message, stack or cause from the original exception.
 *
 * Never generates a proposal, price, position, confidence, evidence or any
 * other value; every field of the returned outcome comes from `value` itself,
 * revalidated.
 */
export function finalizeBoundedAgentAttempts(
  value: BoundedAgentAttemptsResult
): FinalizedBoundedAgentAttemptsResult {
  try {
    const source = requireInputObject(value, FINALIZE_BOUNDED_AGENT_ATTEMPTS);
    const status = readProperty(source, "status");

    if (status === "ACCEPTED") return finalizeAccepted(source);
    if (status === "ATTEMPTS_EXHAUSTED") return finalizeHold(source);

    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "status", "must be ACCEPTED or ATTEMPTS_EXHAUSTED");
  } catch (error) {
    if (error instanceof ContractValidationError) throw error;
    rejectContract(FINALIZE_BOUNDED_AGENT_ATTEMPTS, "value", "must be a valid BoundedAgentAttemptsResult");
  }
}
