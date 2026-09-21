/**
 * The smallest offline composition that runs a finalized batch and summarizes
 * it in one call:
 *
 * ```text
 * FinalizedAgentCycleBatchItems
 * → runFinalizedAgentCycles (once)
 * → summarizeFinalizedAgentCycles (once)
 * → { results, summary }
 * ```
 *
 * `runFinalizedAgentCyclesWithSummary` creates no logic of its own: it calls
 * `runFinalizedAgentCycles` (`./run-finalized-agent-cycles.js`) exactly once
 * and hands its returned `FinalizedAgentCycleBatchResults` directly to
 * `summarizeFinalizedAgentCycles` (`./summarize-finalized-agent-cycles.js`)
 * exactly once, returning both, unmodified, together in one frozen object.
 * Both callees already validate fail-closed on their own; this module does
 * not re-validate, re-run or re-classify any of it.
 *
 * A rejection thrown by `runFinalizedAgentCycles` — a failure before any item
 * ran, since a single item's own failure is already isolated into that
 * item's `FAILED` result rather than a thrown rejection — propagates
 * immediately, already sanitized by that module; `summarizeFinalizedAgentCycles`
 * is never called in that case. A throw from `summarizeFinalizedAgentCycles`
 * — always its own `ContractValidationError`, since `results` was just
 * produced by `runFinalizedAgentCycles` itself — propagates the same way.
 * Neither exception is ever caught, inspected or converted into a success
 * here.
 *
 * This module has no ranking, scoring, voting, consensus, handoff, proposal
 * selection, comparison of performance, retry, concurrency, timer, clock,
 * randomness, HTTP, external SDK, queue, persistence, environment variable,
 * token, secret, credential, Risk Manager, `PaperBroker`, fill, wallet,
 * ledger, blockchain, testnet, exchange or real money.
 */

export { ContractValidationError } from "../domain/errors.js";
export {
  runFinalizedAgentCycles,
  type CompletedFinalizedAgentCycleBatchItem,
  type FailedFinalizedAgentCycleBatchItem,
  type FinalizedAgentCycleBatchItem,
  type FinalizedAgentCycleBatchItems,
  type FinalizedAgentCycleBatchResult,
  type FinalizedAgentCycleBatchResults,
  type FinalizedBoundedAgentAttemptsResult,
  type RunBoundedAgentAttemptsRequest
} from "./run-finalized-agent-cycles.js";
export {
  summarizeFinalizedAgentCycles,
  type FinalizedAgentCyclesSummary
} from "./summarize-finalized-agent-cycles.js";

import {
  runFinalizedAgentCycles,
  type FinalizedAgentCycleBatchItems,
  type FinalizedAgentCycleBatchResults
} from "./run-finalized-agent-cycles.js";
import {
  summarizeFinalizedAgentCycles,
  type FinalizedAgentCyclesSummary
} from "./summarize-finalized-agent-cycles.js";

/**
 * Immutable, closed result of running a finalized batch and summarizing it:
 * the batch's full, ordered results alongside a summary coherent with them.
 * Carries nothing beyond what `runFinalizedAgentCycles` and
 * `summarizeFinalizedAgentCycles` already returned.
 */
export interface FinalizedAgentCyclesWithSummary {
  /** Exactly what `runFinalizedAgentCycles` returned for `value` — unmodified, same order and identities. */
  readonly results: FinalizedAgentCycleBatchResults;
  /** Exactly what `summarizeFinalizedAgentCycles` returned for `results`. */
  readonly summary: FinalizedAgentCyclesSummary;
}

/**
 * Runs the one existing finalized-batch sequence for `value` and summarizes
 * its result with the one existing summarizer, returning both together.
 *
 * Sequence, with no deviation possible:
 *
 * 1. calls `runFinalizedAgentCycles(value)` exactly once;
 * 2. if it throws, the sanitized error propagates immediately and
 *    `summarizeFinalizedAgentCycles` is never called;
 * 3. otherwise calls `summarizeFinalizedAgentCycles` exactly once with the
 *    returned `results`, unmodified;
 * 4. returns a frozen `{ results, summary }` — neither `results` nor
 *    `summary` is copied, re-derived or mutated, and no adapter is ever
 *    called a second time by this composition.
 */
export async function runFinalizedAgentCyclesWithSummary(
  value: FinalizedAgentCycleBatchItems
): Promise<FinalizedAgentCyclesWithSummary> {
  const results = await runFinalizedAgentCycles(value);
  const summary = summarizeFinalizedAgentCycles(results);
  return Object.freeze({ results, summary });
}
