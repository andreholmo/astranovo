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
 * `requireBoundedText`/`requireObject` are duplicated here in miniature
 * rather than imported from sibling modules, whose helpers are private and
 * whose exports this task does not authorise changing. The pattern mirrors
 * the small local revalidation already done throughout `src/agent`.
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

export { ContractValidationError } from "../domain/errors.js";

const RUN_AUDITABLE_AGENT_ATTEMPT = "RunAuditableAgentAttempt";
const AGENT_ADAPTER_CALL = "AgentAdapterCall";
const RAW_AGENT_RESPONSE = "RawAgentResponse";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

function requireInputObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Validates a short identifying/version string: non-empty, non-blank, bounded
 * and free of control characters. Used only for `responseId`, `promptVersion`
 * and `model` metadata, validated here before the adapter is ever touched —
 * never for agent-supplied content.
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
 * it and never inspects its result. Reading the `call` property itself is
 * guarded so a forged adapter cannot use a throwing getter/proxy to leak a
 * value through this check.
 */
function requireAdapter(value: unknown, contract: string): AgentAdapter {
  const isObject = typeof value === "object" && value !== null;
  const call = isObject ? readAdapterCall(value) : undefined;
  if (!isObject || typeof call !== "function") {
    rejectContract(contract, "adapter", "must be an object exposing a call(request) function");
  }
  return value as AgentAdapter;
}

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

  const adapter = requireAdapter(source.adapter, contract);
  const request = parseAgentRequest(source.request);
  const responseId = requireBoundedText(source.responseId, contract, "responseId", MAX_RESPONSE_ID_LENGTH);
  const promptVersion = requireBoundedText(
    source.promptVersion,
    contract,
    "promptVersion",
    MAX_PROMPT_VERSION_LENGTH
  );
  const model = requireBoundedText(source.model, contract, "model", MAX_MODEL_LENGTH);

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
