/**
 * The smallest offline composition that closes one agent's cycle end to end:
 *
 * ```text
 * RunBoundedAgentAttemptsRequest
 * → runBoundedAgentAttempts (once)
 * → finalizeBoundedAgentAttempts (once)
 * → ACCEPTED | HOLD
 * ```
 *
 * `runFinalizedAgentCycle` creates no logic of its own: it calls
 * `runBoundedAgentAttempts` (`./run-bounded-agent-attempts.js`) exactly once
 * and hands its returned `BoundedAgentAttemptsResult` directly to
 * `finalizeBoundedAgentAttempts` (`./finalize-bounded-agent-attempts.js`)
 * exactly once, returning that call's result unchanged. Both callees already
 * validate, retry-bound, capture and finalize fail-closed on their own; this
 * module does not re-validate, re-capture, re-decide progress or re-finalize
 * any of it.
 *
 * A rejection thrown by `runBoundedAgentAttempts` — a failure from before any
 * capture existed — propagates immediately, already sanitized by that
 * module; no further attempt is made and `finalizeBoundedAgentAttempts` is
 * never called. Nothing here generates an id, timestamp, message, proposal or
 * any other implicit value.
 *
 * This module has no retry, backoff, delay, timeout, clock, randomness,
 * network, SDK, environment variable or persistence of any kind. It does not
 * alter the public contract of `runBoundedAgentAttempts` or
 * `finalizeBoundedAgentAttempts`.
 */

export { ContractValidationError } from "../domain/errors.js";
export {
  finalizeBoundedAgentAttempts,
  type FinalizedBoundedAgentAttemptsResult
} from "./finalize-bounded-agent-attempts.js";
export {
  runBoundedAgentAttempts,
  type RunBoundedAgentAttemptsRequest
} from "./run-bounded-agent-attempts.js";

import { finalizeBoundedAgentAttempts, type FinalizedBoundedAgentAttemptsResult } from "./finalize-bounded-agent-attempts.js";
import { runBoundedAgentAttempts, type RunBoundedAgentAttemptsRequest } from "./run-bounded-agent-attempts.js";

/**
 * Runs the one existing bounded attempt sequence for `value` and finalizes
 * its result with the one existing finalizer, returning
 * {@link FinalizedBoundedAgentAttemptsResult} directly.
 *
 * Sequence, with no deviation possible:
 *
 * 1. calls `runBoundedAgentAttempts(value)` exactly once;
 * 2. if it throws, the sanitized error propagates immediately and
 *    `finalizeBoundedAgentAttempts` is never called;
 * 3. otherwise calls `finalizeBoundedAgentAttempts` exactly once with the
 *    returned `BoundedAgentAttemptsResult`, unmodified, and returns its
 *    result directly.
 */
export async function runFinalizedAgentCycle(
  value: RunBoundedAgentAttemptsRequest
): Promise<FinalizedBoundedAgentAttemptsResult> {
  const result = await runBoundedAgentAttempts(value);
  return finalizeBoundedAgentAttempts(result);
}
