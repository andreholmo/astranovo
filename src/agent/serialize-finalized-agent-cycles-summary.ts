/**
 * The smallest pure, offline transformation that turns an already-produced
 * `FinalizedAgentCyclesSummary` (`./summarize-finalized-agent-cycles.js`)
 * into a canonical JSON string for audit or future display, without any I/O:
 *
 * ```text
 * FinalizedAgentCyclesSummary
 * → serializeFinalizedAgentCyclesSummary
 * → canonical JSON string
 * ```
 *
 * This module only validates and serializes the existing summary contract.
 * It never recomputes a summary, never calls `summarizeFinalizedAgentCycles`
 * or anything upstream of it, and never ranks, scores, votes, compares or
 * selects anything.
 *
 * `value` is never trusted as an already-valid `FinalizedAgentCyclesSummary`
 * just because of its declared TypeScript type: it must be a real JSON
 * object with exactly the closed set of public fields the interface
 * declares — no extra, non-enumerable or `Symbol`-keyed property anywhere on
 * it. `total`/`acceptedCount`/`holdCount`/`failedCount` must each be a safe,
 * non-negative integer (never negative, fractional, infinite or above
 * `Number.MAX_SAFE_INTEGER`); `acceptedItemIds`/`holdItemIds`/`failedItemIds`
 * must each be a real, dense array — no extra, non-enumerable or
 * `Symbol`-keyed property, no hole — of bounded, non-blank `itemId` strings.
 * Each count must equal the length of its own list, `total` must equal
 * `acceptedCount + holdCount + failedCount`, and every `itemId` must be
 * unique across all three lists combined, in the order each list already
 * declares it.
 *
 * Every read of the untrusted value — its own keys, each field, each list's
 * `length` and each index — goes through the same defensive primitives
 * (`readProperty`, a local `Reflect.ownKeys`-based exact-key check) already
 * used across `src/agent`, so a throwing getter or `Proxy` trap anywhere —
 * including one that throws an already-forged `ContractValidationError`
 * carrying a secret — can never escape this validation unsanitized; it is
 * treated exactly like the value being absent.
 *
 * The canonical output is built from freshly extracted primitives — never
 * from the input object or its nested arrays directly — so a hostile
 * `toJSON` anywhere on `value` (own or inherited) is never invoked: this
 * module never calls `JSON.stringify` on anything the caller supplied,
 * only on a plain object/array literal assembled from already-validated
 * strings, numbers and array-of-strings. The output key order is always
 * `total`, `acceptedCount`, `holdCount`, `failedCount`, `acceptedItemIds`,
 * `holdItemIds`, `failedItemIds`, and each `itemId` list keeps its own
 * original order; `JSON.stringify` with no indentation produces a compact
 * string with no extra whitespace. Field-for-field identical inputs always
 * produce byte-identical output.
 *
 * This module never mutates or freezes `value`, never calls any function
 * `value` exposes, has no aggregation, ranking, scoring, voting, consensus,
 * proposal selection, Risk Manager, `PaperBroker`, fill, wallet, ledger or
 * persistence, and has no HTTP, external SDK, queue, timer, clock,
 * randomness, environment variable, token, secret, credential, wallet,
 * blockchain, testnet, exchange or real money.
 */

import { ContractValidationError, rejectContract } from "../domain/errors.js";
import { readProperty, requireBoundedText } from "./internal/attempt-input-validation.js";
import { type FinalizedAgentCyclesSummary } from "./summarize-finalized-agent-cycles.js";

export { ContractValidationError } from "../domain/errors.js";
export type { FinalizedAgentCyclesSummary } from "./summarize-finalized-agent-cycles.js";

const SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY = "SerializeFinalizedAgentCyclesSummary";

/** Mirrors `summarize-finalized-agent-cycles.ts`'s own `itemId` bound without importing its private constant. */
const MAX_ITEM_ID_LENGTH = 64;

/** Exact own keys a `FinalizedAgentCyclesSummary` may have. Mirrors its own closed public shape without importing a private constant. */
const SUMMARY_KEYS = [
  "total",
  "acceptedCount",
  "holdCount",
  "failedCount",
  "acceptedItemIds",
  "holdItemIds",
  "failedItemIds"
] as const;

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
 * index `"0"..String(length - 1)`, nothing more, nothing missing. Never
 * builds an expected-keys list sized off the untrusted `length`; instead
 * {@link safeOwnKeys} is read once and rejected immediately when its count
 * doesn't match `length + 1`, so a real sparse array or `Proxy` reporting a
 * huge `length` while owning only a handful of actual keys is rejected
 * cheaply.
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

/** Fails closed unless `value` is a safe, non-negative integer — never negative, fractional, infinite or above `Number.MAX_SAFE_INTEGER`. */
function requireSafeNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, field, "must be a safe, non-negative integer");
  }
  return value;
}

/**
 * Reads `value` as a dense array of bounded, non-blank `itemId` strings, the
 * same declared-length-agnostic, `Proxy`/getter-safe way
 * {@link hasExactDenseArrayKeys} already checks cardinality before any
 * per-index read happens. Every entry goes through {@link readProperty} and
 * {@link requireBoundedText}, so a throwing getter or `Proxy` trap on any
 * index is treated exactly like a missing entry rather than escaping
 * unsanitized.
 */
function requireItemIdList(value: unknown, field: string): readonly string[] {
  if (!safeIsArray(value)) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, field, "must be an array");
  }
  const arrayValue = value as object;
  const length = readProperty(arrayValue, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, field, "must be an array");
  }
  if (!hasExactDenseArrayKeys(arrayValue, length)) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, field, "must be a dense array with no extra properties");
  }
  const entries: string[] = [];
  for (let index = 0; index < length; index += 1) {
    entries.push(
      requireBoundedText(
        readProperty(arrayValue, String(index)),
        SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY,
        field,
        MAX_ITEM_ID_LENGTH
      )
    );
  }
  return entries;
}

/** `FinalizedAgentCyclesSummary`'s own fields, validated shape-wise and cross-checked for coherence — never recomputed from a batch. */
interface ValidatedSummaryFields {
  readonly total: number;
  readonly acceptedCount: number;
  readonly holdCount: number;
  readonly failedCount: number;
  readonly acceptedItemIds: readonly string[];
  readonly holdItemIds: readonly string[];
  readonly failedItemIds: readonly string[];
}

/**
 * Validates `value`'s closed public shape and internal coherence, purely
 * structurally: exactly `FinalizedAgentCyclesSummary`'s own keys; each count
 * a safe, non-negative integer equal to its own list's length; `total`
 * exactly `acceptedCount + holdCount + failedCount`; and every `itemId`
 * unique across all three lists combined. Never recomputes a summary from a
 * batch — this confirms `value` is internally consistent, not that it was
 * genuinely produced by `summarizeFinalizedAgentCycles`.
 */
function requireClosedSummaryShape(value: unknown): ValidatedSummaryFields {
  if (!isJsonObject(value)) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "value", "must be a JSON object");
  }
  if (!hasExactOwnKeys(value, SUMMARY_KEYS)) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "value", "must have exactly the expected summary properties");
  }

  const total = requireSafeNonNegativeInteger(readProperty(value, "total"), "total");
  const acceptedCount = requireSafeNonNegativeInteger(readProperty(value, "acceptedCount"), "acceptedCount");
  const holdCount = requireSafeNonNegativeInteger(readProperty(value, "holdCount"), "holdCount");
  const failedCount = requireSafeNonNegativeInteger(readProperty(value, "failedCount"), "failedCount");

  const acceptedItemIds = requireItemIdList(readProperty(value, "acceptedItemIds"), "acceptedItemIds");
  const holdItemIds = requireItemIdList(readProperty(value, "holdItemIds"), "holdItemIds");
  const failedItemIds = requireItemIdList(readProperty(value, "failedItemIds"), "failedItemIds");

  if (acceptedCount !== acceptedItemIds.length) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "acceptedCount", "must equal acceptedItemIds length");
  }
  if (holdCount !== holdItemIds.length) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "holdCount", "must equal holdItemIds length");
  }
  if (failedCount !== failedItemIds.length) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "failedCount", "must equal failedItemIds length");
  }
  if (total !== acceptedCount + holdCount + failedCount) {
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "total", "must equal acceptedCount + holdCount + failedCount");
  }

  const seenItemIds = new Set<string>();
  for (const itemId of [...acceptedItemIds, ...holdItemIds, ...failedItemIds]) {
    if (seenItemIds.has(itemId)) {
      rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "itemId", "must be unique across all categories");
    }
    seenItemIds.add(itemId);
  }

  return { total, acceptedCount, holdCount, failedCount, acceptedItemIds, holdItemIds, failedItemIds };
}

/**
 * Validates the whole summary structure, converting any exception — a
 * genuine `ContractValidationError` from the checks above, or anything
 * unexpected — into a single sanitized `ContractValidationError` with a
 * constant message. Every untrusted read inside
 * {@link requireClosedSummaryShape}/{@link requireItemIdList} already goes
 * through {@link readProperty}/{@link safeOwnKeys}, so a malicious throw
 * (including a forged `ContractValidationError`) never reaches this boundary
 * as a raw exception in the first place; this catch is defense in depth, not
 * the primary sanitization.
 */
function validateSummary(value: unknown): ValidatedSummaryFields {
  try {
    return requireClosedSummaryShape(value);
  } catch (error) {
    if (error instanceof ContractValidationError) throw error;
    rejectContract(SERIALIZE_FINALIZED_AGENT_CYCLES_SUMMARY, "value", "must be a valid FinalizedAgentCyclesSummary");
  }
}

/**
 * Serializes a `FinalizedAgentCyclesSummary` into a canonical, compact JSON
 * string: fixed key order (`total`, `acceptedCount`, `holdCount`,
 * `failedCount`, `acceptedItemIds`, `holdItemIds`, `failedItemIds`), no
 * whitespace, each `itemId` list in its own original order. Synchronous,
 * pure and deterministic: no clock, no randomness, no I/O.
 *
 * Sequence, with no deviation possible:
 *
 * 1. validates `value`'s entire closed shape and internal coherence
 *    fail-closed, including cross-checking each count against its list's
 *    length, `total` against the three counts, and `itemId` uniqueness
 *    across all three lists;
 * 2. builds a fresh plain object from the already-validated primitives, in
 *    the fixed key order, and serializes it with `JSON.stringify` — never
 *    `value` itself or any of its nested arrays, so a hostile `toJSON`
 *    anywhere on `value` is never invoked.
 *
 * Never mutates or freezes `value`, and never calls any function `value`
 * exposes.
 */
export function serializeFinalizedAgentCyclesSummary(value: FinalizedAgentCyclesSummary): string {
  const fields = validateSummary(value);
  const canonical = {
    total: fields.total,
    acceptedCount: fields.acceptedCount,
    holdCount: fields.holdCount,
    failedCount: fields.failedCount,
    acceptedItemIds: fields.acceptedItemIds,
    holdItemIds: fields.holdItemIds,
    failedItemIds: fields.failedItemIds
  };
  return JSON.stringify(canonical);
}
