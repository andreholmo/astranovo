/**
 * The smallest offline composition that runs a non-empty, ordered batch of
 * already-finalized agent cycles, isolating each item's failure so every
 * other item still runs:
 *
 * ```text
 * readonly FinalizedAgentCycleBatchItem[]
 * → runFinalizedAgentCycle (once per item, in order)
 * → COMPLETED | FAILED per item
 * → readonly FinalizedAgentCycleBatchResult[]
 * ```
 *
 * This module only composes individual cycles that already exist and were
 * already reviewed by `./run-finalized-agent-cycle.js`. It aggregates
 * nothing, votes on nothing, picks no winner, never calls a Risk Manager or
 * broker, and shares no wallet or state between items.
 *
 * The entire batch structure is validated fail-closed before the first
 * item's adapter is ever touched: `value` must be a real, non-empty, dense
 * array with no extra, non-enumerable or `Symbol`-keyed property anywhere on
 * it, and every entry a JSON object with exactly `itemId` (a non-empty,
 * bounded, distinct string — never generated or normalized) and `request`.
 * `request` itself is intentionally left unvalidated at this boundary:
 * `runFinalizedAgentCycle` (and everything beneath it) already revalidates
 * it fail-closed, and duplicating that here would be exactly the duplication
 * this task forbids.
 *
 * Every read of the untrusted batch — its `length`, each index, each item's
 * own keys and `itemId` — goes through the same defensive primitives
 * (`readProperty`, a local `Reflect.ownKeys`-based exact-key check) already
 * used across `src/agent`, so a throwing getter or `Proxy` trap anywhere —
 * including one that throws an already-forged `ContractValidationError`
 * carrying a secret — can never escape this validation unsanitized; it is
 * treated exactly like the value being absent.
 *
 * `runFinalizedAgentCycle` is called exactly once per item, sequentially, in
 * the order supplied — never concurrently. A rejection from any single
 * item's call — already sanitized by that module and everything beneath it
 * — is never inspected, interpolated or propagated: it becomes exactly
 * `{ itemId, status: "FAILED", code: "AGENT_CYCLE_FAILED" }`, and the batch
 * continues with the next item. A failure can never turn into `COMPLETED`,
 * `ACCEPTED` or `HOLD`. A `COMPLETED` item preserves the `ACCEPTED | HOLD`
 * outcome `runFinalizedAgentCycle` returned, unchanged.
 *
 * This module has no aggregation, voting, consensus, handoff, proposal
 * selection, shared context, concurrency/parallelism, Risk Manager,
 * `PaperBroker`, fill, wallet, ledger, persistence, market data provider,
 * real Astra integration, timeout, backoff or scheduling. It has no HTTP,
 * external SDK, queue, timer, clock, randomness, environment variable,
 * token, secret, credential, wallet, blockchain, testnet, exchange or real
 * money.
 */

import { ContractValidationError, rejectContract } from "../domain/errors.js";
import { readProperty, requireBoundedText, requireInputObject } from "./internal/attempt-input-validation.js";
import {
  runFinalizedAgentCycle,
  type FinalizedBoundedAgentAttemptsResult,
  type RunBoundedAgentAttemptsRequest
} from "./run-finalized-agent-cycle.js";

export { ContractValidationError } from "../domain/errors.js";
export type { FinalizedBoundedAgentAttemptsResult, RunBoundedAgentAttemptsRequest } from "./run-finalized-agent-cycle.js";

const RUN_FINALIZED_AGENT_CYCLES = "RunFinalizedAgentCycles";
const MAX_ITEM_ID_LENGTH = 64;

const BATCH_ITEM_KEYS = ["itemId", "request"] as const;

/** One already-finalized agent cycle's request, explicitly identified within its batch. */
export interface FinalizedAgentCycleBatchItem {
  /** Explicit, unique, non-empty id for this item. Never generated or normalized. */
  readonly itemId: string;
  /** Exactly `runFinalizedAgentCycle`'s existing request contract. Revalidated, never mutated. */
  readonly request: RunBoundedAgentAttemptsRequest;
}

/** A non-empty, dense, readonly list of batch items, in the order they will run. */
export type FinalizedAgentCycleBatchItems = readonly FinalizedAgentCycleBatchItem[];

/** One item's cycle ran to completion; its outcome is preserved unchanged. */
export interface CompletedFinalizedAgentCycleBatchItem {
  readonly itemId: string;
  readonly status: "COMPLETED";
  /** The `ACCEPTED | HOLD` outcome `runFinalizedAgentCycle` returned for this item, unmodified. */
  readonly result: FinalizedBoundedAgentAttemptsResult;
}

/** One item's cycle failed; sanitized to a closed, safe code — never a message, stack or payload. */
export interface FailedFinalizedAgentCycleBatchItem {
  readonly itemId: string;
  readonly status: "FAILED";
  readonly code: "AGENT_CYCLE_FAILED";
}

/** Immutable, closed union: one batch item's outcome. */
export type FinalizedAgentCycleBatchResult =
  | CompletedFinalizedAgentCycleBatchItem
  | FailedFinalizedAgentCycleBatchItem;

/** Frozen, ordered list of every item's outcome — same order and length as the input batch. */
export type FinalizedAgentCycleBatchResults = readonly FinalizedAgentCycleBatchResult[];

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
 * `length` (e.g. via `Array.from({ length }, ...)`): a real sparse array or a
 * `Proxy` can report a huge `length` while owning only a handful of actual
 * keys, and allocating or iterating a structure proportional to that
 * declared `length` before checking cardinality is itself a memory/CPU
 * exhaustion vector. Instead, {@link safeOwnKeys} is read once — its cost is
 * bounded by the *actual* number of own keys the target reports, not by the
 * declared `length` — and rejected immediately when that count doesn't match
 * `length + 1`. Only once cardinality is confirmed does this walk the
 * (now-bounded) key list to confirm every non-`"length"` key is a distinct
 * canonical index; since own keys are always unique, `length` such distinct
 * indices in `[0, length)` can only be exactly `0..length-1`.
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

interface ValidatedBatchItem {
  readonly itemId: string;
  readonly request: unknown;
}

/**
 * Validates one batch item fail-closed: a JSON object with exactly `itemId`
 * and `request`, nothing more — no extra, missing, non-enumerable or
 * `Symbol`-keyed property — and a non-empty, bounded `itemId`. `request` is
 * returned unvalidated; see the module comment for why.
 */
function requireBatchItem(value: unknown): ValidatedBatchItem {
  const source = requireInputObject(value, RUN_FINALIZED_AGENT_CYCLES);
  if (!hasExactOwnKeys(source, BATCH_ITEM_KEYS)) {
    rejectContract(RUN_FINALIZED_AGENT_CYCLES, "items", "must have exactly itemId and request");
  }
  const itemId = requireBoundedText(
    readProperty(source, "itemId"),
    RUN_FINALIZED_AGENT_CYCLES,
    "itemId",
    MAX_ITEM_ID_LENGTH
  );
  return { itemId, request: readProperty(source, "request") };
}

/**
 * Validates the entire batch fail-closed, before any item's adapter is ever
 * touched: `value` must be a real array (never an array-like), with at
 * least one entry, and exactly as many own keys as a dense array of that
 * length would have — `"length"` plus each numeric index — so a hole, or an
 * extra/non-enumerable/`Symbol`-keyed property anywhere on the array itself,
 * fails here. Every entry must be a valid batch item with a distinct
 * `itemId`, checked in the exact order supplied.
 *
 * `length` and each entry are read through {@link readProperty}, never
 * `for...of`, so a forged array-like cannot leak a thrown value through a
 * `Symbol.iterator` trap; a throwing read is treated exactly like a missing
 * entry.
 */
function requireBatchItems(value: unknown): readonly ValidatedBatchItem[] {
  if (!Array.isArray(value)) {
    rejectContract(RUN_FINALIZED_AGENT_CYCLES, "value", "must be a non-empty array");
  }
  const length = readProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) {
    rejectContract(RUN_FINALIZED_AGENT_CYCLES, "value", "must be a non-empty array");
  }
  if (!hasExactDenseArrayKeys(value, length)) {
    rejectContract(RUN_FINALIZED_AGENT_CYCLES, "value", "must be a dense array with no extra properties");
  }

  const items: ValidatedBatchItem[] = [];
  const seenItemIds = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const item = requireBatchItem(readProperty(value, String(index)));
    if (seenItemIds.has(item.itemId)) {
      rejectContract(RUN_FINALIZED_AGENT_CYCLES, "itemId", "must be unique within the batch");
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
 * Every untrusted read inside {@link requireBatchItems}/{@link requireBatchItem}
 * already goes through {@link readProperty}/{@link safeOwnKeys}, so a
 * malicious throw (including a forged `ContractValidationError`) never
 * reaches this boundary as a raw exception in the first place; this catch is
 * defense in depth, not the primary sanitization.
 */
function validateBatch(value: unknown): readonly ValidatedBatchItem[] {
  try {
    return requireBatchItems(value);
  } catch (error) {
    if (error instanceof ContractValidationError) throw error;
    rejectContract(RUN_FINALIZED_AGENT_CYCLES, "value", "must be a valid, non-empty FinalizedAgentCycleBatchItem list");
  }
}

/**
 * Runs a non-empty batch of finalized agent cycles sequentially, in order,
 * isolating each item's failure so the rest of the batch still runs.
 * Asynchronous only because `runFinalizedAgentCycle` is; there is no timer,
 * delay, clock, randomness, network, SDK or persistence anywhere in this
 * module.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates the entire batch structure — fail-closed, before the first
 *    item's adapter is ever touched;
 * 2. for each item, in order: calls `runFinalizedAgentCycle(item.request)`
 *    exactly once;
 * 3. on success, records `{ itemId, status: "COMPLETED", result }`, with
 *    `result` preserved exactly as returned;
 * 4. on any rejection — never inspected, interpolated or propagated —
 *    records `{ itemId, status: "FAILED", code: "AGENT_CYCLE_FAILED" }` and
 *    continues with the next item;
 * 5. returns a frozen, ordered list of every item's outcome, same order and
 *    length as the input batch.
 *
 * Never generates an id, timestamp or any other implicit value, and never
 * mutates the input batch, any item, any request or the returned list.
 */
export async function runFinalizedAgentCycles(
  value: FinalizedAgentCycleBatchItems
): Promise<FinalizedAgentCycleBatchResults> {
  const items = validateBatch(value);

  const results: FinalizedAgentCycleBatchResult[] = [];
  for (const item of items) {
    try {
      const result = await runFinalizedAgentCycle(item.request as RunBoundedAgentAttemptsRequest);
      const completed: CompletedFinalizedAgentCycleBatchItem = {
        itemId: item.itemId,
        status: "COMPLETED",
        result
      };
      results.push(Object.freeze(completed));
    } catch {
      const failed: FailedFinalizedAgentCycleBatchItem = {
        itemId: item.itemId,
        status: "FAILED",
        code: "AGENT_CYCLE_FAILED"
      };
      results.push(Object.freeze(failed));
    }
  }

  return Object.freeze(results);
}
