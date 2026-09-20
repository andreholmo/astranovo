/**
 * The smallest pure evaluation that turns an already-captured raw agent
 * response into an auditable outcome:
 *
 * ```text
 * AgentResponseCapture → ACCEPTED(AgentProposal) | REJECTED(safe code)
 * ```
 *
 * The capture is preserved in both outcomes, even when the agent's content
 * turns out to be invalid, so a rejected attempt never disappears from the
 * audit trail. This module never calls an adapter, never retries and never
 * decides whether another attempt is allowed — those remain
 * `./run-single-agent-attempt.js` and `./retry-policy.js`'s jobs.
 *
 * `value` is revalidated fail-closed with `captureAgentResponse`
 * (`./capture-agent-response.js`) before any content is evaluated, so a
 * forged or structurally invalid capture throws `ContractValidationError`
 * the same way it always has — it never reaches, and is never disguised as,
 * a `REJECTED` business outcome. `rawResponse` itself is never altered by
 * that revalidation.
 *
 * A `REJECTED` outcome carries exactly one closed, safe code — never the raw
 * response, the parsed JSON, a message, a stack, a cause or any other
 * agent-supplied content — so it is always safe to log or show.
 *
 * This module has no clock, no randomness, no I/O and no persistence.
 */

import { parseAgentProposal, type AgentProposal } from "../domain/contracts.js";
import { ContractValidationError } from "../domain/errors.js";
import { captureAgentResponse, type AgentResponseCapture } from "./capture-agent-response.js";

export { ContractValidationError } from "../domain/errors.js";

/** Closed set of safe reasons a captured response can be rejected for. */
export const AGENT_RESPONSE_REJECTION_CODES = [
  "INVALID_JSON",
  "INVALID_PROPOSAL",
  "AGENT_ID_MISMATCH",
  "CYCLE_ID_MISMATCH",
  "PROMPT_VERSION_MISMATCH",
  "MODEL_MISMATCH"
] as const;

/** One of {@link AGENT_RESPONSE_REJECTION_CODES}. Never a message, value or arbitrary text. */
export type AgentResponseRejectionCode = (typeof AGENT_RESPONSE_REJECTION_CODES)[number];

/** The capture's content was accepted: it decodes to a proposal aligned with its own request. */
export interface AcceptedAgentResponseEvaluation {
  readonly status: "ACCEPTED";
  readonly capture: AgentResponseCapture;
  readonly proposal: AgentProposal;
}

/** The capture's content was rejected. The capture itself is still preserved for audit. */
export interface RejectedAgentResponseEvaluation {
  readonly status: "REJECTED";
  readonly capture: AgentResponseCapture;
  readonly code: AgentResponseRejectionCode;
}

/** Immutable discriminated union: exactly what {@link evaluateAgentResponseCapture} returns. */
export type AgentResponseEvaluation =
  | AcceptedAgentResponseEvaluation
  | RejectedAgentResponseEvaluation;

function rejected(
  capture: AgentResponseCapture,
  code: AgentResponseRejectionCode
): RejectedAgentResponseEvaluation {
  return Object.freeze({ status: "REJECTED", capture, code });
}

/**
 * Evaluates a raw agent response capture and returns a frozen, auditable
 * outcome. Synchronous, pure and deterministic: no clock, no randomness, no
 * I/O, no persistence.
 *
 * Sequence, with no deviation possible:
 *
 * 1. revalidates `value` fail-closed as a complete `AgentResponseCapture` via
 *    `captureAgentResponse`, without altering `rawResponse` — a forged or
 *    structurally invalid capture throws `ContractValidationError` here,
 *    before any content is evaluated;
 * 2. parses `rawResponse` as JSON — invalid JSON is `REJECTED` with
 *    `INVALID_JSON`;
 * 3. validates the parsed value with `parseAgentProposal` — an invalid shape
 *    is `REJECTED` with `INVALID_PROPOSAL`;
 * 4. requires the proposal's `agentId`, `cycleId`, `promptVersion` and
 *    `model` to equal the capture's own request/`promptVersion`/`model`,
 *    exactly — the first mismatch found is `REJECTED` with the matching
 *    `*_MISMATCH` code;
 * 5. otherwise returns `ACCEPTED` with the validated capture and proposal.
 *
 * The returned capture is always the revalidated, frozen copy from step 1 —
 * identical byte for byte to the input's `rawResponse` — regardless of
 * whether the outcome is `ACCEPTED` or `REJECTED`.
 */
export function evaluateAgentResponseCapture(value: unknown): AgentResponseEvaluation {
  const capture = captureAgentResponse(value);

  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(capture.rawResponse) as unknown;
  } catch {
    return rejected(capture, "INVALID_JSON");
  }

  let proposal: AgentProposal;
  try {
    proposal = parseAgentProposal(parsedResponse);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return rejected(capture, "INVALID_PROPOSAL");
    }
    throw error;
  }

  if (proposal.agentId !== capture.request.agentId) {
    return rejected(capture, "AGENT_ID_MISMATCH");
  }
  if (proposal.cycleId !== capture.request.cycleId) {
    return rejected(capture, "CYCLE_ID_MISMATCH");
  }
  if (proposal.promptVersion !== capture.promptVersion) {
    return rejected(capture, "PROMPT_VERSION_MISMATCH");
  }
  if (proposal.model !== capture.model) {
    return rejected(capture, "MODEL_MISMATCH");
  }

  return Object.freeze({ status: "ACCEPTED", capture, proposal });
}
