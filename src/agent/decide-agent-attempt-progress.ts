/**
 * The smallest pure state machine that turns already-captured, already-
 * evaluated agent attempts into the next allowed progress:
 *
 * ```text
 * []                  → ATTEMPT_AVAILABLE
 * [REJECTED...]       → ATTEMPT_AVAILABLE | ATTEMPTS_EXHAUSTED
 * [..., ACCEPTED]     → ACCEPTED
 * ```
 *
 * `decideAgentAttemptProgress` never calls an `AgentAdapter`, never makes or
 * retries an attempt, never produces a `HOLD`, and never persists or reaches
 * any integration. It only decides which of the three states the history of
 * attempts for one agent/cycle/prompt/model is currently in.
 *
 * `policy` is revalidated fail-closed via {@link parseAgentRetryPolicy}
 * (`./retry-policy.js`), the same way {@link shouldRetryAgentAttempt} does,
 * rather than trusted as already parsed. Every entry of `results` is
 * similarly never trusted as an already-computed `AgentResponseEvaluation`:
 * its nested `capture` is recomputed from scratch via
 * {@link evaluateAgentResponseCapture} (`./evaluate-agent-response-capture.js`),
 * which itself revalidates the capture fail-closed via `captureAgentResponse`.
 * The entry's own declared `status`, `code` and `proposal` are never trusted
 * either — they are required to match the recomputed evaluation exactly, field
 * for field. Any divergence (a forged `status`, a rewritten `code`, an altered
 * `proposal`, or a payload shape that does not belong to the recomputed
 * outcome) throws a sanitized `ContractValidationError` rather than silently
 * substituting the recomputed value: a corrupted or forged entry must fail
 * closed, not be quietly "corrected".
 *
 * `ATTEMPT_AVAILABLE` and `ATTEMPTS_EXHAUSTED` never carry a capture, a raw
 * response or a proposal — only counts and closed, safe rejection codes.
 * Only `ACCEPTED` preserves the accepted evaluation (capture and proposal)
 * for audit, exactly as the task requires.
 *
 * This module has no clock, no randomness, no I/O and no persistence.
 */

import type { AgentProposal } from "../domain/contracts.js";
import { rejectContract } from "../domain/errors.js";
import {
  evaluateAgentResponseCapture,
  type AcceptedAgentResponseEvaluation,
  type AgentResponseEvaluation,
  type AgentResponseRejectionCode,
  type RejectedAgentResponseEvaluation
} from "./evaluate-agent-response-capture.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "./retry-policy.js";

export { ContractValidationError } from "../domain/errors.js";

const AGENT_ATTEMPT_RESULTS = "AgentAttemptResults";
const AGENT_ATTEMPT_PROVENANCE = "AgentAttemptProvenance";

function requireObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Structurally compares a caller-declared proposal against the recomputed,
 * trustworthy one, field for field. Never trusts the declared value's shape:
 * a non-object, a wrong-length `evidenceIds` or any differing field fails.
 */
function proposalMatchesRecomputed(declared: unknown, recomputed: AgentProposal): boolean {
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return false;
  const candidate = declared as Record<string, unknown>;
  if (
    candidate.schemaVersion !== recomputed.schemaVersion ||
    candidate.proposalId !== recomputed.proposalId ||
    candidate.cycleId !== recomputed.cycleId ||
    candidate.agentId !== recomputed.agentId ||
    candidate.action !== recomputed.action ||
    candidate.asset !== recomputed.asset ||
    candidate.confidence !== recomputed.confidence ||
    candidate.positionPct !== recomputed.positionPct ||
    candidate.reason !== recomputed.reason ||
    candidate.veto !== recomputed.veto ||
    candidate.promptVersion !== recomputed.promptVersion ||
    candidate.model !== recomputed.model
  ) {
    return false;
  }
  if (!Array.isArray(candidate.evidenceIds) || candidate.evidenceIds.length !== recomputed.evidenceIds.length) {
    return false;
  }
  return candidate.evidenceIds.every((id, index) => id === recomputed.evidenceIds[index]);
}

/**
 * Fails closed unless the entry's own declared `status`, `code` and
 * `proposal` are exactly consistent with the recomputed, trustworthy
 * evaluation: same discriminant, same safe code (for `REJECTED`), same
 * proposal (for `ACCEPTED`), and no payload that belongs to the other
 * outcome. Never includes the declared or recomputed values in the thrown
 * error.
 */
function requireDeclaredResultMatchesRecomputed(
  source: Record<string, unknown>,
  recomputed: AgentResponseEvaluation
): void {
  if (source.status !== recomputed.status) {
    rejectContract(AGENT_ATTEMPT_RESULTS, "status", "must match the recomputed evaluation");
  }
  if (recomputed.status === "REJECTED") {
    if (source.code !== recomputed.code) {
      rejectContract(AGENT_ATTEMPT_RESULTS, "code", "must match the recomputed rejection code");
    }
    if (source.proposal !== undefined) {
      rejectContract(AGENT_ATTEMPT_RESULTS, "proposal", "must not be present on a REJECTED result");
    }
    return;
  }
  if (source.code !== undefined) {
    rejectContract(AGENT_ATTEMPT_RESULTS, "code", "must not be present on an ACCEPTED result");
  }
  if (!proposalMatchesRecomputed(source.proposal, recomputed.proposal)) {
    rejectContract(AGENT_ATTEMPT_RESULTS, "proposal", "must match the recomputed proposal");
  }
}

/**
 * Recomputes one entry's evaluation from scratch, using only its nested
 * `capture`, then requires the entry's own declared `status`, `code` and
 * `proposal` to be exactly consistent with that recomputed evaluation. A
 * forged or corrupted entry — one whose declared discriminant, code or
 * proposal disagrees with what its own capture actually evaluates to —
 * throws here rather than being silently replaced by the recomputed value.
 */
function reevaluateResult(value: unknown): AgentResponseEvaluation {
  const source = requireObject(value, AGENT_ATTEMPT_RESULTS);
  const recomputed = evaluateAgentResponseCapture(source.capture);
  requireDeclaredResultMatchesRecomputed(source, recomputed);
  return recomputed;
}

/**
 * Fails closed unless every evaluation's capture shares exactly the same
 * `agentId`, `cycleId`, `promptVersion` and `model` as the first one. An
 * empty list has nothing to compare and trivially passes.
 */
function requireSharedProvenance(evaluations: readonly AgentResponseEvaluation[]): void {
  const firstEvaluation = evaluations[0];
  if (firstEvaluation === undefined) return;
  const first = firstEvaluation.capture;
  for (const evaluation of evaluations) {
    const capture = evaluation.capture;
    if (
      capture.request.agentId !== first.request.agentId ||
      capture.request.cycleId !== first.request.cycleId ||
      capture.promptVersion !== first.promptVersion ||
      capture.model !== first.model
    ) {
      rejectContract(
        AGENT_ATTEMPT_PROVENANCE,
        "results",
        "must share the same agentId, cycleId, promptVersion and model"
      );
    }
  }
}

/**
 * Narrows to a {@link RejectedAgentResponseEvaluation}, failing closed if it
 * is not one. Only ever called once the caller has already established that
 * no `ACCEPTED` evaluation remains among these entries.
 */
function requireRejected(evaluation: AgentResponseEvaluation): RejectedAgentResponseEvaluation {
  if (evaluation.status !== "REJECTED") {
    rejectContract(
      AGENT_ATTEMPT_RESULTS,
      "results",
      "must not contain a result after an ACCEPTED result"
    );
  }
  return evaluation;
}

/** At least one more attempt is allowed; no attempt has been accepted yet. */
export interface AttemptAvailableProgress {
  readonly status: "ATTEMPT_AVAILABLE";
  /** Number of attempts already completed, all `REJECTED`. */
  readonly completedAttempts: number;
  readonly maxAttempts: number;
  /** The most recent attempt's rejection code, when at least one attempt happened. */
  readonly lastRejectionCode?: AgentResponseRejectionCode;
}

/** The final, most recent attempt was accepted. No further attempt is allowed or needed. */
export interface AcceptedAttemptProgress {
  readonly status: "ACCEPTED";
  /** The validated accepted evaluation, capture and proposal included, for audit. */
  readonly result: AcceptedAgentResponseEvaluation;
  readonly completedAttempts: number;
}

/** Every allowed attempt was made and rejected; no attempt is allowed. */
export interface AttemptsExhaustedProgress {
  readonly status: "ATTEMPTS_EXHAUSTED";
  readonly completedAttempts: number;
  readonly maxAttempts: number;
  /** Closed, safe rejection codes only — never a raw response or arbitrary text. */
  readonly rejectionCodes: readonly AgentResponseRejectionCode[];
}

/** Immutable, closed union: exactly what {@link decideAgentAttemptProgress} returns. */
export type AgentAttemptProgress =
  | AttemptAvailableProgress
  | AcceptedAttemptProgress
  | AttemptsExhaustedProgress;

/**
 * Decides, purely and deterministically, the next allowed progress for one
 * agent/cycle/prompt/model given the retry policy and the ordered attempts
 * made so far. Synchronous: no clock, no randomness, no I/O, no persistence.
 *
 * Sequence, with no deviation possible:
 *
 * 1. revalidates `policy` fail-closed via `parseAgentRetryPolicy`;
 * 2. requires `results` to be an array, then recomputes every entry's
 *    evaluation from its nested `capture` via `evaluateAgentResponseCapture`
 *    — a forged or structurally invalid capture throws here — and requires
 *    the entry's own declared `status`, `code` and `proposal` to match that
 *    recomputed evaluation exactly, throwing on any divergence;
 * 3. fails closed when `results` holds more entries than `policy.maxAttempts`;
 * 4. fails closed when any entry other than the last one is `ACCEPTED`;
 * 5. fails closed unless every capture shares the same `agentId`, `cycleId`,
 *    `promptVersion` and `model`;
 * 6. returns `ACCEPTED` when the last (and only the last) entry is accepted;
 *    otherwise `ATTEMPTS_EXHAUSTED` once `results.length` reaches
 *    `policy.maxAttempts`, or `ATTEMPT_AVAILABLE` otherwise.
 *
 * An empty `results` list means no attempt has been made yet and always
 * returns `ATTEMPT_AVAILABLE` with `completedAttempts: 0`.
 */
export function decideAgentAttemptProgress(
  policy: AgentRetryPolicy,
  results: readonly AgentResponseEvaluation[]
): AgentAttemptProgress {
  const validPolicy = parseAgentRetryPolicy(policy);

  if (!Array.isArray(results)) {
    rejectContract(AGENT_ATTEMPT_RESULTS, "results", "must be an array");
  }

  const evaluations = results.map(reevaluateResult);

  if (evaluations.length > validPolicy.maxAttempts) {
    rejectContract(
      AGENT_ATTEMPT_RESULTS,
      "results",
      "must not hold more entries than policy.maxAttempts"
    );
  }

  evaluations.forEach((evaluation, index) => {
    if (evaluation.status === "ACCEPTED" && index !== evaluations.length - 1) {
      rejectContract(
        AGENT_ATTEMPT_RESULTS,
        "results",
        "must not contain a result after an ACCEPTED result"
      );
    }
  });

  requireSharedProvenance(evaluations);

  const completedAttempts = evaluations.length;
  const lastEvaluation = evaluations[completedAttempts - 1];

  if (lastEvaluation !== undefined && lastEvaluation.status === "ACCEPTED") {
    const accepted: AcceptedAttemptProgress = {
      status: "ACCEPTED",
      result: lastEvaluation,
      completedAttempts
    };
    return Object.freeze(accepted);
  }

  const rejectedEvaluations = evaluations.map(requireRejected);

  if (completedAttempts === validPolicy.maxAttempts) {
    const exhausted: AttemptsExhaustedProgress = {
      status: "ATTEMPTS_EXHAUSTED",
      completedAttempts,
      maxAttempts: validPolicy.maxAttempts,
      rejectionCodes: Object.freeze(rejectedEvaluations.map((evaluation) => evaluation.code))
    };
    return Object.freeze(exhausted);
  }

  const lastRejected = rejectedEvaluations[rejectedEvaluations.length - 1];
  const available: AttemptAvailableProgress = {
    status: "ATTEMPT_AVAILABLE",
    completedAttempts,
    maxAttempts: validPolicy.maxAttempts,
    ...(lastRejected !== undefined ? { lastRejectionCode: lastRejected.code } : {})
  };
  return Object.freeze(available);
}
