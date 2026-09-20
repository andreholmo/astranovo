/**
 * The smallest in-memory, deterministic and auditable link between one
 * `AgentRequest` and the raw response an agent returned for it, together with
 * the explicit prompt/model versions that produced that response:
 *
 * ```text
 * AgentRequest + rawResponse + promptVersion + model → AgentResponseCapture
 * ```
 *
 * `rawResponse` is opaque at this layer: it is preserved exactly, including
 * text that is not valid JSON, and is never parsed, normalised, corrected or
 * interpreted. Turning it into a trustworthy `AgentProposal` remains entirely
 * `parseAgentProposal`'s job (`src/domain/contracts.ts`), which this module
 * never calls.
 *
 * This module has no clock, no randomness, no I/O and no persistence.
 * `responseId` is supplied by the caller — nothing here generates an
 * identifier.
 *
 * `requireBoundedText`/`requireObject` are duplicated here in miniature
 * rather than imported from `src/domain/contracts.ts`, whose helpers are
 * private to that module and whose exports this task does not authorise
 * changing. The pattern mirrors the small local revalidation already done in
 * `src/agent/agent-adapter.ts`, `src/risk/risk-manager.ts` and
 * `src/metrics/value-wallet-at.ts`.
 */

import { rejectContract } from "../domain/errors.js";
import { type AgentRequest, parseAgentRequest } from "./agent-adapter.js";

export { ContractValidationError } from "../domain/errors.js";

const AGENT_RESPONSE_CAPTURE = "AgentResponseCapture";

/** Maximum length of `responseId`. */
export const MAX_RESPONSE_ID_LENGTH = 64;
/** Maximum length of `promptVersion`. */
export const MAX_PROMPT_VERSION_LENGTH = 64;
/** Maximum length of `model`. */
export const MAX_MODEL_LENGTH = 128;
/**
 * Maximum length of `rawResponse`, in UTF-16 code units. A sanity limit
 * against unbounded memory growth, not a policy on agent output size.
 */
export const MAX_RAW_RESPONSE_LENGTH = 65_536;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

function requireObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Validates a short identifying/version string: non-empty, non-blank, bounded
 * and free of control characters. Used for `responseId`, `promptVersion` and
 * `model` — never for `rawResponse`, which is opaque and must not be
 * inspected this way.
 */
function requireBoundedText(
  value: unknown,
  contract: string,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string") rejectContract(contract, field, "must be a string");
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
 * Validates `rawResponse`: a non-empty string within an explicit length
 * limit, returned exactly as received. No trimming, no blank check beyond
 * "not empty", no control-character rejection and no other interpretation of
 * its content — an agent's raw text may legitimately contain newlines, tabs
 * or invalid JSON, and none of that makes it inadmissible at this layer.
 */
function requireRawResponse(value: unknown, contract: string, field: string): string {
  if (typeof value !== "string") rejectContract(contract, field, "must be a string");
  if (value.length === 0) rejectContract(contract, field, "must not be empty");
  if (value.length > MAX_RAW_RESPONSE_LENGTH) {
    rejectContract(contract, field, `must be at most ${MAX_RAW_RESPONSE_LENGTH} characters`);
  }
  return value;
}

/**
 * The minimal, immutable, auditable record of one raw agent response.
 *
 * Contains exactly: a validated, frozen copy of the `AgentRequest` it
 * answers; the caller-supplied `responseId`; the raw response text, preserved
 * verbatim; and the explicit `promptVersion`/`model` that produced it.
 */
export interface AgentResponseCapture {
  readonly request: AgentRequest;
  readonly responseId: string;
  readonly rawResponse: string;
  readonly promptVersion: string;
  readonly model: string;
}

/**
 * Builds and freezes an {@link AgentResponseCapture}. Pure and deterministic:
 * no clock, no randomness, no I/O, no persistence, and no identifier is
 * generated here — `responseId` must come from the caller.
 *
 * `request` is revalidated with `parseAgentRequest` regardless of whether it
 * was already parsed, so the returned capture never shares a mutable object
 * with the caller. Every other field fails closed with
 * `ContractValidationError` when missing, of the wrong type, empty/blank
 * (except `rawResponse`, which only requires non-empty), over its explicit
 * length limit, or — for `responseId`/`promptVersion`/`model` — containing a
 * control character.
 */
export function captureAgentResponse(value: unknown): AgentResponseCapture {
  const source = requireObject(value, AGENT_RESPONSE_CAPTURE);
  const parsed: AgentResponseCapture = {
    request: parseAgentRequest(source.request),
    responseId: requireBoundedText(
      source.responseId,
      AGENT_RESPONSE_CAPTURE,
      "responseId",
      MAX_RESPONSE_ID_LENGTH
    ),
    rawResponse: requireRawResponse(source.rawResponse, AGENT_RESPONSE_CAPTURE, "rawResponse"),
    promptVersion: requireBoundedText(
      source.promptVersion,
      AGENT_RESPONSE_CAPTURE,
      "promptVersion",
      MAX_PROMPT_VERSION_LENGTH
    ),
    model: requireBoundedText(source.model, AGENT_RESPONSE_CAPTURE, "model", MAX_MODEL_LENGTH)
  };
  return Object.freeze(parsed);
}
