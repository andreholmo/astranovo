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
 * `result` is read only far enough to discriminate `ACCEPTED` from `HOLD` and
 * to confirm it carries exactly the closed set of properties that outcome
 * allows — never recomputed, and never copied into the summary. This module
 * never recalculates an attempt or a result and never duplicates
 * `finalizeBoundedAgentAttempts`'s own structural revalidation of evaluations
 * or proposals; exactly like `runFinalizedAgentCycles` intentionally leaves
 * each item's `request` unvalidated at its own boundary, this module
 * intentionally leaves `result`'s nested `evaluations`/`rejectionCodes`/proposal
 * content unvalidated at this boundary, because that content is never read,
 * copied or exposed here.
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
import { readProperty, requireBoundedText, requireInputObject } from "./internal/attempt-input-validation.js";
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

type FinalizedAgentCycleCategory = "ACCEPTED" | "HOLD" | "FAILED";

interface ValidatedSummaryItem {
  readonly itemId: string;
  readonly category: FinalizedAgentCycleCategory;
}

/**
 * Reads and classifies one `COMPLETED` entry's nested `result`, without
 * recomputing or trusting anything about it beyond its own closed shape: this
 * module never recalculates an attempt or a result, so `result` is read only
 * far enough to discriminate `ACCEPTED` from `HOLD` and to confirm it carries
 * exactly the closed set of properties that discriminant allows — never its
 * nested `evaluations`, `rejectionCodes` or proposal content, and never
 * copied into the summary.
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
    return "ACCEPTED";
  }
  if (status === "HOLD") {
    if (!hasExactOwnKeys(value, HOLD_RESULT_KEYS)) {
      rejectContract(SUMMARIZE_FINALIZED_AGENT_CYCLES, "result", "must have exactly the expected HOLD properties");
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
