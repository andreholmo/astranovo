/**
 * The smallest deterministic, fail-closed composition of exactly one agent
 * attempt that returns its full auditable evaluation instead of throwing on
 * a rejection:
 *
 * ```text
 * AgentRequest → AgentAdapter.call (once) → AgentResponseCapture
 * → ACCEPTED(AgentProposal) | REJECTED(safe code)
 * ```
 *
 * `runAuditableAgentAttempt` validates the input object itself, the adapter,
 * the `AgentRequest`, `responseId`, `promptVersion` and `model` — all
 * fail-closed, all before the adapter is ever touched — calls
 * `adapter.call` exactly once inside a guard that converts any exception
 * into a fixed, sanitized `ContractValidationError` (never the thrown
 * value's `message`, `cause` or stack), requires the raw result to be a
 * `string`, then hands it unmodified to `evaluateAgentResponseCapture`
 * (`./evaluate-agent-response-capture.js`) and returns its frozen
 * `AgentResponseEvaluation` directly.
 *
 * Unlike `./run-single-agent-attempt.js`, an invalid agent response here is
 * not converted into a thrown error: it comes back as a `REJECTED`
 * evaluation carrying its own capture, so the attempt stays auditable even
 * when the agent's content was unusable. Only a failure with no valid
 * capture at all — a bad input, a bad adapter, an adapter that throws, or a
 * non-string raw response — throws `ContractValidationError`, the same
 * fail-closed guarantee this boundary has always had.
 *
 * This module has no retry, delay, timeout, fallback, clock, randomness,
 * network or I/O. It calls the adapter exactly once and returns; deciding
 * whether another attempt is allowed remains `./retry-policy.js`'s job.
 *
 * `requireInputObject`/`requireBoundedText`/`requireAdapter` come from
 * `./internal/attempt-input-validation.js`, the one shared implementation of
 * this boundary also used by `./run-bounded-agent-attempts.js`, so the two
 * modules no longer keep independent copies of the same validation. Every
 * message raised through them is unchanged from what this module has always
 * thrown.
 *
 * Every property this module reads off the caller-supplied input object —
 * `adapter`, `request`, `responseId`, `promptVersion` and `model` — goes
 * through `readProperty` (same shared module), which treats a throwing
 * getter or `Proxy` trap exactly like the property being absent rather than
 * letting whatever it throws escape unsanitized.
 *
 * The validate-then-call-once sequence itself lives only in
 * {@link runAuditableAgentAttemptAs}, parameterized by the contract name used
 * in every sanitized validation failure it raises before the adapter is
 * touched. `runAuditableAgentAttempt` calls it with this module's own
 * contract name; `./run-single-agent-attempt.js` calls it with its own, so
 * that module's public messages stay byte-for-byte what they always were,
 * with no second copy of the validation or the call.
 */

import { rejectContract } from "../domain/errors.js";
import { type AgentAdapter, type AgentRequest, parseAgentRequest } from "./agent-adapter.js";
import {
  MAX_MODEL_LENGTH,
  MAX_PROMPT_VERSION_LENGTH,
  MAX_RESPONSE_ID_LENGTH
} from "./capture-agent-response.js";
import {
  evaluateAgentResponseCapture,
  type AgentResponseEvaluation
} from "./evaluate-agent-response-capture.js";
import {
  readProperty,
  requireAdapter,
  requireBoundedText,
  requireInputObject
} from "./internal/attempt-input-validation.js";

export { ContractValidationError } from "../domain/errors.js";

const RUN_AUDITABLE_AGENT_ATTEMPT = "RunAuditableAgentAttempt";
const AGENT_ADAPTER_CALL = "AgentAdapterCall";
const RAW_AGENT_RESPONSE = "RawAgentResponse";

/** Everything one single, non-retried, auditable agent attempt depends on. */
export interface RunAuditableAgentAttemptRequest {
  /** Adapter called exactly once by this attempt. Never mutated. */
  readonly adapter: AgentAdapter;
  /** Request identifying the agent, cycle and snapshot. Revalidated, never mutated. */
  readonly request: AgentRequest;
  /** Caller-supplied identifier for the captured response. Nothing here generates one. */
  readonly responseId: string;
  /** Prompt version this attempt used, required to match the returned proposal exactly. */
  readonly promptVersion: string;
  /** Model identifier this attempt used, required to match the returned proposal exactly. */
  readonly model: string;
}

/**
 * Runs exactly one agent attempt and returns its full auditable evaluation,
 * raising every fail-closed validation error under `contract` rather than a
 * fixed name. This is the only implementation of the validate-then-call-once
 * sequence: `runAuditableAgentAttempt` below calls it with this module's own
 * contract name, and `./run-single-agent-attempt.js` calls it with its own,
 * so each caller's sanitized messages read exactly as that caller's public
 * contract has always promised. Synchronous work wrapped in `async` only to
 * preserve the existing boundary's calling convention; there is no `await`
 * on any I/O.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates the input object itself, then `adapter`, `request`,
 *    `responseId`, `promptVersion` and `model` — before the adapter is ever
 *    touched;
 * 2. calls `adapter.call(request)` exactly once, inside a guard that turns
 *    any exception the adapter throws into a sanitized
 *    `ContractValidationError` carrying a fixed, stable message — never the
 *    thrown value's `message`, `cause`, stack or any other of its content —
 *    and does not retry;
 * 3. requires the raw result to be a `string`; any other type fails closed
 *    before a capture is ever created;
 * 4. hands `{ request, responseId, rawResponse, promptVersion, model }`,
 *    unmodified, to `evaluateAgentResponseCapture`, which captures the
 *    response verbatim, parses it as JSON, validates it with
 *    `parseAgentProposal` and checks
 *    `agentId`/`cycleId`/`promptVersion`/`model` alignment;
 * 5. returns that frozen `AgentResponseEvaluation` directly — `ACCEPTED` or
 *    `REJECTED`, capture included either way.
 *
 * Does not generate an id, timestamp or any other implicit value, and does
 * not retry, delay, time out or fall back — a rejection at any step ends the
 * attempt.
 */
export async function runAuditableAgentAttemptAs(
  contract: string,
  value: RunAuditableAgentAttemptRequest
): Promise<AgentResponseEvaluation> {
  const source = requireInputObject(value, contract);

  const adapter = requireAdapter(readProperty(source, "adapter"), contract);
  const request = parseAgentRequest(readProperty(source, "request"));
  const responseId = requireBoundedText(
    readProperty(source, "responseId"),
    contract,
    "responseId",
    MAX_RESPONSE_ID_LENGTH
  );
  const promptVersion = requireBoundedText(
    readProperty(source, "promptVersion"),
    contract,
    "promptVersion",
    MAX_PROMPT_VERSION_LENGTH
  );
  const model = requireBoundedText(readProperty(source, "model"), contract, "model", MAX_MODEL_LENGTH);

  let rawResponse: unknown;
  try {
    rawResponse = adapter.call(request);
  } catch {
    rejectContract(AGENT_ADAPTER_CALL, "rawResponse", "adapter.call must not throw");
  }
  if (typeof rawResponse !== "string") {
    rejectContract(RAW_AGENT_RESPONSE, "rawResponse", "must be a string");
  }

  return evaluateAgentResponseCapture({
    request,
    responseId,
    rawResponse,
    promptVersion,
    model
  });
}

/**
 * Runs exactly one agent attempt and returns its full auditable evaluation,
 * using this module's own contract name (`RunAuditableAgentAttempt`) for
 * every validation failure. See {@link runAuditableAgentAttemptAs} for the
 * full sequence.
 */
export async function runAuditableAgentAttempt(
  value: RunAuditableAgentAttemptRequest
): Promise<AgentResponseEvaluation> {
  return runAuditableAgentAttemptAs(RUN_AUDITABLE_AGENT_ATTEMPT, value);
}
