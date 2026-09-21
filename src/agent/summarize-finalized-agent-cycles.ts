/**
 * The smallest pure, offline transformation that turns an already-finalized
 * batch (`./run-finalized-agent-cycles.js`) into a summary for observability
 * and audit only:
 *
 * ```text
 * FinalizedAgentCycleBatchResults
 * → summarizeFinalizedAgentCycles
 * → total + ACCEPTED + HOLD + FAILED (counts and ordered itemId lists)
 * ```
 *
 * This module classifies nothing about an agent's skill or performance; it
 * only counts and lists identities already produced upstream. It never
 * ranks, scores, votes, selects a winner or a proposal, and never calls an
 * `AgentAdapter`, `RiskManager`, `PaperBroker`, retry loop or finalizer — it
 * only reads the outcome already recorded by `runFinalizedAgentCycles` and
 * `finalizeBoundedAgentAttempts`.
 *
 * `value` is never trusted as an already-valid `FinalizedAgentCycleBatchResults`
 * just because of its declared TypeScript type: it must be a real, non-empty,
 * dense array with no extra, non-enumerable or `Symbol`-keyed property
 * anywhere on it, and every entry a JSON object with a distinct, bounded
 * `itemId` and exactly the closed set of properties its own `status`
 * discriminant allows — `COMPLETED` entries exactly `itemId`/`status`/`result`,
 * `FAILED` entries exactly `itemId`/`status`/`code` with `code` equal to the
 * single closed value `AGENT_CYCLE_FAILED`. A `COMPLETED` entry's nested
 * `result` is read only far enough to discriminate `ACCEPTED` from `HOLD`,
 * confirm it carries exactly the closed set of properties that outcome
 * allows, and confirm each required property has the closed shape/value its
 * own union demands — `HOLD`'s `reason` equal to the single closed value
 * `ATTEMPTS_EXHAUSTED`; `evaluations` (both outcomes) a dense array, with no
 * extra property anywhere on it, holding between one and
 * `MAX_AGENT_RETRY_ATTEMPTS` entries, each entry itself a JSON object with
 * exactly the closed set of properties its own `status` allows (`REJECTED`:
 * `status`/`capture`/`code` with `code` one of the closed
 * `AgentResponseRejectionCode` values; `ACCEPTED`: `status`/`capture`/`proposal`),
 * with `capture`/`proposal` each required to carry their own closed public
 * shape — `capture` exactly `AgentResponseCapture`'s own keys, `request`
 * itself closed-shaped; `proposal` exactly `AgentProposal`'s own keys, with
 * `action` one of the closed proposal actions and `evidenceIds` a dense array
 * of strings with no extra property anywhere on it. For `ACCEPTED`: only the
 * last `evaluations` entry may itself be `ACCEPTED` — every earlier one must
 * be `REJECTED` — and `result` must carry the same closed `ACCEPTED`-shape
 * and match that last evaluation's `capture`/`proposal` field for field,
 * exactly; a `result` with the right shape but different content, or an
 * `evaluations` list that never reaches (or reaches early, or more than once)
 * an `ACCEPTED` entry, both fail closed. `HOLD`'s `evaluations` entries are
 * every one `REJECTED`-shaped, and its `rejectionCodes` a dense array, with no
 * extra property anywhere on it, matching those entries' own declared `code`s
 * exactly, in count and order. None of this recomputes an attempt or a
 * result: `evaluateAgentResponseCapture`, `captureAgentResponse` and
 * `parseAgentProposal` are never called, and nothing here confirms a
 * `capture` genuinely produced the `proposal`/`code` sitting beside it, or
 * that a `rawResponse` decodes to anything at all — only that every shape is
 * internally consistent, closed, and — for `ACCEPTED` — that `result` and the
 * last evaluation structurally agree. This module never duplicates
 * `finalizeBoundedAgentAttempts`'s own recomputation-based revalidation;
 * exactly like `runFinalizedAgentCycles` intentionally leaves each item's
 * `request` unvalidated at its own boundary, this module intentionally
 * leaves every `capture`'s `rawResponse` content and `request`'s business
 * rules (slug/identifier patterns, length bounds) unvalidated at this
 * boundary, because that content is never interpreted, copied or exposed
 * here — only compared, field for field, against another equally
 * shape-validated value from the same untrusted input.
 *
 * Every read of the untrusted batch — its `length`, each index, each item's
 * and each nested `result`'s own keys and fields — goes through the same
 * defensive primitives (`readProperty`, a local `Reflect.ownKeys`-based exact-
 * key check) already used across `src/agent`, so a throwing getter or `Proxy`
 * trap anywhere — including one that throws an already-forged
 * `ContractValidationError` carrying a secret — can never escape this
 * validation unsanitized; it is treated exactly like the value being absent.
 *
 * The summary carries only `itemId` strings and counts derived from them.
 * No proposal, capture, evaluation, rejection code, error message or other
 * free text from any item ever reaches the returned summary.
 *
 * This module has no aggregation beyond counting, no ranking, scoring,
 * voting, consensus, handoff, proposal selection, Risk Manager, `PaperBroker`,
 * fill, wallet, ledger or persistence. It has no HTTP, external SDK, queue,
 * timer, clock, randomness, environment variable, token, secret, credential,
 * wallet, blockchain, testnet, exchange or real money.
 */

import { PROPOSAL_ACTIONS } from "../domain/contracts.js";
import { ContractValidationError, rejectContract } from "../domain/errors.js";
import { AGENT_RESPONSE_REJECTION_CODES, type AgentResponseRejectionCode } from "./evaluate-agent-response-capture.js";
import { readProperty, requireBoundedText, requireInputObject } from "./internal/attempt-input-validation.js";
import { MAX_AGENT_RETRY_ATTEMPTS, MIN_AGENT_RETRY_ATTEMPTS } from "./retry-policy.js";
import { type FinalizedAgentCycleBatchResults } from "./run-finalized-agent-cycles.js";

export { ContractValidationError } from "../domain/errors.js";
export type { FinalizedAgentCycleBatchResults } from "./run-finalized-agent-cycles.js";

const SUMMARIZE_FINALIZED_AGENT_CYCLES = "SummarizeFinalizedAgentCycles";
const MAX_ITEM_ID_LENGTH = 64;

/** Exact own keys a batch result entry may have for each top-level discriminant. */
const COMPLETED_ITEM_KEYS = ["itemId", "status", "result"] as const;
const FAILED_ITEM_KEYS = ["itemId", "status", "code"] as const;

/** Exact own keys a `COMPLETED` entry's nested `result` may have for each discriminant. Mirrors `finalize-bounded-agent-attempts.ts`'s closed shapes without importing its private constants. */
const ACCEPTED_RESULT_KEYS = ["status", "evaluations", "result"] as const;
const HOLD_RESULT_KEYS = ["status", "reason", "evaluations", "rejectionCodes"] as const;

/** Closed set of reasons a `HOLD` result may declare. Mirrors `finalize-bounded-agent-attempts.ts`'s `AGENT_ATTEMPTS_HOLD_REASONS` without importing it. */
const HOLD_RESULT_REASON = "ATTEMPTS_EXHAUSTED";

/** Exact own keys one `evaluations` entry may have for each discriminant. Mirrors `finalize-bounded-agent-attempts.ts`'s closed shapes without importing its private constants. */
const REJECTED_EVALUATION_KEYS = ["status", "capture", "code"] as const;
const ACCEPTED_EVALUATION_KEYS = ["status", "capture", "proposal"] as const;

/** Exact own keys an `AgentRequest` may have. Mirrors `agent-adapter.ts`'s closed shape without importing its private validators. */
const REQUEST_KEYS = ["schemaVersion", "agentId", "cycleId", "snapshotId"] as const;

/** Exact own keys an `AgentResponseCapture` may have. Mirrors `capture-agent-response.ts`'s closed shape without importing its private validators. */
const CAPTURE_KEYS = ["request", "responseId", "rawResponse", "promptVersion", "model"] as const;

/** Exact own keys an `AgentProposal` may have. Mirrors `src/domain/contracts.ts`'s closed shape without importing its private validators. */
const PROPOSAL_KEYS = [
  "schemaVersion",
  "proposalId",
  "cycleId",
  "agentId",
  "action",
  "asset",
  "confidence",
  "positionPct",
  "reason",
  "veto",
  "evidenceIds",
  "promptVersion",
  "model"
] as const;

/** Immutable, closed, frozen summary of a finalized batch: counts plus ordered `itemId` lists per category. Observability/audit only. */
export interface FinalizedAgentCyclesSummary {
  readonly total: number;
  readonly acceptedCount: number;
  readonly holdCount: number;
  readonly failedCount: number;
  /** `itemId`s of every `COMPLETED/ACCEPTED` item, in original batch order. */
  readonly acceptedItemIds: readonly string[];
  /** `itemId`s of every `COMPLETED/HOLD` item, in original batch order. */
  readonly holdItemIds: readonly string[];
  /** `itemId`s of every `FAILED` item, in original batch order. */
  readonly failedItemIds: readonly string[];
}

/**
 * Reads every own property key of `value` — enumerable or not, string or
 * symbol — via `Reflect.ownKeys`, so a closed-key check below cannot be
 * defeated by hiding an extra property behind non-enumerability or a symbol
 * key. A `Proxy`'s `ownKeys` trap throwing anything at all — including a
 * forged, already-`ContractValidationError` value carrying a secret — is
 * treated exactly like an empty key list and never rethrown.
 */
function safeOwnKeys(value: object): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return [];
  }
}

/** Whether `value`'s own keys — enumerable or not, string or symbol — are exactly `expectedKeys`. */
function hasExactOwnKeys(value: object, expectedKeys: readonly string[]): boolean {
  const actualKeys = safeOwnKeys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  );
}

/** Whether `key` is the canonical string form of an integer index in `[0, length)`, e.g. `"0"`, never `"00"` or `"-0"`. */
function isCanonicalArrayIndex(key: PropertyKey, length: number): boolean {
  if (typeof key !== "string" || key === "length") return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

/**
 * Whether `value`'s own keys — enumerable or not, string or symbol — are
 * exactly a dense array of `length` own keys: `"length"` plus each canonical
 * index `"0"..String(length - 1)`, nothing more, nothing missing.
 *
 * Deliberately never builds an expected-keys list sized off the untrusted
 * `length`: a real sparse array or a `Proxy` can report a huge `length` while
 * owning only a handful of actual keys, and allocating or iterating a
 * structure proportional to that declared `length` before checking
 * cardinality is itself a memory/CPU exhaustion vector. Instead,
 * {@link safeOwnKeys} is read once — its cost is bounded by the *actual*
 * number of own keys the target reports, not by the declared `length` — and
 * rejected immediately when that count doesn't match `length + 1`.
 */
function hasExactDenseArrayKeys(value: object, length: number): boolean {
  const actualKeys = safeOwnKeys(value);
  if (actualKeys.length !== length + 1) return false;

  let sawLength = false;
  const seenIndices = new Set<number>();
  for (const key of actualKeys) {
    if (key === "length") {
      sawLength = true;
      continue;
    }
    if (!isCanonicalArrayIndex(key, length)) return false;
    seenIndices.add(Number(key));
  }
  return sawLength && seenIndices.size === length;
}

/**
 * Whether `value` is a real array, without ever throwing: `Array.isArray`
 * itself can throw on a revoked `Proxy`, and a throwing check here must be
 * treated exactly like "not an array" rather than escaping unsanitized.
 */
function safeIsArray(value: unknown): boolean {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

/** Whether `value` is a non-null, non-array JSON object — never `null`, an array or a primitive. */
function isJsonObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !safeIsArray(value);
}

/** Whether `value` is one of the closed {@link AGENT_RESPONSE_REJECTION_CODES} values — never an arbitrary string standing in for one. */
function isKnownRejectionCode(value: unknown): value is AgentResponseRejectionCode {
  return typeof value === "string" && (AGENT_RESPONSE_REJECTION_CODES as readonly string[]).includes(value);
}

/** The `agentId`/`cycleId`/`snapshotId` triple that identifies an `AgentRequest`, validated only shape-wise — never recomputed against a real request. */
interface ValidatedRequestFields {
  readonly agentId: string;
  readonly cycleId: string;
  readonly snapshotId: string;
}

/** A `capture`'s closed public fields, validated shape-wise only — never recomputed with `captureAgentResponse`. */
interface ValidatedCaptureFields {
  readonly request: ValidatedRequestFields;
  readonly responseId: string;
  readonly rawResponse: string;
  readonly promptVersion: string;
  readonly model: string;
}

/** A `proposal`'s closed public fields, validated shape-wise only — never recomputed with `parseAgentProposal`. */
interface ValidatedProposalFields {
  readonly proposalId: string;
  readonly cycleId: string;
  readonly agentId: string;
  readonly action: string;
  readonly asset: string;
  readonly confidence: number;
  readonly positionPct: number;
  readonly reason: string;
  readonly veto: boolean;
  readonly evidenceIds: readonly string[];
  readonly promptVersion: string;
  readonly model: string;
}

/** Fails closed unless `value` is a non-empty string. Never bounds its length or inspects its content beyond that: length/pattern limits belong to the real parsers this module never calls. */
function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must be a non-empty string");
  }
  return value;
}

/**
 * Validates a declared `request`'s closed public shape — exactly `AgentRequest`'s
 * own keys, a `schemaVersion` equal to the single closed value `1`, and
 * `agentId`/`cycleId`/`snapshotId` each a non-empty string. Never calls
 * `parseAgentRequest`: this confirms the value is shape-consistent, not that it
 * was genuinely produced by a real request.
 */
function requireClosedRequestShape(value: unknown, field: string): ValidatedRequestFields {
  if (!isJsonObject(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "request must be a JSON object");
  }
  if (!hasExactOwnKeys(value, REQUEST_KEYS)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "request must have exactly the expected properties");
  }
  if (readProperty(value, "schemaVersion") !== 1) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "request schemaVersion must be exactly 1");
  }
  return {
    agentId: requireNonEmptyString(readProperty(value, "agentId"), field),
    cycleId: requireNonEmptyString(readProperty(value, "cycleId"), field),
    snapshotId: requireNonEmptyString(readProperty(value, "snapshotId"), field)
  };
}

/**
 * Validates a declared `capture`'s closed public shape — exactly
 * `AgentResponseCapture`'s own keys, with `request` itself closed-shaped and
 * `responseId`/`rawResponse`/`promptVersion`/`model` each a non-empty string.
 * Never calls `captureAgentResponse` and never inspects `rawResponse`'s
 * content: this confirms the value is shape-consistent, not that it was
 * genuinely produced by a real capture.
 */
function requireClosedCaptureShape(value: unknown, field: string): ValidatedCaptureFields {
  if (!isJsonObject(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "capture must be a JSON object");
  }
  if (!hasExactOwnKeys(value, CAPTURE_KEYS)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "capture must have exactly the expected properties");
  }
  return {
    request: requireClosedRequestShape(readProperty(value, "request"), field),
    responseId: requireNonEmptyString(readProperty(value, "responseId"), field),
    rawResponse: requireNonEmptyString(readProperty(value, "rawResponse"), field),
    promptVersion: requireNonEmptyString(readProperty(value, "promptVersion"), field),
    model: requireNonEmptyString(readProperty(value, "model"), field)
  };
}

/** {@link requireDenseArrayEntries} for a `proposal`'s `evidenceIds`, additionally requiring every entry to be a non-empty string. */
function requireClosedEvidenceIds(value: unknown, field: string): readonly string[] {
  return requireDenseArrayEntries(value, field).map((entry) => requireNonEmptyString(entry, field));
}

/**
 * Validates a declared `proposal`'s closed public shape — exactly
 * `AgentProposal`'s own keys, with `schemaVersion` equal to the single closed
 * value `1`, `action` one of the closed {@link PROPOSAL_ACTIONS} values,
 * `confidence`/`positionPct` finite numbers, `veto` a boolean, `evidenceIds` a
 * dense array of non-empty strings with no extra property anywhere on it, and
 * every remaining field a non-empty string. Never calls `parseAgentProposal`:
 * this confirms the value is shape-consistent, not that it was genuinely
 * produced by a real proposal.
 */
function requireClosedProposalShape(value: unknown, field: string): ValidatedProposalFields {
  if (!isJsonObject(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal must be a JSON object");
  }
  if (!hasExactOwnKeys(value, PROPOSAL_KEYS)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal must have exactly the expected properties");
  }
  if (readProperty(value, "schemaVersion") !== 1) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal schemaVersion must be exactly 1");
  }
  const action = readProperty(value, "action");
  if (typeof action !== "string" || !(PROPOSAL_ACTIONS as readonly string[]).includes(action)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal action must be a closed action value");
  }
  const confidence = readProperty(value, "confidence");
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal confidence must be a finite number");
  }
  const positionPct = readProperty(value, "positionPct");
  if (typeof positionPct !== "number" || !Number.isFinite(positionPct)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal positionPct must be a finite number");
  }
  const veto = readProperty(value, "veto");
  if (typeof veto !== "boolean") {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal veto must be a boolean");
  }
  return {
    proposalId: requireNonEmptyString(readProperty(value, "proposalId"), field),
    cycleId: requireNonEmptyString(readProperty(value, "cycleId"), field),
    agentId: requireNonEmptyString(readProperty(value, "agentId"), field),
    action,
    asset: requireNonEmptyString(readProperty(value, "asset"), field),
    confidence,
    positionPct,
    reason: requireNonEmptyString(readProperty(value, "reason"), field),
    veto,
    evidenceIds: requireClosedEvidenceIds(readProperty(value, "evidenceIds"), field),
    promptVersion: requireNonEmptyString(readProperty(value, "promptVersion"), field),
    model: requireNonEmptyString(readProperty(value, "model"), field)
  };
}

/** Structural equality between two already shape-validated {@link ValidatedRequestFields}. */
function requestFieldsEqual(a: ValidatedRequestFields, b: ValidatedRequestFields): boolean {
  return a.agentId === b.agentId && a.cycleId === b.cycleId && a.snapshotId === b.snapshotId;
}

/** Structural equality between two already shape-validated {@link ValidatedCaptureFields}. */
function captureFieldsEqual(a: ValidatedCaptureFields, b: ValidatedCaptureFields): boolean {
  return (
    a.responseId === b.responseId &&
    a.rawResponse === b.rawResponse &&
    a.promptVersion === b.promptVersion &&
    a.model === b.model &&
    requestFieldsEqual(a.request, b.request)
  );
}

/** Element-wise equality between two already shape-validated `evidenceIds` lists, order-sensitive. */
function evidenceIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Structural equality between two already shape-validated {@link ValidatedProposalFields}. */
function proposalFieldsEqual(a: ValidatedProposalFields, b: ValidatedProposalFields): boolean {
  return (
    a.proposalId === b.proposalId &&
    a.cycleId === b.cycleId &&
    a.agentId === b.agentId &&
    a.action === b.action &&
    a.asset === b.asset &&
    a.confidence === b.confidence &&
    a.positionPct === b.positionPct &&
    a.reason === b.reason &&
    a.veto === b.veto &&
    a.promptVersion === b.promptVersion &&
    a.model === b.model &&
    evidenceIdsEqual(a.evidenceIds, b.evidenceIds)
  );
}

/**
 * Reads `value` as a dense array — exactly `"length"` plus each canonical
 * index, nothing more, checked the same fail-closed, declared-length-agnostic
 * way {@link hasExactDenseArrayKeys} already checks the outer batch array —
 * and returns its entries in order. Every read goes through
 * {@link readProperty}, so a throwing getter or `Proxy` trap anywhere is
 * treated exactly like a missing entry rather than escaping unsanitized.
 */
function requireDenseArrayEntries(value: unknown, field: string): readonly unknown[] {
  if (!safeIsArray(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must be an array");
  }
  const arrayValue = value as object;
  const length = readProperty(arrayValue, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must be an array");
  }
  if (!hasExactDenseArrayKeys(arrayValue, length)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must be a dense array with no extra properties");
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    entries.push(readProperty(arrayValue, String(index)));
  }
  return entries;
}

/** {@link requireDenseArrayEntries} for `evaluations`, additionally bounded to `[MIN_AGENT_RETRY_ATTEMPTS, MAX_AGENT_RETRY_ATTEMPTS]`, mirroring `finalize-bounded-agent-attempts.ts`'s own bound without recomputing anything. */
function requireEvaluationEntries(value: unknown): readonly unknown[] {
  const entries = requireDenseArrayEntries(value, "evaluations");
  if (entries.length < MIN_AGENT_RETRY_ATTEMPTS || entries.length > MAX_AGENT_RETRY_ATTEMPTS) {
    rejectContract(
      SUMMARIZE_FINALIZED_AGENT_CYCLES,
      "evaluations",
      `must hold between ${MIN_AGENT_RETRY_ATTEMPTS} and ${MAX_AGENT_RETRY_ATTEMPTS} entries`
    );
  }
  return entries;
}

/** One `evaluations` entry (or `ACCEPTED.result`), validated to its own closed shape, `REJECTED`-shaped. */
interface RejectedEvaluationShape {
  readonly status: "REJECTED";
  readonly capture: ValidatedCaptureFields;
  readonly code: AgentResponseRejectionCode;
}

/** One `evaluations` entry (or `ACCEPTED.result`), validated to its own closed shape, `ACCEPTED`-shaped. */
interface AcceptedEvaluationShape {
  readonly status: "ACCEPTED";
  readonly capture: ValidatedCaptureFields;
  readonly proposal: ValidatedProposalFields;
}

type ValidatedEvaluationShape = RejectedEvaluationShape | AcceptedEvaluationShape;

/** Whether two already shape-validated `ACCEPTED` evaluation shapes are field-for-field equal. */
function acceptedEvaluationShapesMatch(a: AcceptedEvaluationShape, b: AcceptedEvaluationShape): boolean {
  return captureFieldsEqual(a.capture, b.capture) && proposalFieldsEqual(a.proposal, b.proposal);
}

/**
 * Validates one `evaluations` entry's own closed shape, purely structurally
 * and without recomputing anything: a JSON object with exactly the closed
 * set of properties its own declared `status` allows — `REJECTED` with
 * `code` one of the closed {@link AGENT_RESPONSE_REJECTION_CODES} values,
 * `ACCEPTED` with `proposal` closed-shaped — and `capture` closed-shaped in
 * both cases. Never calls `evaluateAgentResponseCapture`, `captureAgentResponse`
 * or `parseAgentProposal`: this confirms the entry is internally
 * shape-consistent, not that it was genuinely produced by evaluating a real
 * capture.
 */
function requireEvaluationEntryShape(value: unknown, field: string): ValidatedEvaluationShape {
  if (!isJsonObject(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "each entry must be a JSON object");
  }
  const status = readProperty(value, "status");
  if (status === "REJECTED") {
    if (!hasExactOwnKeys(value, REJECTED_EVALUATION_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must have exactly the expected REJECTED evaluation properties");
    }
    const capture = requireClosedCaptureShape(readProperty(value, "capture"), field);
    const code = readProperty(value, "code");
    if (!isKnownRejectionCode(code)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "code must be a closed rejection code");
    }
    return { status: "REJECTED", capture, code };
  }
  if (status === "ACCEPTED") {
    if (!hasExactOwnKeys(value, ACCEPTED_EVALUATION_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must have exactly the expected ACCEPTED evaluation properties");
    }
    const capture = requireClosedCaptureShape(readProperty(value, "capture"), field);
    const proposal = requireClosedProposalShape(readProperty(value, "proposal"), field);
    return { status: "ACCEPTED", capture, proposal };
  }
  rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "status must be ACCEPTED or REJECTED");
}

type FinalizedAgentCycleCategory = "ACCEPTED" | "HOLD" | "FAILED";

interface ValidatedSummaryItem {
  readonly itemId: string;
  readonly category: FinalizedAgentCycleCategory;
}

/**
 * Reads and classifies one `COMPLETED` entry's nested `result`, without
 * recomputing or trusting anything about it beyond its own closed shape: this
 * module never recalculates an attempt or a result, so `result` is read only
 * far enough to discriminate `ACCEPTED` from `HOLD`, to confirm it carries
 * exactly the closed set of properties that discriminant allows, and to
 * confirm each required property has the closed shape/value its own union
 * demands — never a `capture`'s `rawResponse` content, and never copied into
 * the summary.
 *
 * A closed union member is not "revalidated" by checking only its top-level
 * key set: `HOLD`'s `reason` must be the single closed value
 * `ATTEMPTS_EXHAUSTED` — never arbitrary free text; `evaluations` (both
 * outcomes) must be a dense array of one to `MAX_AGENT_RETRY_ATTEMPTS`
 * entries, each itself closed-shaped, with `capture`/`proposal` each their
 * own closed public shape, and, for `HOLD`, every entry `REJECTED`-shaped
 * with a closed rejection code. For `ACCEPTED`: an `evaluations` entry may
 * only be `ACCEPTED`-shaped in the last position — an earlier one, or more
 * than one, fails closed — the last entry must exist and be `ACCEPTED`, and
 * `result` must itself be `ACCEPTED`-shaped and structurally identical to
 * that last entry's `capture` and `proposal`, field for field; a
 * `result` carrying a different capture/proposal, an all-`REJECTED`
 * `evaluations` list, or an `ACCEPTED` evaluation anywhere but last, all fail
 * closed. `HOLD`'s `rejectionCodes` must be a dense array matching the
 * declared evaluations' own codes exactly, in count and order. Checking this
 * remains strictly shallower than `finalize-bounded-agent-attempts.ts`'s own
 * recomputation: it never reads what is inside any `capture`'s
 * `rawResponse`, and never calls `evaluateAgentResponseCapture`.
 */
function classifyCompletedResult(value: unknown): "ACCEPTED" | "HOLD" {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "must be a JSON object");
  }
  const status = readProperty(value, "status");
  if (status === "ACCEPTED") {
    if (!hasExactOwnKeys(value, ACCEPTED_RESULT_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "must have exactly the expected ACCEPTED properties");
    }
    const evaluationEntries = requireEvaluationEntries(readProperty(value, "evaluations"));
    const evaluationShapes = evaluationEntries.map((entry) => requireEvaluationEntryShape(entry, "evaluations"));
    evaluationShapes.forEach((shape, index) => {
      if (shape.status === "ACCEPTED" && index !== evaluationShapes.length - 1) {
        rejectContract(
          SUMMARIZE_FINALIZED_AGENT_CYCLES,
          "evaluations",
          "must not contain an ACCEPTED evaluation before the last entry"
        );
      }
    });
    const last = evaluationShapes[evaluationShapes.length - 1];
    if (last === undefined || last.status !== "ACCEPTED") {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "evaluations", "must end with an ACCEPTED evaluation");
    }
    const resultShape = requireEvaluationEntryShape(readProperty(value, "result"), "result");
    if (resultShape.status !== "ACCEPTED" || !acceptedEvaluationShapesMatch(resultShape, last)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "must match the last accepted evaluation exactly");
    }
    return "ACCEPTED";
  }
  if (status === "HOLD") {
    if (!hasExactOwnKeys(value, HOLD_RESULT_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "must have exactly the expected HOLD properties");
    }
    if (readProperty(value, "reason") !== HOLD_RESULT_REASON) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "reason must be ATTEMPTS_EXHAUSTED");
    }
    const evaluationEntries = requireEvaluationEntries(readProperty(value, "evaluations"));
    const declaredCodes: AgentResponseRejectionCode[] = [];
    for (const entry of evaluationEntries) {
      const shape = requireEvaluationEntryShape(entry, "evaluations");
      if (shape.status !== "REJECTED") {
        rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "evaluations", "must be entirely REJECTED for HOLD");
      }
      declaredCodes.push(shape.code);
    }
    const rejectionCodeEntries = requireDenseArrayEntries(readProperty(value, "rejectionCodes"), "rejectionCodes");
    const codesMatch =
      rejectionCodeEntries.length === declaredCodes.length &&
      rejectionCodeEntries.every((code, index) => code === declaredCodes[index]);
    if (!codesMatch) {
      rejectContract(
        SUMMARIZE_FINALIZED_AGENT_CYCLES,
        "rejectionCodes",
        "must match the declared evaluations' rejection codes, in order"
      );
    }
    return "HOLD";
  }
  rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "status must be ACCEPTED or HOLD");
}

/**
 * Validates one batch result entry fail-closed: a JSON object with a
 * distinct, non-empty, bounded `itemId`, and exactly the closed set of
 * properties its own `status` allows — `COMPLETED` with a classifiable
 * `result`, or `FAILED` with `code` exactly `AGENT_CYCLE_FAILED`. Any other
 * declared `status`, or a `FAILED` entry with any other `code`, fails closed.
 */
function requireSummaryItem(value: unknown): ValidatedSummaryItem {
  const source = requireInputObject(value, SUMMARIZE_FINALIZED_AGENT_CYCLES);
  const status = readProperty(source, "status");

  if (status === "COMPLETED") {
    if (!hasExactOwnKeys(source, COMPLETED_ITEM_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "items", "must have exactly itemId, status and result");
    }
    const itemId = requireBoundedText(
      readProperty(source, "itemId"),
      SUMMARIZE_FINALIZED_AGENT_CYCLES,
      "itemId",
      MAX_ITEM_ID_LENGTH
    );
    const category = classifyCompletedResult(readProperty(source, "result"));
    return { itemId, category };
  }

  if (status === "FAILED") {
    if (!hasExactOwnKeys(source, FAILED_ITEM_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "items", "must have exactly itemId, status and code");
    }
    const itemId = requireBoundedText(
      readProperty(source, "itemId"),
      SUMMARIZE_FINALIZED_AGENT_CYCLES,
      "itemId",
      MAX_ITEM_ID_LENGTH
    );
    if (readProperty(source, "code") !== "AGENT_CYCLE_FAILED") {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "code", "must be AGENT_CYCLE_FAILED");
    }
    return { itemId, category: "FAILED" };
  }

  rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "status", "must be COMPLETED or FAILED");
}

/**
 * Validates the entire batch fail-closed, before any classification happens:
 * `value` must be a real array (never an array-like), with at least one
 * entry, and exactly as many own keys as a dense array of that length would
 * have — `"length"` plus each numeric index — so a hole, or an
 * extra/non-enumerable/`Symbol`-keyed property anywhere on the array itself,
 * fails here. Every entry must be a valid summary item with a distinct
 * `itemId`, checked in the exact order supplied.
 *
 * `length` and each entry are read through {@link readProperty}, never
 * `for...of`, so a forged array-like cannot leak a thrown value through a
 * `Symbol.iterator` trap; a throwing read is treated exactly like a missing
 * entry.
 */
function requireSummaryItems(value: unknown): readonly ValidatedSummaryItem[] {
  if (!Array.isArray(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "value", "must be a non-empty array");
  }
  const length = readProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "value", "must be a non-empty array");
  }
  if (!hasExactDenseArrayKeys(value, length)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "value", "must be a dense array with no extra properties");
  }

  const items: ValidatedSummaryItem[] = [];
  const seenItemIds = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const item = requireSummaryItem(readProperty(value, String(index)));
    if (seenItemIds.has(item.itemId)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "itemId", "must be unique within the batch");
    }
    seenItemIds.add(item.itemId);
    items.push(item);
  }
  return items;
}

/**
 * Validates the whole batch structure, converting any exception — a genuine
 * `ContractValidationError` from the checks above, or anything unexpected —
 * into a single sanitized `ContractValidationError` with a constant message.
 * Every untrusted read inside {@link requireSummaryItems}/{@link requireSummaryItem}
 * already goes through {@link readProperty}/{@link safeOwnKeys}, so a
 * malicious throw (including a forged `ContractValidationError`) never
 * reaches this boundary as a raw exception in the first place; this catch is
 * defense in depth, not the primary sanitization.
 */
function validateBatchResults(value: unknown): readonly ValidatedSummaryItem[] {
  try {
    return requireSummaryItems(value);
  } catch (error) {
    if (error instanceof ContractValidationError) throw error;
    rejectContract(
      SUMMARIZE_FINALIZED_AGENT_CYCLES,
      "value",
      "must be a valid, non-empty FinalizedAgentCycleBatchResults list"
    );
  }
}

/**
 * Summarizes a non-empty, already-finalized batch into counts and ordered
 * `itemId` lists per category. Synchronous, pure and deterministic: no
 * clock, no randomness, no I/O, no persistence, no adapter, no Risk Manager
 * and no broker.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates the entire batch structure fail-closed, including every
 *    item's distinct `itemId` and closed shape;
 * 2. classifies each item exactly once, in order, into `ACCEPTED`, `HOLD` or
 *    `FAILED`;
 * 3. returns a frozen summary whose three counts always sum to `total`, and
 *    whose three `itemId` lists each preserve the original batch order and
 *    are themselves frozen.
 *
 * Never mutates the input batch, any item or the returned summary, and never
 * copies a proposal, capture, evaluation, rejection code or any other free
 * text into the summary.
 */
export function summarizeFinalizedAgentCycles(
  value: FinalizedAgentCycleBatchResults
): FinalizedAgentCyclesSummary {
  const items = validateBatchResults(value);

  const acceptedItemIds: string[] = [];
  const holdItemIds: string[] = [];
  const failedItemIds: string[] = [];

  for (const item of items) {
    if (item.category === "ACCEPTED") {
      acceptedItemIds.push(item.itemId);
    } else if (item.category === "HOLD") {
      holdItemIds.push(item.itemId);
    } else {
      failedItemIds.push(item.itemId);
    }
  }

  const summary: FinalizedAgentCyclesSummary = {
    total: items.length,
    acceptedCount: acceptedItemIds.length,
    holdCount: holdItemIds.length,
    failedCount: failedItemIds.length,
    acceptedItemIds: Object.freeze(acceptedItemIds),
    holdItemIds: Object.freeze(holdItemIds),
    failedItemIds: Object.freeze(failedItemIds)
  };
  return Object.freeze(summary);
}
