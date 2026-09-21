/**
 * The smallest deterministic, fail-closed composition of exactly one agent
 * attempt, kept as a thin, throwing-on-rejection wrapper around
 * `./run-auditable-agent-attempt.js`:
 *
 * ```text
 * AgentRequest → runAuditableAgentAttempt (adapter called once)
 * → ACCEPTED(AgentProposal) | REJECTED(safe code)
 * ```
 *
 * All validation — the input object, the adapter, the `AgentRequest`,
 * `responseId`, `promptVersion`, `model` — and the single `adapter.call`
 * happen inside `runAuditableAgentAttemptAs`; this module adds no second
 * implementation of that call and never touches the adapter itself. It calls
 * that shared core with this module's own contract name
 * (`RunSingleAgentAttempt`), so every one of those validation failures reads
 * exactly as it always has, unchanged by the extraction. It then translates
 * the returned `AgentResponseEvaluation` back into this function's original,
 * narrower public contract: `ACCEPTED` returns `{ capture, proposal }`,
 * `REJECTED` is converted into the same sanitized `ContractValidationError`
 * this function has always thrown for each of the six rejection codes.
 *
 * This module has no retry, delay, timeout, fallback, clock, randomness,
 * network or I/O. Deciding whether another attempt is allowed is
 * `./retry-policy.js`'s job, and actually making a further attempt is the
 * caller's, not this function's.
 *
 * Every rejection here names only the contract, field and requirement that
 * failed — never the raw response, the parsed JSON, a token, a secret or any
 * other arbitrary agent-supplied content — so an error is always safe to log
 * or show, per the same policy `src/domain/contracts.ts` documents.
 */

import { rejectContract } from "../domain/errors.js";
import { type AgentAdapter, type AgentRequest } from "./agent-adapter.js";
import { type AgentResponseCapture } from "./capture-agent-response.js";
import { type AgentResponseRejectionCode } from "./evaluate-agent-response-capture.js";
import { runAuditableAgentAttemptAs } from "./run-auditable-agent-attempt.js";
import { type AgentProposal } from "../domain/contracts.js";

export { ContractValidationError } from "../domain/errors.js";

const RUN_SINGLE_AGENT_ATTEMPT = "RunSingleAgentAttempt";
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
 * 1. delegates entirely to `runAuditableAgentAttemptAs`, called with this
 *    module's own contract name, which validates the input object,
 *    `adapter`, `request`, `responseId`, `promptVersion` and `model` —
 *    before the adapter is ever touched — then calls `adapter.call(request)`
 *    exactly once, inside a guard that turns any exception the adapter
 *    throws into a sanitized `ContractValidationError` carrying a fixed,
 *    stable message — never the thrown value's `message`, `cause`, stack or
 *    any other of its content — and does not retry;
 * 2. `runAuditableAgentAttemptAs` requires the raw result to be a `string`,
 *    then hands `{ request, responseId, rawResponse, promptVersion, model }`
 *    to `evaluateAgentResponseCapture`, which captures the response
 *    verbatim, parses it as JSON, validates it with `parseAgentProposal` and
 *    checks `agentId`/`cycleId`/`promptVersion`/`model` alignment;
 * 3. a `REJECTED` evaluation is thrown here as the same sanitized
 *    `ContractValidationError` this function has always thrown for that
 *    failure;
 * 4. an `ACCEPTED` evaluation returns `{ capture, proposal }`, frozen.
 *
 * Does not generate an id, timestamp or any other implicit value, and does
 * not retry, delay, time out or fall back — a rejection at any step ends the
 * attempt. No call to the adapter happens outside `runAuditableAgentAttemptAs`.
 */
export async function runSingleAgentAttempt(
  value: RunSingleAgentAttemptRequest
): Promise<SingleAgentAttemptResult> {
  const evaluation = await runAuditableAgentAttemptAs(RUN_SINGLE_AGENT_ATTEMPT, value);

  if (evaluation.status === "REJECTED") {
    rejectForCode(evaluation.code);
  }

  return Object.freeze({ capture: evaluation.capture, proposal: evaluation.proposal });
}
