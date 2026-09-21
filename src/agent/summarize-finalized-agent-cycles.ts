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
 * allows, and confirm each required property has the basic shape/value its
 * own closed union demands — `HOLD`'s `reason` equal to the single closed
 * value `ATTEMPTS_EXHAUSTED`; `evaluations` (both outcomes) a dense array,
 * with no extra property anywhere on it, holding between one and
 * `MAX_AGENT_RETRY_ATTEMPTS` entries, each entry itself a JSON object with
 * exactly the closed set of properties its own `status` allows (`REJECTED`:
 * `status`/`capture`/`code` with `code` one of the closed
 * `AgentResponseRejectionCode` values; `ACCEPTED`: `status`/`capture`/`proposal`),
 * with `capture`/`proposal` required only to be JSON objects; `ACCEPTED`'s
 * `result` the same closed `ACCEPTED`-evaluation shape; `HOLD`'s
 * `evaluations` entries every one `REJECTED`-shaped, and its `rejectionCodes`
 * a dense array, with no extra property anywhere on it, matching those
 * entries' own declared `code`s exactly, in count and order. None of this
 * recomputes an attempt or a result: a `capture`'s or `proposal`'s own nested
 * fields are never read, `evaluateAgentResponseCapture` is never called
 * again, and nothing here confirms a `capture` genuinely produced the
 * `proposal`/`code` sitting beside it — only that the shapes are internally
 * consistent and closed. This module never duplicates
 * `finalizeBoundedAgentAttempts`'s own recomputation-based revalidation;
 * exactly like `runFinalizedAgentCycles` intentionally leaves each item's
 * `request` unvalidated at its own boundary, this module intentionally
 * leaves every `capture`'s and `proposal`'s nested content unvalidated at
 * this boundary, because that content is never read, copied or exposed here.
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

/**
 * Validates one `evaluations` entry's own closed shape, purely structurally
 * and without recomputing anything: a JSON object with exactly the closed
 * set of properties its own declared `status` allows — `REJECTED` with
 * `code` one of the closed {@link AGENT_RESPONSE_REJECTION_CODES} values,
 * `ACCEPTED` with `proposal` at least a JSON object — and `capture` at least
 * a JSON object in both cases. Never reads a nested field of `capture` or
 * `proposal`, and never calls `evaluateAgentResponseCapture`: this confirms
 * the entry is internally shape-consistent, not that it was genuinely
 * produced by evaluating a real capture.
 */
function requireEvaluationEntryShape(value: unknown, field: string): "ACCEPTED" | "REJECTED" {
  if (!isJsonObject(value)) {
    rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "each entry must be a JSON object");
  }
  const status = readProperty(value, "status");
  if (status === "REJECTED") {
    if (!hasExactOwnKeys(value, REJECTED_EVALUATION_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must have exactly the expected REJECTED evaluation properties");
    }
    if (!isJsonObject(readProperty(value, "capture"))) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "capture must be a JSON object");
    }
    if (!isKnownRejectionCode(readProperty(value, "code"))) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "code must be a closed rejection code");
    }
    return "REJECTED";
  }
  if (status === "ACCEPTED") {
    if (!hasExactOwnKeys(value, ACCEPTED_EVALUATION_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "must have exactly the expected ACCEPTED evaluation properties");
    }
    if (!isJsonObject(readProperty(value, "capture"))) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "capture must be a JSON object");
    }
    if (!isJsonObject(readProperty(value, "proposal"))) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, field, "proposal must be a JSON object");
    }
    return "ACCEPTED";
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
 * demands — never a `capture`'s or `proposal`'s nested *content*, and never
 * copied into the summary.
 *
 * A closed union member is not "revalidated" by checking only its top-level
 * key set: `HOLD`'s `reason` must be the single closed value
 * `ATTEMPTS_EXHAUSTED` — never arbitrary free text; `evaluations` (both
 * outcomes) must be a dense array of one to `MAX_AGENT_RETRY_ATTEMPTS`
 * entries, each itself closed-shaped and, for `HOLD`, `REJECTED`-shaped with
 * a closed rejection code; `ACCEPTED`'s `result` must carry the same closed
 * `ACCEPTED`-evaluation shape; `HOLD`'s `rejectionCodes` must be a dense
 * array matching the declared evaluations' own codes exactly, in count and
 * order. Checking this remains strictly shallower than
 * `finalize-bounded-agent-attempts.ts`'s own recomputation: it never reads
 * what is inside any `capture` or `proposal`, and never calls
 * `evaluateAgentResponseCapture`.
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
    evaluationEntries.forEach((entry) => requireEvaluationEntryShape(entry, "evaluations"));
    const acceptedResult = readProperty(value, "result");
    if (requireEvaluationEntryShape(acceptedResult, "result") !== "ACCEPTED") {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "result must be an ACCEPTED evaluation");
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
    const declaredCodes: string[] = [];
    for (const entry of evaluationEntries) {
      if (requireEvaluationEntryShape(entry, "evaluations") !== "REJECTED") {
        rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "evaluations", "must be entirely REJECTED for HOLD");
      }
      declaredCodes.push(readProperty(entry as object, "code") as string);
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
