import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "../src/agent/retry-policy.js";
import {
  runFinalizedAgentCyclesWithSummary,
  type FinalizedAgentCycleBatchItem,
  type RunBoundedAgentAttemptsRequest
} from "../src/agent/run-finalized-agent-cycles-with-summary.js";
import { runFinalizedAgentCycles } from "../src/agent/run-finalized-agent-cycles.js";
import { summarizeFinalizedAgentCycles } from "../src/agent/summarize-finalized-agent-cycles.js";

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

/** A local, deterministic, offline adapter that returns one configured raw response per call, in order. */
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

function item(itemId: string, req: RunBoundedAgentAttemptsRequest): FinalizedAgentCycleBatchItem {
  return { itemId, request: req };
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

async function expectRejection(promise: Promise<unknown>): Promise<ContractValidationError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ContractValidationError);
    return error;
  }
  assert.fail("expected runFinalizedAgentCyclesWithSummary to reject");
}

describe("runFinalizedAgentCyclesWithSummary: mixed batch produces full results and a coherent summary", () => {
  it("returns results and a summary matching calling both modules directly", async () => {
    const batchFor = () => [
      item("a", acceptedRequest("cycle-a", new SequentialAdapter([acceptedResponse("cycle-a")]))),
      item("b", exhaustedRequest("cycle-b", new SequentialAdapter([INVALID_JSON_RESPONSE]))),
      item("c", { ...acceptedRequest("cycle-c"), adapter: new ThrowingAdapter(new Error("boom")) })
    ];

    const composed = await runFinalizedAgentCyclesWithSummary(batchFor());
    const directResults = await runFinalizedAgentCycles(batchFor());
    const directSummary = summarizeFinalizedAgentCycles(directResults);

    assert.deepEqual(jsonClone(composed.results), jsonClone(directResults));
    assert.deepEqual(jsonClone(composed.summary), jsonClone(directSummary));

    assert.equal(composed.summary.total, 3);
    assert.equal(composed.summary.acceptedCount, 1);
    assert.equal(composed.summary.holdCount, 1);
    assert.equal(composed.summary.failedCount, 1);
  });

  it("preserves order and itemId identities across both results and summary", async () => {
    const batch = [
      item("first", acceptedRequest("cycle-first")),
      item("second", exhaustedRequest("cycle-second")),
      item("third", acceptedRequest("cycle-third"))
    ];

    const { results, summary } = await runFinalizedAgentCyclesWithSummary(batch);

    assert.deepEqual(
      results.map((result) => result.itemId),
      ["first", "second", "third"]
    );
    assert.deepEqual(summary.acceptedItemIds, ["first", "third"]);
    assert.deepEqual(summary.holdItemIds, ["second"]);
    assert.deepEqual(summary.failedItemIds, []);
  });
});

describe("runFinalizedAgentCyclesWithSummary: each adapter is called only as many times as its own cycle determines", () => {
  it("never calls an adapter a second time because of the summary step", async () => {
    const acceptedAdapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const holdAdapter = new SequentialAdapter([INVALID_JSON_RESPONSE]);

    await runFinalizedAgentCyclesWithSummary([
      item("a", acceptedRequest("cycle-a", acceptedAdapter)),
      item("b", exhaustedRequest("cycle-b", holdAdapter))
    ]);

    assert.equal(acceptedAdapter.callCount, 1);
    assert.equal(holdAdapter.callCount, 1);
  });
});

describe("runFinalizedAgentCyclesWithSummary: an isolated failure stays FAILED and the rest of the batch still runs", () => {
  it("keeps a thrown adapter error isolated to its own item", async () => {
    const secret = "SECRET_FROM_THROWING_ADAPTER";
    const failingAdapter = new ThrowingAdapter(new Error(secret));
    const okAdapter = new SequentialAdapter([acceptedResponse("cycle-ok")]);

    const { results, summary } = await runFinalizedAgentCyclesWithSummary([
      item("failing", { ...acceptedRequest("cycle-fail"), adapter: failingAdapter }),
      item("ok", acceptedRequest("cycle-ok", okAdapter))
    ]);

    assert.equal(results[0]?.status, "FAILED");
    if (results[0]?.status === "FAILED") {
      assert.equal(results[0].code, "AGENT_CYCLE_FAILED");
    }
    assert.equal(results[1]?.status, "COMPLETED");
    assert.deepEqual(summary.failedItemIds, ["failing"]);
    assert.deepEqual(summary.acceptedItemIds, ["ok"]);
    assert.equal(JSON.stringify(results).includes(secret), false);
    assert.equal(JSON.stringify(summary).includes(secret), false);
  });
});

describe("runFinalizedAgentCyclesWithSummary: invalid input fails closed before any adapter is called", () => {
  it("rejects a null batch without calling any adapter", async () => {
    await expectRejection(runFinalizedAgentCyclesWithSummary(null as never));
  });

  it("rejects an empty batch without calling any adapter", async () => {
    await expectRejection(runFinalizedAgentCyclesWithSummary([]));
  });

  it("rejects a batch with a duplicate itemId without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a"), acceptedResponse("cycle-a")]);

    await expectRejection(
      runFinalizedAgentCyclesWithSummary([
        item("same", acceptedRequest("cycle-a", adapter)),
        item("same", acceptedRequest("cycle-a", adapter))
      ])
    );

    assert.equal(adapter.callCount, 0);
  });
});

describe("runFinalizedAgentCyclesWithSummary: hostile getters and Proxy traps fail closed without leaking a secret", () => {
  it("never leaks a secret thrown by a Proxy standing in for the whole batch", async () => {
    const secret = "SECRET_FROM_BATCH_PROXY";
    const forged = new Proxy([item("a", acceptedRequest("cycle-a"))], {
      get(target, key, receiver): unknown {
        if (key === "length" || key === "0") {
          throw new ContractValidationError("Forged", "field", secret);
        }
        return Reflect.get(target, key, receiver);
      }
    });

    const error = await expectRejection(runFinalizedAgentCyclesWithSummary(forged as never));

    assert.ok(!error.message.includes(secret));
  });

  it("never leaks a secret thrown by a Proxy standing in for one batch item", async () => {
    const secret = "SECRET_FROM_ITEM_PROXY";
    const forgedItem = new Proxy(
      { itemId: "a", request: acceptedRequest("cycle-a") },
      {
        get(): never {
          throw new Error(secret);
        }
      }
    );

    const error = await expectRejection(
      runFinalizedAgentCyclesWithSummary([forgedItem as unknown as FinalizedAgentCycleBatchItem])
    );

    assert.ok(!error.message.includes(secret));
  });
});

describe("runFinalizedAgentCyclesWithSummary: results are frozen and inputs are not mutated", () => {
  it("returns a frozen outer object while preserving the inner freezes of results and summary", async () => {
    const batch = [item("a", acceptedRequest("cycle-a"))];

    const composed = await runFinalizedAgentCyclesWithSummary(batch);

    assert.ok(Object.isFrozen(composed));
    assert.ok(Object.isFrozen(composed.results));
    assert.ok(Object.isFrozen(composed.summary));
    assert.ok(Object.isFrozen(composed.summary.acceptedItemIds));
    assert.ok(Object.isFrozen(composed.summary.holdItemIds));
    assert.ok(Object.isFrozen(composed.summary.failedItemIds));
  });

  it("does not mutate the input batch array or its items", async () => {
    const batch = [item("a", acceptedRequest("cycle-a")), item("b", exhaustedRequest("cycle-b"))];
    const beforeLength = batch.length;
    const beforeItemIds = batch.map((entry) => entry.itemId);

    await runFinalizedAgentCyclesWithSummary(batch);

    assert.equal(batch.length, beforeLength);
    assert.deepEqual(
      batch.map((entry) => entry.itemId),
      beforeItemIds
    );
  });
});

describe("runFinalizedAgentCyclesWithSummary: determinism", () => {
  it("produces a field-for-field identical result for the same data and deterministic adapters", async () => {
    const batchFor = () => [
      item("a", acceptedRequest("cycle-a", new SequentialAdapter([acceptedResponse("cycle-a")]))),
      item("b", exhaustedRequest("cycle-b", new SequentialAdapter([INVALID_JSON_RESPONSE])))
    ];

    const first = await runFinalizedAgentCyclesWithSummary(batchFor());
    const second = await runFinalizedAgentCyclesWithSummary(batchFor());

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});

describe("runFinalizedAgentCyclesWithSummary: offline, no clock, timer, randomness, network or I/O", () => {
  it("returns an identical result regardless of elapsed wall-clock time between calls", async () => {
    const batchFor = () => [item("a", acceptedRequest("cycle-a", new SequentialAdapter([acceptedResponse("cycle-a")])))];

    const first = await runFinalizedAgentCyclesWithSummary(batchFor());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runFinalizedAgentCyclesWithSummary(batchFor());

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});
