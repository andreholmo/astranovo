import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "../src/agent/retry-policy.js";
import {
  runFinalizedAgentCycles,
  type FinalizedAgentCycleBatchItem,
  type FinalizedAgentCycleBatchItems,
  type FinalizedAgentCycleBatchResult,
  type FinalizedAgentCycleBatchResults,
  type RunBoundedAgentAttemptsRequest
} from "../src/agent/run-finalized-agent-cycles.js";
import { summarizeFinalizedAgentCycles } from "../src/agent/summarize-finalized-agent-cycles.js";

// --- shared fixtures for building real, end-to-end finalized batches ---

function request(cycleId: string): AgentRequest {
  return parseAgentRequest({
    schemaVersion: 1,
    agentId: "trend-following",
    cycleId,
    snapshotId: "snapshot-1"
  });
}

const PROMPT_VERSION = "prompt-v1";
const MODEL = "stub-model";

function proposal(cycleId: string) {
  return {
    schemaVersion: 1,
    proposalId: `proposal-${cycleId}`,
    cycleId,
    agentId: "trend-following",
    action: "HOLD",
    asset: "ACME",
    confidence: 0.5,
    positionPct: 0,
    reason: "no clear edge",
    veto: false,
    evidenceIds: [],
    promptVersion: PROMPT_VERSION,
    model: MODEL
  };
}

function acceptedResponse(cycleId: string): string {
  return JSON.stringify(proposal(cycleId));
}

const INVALID_JSON_RESPONSE = "not json at all {{{";

function policy(maxAttempts: number): AgentRetryPolicy {
  return parseAgentRetryPolicy({ maxAttempts });
}

function ids(count: number, prefix = "response"): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}-${index + 1}`);
}

/** A local, deterministic, offline adapter that returns one configured raw response per call, in order, and tracks how many times it was called. */
class SequentialAdapter implements AgentAdapter {
  public callCount = 0;
  readonly #responses: readonly unknown[];

  public constructor(responses: readonly unknown[]) {
    this.#responses = responses;
  }

  public call(_request: AgentRequest): unknown {
    const response = this.#responses[this.callCount];
    this.callCount += 1;
    if (response === undefined) {
      throw new Error("SequentialAdapter: no more responses configured for this call");
    }
    return response;
  }
}

class ThrowingAdapter implements AgentAdapter {
  public callCount = 0;
  readonly #error: unknown;

  public constructor(error: unknown) {
    this.#error = error;
  }

  public call(_request: AgentRequest): unknown {
    this.callCount += 1;
    throw this.#error;
  }
}

function acceptedRequest(
  cycleId: string,
  adapter: AgentAdapter = new SequentialAdapter([acceptedResponse(cycleId)])
): RunBoundedAgentAttemptsRequest {
  return {
    adapter,
    request: request(cycleId),
    policy: policy(1),
    responseIds: ids(1, `r-${cycleId}`),
    promptVersion: PROMPT_VERSION,
    model: MODEL
  };
}

function exhaustedRequest(
  cycleId: string,
  adapter: AgentAdapter = new SequentialAdapter([INVALID_JSON_RESPONSE])
): RunBoundedAgentAttemptsRequest {
  return {
    adapter,
    request: request(cycleId),
    policy: policy(1),
    responseIds: ids(1, `r-${cycleId}`),
    promptVersion: PROMPT_VERSION,
    model: MODEL
  };
}

function failingRequest(cycleId: string, adapter: AgentAdapter = new ThrowingAdapter(new Error("boom"))): RunBoundedAgentAttemptsRequest {
  return { ...acceptedRequest(cycleId), adapter };
}

function item(itemId: string, req: RunBoundedAgentAttemptsRequest): FinalizedAgentCycleBatchItem {
  return { itemId, request: req };
}

type BatchSpecEntry = { readonly itemId: string; readonly kind: "ACCEPTED" | "HOLD" | "FAILED" };

/** Builds a real, end-to-end finalized batch via `runFinalizedAgentCycles`, so summary tests exercise the exact shape production code produces. */
async function buildRealBatch(spec: readonly BatchSpecEntry[]): Promise<FinalizedAgentCycleBatchResults> {
  const batchItems: FinalizedAgentCycleBatchItem[] = spec.map(({ itemId, kind }) => {
    if (kind === "ACCEPTED") return item(itemId, acceptedRequest(itemId));
    if (kind === "HOLD") return item(itemId, exhaustedRequest(itemId));
    return item(itemId, failingRequest(itemId));
  });
  return runFinalizedAgentCycles(batchItems as FinalizedAgentCycleBatchItems);
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function expectRejection(action: () => unknown): ContractValidationError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ContractValidationError);
    return error;
  }
  assert.fail("expected summarizeFinalizedAgentCycles to throw");
}

// --- synthetic fixtures for isolated, adversarial unit tests: valid enough shape-wise,
// without needing a real adapter run, since summarizeFinalizedAgentCycles never recomputes
// nested evaluations/proposals/captures — only their closed key set and closed values.
// A genuinely possible finalized result always carries between one and
// MAX_AGENT_RETRY_ATTEMPTS closed-shaped evaluation entries, so these fixtures do too —
// an empty or all-omitted `evaluations`/`result` is not a structure the real finalizer
// could ever have produced.

interface SyntheticAcceptedEvaluation {
  readonly status: "ACCEPTED";
  readonly capture: Record<string, unknown>;
  readonly proposal: Record<string, unknown>;
}

interface SyntheticRejectedEvaluation {
  readonly status: "REJECTED";
  readonly capture: Record<string, unknown>;
  readonly code: string;
}

function syntheticCapture(): Record<string, unknown> {
  return { note: "synthetic-capture-fixture" };
}

function syntheticProposalValue(): Record<string, unknown> {
  return { note: "synthetic-proposal-fixture" };
}

function acceptedEvaluationEntry(): SyntheticAcceptedEvaluation {
  return { status: "ACCEPTED", capture: syntheticCapture(), proposal: syntheticProposalValue() };
}

function rejectedEvaluationEntry(code = "INVALID_JSON"): SyntheticRejectedEvaluation {
  return { status: "REJECTED", capture: syntheticCapture(), code };
}

function completedAccepted(itemId: string): FinalizedAgentCycleBatchResult {
  return {
    itemId,
    status: "COMPLETED",
    result: { status: "ACCEPTED", evaluations: [acceptedEvaluationEntry()], result: acceptedEvaluationEntry() }
  } as unknown as FinalizedAgentCycleBatchResult;
}

function completedHold(itemId: string): FinalizedAgentCycleBatchResult {
  const evaluations = [rejectedEvaluationEntry()];
  return {
    itemId,
    status: "COMPLETED",
    result: {
      status: "HOLD",
      reason: "ATTEMPTS_EXHAUSTED",
      evaluations,
      rejectionCodes: evaluations.map((evaluation) => evaluation.code)
    }
  } as unknown as FinalizedAgentCycleBatchResult;
}

function failed(itemId: string): FinalizedAgentCycleBatchResult {
  return { itemId, status: "FAILED", code: "AGENT_CYCLE_FAILED" };
}

describe("summarizeFinalizedAgentCycles: mixed real batch counts and ordering", () => {
  it("produces exact counts and preserves per-category order for a mixed batch", async () => {
    const batch = await buildRealBatch([
      { itemId: "a1", kind: "ACCEPTED" },
      { itemId: "h1", kind: "HOLD" },
      { itemId: "f1", kind: "FAILED" },
      { itemId: "a2", kind: "ACCEPTED" },
      { itemId: "h2", kind: "HOLD" },
      { itemId: "f2", kind: "FAILED" }
    ]);

    const summary = summarizeFinalizedAgentCycles(batch);

    assert.equal(summary.total, 6);
    assert.equal(summary.acceptedCount, 2);
    assert.equal(summary.holdCount, 2);
    assert.equal(summary.failedCount, 2);
    assert.deepEqual(summary.acceptedItemIds, ["a1", "a2"]);
    assert.deepEqual(summary.holdItemIds, ["h1", "h2"]);
    assert.deepEqual(summary.failedItemIds, ["f1", "f2"]);
    assert.equal(summary.acceptedCount + summary.holdCount + summary.failedCount, summary.total);
  });

  it("each item id appears in exactly one list, matching total", async () => {
    const batch = await buildRealBatch([
      { itemId: "x", kind: "HOLD" },
      { itemId: "y", kind: "ACCEPTED" },
      { itemId: "z", kind: "FAILED" }
    ]);

    const summary = summarizeFinalizedAgentCycles(batch);
    const allIds = [...summary.acceptedItemIds, ...summary.holdItemIds, ...summary.failedItemIds];

    assert.equal(new Set(allIds).size, allIds.length);
    assert.equal(allIds.length, summary.total);
  });
});

describe("summarizeFinalizedAgentCycles: single-category batches", () => {
  it("summarizes a batch containing only ACCEPTED items", async () => {
    const batch = await buildRealBatch([
      { itemId: "a1", kind: "ACCEPTED" },
      { itemId: "a2", kind: "ACCEPTED" }
    ]);

    const summary = summarizeFinalizedAgentCycles(batch);

    assert.equal(summary.total, 2);
    assert.equal(summary.acceptedCount, 2);
    assert.equal(summary.holdCount, 0);
    assert.equal(summary.failedCount, 0);
    assert.deepEqual(summary.acceptedItemIds, ["a1", "a2"]);
    assert.deepEqual(summary.holdItemIds, []);
    assert.deepEqual(summary.failedItemIds, []);
  });

  it("summarizes a batch containing only HOLD items", async () => {
    const batch = await buildRealBatch([
      { itemId: "h1", kind: "HOLD" },
      { itemId: "h2", kind: "HOLD" }
    ]);

    const summary = summarizeFinalizedAgentCycles(batch);

    assert.equal(summary.total, 2);
    assert.equal(summary.acceptedCount, 0);
    assert.equal(summary.holdCount, 2);
    assert.equal(summary.failedCount, 0);
    assert.deepEqual(summary.holdItemIds, ["h1", "h2"]);
  });

  it("summarizes a batch containing only FAILED items", async () => {
    const batch = await buildRealBatch([
      { itemId: "f1", kind: "FAILED" },
      { itemId: "f2", kind: "FAILED" }
    ]);

    const summary = summarizeFinalizedAgentCycles(batch);

    assert.equal(summary.total, 2);
    assert.equal(summary.acceptedCount, 0);
    assert.equal(summary.holdCount, 0);
    assert.equal(summary.failedCount, 2);
    assert.deepEqual(summary.failedItemIds, ["f1", "f2"]);
  });
});

describe("summarizeFinalizedAgentCycles: never recalculates or calls anything downstream", () => {
  it("never calls an item's adapter again while summarizing an already-finalized batch", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const batch = await runFinalizedAgentCycles([item("a", acceptedRequest("cycle-a", adapter))]);
    const callCountBeforeSummary = adapter.callCount;

    summarizeFinalizedAgentCycles(batch);

    assert.equal(adapter.callCount, callCountBeforeSummary);
  });
});

describe("summarizeFinalizedAgentCycles: invalid or forged batch structure fails closed", () => {
  it("rejects a null batch", () => {
    expectRejection(() => summarizeFinalizedAgentCycles(null as never));
  });

  it("rejects a non-array batch", () => {
    expectRejection(() => summarizeFinalizedAgentCycles({ length: 1, 0: completedAccepted("a") } as never));
  });

  it("rejects an empty batch", () => {
    expectRejection(() => summarizeFinalizedAgentCycles([]));
  });

  it("rejects a sparse batch array", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [completedAccepted("a"), , failed("c")] as unknown as FinalizedAgentCycleBatchResults;
    expectRejection(() => summarizeFinalizedAgentCycles(sparse));
  });

  it("rejects a batch array carrying an extra own property on the array itself", () => {
    const forgedBatch = [completedAccepted("a")] as unknown as FinalizedAgentCycleBatchResults & { extra?: string };
    (forgedBatch as unknown as { extra: string }).extra = "nope";

    expectRejection(() => summarizeFinalizedAgentCycles(forgedBatch));
  });

  it("rejects a duplicate itemId across categories", () => {
    expectRejection(() => summarizeFinalizedAgentCycles([completedAccepted("same-id"), failed("same-id")]));
  });

  it("rejects an item declaring an unknown top-level status", () => {
    const forged = { itemId: "a", status: "PENDING", result: {} } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a FAILED item with an incompatible code", () => {
    const forged = { itemId: "a", status: "FAILED", code: "SOMETHING_ELSE" } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED item whose nested result status is neither ACCEPTED nor HOLD", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "REJECTED" }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED item whose union is adulterated with both result and code", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations: [], result: {} },
      code: "AGENT_CYCLE_FAILED"
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a FAILED item with an extra enumerable property", () => {
    const forged = { itemId: "a", status: "FAILED", code: "AGENT_CYCLE_FAILED", extra: "nope" };
    expectRejection(() => summarizeFinalizedAgentCycles([forged as unknown as FinalizedAgentCycleBatchResult]));
  });

  it("rejects an item with an extra non-enumerable property", () => {
    const forgedItem: Record<string, unknown> = { itemId: "a", status: "FAILED", code: "AGENT_CYCLE_FAILED" };
    Object.defineProperty(forgedItem, "hidden", { value: "secret-field", enumerable: false });

    expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));
  });

  it("rejects an item with an extra Symbol-keyed property", () => {
    const forgedItem: Record<string | symbol, unknown> = { itemId: "a", status: "FAILED", code: "AGENT_CYCLE_FAILED" };
    forgedItem[Symbol("hidden")] = "secret-symbol-field";

    expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose nested result has an extra property", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations: [], result: {}, extra: "nope" }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose nested result is missing an expected property", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "HOLD", evaluations: [], rejectionCodes: [] }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose reason is not the closed ATTEMPTS_EXHAUSTED value", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "HOLD", reason: "QUALQUER_COISA", evaluations: [], rejectionCodes: [] }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose evaluations and rejectionCodes are null instead of arrays", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "HOLD", reason: "ATTEMPTS_EXHAUSTED", evaluations: null, rejectionCodes: null }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose evaluations and result are null", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations: null, result: null }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose result is an array instead of a JSON object", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations: [acceptedEvaluationEntry()], result: [] }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose evaluations is an object instead of an array", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations: {}, result: {} }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects an empty or blank itemId", () => {
    expectRejection(() => summarizeFinalizedAgentCycles([completedAccepted("")]));
  });

  it("rejects a real sparse array with a huge declared length without allocating proportional to it", () => {
    const sparse: unknown[] = [completedAccepted("a")];
    sparse.length = 4_000_000_000;

    const startedAt = Date.now();
    expectRejection(() => summarizeFinalizedAgentCycles(sparse as unknown as FinalizedAgentCycleBatchResults));
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs < 500, `rejection must not scale with the declared length (took ${elapsedMs}ms)`);
  });

  it("rejects a Proxy array reporting a huge length without allocating proportional to it", () => {
    const target = [completedAccepted("a")];
    const forged = new Proxy(target, {
      get(t, prop, receiver): unknown {
        if (prop === "length") return 4_000_000_000;
        return Reflect.get(t, prop, receiver);
      }
    });

    const startedAt = Date.now();
    expectRejection(() => summarizeFinalizedAgentCycles(forged as unknown as FinalizedAgentCycleBatchResults));
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs < 500, `rejection must not scale with the reported length (took ${elapsedMs}ms)`);
  });
});

describe("summarizeFinalizedAgentCycles: nested evaluations/result/rejectionCodes structural validation", () => {
  it("rejects a COMPLETED/ACCEPTED item whose evaluations is empty (the reported bypass)", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations: [], result: {} }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose evaluations and rejectionCodes are empty (the reported bypass)", () => {
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "HOLD", reason: "ATTEMPTS_EXHAUSTED", evaluations: [], rejectionCodes: [] }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose evaluations holds more entries than the maximum allowed", () => {
    const evaluations = [
      rejectedEvaluationEntry(),
      rejectedEvaluationEntry(),
      rejectedEvaluationEntry(),
      acceptedEvaluationEntry()
    ];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations, result: acceptedEvaluationEntry() }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose evaluations array is sparse", () => {
    const evaluations = [rejectedEvaluationEntry(), , rejectedEvaluationEntry()] as unknown[]; // eslint-disable-line no-sparse-arrays
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        status: "HOLD",
        reason: "ATTEMPTS_EXHAUSTED",
        evaluations,
        rejectionCodes: ["INVALID_JSON", "INVALID_JSON"]
      }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose evaluations array carries an extra non-enumerable property", () => {
    const evaluations: unknown[] = [acceptedEvaluationEntry()];
    Object.defineProperty(evaluations, "hidden", { value: "secret-field", enumerable: false });
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations, result: acceptedEvaluationEntry() }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose rejectionCodes array carries an extra Symbol-keyed property", () => {
    const evaluations = [rejectedEvaluationEntry()];
    const rejectionCodes: unknown[] = evaluations.map((evaluation) => evaluation.code);
    (rejectionCodes as unknown as Record<symbol, unknown>)[Symbol("hidden")] = "secret-symbol-field";
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "HOLD", reason: "ATTEMPTS_EXHAUSTED", evaluations, rejectionCodes }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose evaluation entry carries an extra property", () => {
    const evaluations = [{ ...acceptedEvaluationEntry(), extra: "nope" }];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations, result: acceptedEvaluationEntry() }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose evaluation entry declares an unknown rejection code", () => {
    const evaluations = [rejectedEvaluationEntry("SOMETHING_ELSE")];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        status: "HOLD",
        reason: "ATTEMPTS_EXHAUSTED",
        evaluations,
        rejectionCodes: ["SOMETHING_ELSE"]
      }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose evaluations contains an ACCEPTED-shaped entry", () => {
    const evaluations = [rejectedEvaluationEntry(), acceptedEvaluationEntry()];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        status: "HOLD",
        reason: "ATTEMPTS_EXHAUSTED",
        evaluations,
        rejectionCodes: ["INVALID_JSON"]
      }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose result has a REJECTED shape instead of ACCEPTED", () => {
    const evaluations = [acceptedEvaluationEntry()];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations, result: rejectedEvaluationEntry() }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/ACCEPTED item whose result is missing proposal", () => {
    const evaluations = [acceptedEvaluationEntry()];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: { status: "ACCEPTED", evaluations, result: { status: "ACCEPTED", capture: syntheticCapture() } }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose rejectionCodes length does not match evaluations", () => {
    const evaluations = [rejectedEvaluationEntry(), rejectedEvaluationEntry()];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        status: "HOLD",
        reason: "ATTEMPTS_EXHAUSTED",
        evaluations,
        rejectionCodes: ["INVALID_JSON"]
      }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("rejects a COMPLETED/HOLD item whose rejectionCodes order does not match the declared evaluations", () => {
    const evaluations = [rejectedEvaluationEntry("INVALID_JSON"), rejectedEvaluationEntry("INVALID_PROPOSAL")];
    const forged = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        status: "HOLD",
        reason: "ATTEMPTS_EXHAUSTED",
        evaluations,
        rejectionCodes: ["INVALID_PROPOSAL", "INVALID_JSON"]
      }
    } as unknown as FinalizedAgentCycleBatchResult;
    expectRejection(() => summarizeFinalizedAgentCycles([forged]));
  });

  it("accepts a COMPLETED/HOLD item at the maximum allowed evaluations count", () => {
    const evaluations = [rejectedEvaluationEntry(), rejectedEvaluationEntry(), rejectedEvaluationEntry()];
    const valid = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        status: "HOLD",
        reason: "ATTEMPTS_EXHAUSTED",
        evaluations,
        rejectionCodes: evaluations.map((evaluation) => evaluation.code)
      }
    } as unknown as FinalizedAgentCycleBatchResult;

    const summary = summarizeFinalizedAgentCycles([valid]);

    assert.equal(summary.holdCount, 1);
    assert.deepEqual(summary.holdItemIds, ["a"]);
  });
});

describe("summarizeFinalizedAgentCycles: hostile getters and Proxy traps fail closed without leaking a secret", () => {
  it("fails closed when the batch array's length getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_LENGTH_PROXY";
    const forged = new Proxy([completedAccepted("a")], {
      get(target, prop, receiver): unknown {
        if (prop === "length") throw new ContractValidationError("Forged", "length", secret);
        return Reflect.get(target, prop, receiver);
      }
    });

    const error = expectRejection(() => summarizeFinalizedAgentCycles(forged as unknown as FinalizedAgentCycleBatchResults));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when Reflect.ownKeys on the batch array itself throws a forged value", () => {
    const secret = "SECRET_FROM_BATCH_OWN_KEYS_TRAP";
    const forged = new Proxy([completedAccepted("a"), failed("b")], {
      ownKeys(): never {
        throw new ContractValidationError("Forged", "ownKeys", secret);
      }
    });

    const error = expectRejection(() => summarizeFinalizedAgentCycles(forged as unknown as FinalizedAgentCycleBatchResults));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when an item's itemId getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_ITEM_ID_GETTER";
    const forgedItem = {
      status: "FAILED",
      code: "AGENT_CYCLE_FAILED",
      get itemId(): never {
        throw new ContractValidationError("Forged", "itemId", secret);
      }
    };

    const error = expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when an item's status getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_STATUS_GETTER";
    const forgedItem = {
      itemId: "a",
      code: "AGENT_CYCLE_FAILED",
      get status(): never {
        throw new ContractValidationError("Forged", "status", secret);
      }
    };

    const error = expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when Reflect.ownKeys on an item throws a forged value", () => {
    const secret = "SECRET_FROM_ITEM_OWN_KEYS_TRAP";
    const forgedItem = new Proxy(
      { itemId: "a", status: "FAILED", code: "AGENT_CYCLE_FAILED" },
      {
        ownKeys(): never {
          throw new ContractValidationError("Forged", "ownKeys", secret);
        }
      }
    );

    const error = expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when a COMPLETED item's nested result status getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_RESULT_STATUS_GETTER";
    const forgedItem = {
      itemId: "a",
      status: "COMPLETED",
      result: {
        get status(): never {
          throw new ContractValidationError("Forged", "status", secret);
        }
      }
    };

    const error = expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when Reflect.ownKeys on a nested result throws a forged value", () => {
    const secret = "SECRET_FROM_RESULT_OWN_KEYS_TRAP";
    const forgedResult = new Proxy(
      { status: "ACCEPTED", evaluations: [], result: {} },
      {
        ownKeys(): never {
          throw new ContractValidationError("Forged", "ownKeys", secret);
        }
      }
    );
    const forgedItem = { itemId: "a", status: "COMPLETED", result: forgedResult };

    const error = expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when a FAILED item's code getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_CODE_GETTER";
    const forgedItem = {
      itemId: "a",
      status: "FAILED",
      get code(): never {
        throw new ContractValidationError("Forged", "code", secret);
      }
    };

    const error = expectRejection(() => summarizeFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchResult]));

    assert.ok(!error.message.includes(secret));
  });
});

describe("summarizeFinalizedAgentCycles: output is frozen; input is not mutated", () => {
  it("freezes the summary and every itemId list", async () => {
    const batch = await buildRealBatch([
      { itemId: "a", kind: "ACCEPTED" },
      { itemId: "h", kind: "HOLD" },
      { itemId: "f", kind: "FAILED" }
    ]);

    const summary = summarizeFinalizedAgentCycles(batch);

    assert.ok(Object.isFrozen(summary));
    assert.ok(Object.isFrozen(summary.acceptedItemIds));
    assert.ok(Object.isFrozen(summary.holdItemIds));
    assert.ok(Object.isFrozen(summary.failedItemIds));
  });

  it("does not mutate a plain, unfrozen input batch or its items", () => {
    const batch = [completedAccepted("a"), completedHold("h"), failed("f")];
    const before = jsonClone(batch);

    summarizeFinalizedAgentCycles(batch as unknown as FinalizedAgentCycleBatchResults);

    assert.deepEqual(jsonClone(batch), before);
  });
});

describe("summarizeFinalizedAgentCycles: determinism", () => {
  it("produces a field-for-field identical summary for the same input", async () => {
    const batch = await buildRealBatch([
      { itemId: "a", kind: "ACCEPTED" },
      { itemId: "h", kind: "HOLD" },
      { itemId: "f", kind: "FAILED" }
    ]);

    const first = summarizeFinalizedAgentCycles(batch);
    const second = summarizeFinalizedAgentCycles(batch);

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });

  it("produces identical summaries for two independently built but equivalent batches", async () => {
    const spec: readonly BatchSpecEntry[] = [
      { itemId: "a", kind: "ACCEPTED" },
      { itemId: "h", kind: "HOLD" },
      { itemId: "f", kind: "FAILED" }
    ];

    const first = summarizeFinalizedAgentCycles(await buildRealBatch(spec));
    const second = summarizeFinalizedAgentCycles(await buildRealBatch(spec));

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});
