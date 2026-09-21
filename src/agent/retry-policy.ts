/**
 * The smallest pure, deterministic contract for how many times an agent
 * attempt may be retried, and whether one more attempt is still allowed.
 *
 * `AgentRetryPolicy` carries only `maxAttempts`. Nothing here creates an
 * attempt, calls `AgentAdapter`, reads the clock, waits, calculates backoff,
 * uses randomness or performs I/O — deciding *that* another attempt is
 * allowed is deliberately kept separate from ever making one, the same
 * separation `src/agent/agent-adapter.ts` and
 * `src/agent/capture-agent-response.ts` already draw between calling an
 * agent and validating what it returned.
 */

import { rejectContract } from "../domain/errors.js";
import { readProperty } from "./internal/attempt-input-validation.js";

export { ContractValidationError } from "../domain/errors.js";

const AGENT_RETRY_POLICY = "AgentRetryPolicy";

/** Lower bound of `maxAttempts`, inclusive: a policy must allow at least one attempt. */
export const MIN_AGENT_RETRY_ATTEMPTS = 1;
/** Upper bound of `maxAttempts`, inclusive: at most three attempts total. */
export const MAX_AGENT_RETRY_ATTEMPTS = 3;

function requireObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireMaxAttempts(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    rejectContract(AGENT_RETRY_POLICY, "maxAttempts", "must be a safe integer");
  }
  if (value < MIN_AGENT_RETRY_ATTEMPTS || value > MAX_AGENT_RETRY_ATTEMPTS) {
    rejectContract(
      AGENT_RETRY_POLICY,
      "maxAttempts",
      `must be between ${MIN_AGENT_RETRY_ATTEMPTS} and ${MAX_AGENT_RETRY_ATTEMPTS}`
    );
  }
  return value;
}

function requireCompletedAttempts(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    rejectContract(AGENT_RETRY_POLICY, "completedAttempts", "must be a safe integer");
  }
  if (value < 0) {
    rejectContract(AGENT_RETRY_POLICY, "completedAttempts", "must not be negative");
  }
  return value;
}

/**
 * The smallest possible retry policy: an explicit, strict ceiling on how many
 * attempts one agent call may take in total, and nothing else. Carries no
 * timing, backoff or execution semantics of any kind.
 */
export interface AgentRetryPolicy {
  /** Maximum number of attempts allowed in total; a safe integer in [1, 3]. */
  readonly maxAttempts: number;
}

/**
 * Validates a retry policy and returns a frozen copy. Input is not mutated.
 * Fails closed with `ContractValidationError` unless `maxAttempts` is a safe
 * integer between {@link MIN_AGENT_RETRY_ATTEMPTS} and
 * {@link MAX_AGENT_RETRY_ATTEMPTS}, inclusive.
 *
 * `maxAttempts` is read through {@link readProperty}
 * (`./internal/attempt-input-validation.js`) rather than direct property
 * access, so a forged `value` — a `Proxy`, or a plain object with a throwing
 * `maxAttempts` getter — fails the same way a missing field would, never by
 * letting whatever the getter throws escape unsanitized.
 */
export function parseAgentRetryPolicy(value: unknown): AgentRetryPolicy {
  const source = requireObject(value, AGENT_RETRY_POLICY);
  const parsed: AgentRetryPolicy = {
    maxAttempts: requireMaxAttempts(readProperty(source, "maxAttempts"))
  };
  return Object.freeze(parsed);
}

/**
 * Decides, purely and deterministically, whether one more attempt is still
 * allowed under `policy` after `completedAttempts` attempts have already
 * happened. `policy` is revalidated here via {@link parseAgentRetryPolicy}
 * rather than trusted as already parsed: the parameter type does not stop a
 * caller from passing a forged or stale object at runtime, and this
 * function must stay fail-closed against that case, not just against a
 * bad `completedAttempts`.
 *
 * Returns `true` only when `completedAttempts` is strictly less than
 * `policy.maxAttempts` — i.e. at least one attempt remains within the
 * explicit limit. Never creates an attempt, calls `AgentAdapter`, reads the
 * clock, waits, calculates backoff, uses randomness or performs I/O.
 */
export function shouldRetryAgentAttempt(
  policy: AgentRetryPolicy,
  completedAttempts: number
): boolean {
  const validPolicy = parseAgentRetryPolicy(policy);
  const attempts = requireCompletedAttempts(completedAttempts);
  return attempts < validPolicy.maxAttempts;
}
