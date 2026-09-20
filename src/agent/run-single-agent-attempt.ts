/**
 * The smallest deterministic, fail-closed composition of exactly one agent
 * attempt:
 *
 * ```text
 * AgentRequest → StubAgentAdapter (or any AgentAdapter) → auditable capture
 * → validated AgentProposal
 * ```
 *
 * `runSingleAgentAttempt` validates every piece of metadata it was given,
 * including that the adapter itself is a usable `AgentAdapter`, *before*
 * touching the adapter, calls `adapter.call` exactly once inside a guard that
 * converts any exception the adapter throws into a sanitized
 * `ContractValidationError` (never the thrown value's message, cause or
 * stack), requires the raw response to be a string, preserves it byte for byte via
 * `captureAgentResponse` (`./capture-agent-response.js`), then interprets
 * that string as JSON and validates it with `parseAgentProposal`
 * (`../domain/contracts.js`) — the only place in this module that judges the
 * agent's content. It never parses, normalises or corrects the raw response
 * itself, and never accepts a proposal whose `agentId`/`cycleId`/
 * `promptVersion`/`model` disagree with what this attempt asked for and was
 * told it used.
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
import { parseAgentProposal, type AgentProposal } from "../domain/contracts.js";
import { type AgentAdapter, type AgentRequest, parseAgentRequest } from "./agent-adapter.js";
import {
  captureAgentResponse,
  type AgentResponseCapture,
  MAX_MODEL_LENGTH,
  MAX_PROMPT_VERSION_LENGTH,
  MAX_RESPONSE_ID_LENGTH
} from "./capture-agent-response.js";

export { ContractValidationError } from "../domain/errors.js";

const RUN_SINGLE_AGENT_ATTEMPT = "RunSingleAgentAttempt";
const AGENT_ADAPTER_CALL = "AgentAdapterCall";
const RAW_AGENT_RESPONSE = "RawAgentResponse";
const AGENT_PROPOSAL_ALIGNMENT = "AgentProposalAlignment";

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
 * 4. captures it verbatim with `captureAgentResponse`;
 * 5. parses that string as JSON and validates the result with
 *    `parseAgentProposal`;
 * 6. requires the proposal's `agentId` and `cycleId` to equal the request's,
 *    exactly;
 * 7. requires the proposal's `promptVersion` and `model` to equal the
 *    metadata this attempt was given, exactly;
 * 8. returns `{ capture, proposal }`, frozen.
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

  const capture = captureAgentResponse({ request, responseId, rawResponse, promptVersion, model });

  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(rawResponse) as unknown;
  } catch {
    rejectContract(RAW_AGENT_RESPONSE, "rawResponse", "must be valid JSON");
  }

  const proposal = parseAgentProposal(parsedResponse);

  if (proposal.agentId !== request.agentId) {
    rejectContract(AGENT_PROPOSAL_ALIGNMENT, "agentId", "must match the request agentId exactly");
  }
  if (proposal.cycleId !== request.cycleId) {
    rejectContract(AGENT_PROPOSAL_ALIGNMENT, "cycleId", "must match the request cycleId exactly");
  }
  if (proposal.promptVersion !== promptVersion) {
    rejectContract(AGENT_PROPOSAL_ALIGNMENT, "promptVersion", "must match the attempt's promptVersion exactly");
  }
  if (proposal.model !== model) {
    rejectContract(AGENT_PROPOSAL_ALIGNMENT, "model", "must match the attempt's model exactly");
  }

  return Object.freeze({ capture, proposal });
}
