/**
 * The smallest offline composition of sequential, auditable agent attempts,
 * bounded strictly by an already-validated {@link AgentRetryPolicy}:
 *
 * ```text
 * AgentRetryPolicy + explicit responseIds
 * → runAuditableAgentAttempt (one call per attempt)
 * → decideAgentAttemptProgress (continue | ACCEPTED | ATTEMPTS_EXHAUSTED)
 * ```
 *
 * `runBoundedAgentAttempts` never creates an attempt on its own initiative: it
 * validates every input fail-closed — including the entire `responseIds`
 * list — before `adapter` is ever touched, then calls
 * `runAuditableAgentAttempt` (`./run-auditable-agent-attempt.js`) exactly once
 * per attempt, using `decideAgentAttemptProgress`
 * (`./decide-agent-attempt-progress.js`) after every evaluation to decide
 * whether to stop at `ACCEPTED`, stop at `ATTEMPTS_EXHAUSTED`, or make the
 * next attempt. A `REJECTED` evaluation is the only thing that ever leads to
 * another attempt; a thrown error from `runAuditableAgentAttempt` — a failure
 * from before any capture existed — propagates immediately, sanitized, with
 * no further attempt.
 *
 * `responseIds` is supplied by the caller in full, one id per attempt allowed
 * by `policy.maxAttempts`, in the exact order they will be used. Nothing here
 * generates, normalizes, reorders or deduces an id; a caller who provides too
 * few, too many, duplicate or malformed ids fails closed before the adapter
 * is touched.
 *
 * This module has no retry beyond the policy's own limit, no backoff, no
 * delay, no timeout, no clock, no randomness, no network, no SDK and no
 * persistence. It does not alter the public contract of
 * `runAuditableAgentAttempt`, `runSingleAgentAttempt`,
 * `decideAgentAttemptProgress` or `AgentRetryPolicy`.
 *
 * `requireInputObject`/`requireBoundedText`/`requireAdapter`/`readAdapterCall`
 * are duplicated here in miniature rather than imported from sibling modules,
 * whose helpers are private and whose exports this task does not authorise
 * changing. The pattern mirrors the small local revalidation already done
 * throughout `src/agent`.
 */

import { rejectContract } from "../domain/errors.js";
import { type AgentAdapter, type AgentRequest, parseAgentRequest } from "./agent-adapter.js";
import {
  MAX_MODEL_LENGTH,
  MAX_PROMPT_VERSION_LENGTH,
  MAX_RESPONSE_ID_LENGTH
} from "./capture-agent-response.js";
import {
  decideAgentAttemptProgress
} from "./decide-agent-attempt-progress.js";
import {
  type AcceptedAgentResponseEvaluation,
  type AgentResponseEvaluation,
  type AgentResponseRejectionCode,
  type RejectedAgentResponseEvaluation
} from "./evaluate-agent-response-capture.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "./retry-policy.js";
import { runAuditableAgentAttempt } from "./run-auditable-agent-attempt.js";

export { ContractValidationError } from "../domain/errors.js";

const RUN_BOUNDED_AGENT_ATTEMPTS = "RunBoundedAgentAttempts";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

function requireInputObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Validates a short identifying/version string: non-empty, non-blank, bounded
 * and free of control characters. Used only for `responseIds` entries,
 * `promptVersion` and `model` metadata — validated here before the adapter is
 * ever touched, never for agent-supplied content.
 */
function requireBoundedText(value: unknown, contract: string, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    rejectContract(contract, field, "must be a string");
  }
  if (value.length === 0 || value.trim().length === 0) {
    rejectContract(contract, field, "must not be empty or blank");
  }
  if (value.length > maxLength) {
    rejectContract(contract, field, `must be at most ${maxLength} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    rejectContract(contract, field, "must not contain control characters");
  }
  return value;
}

/**
 * Reads `value.call` defensively: a forged adapter can make `call` a getter
 * (directly, or via a `Proxy` `get` trap) that throws instead of returning a
 * function, and whatever it throws — message, stack, cause, a secret — must
 * never escape this check. Any exception here means "no usable `call`",
 * exactly like the property being absent; it never rethrows the original
 * value.
 */
function readAdapterCall(value: object): unknown {
  try {
    return (value as { call?: unknown }).call;
  } catch {
    return undefined;
  }
}

/**
 * Validates fail-closed, before any call is attempted, that `value` is a
 * usable `AgentAdapter` — an object exposing a `call` function. Never invokes
 * it and never inspects its result.
 */
function requireAdapter(value: unknown, contract: string): AgentAdapter {
  const isObject = typeof value === "object" && value !== null;
  const call = isObject ? readAdapterCall(value) : undefined;
  if (!isObject || typeof call !== "function") {
    rejectContract(contract, "adapter", "must be an object exposing a call(request) function");
  }
  return value as AgentAdapter;
}

/**
 * Validates `responseIds` fail-closed: must be an array with exactly
 * `maxAttempts` entries, each a valid, bounded id string, with no duplicate
 * — checked in the exact order supplied. Never generates, trims, reorders or
 * substitutes an id.
 */
function requireResponseIds(value: unknown, maxAttempts: number, contract: string): readonly string[] {
  if (!Array.isArray(value)) {
    rejectContract(contract, "responseIds", "must be an array");
  }
  if (value.length !== maxAttempts) {
    rejectContract(contract, "responseIds", "must have exactly policy.maxAttempts entries");
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    const id = requireBoundedText(entry, contract, "responseIds", MAX_RESPONSE_ID_LENGTH);
    if (seen.has(id)) {
      rejectContract(contract, "responseIds", "must not contain duplicate ids");
    }
    seen.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

/**
 * Fails closed unless every entry of `evaluations` is `REJECTED`. Only ever
 * called once `decideAgentAttemptProgress` has already reported
 * `ATTEMPTS_EXHAUSTED` for the same list, so this documents and enforces that
 * guarantee rather than merely assuming it.
 */
function requireAllRejected(
  evaluations: readonly AgentResponseEvaluation[]
): readonly RejectedAgentResponseEvaluation[] {
  return Object.freeze(
    evaluations.map((evaluation) => {
      if (evaluation.status !== "REJECTED") {
        rejectContract(
          RUN_BOUNDED_AGENT_ATTEMPTS,
          "evaluations",
          "must all be REJECTED once attempts are exhausted"
        );
      }
      return evaluation;
    })
  );
}

/** Everything a bounded sequence of auditable agent attempts depends on. */
export interface RunBoundedAgentAttemptsRequest {
  /** Adapter called at most once per attempt. Never mutated. */
  readonly adapter: AgentAdapter;
  /** Request identifying the agent, cycle and snapshot. Revalidated, never mutated. */
  readonly request: AgentRequest;
  /** Strict ceiling on how many attempts this call may take. Revalidated. */
  readonly policy: AgentRetryPolicy;
  /**
   * Caller-supplied ids, one per allowed attempt, in the exact order they
   * will be used. Must have exactly `policy.maxAttempts` entries, all valid
   * and distinct. Nothing here generates, normalizes or deduces an id.
   */
  readonly responseIds: readonly string[];
  /** Prompt version every attempt uses, required to match each returned proposal exactly. */
  readonly promptVersion: string;
  /** Model identifier every attempt uses, required to match each returned proposal exactly. */
  readonly model: string;
}

/** The first (and only) accepted attempt stopped the sequence immediately. */
export interface AcceptedBoundedAgentAttempts {
  readonly status: "ACCEPTED";
  /** Every evaluation made, in order, including the accepted one. */
  readonly evaluations: readonly AgentResponseEvaluation[];
  /** The accepted evaluation, capture and proposal included, for audit. */
  readonly result: AcceptedAgentResponseEvaluation;
}

/** Every allowed attempt was made and rejected; no further attempt is allowed. */
export interface AttemptsExhaustedBoundedAgentAttempts {
  readonly status: "ATTEMPTS_EXHAUSTED";
  /** Every evaluation made, in order — all `REJECTED`. */
  readonly evaluations: readonly RejectedAgentResponseEvaluation[];
  /** Closed, safe rejection codes only, in order — never a raw response or arbitrary text. */
  readonly rejectionCodes: readonly AgentResponseRejectionCode[];
}

/** Immutable, closed union: exactly what {@link runBoundedAgentAttempts} returns. */
export type BoundedAgentAttemptsResult =
  | AcceptedBoundedAgentAttempts
  | AttemptsExhaustedBoundedAgentAttempts;

/**
 * Runs at most `policy.maxAttempts` sequential, auditable agent attempts and
 * returns a frozen, closed result. Asynchronous only because
 * `runAuditableAgentAttempt` is; there is no timer, delay, backoff, clock,
 * randomness, network or I/O anywhere in this module.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates the input object itself, `adapter`, `request`, `policy`,
 *    every entry of `responseIds`, `promptVersion` and `model` — all
 *    fail-closed, all before the adapter is ever touched;
 * 2. requires `responseIds.length === policy.maxAttempts`, every id valid and
 *    distinct, in the exact order supplied;
 * 3. calls `runAuditableAgentAttempt` exactly once per attempt, using the
 *    next unused `responseId` in order;
 * 4. after each evaluation, calls `decideAgentAttemptProgress` with the full
 *    history made so far to decide whether to stop at `ACCEPTED`, stop at
 *    `ATTEMPTS_EXHAUSTED`, or make the next attempt — the next attempt only
 *    ever happens after a `REJECTED` evaluation;
 * 5. if `runAuditableAgentAttempt` throws — a failure from before any capture
 *    existed — the sanitized error propagates immediately and no further
 *    attempt is made;
 * 6. returns a frozen `ACCEPTED` result (every evaluation made, plus the
 *    accepted one) or a frozen `ATTEMPTS_EXHAUSTED` result (every evaluation
 *    made, all rejected, plus their closed codes in order).
 *
 * Never generates an id, timestamp or any other implicit value.
 */
export async function runBoundedAgentAttempts(
  value: RunBoundedAgentAttemptsRequest
): Promise<BoundedAgentAttemptsResult> {
  const source = requireInputObject(value, RUN_BOUNDED_AGENT_ATTEMPTS);

  const adapter = requireAdapter(source.adapter, RUN_BOUNDED_AGENT_ATTEMPTS);
  const request = parseAgentRequest(source.request);
  const policy = parseAgentRetryPolicy(source.policy);
  const responseIds = requireResponseIds(source.responseIds, policy.maxAttempts, RUN_BOUNDED_AGENT_ATTEMPTS);
  const promptVersion = requireBoundedText(
    source.promptVersion,
    RUN_BOUNDED_AGENT_ATTEMPTS,
    "promptVersion",
    MAX_PROMPT_VERSION_LENGTH
  );
  const model = requireBoundedText(source.model, RUN_BOUNDED_AGENT_ATTEMPTS, "model", MAX_MODEL_LENGTH);

  async function attemptAt(
    index: number,
    evaluations: readonly AgentResponseEvaluation[]
  ): Promise<BoundedAgentAttemptsResult> {
    const responseId = responseIds[index];
    if (responseId === undefined) {
      rejectContract(RUN_BOUNDED_AGENT_ATTEMPTS, "responseIds", "must provide a responseId for every attempt");
    }

    const evaluation = await runAuditableAgentAttempt({ adapter, request, responseId, promptVersion, model });
    const nextEvaluations = Object.freeze([...evaluations, evaluation]);
    const progress = decideAgentAttemptProgress(policy, nextEvaluations);

    if (progress.status === "ACCEPTED") {
      const accepted: AcceptedBoundedAgentAttempts = {
        status: "ACCEPTED",
        evaluations: nextEvaluations,
        result: progress.result
      };
      return Object.freeze(accepted);
    }

    if (progress.status === "ATTEMPTS_EXHAUSTED") {
      const exhausted: AttemptsExhaustedBoundedAgentAttempts = {
        status: "ATTEMPTS_EXHAUSTED",
        evaluations: requireAllRejected(nextEvaluations),
        rejectionCodes: progress.rejectionCodes
      };
      return Object.freeze(exhausted);
    }

    return attemptAt(index + 1, nextEvaluations);
  }

  return attemptAt(0, Object.freeze([]));
}
