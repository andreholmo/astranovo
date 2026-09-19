/**
 * The minimal, auditable boundary between an agent and a raw response.
 *
 * `AgentAdapter` only produces a raw, unvalidated response (`unknown`) for an
 * immutable `AgentRequest`. Turning that raw value into a trustworthy
 * `AgentProposal` is `parseAgentProposal`'s job (`src/domain/contracts.ts`),
 * deliberately kept out of this module: an adapter that both fetches and
 * validates could quietly "fix" or invent fields on the way through.
 *
 * This module has no network, SDK, clock, randomness or I/O. It is the seam a
 * future real integration (Astra or otherwise) would fit behind, not one that
 * exists in this repository (D-002, out of scope for this task).
 *
 * `agentId`/`cycleId`/`snapshotId` validation is duplicated here in miniature
 * rather than imported from `src/domain/contracts.ts`, whose slug/identifier
 * helpers are private to that module and whose exports this task does not
 * authorise changing. The pattern mirrors the small local revalidation already
 * done in `src/risk/risk-manager.ts` and `src/metrics/value-wallet-at.ts`.
 */

import { rejectContract } from "../domain/errors.js";

export { ContractValidationError } from "../domain/errors.js";

const MAX_SLUG_LENGTH = 64;
const MAX_IDENTIFIER_LENGTH = 64;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

const AGENT_REQUEST = "AgentRequest";

function requireObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, contract: string, field: string, maxLength: number): string {
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

function requireSlug(value: unknown, contract: string, field: string): string {
  const text = requireText(value, contract, field, MAX_SLUG_LENGTH);
  if (!SLUG_PATTERN.test(text)) {
    rejectContract(contract, field, "must be a lowercase slug such as trend-following");
  }
  return text;
}

function requireIdentifier(value: unknown, contract: string, field: string): string {
  const text = requireText(value, contract, field, MAX_IDENTIFIER_LENGTH);
  if (!IDENTIFIER_PATTERN.test(text)) {
    rejectContract(contract, field, "must be alphanumeric with . _ : - separators");
  }
  return text;
}

/**
 * One immutable request for a raw agent response, identified exactly by the
 * agent, the decision cycle and the market snapshot it is deciding over.
 */
export interface AgentRequest {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly cycleId: string;
  readonly snapshotId: string;
}

/** Validates an agent request and returns a frozen copy. Input is not mutated. */
export function parseAgentRequest(value: unknown): AgentRequest {
  const source = requireObject(value, AGENT_REQUEST);
  if (source.schemaVersion !== 1) {
    rejectContract(AGENT_REQUEST, "schemaVersion", "must be exactly 1");
  }
  const parsed: AgentRequest = {
    schemaVersion: 1,
    agentId: requireSlug(source.agentId, AGENT_REQUEST, "agentId"),
    cycleId: requireIdentifier(source.cycleId, AGENT_REQUEST, "cycleId"),
    snapshotId: requireIdentifier(source.snapshotId, AGENT_REQUEST, "snapshotId")
  };
  return Object.freeze(parsed);
}

/**
 * Minimal, auditable boundary for obtaining one raw agent response.
 *
 * An implementation must return exactly one raw response per request — never
 * infer, complete, retry or partially interpret it — and must never reach a
 * broker, wallet or ledger. Validating the shape of the returned value is
 * explicitly out of scope for this boundary; the caller forwards it to
 * `parseAgentProposal`.
 */
export interface AgentAdapter {
  call(request: AgentRequest): unknown;
}
