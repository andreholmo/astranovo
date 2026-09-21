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
 * similarly never trusted as an already-computed
 * `AgentResponseEvaluation`: only its nested `capture` is read, and the full
 * evaluation is recomputed via {@link evaluateAgentResponseCapture}
 * (`./evaluate-agent-response-capture.js`), which itself revalidates the
 * capture fail-closed via `captureAgentResponse`. A caller-forged `status`,
 * `proposal` or `code` on an entry is therefore never trusted — it is always
 * replaced by the recomputed, trustworthy evaluation.
 *
 * `ATTEMPT_AVAILABLE` and `ATTEMPTS_EXHAUSTED` never carry a capture, a raw
 * response or a proposal — only counts and closed, safe rejection codes.
 * Only `ACCEPTED` preserves the accepted evaluation (capture and proposal)
 * for audit, exactly as the task requires.
 *
 * This module has no clock, no randomness, no I/O and no persistence.
 */

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
 * Recomputes one entry's evaluation from scratch, using only its nested
 * `capture` — never the caller-supplied `status`, `proposal` or `code`, which
 * a forged entry could set to anything.
 */
function reevaluateResult(value: unknown): AgentResponseEvaluation {
  const source = requireObject(value, AGENT_ATTEMPT_RESULTS);
  return evaluateAgentResponseCapture(source.capture);
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
 *    — a forged or structurally invalid capture throws here;
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
