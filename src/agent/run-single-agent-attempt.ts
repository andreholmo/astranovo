/**
 * The smallest deterministic, fail-closed composition of exactly one agent
 * attempt:
 *
 * ```text
 * AgentRequest → StubAgentAdapter (or any AgentAdapter) → auditable capture
 * → ACCEPTED(AgentProposal) | REJECTED(safe code)
 * ```
 *
 * `runSingleAgentAttempt` validates every piece of metadata it was given,
 * including that the adapter itself is a usable `AgentAdapter`, *before*
 * touching the adapter, calls `adapter.call` exactly once inside a guard that
 * converts any exception the adapter throws into a sanitized
 * `ContractValidationError` (never the thrown value's message, cause or
 * stack), then hands the raw result to `evaluateAgentResponseCapture`
 * (`./evaluate-agent-response-capture.js`) — the only place that captures the
 * response byte for byte, interprets it as JSON, validates it with
 * `parseAgentProposal` and checks `agentId`/`cycleId`/`promptVersion`/`model`
 * alignment. This module never parses, normalises or corrects the raw
 * response itself, and turns a `REJECTED` evaluation into the same sanitized
 * `ContractValidationError` this function has always thrown, so its public
 * contract — a rejected proposal throws, an accepted one returns
 * `{ capture, proposal }` — is unchanged.
 *
 * This module has no retry, delay, timeout, fallback, clock, randomness,
 * network or I/O. It calls the adapter exactly once and returns; deciding
 * whether another attempt is allowed is `./retry-policy.js`'s job, and
 * actually making a further attempt is the caller's, not this function's.
 *
 * Every rejection here names only the contract, field and requirement that
 * failed — never the raw response, the parsed JSON, a token, a secret or any
 * other arbitrary agent-supplied content — so an error is always safe to log
 * or show, per the same policy `src/domain/contracts.ts` documents.
 *
 * `requireBoundedText` is duplicated here in miniature rather than imported
 * from `./capture-agent-response.ts`, whose helpers are private to that
 * module and whose exports this task does not authorise changing. The
 * pattern mirrors the small local revalidation already done in
 * `src/agent/agent-adapter.ts`, `src/agent/capture-agent-response.ts`,
 * `src/risk/risk-manager.ts` and `src/metrics/value-wallet-at.ts`.
 */

import { rejectContract } from "../domain/errors.js";
import { type AgentAdapter, type AgentRequest, parseAgentRequest } from "./agent-adapter.js";
import {
  MAX_MODEL_LENGTH,
  MAX_PROMPT_VERSION_LENGTH,
  MAX_RESPONSE_ID_LENGTH,
  type AgentResponseCapture
} from "./capture-agent-response.js";
import {
  evaluateAgentResponseCapture,
  type AgentResponseRejectionCode
} from "./evaluate-agent-response-capture.js";
import { type AgentProposal } from "../domain/contracts.js";

export { ContractValidationError } from "../domain/errors.js";

const RUN_SINGLE_AGENT_ATTEMPT = "RunSingleAgentAttempt";
const AGENT_ADAPTER_CALL = "AgentAdapterCall";
const RAW_AGENT_RESPONSE = "RawAgentResponse";
const AGENT_PROPOSAL_ALIGNMENT = "AgentProposalAlignment";

/**
 * Converts a `REJECTED` {@link AgentResponseRejectionCode} into the same
 * sanitized `ContractValidationError` this function has always thrown for
 * that failure, so the public contract of `runSingleAgentAttempt` is
 * unchanged by delegating evaluation to `evaluateAgentResponseCapture`.
 */
function rejectForCode(code: AgentResponseRejectionCode): never {
  switch (code) {
    case "INVALID_JSON":
      rejectContract(RAW_AGENT_RESPONSE, "rawResponse", "must be valid JSON");
      break;
    case "INVALID_PROPOSAL":
      rejectContract(RAW_AGENT_RESPONSE, "rawResponse", "must decode to a valid AgentProposal");
      break;
    case "AGENT_ID_MISMATCH":
      rejectContract(AGENT_PROPOSAL_ALIGNMENT, "agentId", "must match the request agentId exactly");
      break;
    case "CYCLE_ID_MISMATCH":
      rejectContract(AGENT_PROPOSAL_ALIGNMENT, "cycleId", "must match the request cycleId exactly");
      break;
    case "PROMPT_VERSION_MISMATCH":
      rejectContract(
        AGENT_PROPOSAL_ALIGNMENT,
        "promptVersion",
        "must match the attempt's promptVersion exactly"
      );
      break;
    case "MODEL_MISMATCH":
      rejectContract(AGENT_PROPOSAL_ALIGNMENT, "model", "must match the attempt's model exactly");
      break;
  }
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Validates a short identifying/version string: non-empty, non-blank, bounded
 * and free of control characters. Used only for `responseId`, `promptVersion`
 * and `model` metadata, validated here before the adapter is ever called —
 * never for agent-supplied content.
 */
function requireBoundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") rejectContract(RUN_SINGLE_AGENT_ATTEMPT, field, "must be a string");
  if (value.length === 0 || value.trim().length === 0) {
    rejectContract(RUN_SINGLE_AGENT_ATTEMPT, field, "must not be empty or blank");
  }
  if (value.length > maxLength) {
    rejectContract(RUN_SINGLE_AGENT_ATTEMPT, field, `must be at most ${maxLength} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    rejectContract(RUN_SINGLE_AGENT_ATTEMPT, field, "must not contain control characters");
  }
  return value;
}

/**
 * Validates fail-closed, before any call is attempted, that `value` is a
 * usable `AgentAdapter` — an object exposing a `call` function. Never invokes
 * it and never inspects its result.
 */
function requireAdapter(value: unknown): AgentAdapter {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { call?: unknown }).call !== "function"
  ) {
    rejectContract(RUN_SINGLE_AGENT_ATTEMPT, "adapter", "must be an object exposing a call(request) function");
  }
  return value as AgentAdapter;
}

/** Everything one single, non-retried agent attempt depends on. */
export interface RunSingleAgentAttemptRequest {
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
 * The minimal, immutable outcome of one completed agent attempt: the
 * auditable capture of the raw response, and the `AgentProposal` validated
 * from it. Nothing else is attached.
 */
export interface SingleAgentAttemptResult {
  readonly capture: AgentResponseCapture;
  readonly proposal: AgentProposal;
}

/**
 * Runs exactly one agent attempt and returns its validated result, or throws
 * `ContractValidationError` fail-closed.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates `adapter`, `request`, `responseId`, `promptVersion` and
 *    `model` — before the adapter is ever touched;
 * 2. calls `adapter.call(request)` exactly once, inside a guard that turns
 *    any exception the adapter throws into a sanitized
 *    `ContractValidationError` carrying a fixed, stable message — never the
 *    thrown value's `message`, `cause`, stack or any other of its content —
 *    and does not retry;
 * 3. requires the raw result to be a `string`;
 * 4. hands `{ request, responseId, rawResponse, promptVersion, model }` to
 *    `evaluateAgentResponseCapture`, which captures the response verbatim,
 *    parses it as JSON, validates it with `parseAgentProposal` and checks
 *    `agentId`/`cycleId`/`promptVersion`/`model` alignment;
 * 5. a `REJECTED` evaluation is thrown here as the same sanitized
 *    `ContractValidationError` this function has always thrown for that
 *    failure;
 * 6. an `ACCEPTED` evaluation returns `{ capture, proposal }`, frozen.
 *
 * Does not generate an id, timestamp or any other implicit value, and does
 * not retry, delay, time out or fall back — a rejection at any step ends the
 * attempt.
 */
export async function runSingleAgentAttempt(
  value: RunSingleAgentAttemptRequest
): Promise<SingleAgentAttemptResult> {
  const {
    adapter: rawAdapter,
    request: rawRequest,
    responseId: rawResponseId,
    promptVersion: rawPromptVersion,
    model: rawModel
  } = value;

  const adapter = requireAdapter(rawAdapter);
  const request = parseAgentRequest(rawRequest);
  const responseId = requireBoundedText(rawResponseId, "responseId", MAX_RESPONSE_ID_LENGTH);
  const promptVersion = requireBoundedText(rawPromptVersion, "promptVersion", MAX_PROMPT_VERSION_LENGTH);
  const model = requireBoundedText(rawModel, "model", MAX_MODEL_LENGTH);

  let rawResponse: unknown;
  try {
    rawResponse = adapter.call(request);
  } catch {
    rejectContract(AGENT_ADAPTER_CALL, "rawResponse", "adapter.call must not throw");
  }
  if (typeof rawResponse !== "string") {
    rejectContract(RAW_AGENT_RESPONSE, "rawResponse", "must be a string");
  }

  const evaluation = evaluateAgentResponseCapture({
    request,
    responseId,
    rawResponse,
    promptVersion,
    model
  });

  if (evaluation.status === "REJECTED") {
    rejectForCode(evaluation.code);
  }

  return Object.freeze({ capture: evaluation.capture, proposal: evaluation.proposal });
}
