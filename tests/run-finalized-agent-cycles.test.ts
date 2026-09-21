import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "../src/agent/retry-policy.js";
import {
  runFinalizedAgentCycles,
  type FinalizedAgentCycleBatchItem,
  type FinalizedAgentCycleBatchItems,
  type RunBoundedAgentAttemptsRequest
} from "../src/agent/run-finalized-agent-cycles.js";

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

function acceptedRequest(cycleId: string, adapter: AgentAdapter = new SequentialAdapter([acceptedResponse(cycleId)])): RunBoundedAgentAttemptsRequest {
  return {
    adapter,
    request: request(cycleId),
    policy: policy(1),
    responseIds: ids(1, `r-${cycleId}`),
    promptVersion: PROMPT_VERSION,
    model: MODEL
  };
}

function exhaustedRequest(cycleId: string, adapter: AgentAdapter = new SequentialAdapter([INVALID_JSON_RESPONSE])): RunBoundedAgentAttemptsRequest {
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
  assert.fail("expected runFinalizedAgentCycles to reject");
}

describe("runFinalizedAgentCycles: single-item batches", () => {
  it("returns one COMPLETED/ACCEPTED item for a single accepted cycle", async () => {
    const results = await runFinalizedAgentCycles([item("item-1", acceptedRequest("cycle-1"))]);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.itemId, "item-1");
    assert.equal(results[0]?.status, "COMPLETED");
    if (results[0]?.status !== "COMPLETED") return;
    assert.equal(results[0].result.status, "ACCEPTED");
  });

  it("returns one COMPLETED/HOLD item for a single exhausted cycle", async () => {
    const results = await runFinalizedAgentCycles([item("item-1", exhaustedRequest("cycle-1"))]);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.itemId, "item-1");
    assert.equal(results[0]?.status, "COMPLETED");
    if (results[0]?.status !== "COMPLETED") return;
    assert.equal(results[0].result.status, "HOLD");
    if (results[0].result.status !== "HOLD") return;
    assert.equal(results[0].result.reason, "ATTEMPTS_EXHAUSTED");
  });
});

describe("runFinalizedAgentCycles: multi-item batches preserve order, itemId and results", () => {
  it("preserves order, itemId and each individual result across three items", async () => {
    const batch: FinalizedAgentCycleBatchItems = [
      item("first", acceptedRequest("cycle-a")),
      item("second", exhaustedRequest("cycle-b")),
      item("third", acceptedRequest("cycle-c"))
    ];

    const results = await runFinalizedAgentCycles(batch);

    assert.equal(results.length, 3);
    assert.deepEqual(
      results.map((result) => result.itemId),
      ["first", "second", "third"]
    );
    assert.deepEqual(
      results.map((result) => result.status),
      ["COMPLETED", "COMPLETED", "COMPLETED"]
    );
    assert.equal(results[0]?.status === "COMPLETED" ? results[0].result.status : undefined, "ACCEPTED");
    assert.equal(results[1]?.status === "COMPLETED" ? results[1].result.status : undefined, "HOLD");
    assert.equal(results[2]?.status === "COMPLETED" ? results[2].result.status : undefined, "ACCEPTED");
  });
});

describe("runFinalizedAgentCycles: each cycle and adapter is called exactly once, no duplication", () => {
  it("calls each item's adapter exactly once and runs items sequentially in order", async () => {
    const callOrder: string[] = [];
    class TrackingAdapter implements AgentAdapter {
      public callCount = 0;
      public constructor(private readonly label: string, private readonly response: unknown) {}
      public call(_request: AgentRequest): unknown {
        this.callCount += 1;
        callOrder.push(this.label);
        return this.response;
      }
    }

    const adapterA = new TrackingAdapter("a", acceptedResponse("cycle-a"));
    const adapterB = new TrackingAdapter("b", acceptedResponse("cycle-b"));
    const adapterC = new TrackingAdapter("c", acceptedResponse("cycle-c"));

    const results = await runFinalizedAgentCycles([
      item("a", acceptedRequest("cycle-a", adapterA)),
      item("b", acceptedRequest("cycle-b", adapterB)),
      item("c", acceptedRequest("cycle-c", adapterC))
    ]);

    assert.equal(adapterA.callCount, 1);
    assert.equal(adapterB.callCount, 1);
    assert.equal(adapterC.callCount, 1);
    assert.deepEqual(callOrder, ["a", "b", "c"]);
    assert.ok(results.every((result) => result.status === "COMPLETED"));
  });
});

describe("runFinalizedAgentCycles: a failing item is isolated; later items still run", () => {
  it("produces FAILED/AGENT_CYCLE_FAILED for a thrown adapter error, and runs the next item", async () => {
    const secret = "SECRET_FROM_THROWING_ADAPTER";
    const failingAdapter = new ThrowingAdapter(new Error(secret));
    const okAdapter = new SequentialAdapter([acceptedResponse("cycle-ok")]);

    const results = await runFinalizedAgentCycles([
      item("failing", { ...acceptedRequest("cycle-fail"), adapter: failingAdapter }),
      item("ok", acceptedRequest("cycle-ok", okAdapter))
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0]?.itemId, "failing");
    assert.equal(results[0]?.status, "FAILED");
    if (results[0]?.status === "FAILED") {
      assert.equal(results[0].code, "AGENT_CYCLE_FAILED");
      assert.deepEqual(Object.keys(results[0]).sort(), ["code", "itemId", "status"]);
    }
    assert.equal(results[1]?.itemId, "ok");
    assert.equal(results[1]?.status, "COMPLETED");
    assert.equal(failingAdapter.callCount, 1);
    assert.equal(okAdapter.callCount, 1);
  });

  it("isolates a hostile Proxy request that throws instead of a plain error, without leaking a secret", async () => {
    const secret = "SECRET_FROM_HOSTILE_REQUEST_PROXY";
    const hostileRequest = new Proxy(acceptedRequest("cycle-hostile"), {
      get(): never {
        throw new ContractValidationError("Forged", "field", secret);
      }
    });
    const okAdapter = new SequentialAdapter([acceptedResponse("cycle-ok")]);

    const results = await runFinalizedAgentCycles([
      item("hostile", hostileRequest as unknown as RunBoundedAgentAttemptsRequest),
      item("ok", acceptedRequest("cycle-ok", okAdapter))
    ]);

    assert.equal(results[0]?.status, "FAILED");
    if (results[0]?.status === "FAILED") {
      assert.equal(results[0].code, "AGENT_CYCLE_FAILED");
    }
    assert.equal(results[1]?.status, "COMPLETED");
    assert.equal(JSON.stringify(results).includes(secret), false);
  });

  it("never leaks a message, stack, payload or secret from a failed item's error", async () => {
    const secret = "SECRET_PAYLOAD_MUST_NOT_LEAK";
    const failingAdapter = new ThrowingAdapter({ message: secret, stack: secret, payload: { token: secret } });

    const results = await runFinalizedAgentCycles([item("failing", { ...acceptedRequest("cycle-fail"), adapter: failingAdapter })]);

    assert.equal(results[0]?.status, "FAILED");
    assert.equal(JSON.stringify(results).includes(secret), false);
  });
});

describe("runFinalizedAgentCycles: invalid or forged batch structure fails before the first adapter call", () => {
  it("rejects a null batch without calling any adapter", async () => {
    await expectRejection(runFinalizedAgentCycles(null as never));
  });

  it("rejects an empty batch without calling any adapter", async () => {
    await expectRejection(runFinalizedAgentCycles([]));
  });

  it("rejects a sparse batch array without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [item("a", acceptedRequest("cycle-a", adapter)), , item("c", acceptedRequest("cycle-c"))] as unknown as FinalizedAgentCycleBatchItems;

    await expectRejection(runFinalizedAgentCycles(sparse));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a batch containing an invalid item without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const batch = [item("a", acceptedRequest("cycle-a", adapter)), "not-an-item"] as unknown as FinalizedAgentCycleBatchItems;

    await expectRejection(runFinalizedAgentCycles(batch));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a duplicate itemId without calling any adapter", async () => {
    const adapterA = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const adapterB = new SequentialAdapter([acceptedResponse("cycle-b")]);

    await expectRejection(
      runFinalizedAgentCycles([
        item("same-id", acceptedRequest("cycle-a", adapterA)),
        item("same-id", acceptedRequest("cycle-b", adapterB))
      ])
    );

    assert.equal(adapterA.callCount, 0);
    assert.equal(adapterB.callCount, 0);
  });

  it("rejects an item with an extra enumerable property without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const forgedItem = { itemId: "a", request: acceptedRequest("cycle-a", adapter), extra: "nope" };

    await expectRejection(runFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchItem]));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an item with an extra non-enumerable property without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const forgedItem: Record<string, unknown> = { itemId: "a", request: acceptedRequest("cycle-a", adapter) };
    Object.defineProperty(forgedItem, "hidden", { value: "secret-field", enumerable: false });

    await expectRejection(runFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchItem]));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an item with an extra Symbol-keyed property without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const forgedItem: Record<string | symbol, unknown> = { itemId: "a", request: acceptedRequest("cycle-a", adapter) };
    forgedItem[Symbol("hidden")] = "secret-symbol-field";

    await expectRejection(runFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchItem]));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a batch array carrying an extra own property on the array itself", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);
    const forgedBatch = [item("a", acceptedRequest("cycle-a", adapter))] as unknown as FinalizedAgentCycleBatchItems & {
      extra?: string;
    };
    (forgedBatch as unknown as { extra: string }).extra = "nope";

    await expectRejection(runFinalizedAgentCycles(forgedBatch));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an empty or blank itemId without calling any adapter", async () => {
    const adapter = new SequentialAdapter([acceptedResponse("cycle-a")]);

    await expectRejection(runFinalizedAgentCycles([item("", acceptedRequest("cycle-a", adapter))]));

    assert.equal(adapter.callCount, 0);
  });
});

describe("runFinalizedAgentCycles: hostile getters and Proxy traps fail closed without leaking a secret", () => {
  it("fails closed when the batch array's length getter throws a forged ContractValidationError", async () => {
    const secret = "SECRET_FROM_LENGTH_PROXY";
    const forged = new Proxy([item("a", acceptedRequest("cycle-a"))], {
      get(target, prop, receiver): unknown {
        if (prop === "length") throw new ContractValidationError("Forged", "length", secret);
        return Reflect.get(target, prop, receiver);
      }
    });

    const error = await expectRejection(runFinalizedAgentCycles(forged as unknown as FinalizedAgentCycleBatchItems));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when an item entry read throws a forged ContractValidationError", async () => {
    const secret = "SECRET_FROM_ITEM_PROXY";
    const forged = new Proxy([item("a", acceptedRequest("cycle-a")), item("b", acceptedRequest("cycle-b"))], {
      get(target, prop, receiver): unknown {
        if (prop === "0") throw new ContractValidationError("Forged", "0", secret);
        return Reflect.get(target, prop, receiver);
      }
    });

    const error = await expectRejection(runFinalizedAgentCycles(forged as unknown as FinalizedAgentCycleBatchItems));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when an item's itemId getter throws a forged ContractValidationError", async () => {
    const secret = "SECRET_FROM_ITEM_ID_GETTER";
    const forgedItem = {
      request: acceptedRequest("cycle-a"),
      get itemId(): never {
        throw new ContractValidationError("Forged", "itemId", secret);
      }
    };

    const error = await expectRejection(runFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchItem]));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when Reflect.ownKeys on an item throws a forged value", async () => {
    const secret = "SECRET_FROM_OWN_KEYS_TRAP";
    const forgedItem = new Proxy(
      { itemId: "a", request: acceptedRequest("cycle-a") },
      {
        ownKeys(): never {
          throw new ContractValidationError("Forged", "ownKeys", secret);
        }
      }
    );

    const error = await expectRejection(runFinalizedAgentCycles([forgedItem as unknown as FinalizedAgentCycleBatchItem]));

    assert.ok(!error.message.includes(secret));
  });
});

describe("runFinalizedAgentCycles: results, list and items are frozen; inputs are not mutated", () => {
  it("freezes the results list and every entry", async () => {
    const results = await runFinalizedAgentCycles([
      item("a", acceptedRequest("cycle-a")),
      item("b", exhaustedRequest("cycle-b"))
    ]);

    assert.ok(Object.isFrozen(results));
    for (const result of results) {
      assert.ok(Object.isFrozen(result));
    }
  });

  it("does not mutate the input batch or its items", async () => {
    const batch = [item("a", acceptedRequest("cycle-a")), item("b", exhaustedRequest("cycle-b"))];
    const before = jsonClone(batch.map((entry) => ({ itemId: entry.itemId })));

    await runFinalizedAgentCycles(batch);

    assert.deepEqual(
      batch.map((entry) => ({ itemId: entry.itemId })),
      before
    );
  });
});

describe("runFinalizedAgentCycles: determinism", () => {
  it("produces a field-for-field identical result list for the same input", async () => {
    function buildBatch(): FinalizedAgentCycleBatchItems {
      return [
        item("a", acceptedRequest("cycle-a")),
        item("b", exhaustedRequest("cycle-b")),
        item("c", acceptedRequest("cycle-c"))
      ];
    }

    const first = await runFinalizedAgentCycles(buildBatch());
    const second = await runFinalizedAgentCycles(buildBatch());

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});

describe("runFinalizedAgentCycles: offline, no clock, timer, randomness, network or I/O", () => {
  it("returns an identical result regardless of elapsed wall-clock time between calls", async () => {
    function buildBatch(): FinalizedAgentCycleBatchItems {
      return [item("a", acceptedRequest("cycle-a")), item("b", exhaustedRequest("cycle-b"))];
    }

    const first = await runFinalizedAgentCycles(buildBatch());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runFinalizedAgentCycles(buildBatch());

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});
