import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/errors.js";
import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "../src/agent/retry-policy.js";
import {
  runBoundedAgentAttempts,
  type BoundedAgentAttemptsResult,
  type RunBoundedAgentAttemptsRequest
} from "../src/agent/run-bounded-agent-attempts.js";

const REQUEST: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "trend-following",
  cycleId: "cycle-1",
  snapshotId: "snapshot-1"
});

const PROMPT_VERSION = "prompt-v1";
const MODEL = "stub-model";

const VALID_PROPOSAL = {
  schemaVersion: 1,
  proposalId: "proposal-1",
  cycleId: "cycle-1",
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

const ACCEPTED_RESPONSE = JSON.stringify(VALID_PROPOSAL);
const INVALID_JSON_RESPONSE = "not json at all {{{";
const INVALID_PROPOSAL_RESPONSE = JSON.stringify({ action: "FLY_TO_THE_MOON" });
const AGENT_ID_MISMATCH_RESPONSE = JSON.stringify({ ...VALID_PROPOSAL, agentId: "momentum" });

function policy(maxAttempts: number): AgentRetryPolicy {
  return parseAgentRetryPolicy({ maxAttempts });
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `response-${index + 1}`);
}

function baseInput(overrides: Partial<RunBoundedAgentAttemptsRequest> = {}): RunBoundedAgentAttemptsRequest {
  return {
    adapter: "adapter" in overrides ? (overrides.adapter as AgentAdapter) : new SequentialAdapter([ACCEPTED_RESPONSE]),
    request: "request" in overrides ? (overrides.request as AgentRequest) : REQUEST,
    policy: "policy" in overrides ? (overrides.policy as AgentRetryPolicy) : policy(1),
    responseIds: "responseIds" in overrides ? (overrides.responseIds as readonly string[]) : ids(1),
    promptVersion: "promptVersion" in overrides ? (overrides.promptVersion as string) : PROMPT_VERSION,
    model: "model" in overrides ? (overrides.model as string) : MODEL
  };
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
  assert.fail("expected runBoundedAgentAttempts to reject");
}

describe("runBoundedAgentAttempts: accepts on the first attempt", () => {
  it("stops immediately, calling the adapter once and never consuming the other ids/responses", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, "unused-1", "unused-2"]);

    const result = await runBoundedAgentAttempts(
      baseInput({ adapter, policy: policy(3), responseIds: ids(3) })
    );

    assert.equal(adapter.callCount, 1);
    assert.equal(result.status, "ACCEPTED");
    if (result.status !== "ACCEPTED") return;
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0]?.status, "ACCEPTED");
    assert.deepEqual(jsonClone(result.result), jsonClone(result.evaluations[0]));
  });
});

describe("runBoundedAgentAttempts: rejects once, then accepts", () => {
  it("makes exactly two calls and returns ACCEPTED with both evaluations preserved", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE, "unused"]);

    const result = await runBoundedAgentAttempts(
      baseInput({ adapter, policy: policy(3), responseIds: ids(3) })
    );

    assert.equal(adapter.callCount, 2);
    assert.equal(result.status, "ACCEPTED");
    if (result.status !== "ACCEPTED") return;
    assert.equal(result.evaluations.length, 2);
    assert.equal(result.evaluations[0]?.status, "REJECTED");
    assert.equal(result.evaluations[1]?.status, "ACCEPTED");
  });
});

describe("runBoundedAgentAttempts: exhausts every policy size without exceeding it", () => {
  for (const maxAttempts of [1, 2, 3]) {
    it(`makes exactly ${maxAttempts} call(s) and returns ATTEMPTS_EXHAUSTED for maxAttempts=${maxAttempts}`, async () => {
      const adapter = new SequentialAdapter(Array.from({ length: maxAttempts }, () => INVALID_JSON_RESPONSE));

      const result = await runBoundedAgentAttempts(
        baseInput({ adapter, policy: policy(maxAttempts), responseIds: ids(maxAttempts) })
      );

      assert.equal(adapter.callCount, maxAttempts);
      assert.equal(result.status, "ATTEMPTS_EXHAUSTED");
      if (result.status !== "ATTEMPTS_EXHAUSTED") return;
      assert.equal(result.evaluations.length, maxAttempts);
      assert.equal(result.rejectionCodes.length, maxAttempts);
      assert.ok(result.rejectionCodes.every((code) => code === "INVALID_JSON"));
    });
  }
});

describe("runBoundedAgentAttempts: preserves evaluations, raw captures, order, ids and codes", () => {
  it("keeps each attempt's capture, responseId and code aligned and in order", async () => {
    const responses = [INVALID_JSON_RESPONSE, INVALID_PROPOSAL_RESPONSE, AGENT_ID_MISMATCH_RESPONSE];
    const attemptIds = ["r-first", "r-second", "r-third"];
    const adapter = new SequentialAdapter(responses);

    const result = await runBoundedAgentAttempts(
      baseInput({ adapter, policy: policy(3), responseIds: attemptIds })
    );

    assert.equal(result.status, "ATTEMPTS_EXHAUSTED");
    if (result.status !== "ATTEMPTS_EXHAUSTED") return;
    assert.deepEqual(
      result.evaluations.map((evaluation) => evaluation.capture.rawResponse),
      responses
    );
    assert.deepEqual(
      result.evaluations.map((evaluation) => evaluation.capture.responseId),
      attemptIds
    );
    assert.deepEqual(result.rejectionCodes, ["INVALID_JSON", "INVALID_PROPOSAL", "AGENT_ID_MISMATCH"]);
    assert.deepEqual(
      result.evaluations.map((evaluation) => evaluation.code),
      result.rejectionCodes
    );
  });
});

describe("runBoundedAgentAttempts: never retries after a failure with no valid capture", () => {
  it("propagates a sanitized error and makes exactly one call when the adapter throws", async () => {
    const secret = "SECRET_TOKEN_FROM_ADAPTER";
    const adapter = new ThrowingAdapter(new Error(secret));

    const error = await expectRejection(
      runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }))
    );

    assert.equal(adapter.callCount, 1);
    assert.ok(!error.message.includes(secret));
  });

  it("propagates a sanitized error and makes exactly one call when the raw response is not a string", async () => {
    const adapter = new SequentialAdapter([42, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: ids(3) })));

    assert.equal(adapter.callCount, 1);
  });
});

describe("runBoundedAgentAttempts: validates the entire input, including every responseId, before the first call", () => {
  it("rejects when a later responseId is invalid, without calling the adapter at all", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(
        baseInput({ adapter, policy: policy(3), responseIds: ["ok-1", "ok-2", "   "] })
      )
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a null input value without calling the adapter", async () => {
    await expectRejection(runBoundedAgentAttempts(null as never));
  });

  it("rejects an array input value without calling the adapter", async () => {
    await expectRejection(runBoundedAgentAttempts([] as never));
  });
});

describe("runBoundedAgentAttempts: responseIds fail closed", () => {
  it("rejects too few ids for the policy (missing)", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: ids(2) }))
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects too many ids for the policy (extra)", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: ids(4) }))
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects duplicate ids", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(
        baseInput({ adapter, policy: policy(3), responseIds: ["same-id", "same-id", "other-id"] })
      )
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a blank id, an empty id, a non-string id and a control-character id", async () => {
    const invalidVariants: ReadonlyArray<readonly string[]> = [
      ["   ", "id-2", "id-3"],
      ["", "id-2", "id-3"],
      ["id-1\u0001", "id-2", "id-3"]
    ];

    for (const variant of invalidVariants) {
      const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);
      await expectRejection(
        runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: variant }))
      );
      assert.equal(adapter.callCount, 0);
    }

    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);
    await expectRejection(
      runBoundedAgentAttempts(
        baseInput({
          adapter,
          policy: policy(3),
          responseIds: [123, "id-2", "id-3"] as unknown as readonly string[]
        })
      )
    );
    assert.equal(adapter.callCount, 0);
  });

  it("rejects a forged, array-like (but not a real array) responseIds value", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);
    const forged = { length: 3, 0: "id-1", 1: "id-2", 2: "id-3" } as unknown as readonly string[];

    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: forged })));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a non-array responseIds value", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(
        baseInput({ adapter, policy: policy(1), responseIds: "response-1" as unknown as readonly string[] })
      )
    );

    assert.equal(adapter.callCount, 0);
  });
});

describe("runBoundedAgentAttempts: policy, request, adapter, metadata and input object fail closed", () => {
  it("rejects a policy with maxAttempts outside [1, 3] without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(
        baseInput({ adapter, policy: { maxAttempts: 5 } as unknown as AgentRetryPolicy, responseIds: ids(5) })
      )
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a null policy without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    await expectRejection(
      runBoundedAgentAttempts(baseInput({ adapter, policy: null as unknown as AgentRetryPolicy }))
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an invalid AgentRequest without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);
    const invalidRequest = {
      schemaVersion: 1,
      agentId: "",
      cycleId: "cycle-1",
      snapshotId: "snapshot-1"
    } as unknown as AgentRequest;

    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter, request: invalidRequest })));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a null adapter without calling it", async () => {
    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter: null as unknown as AgentAdapter })));
  });

  it("rejects an adapter with no call function", async () => {
    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter: {} as unknown as AgentAdapter })));
  });

  it("fails closed without leaking a secret thrown by a getter for call, and never invokes it", async () => {
    const secret = "SECRET_FROM_CALL_GETTER";
    let getterReads = 0;
    const forgedAdapter: Record<string, unknown> = {};
    Object.defineProperty(forgedAdapter, "call", {
      enumerable: true,
      configurable: true,
      get(): never {
        getterReads += 1;
        throw new Error(secret);
      }
    });

    const error = await expectRejection(
      runBoundedAgentAttempts(baseInput({ adapter: forgedAdapter as unknown as AgentAdapter }))
    );

    assert.ok(!error.message.includes(secret));
    assert.equal(getterReads, 1);
  });

  it("rejects a blank promptVersion without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter, promptVersion: "   " })));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an empty model without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    await expectRejection(runBoundedAgentAttempts(baseInput({ adapter, model: "" })));

    assert.equal(adapter.callCount, 0);
  });
});

describe("runBoundedAgentAttempts: results, evaluation lists and code lists are frozen; inputs are not mutated", () => {
  it("freezes an ACCEPTED result and its evaluations list", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    const result = await runBoundedAgentAttempts(baseInput({ adapter }));

    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen((result as { evaluations: unknown }).evaluations));
  });

  it("freezes an ATTEMPTS_EXHAUSTED result, its evaluations list and its rejectionCodes list", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE]);

    const result = await runBoundedAgentAttempts(baseInput({ adapter, policy: policy(1), responseIds: ids(1) }));

    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen((result as { evaluations: unknown }).evaluations));
    assert.ok(Object.isFrozen((result as { rejectionCodes: unknown }).rejectionCodes));
  });

  it("does not mutate the responseIds array or the AgentRequest passed in", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE]);
    const responseIds = ids(3);
    const beforeIds = [...responseIds];
    const beforeRequest = { ...REQUEST };

    await runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds }));

    assert.deepEqual(responseIds, beforeIds);
    assert.deepEqual({ ...REQUEST }, beforeRequest);
  });
});

describe("runBoundedAgentAttempts: determinism", () => {
  it("produces a field-for-field identical result for the same sequential adapter and the same input", async () => {
    const responses = [INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE];
    const first = await runBoundedAgentAttempts(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );
    const second = await runBoundedAgentAttempts(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});

describe("runBoundedAgentAttempts: no call after ACCEPTED and never a fourth call", () => {
  it("makes no further call once accepted, even though three ids/responses were available", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }));

    assert.equal(adapter.callCount, 1);
  });

  it("never makes more than policy.maxAttempts calls when every attempt is rejected", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE]);

    const result = await runBoundedAgentAttempts(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }));

    assert.equal(adapter.callCount, 3);
    assert.equal(result.status, "ATTEMPTS_EXHAUSTED");
  });
});

describe("runBoundedAgentAttempts: offline, no clock, timer, randomness, network or I/O", () => {
  it("returns an identical result regardless of elapsed wall-clock time between calls", async () => {
    const responses = [INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE];
    const first = await runBoundedAgentAttempts(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runBoundedAgentAttempts(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });

  it("does not fabricate a responseId: every capture carries exactly the caller-supplied value", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);
    const [callerId] = ids(1) as [string];

    const result: BoundedAgentAttemptsResult = await runBoundedAgentAttempts(
      baseInput({ adapter, responseIds: [callerId] })
    );

    assert.equal(result.status, "ACCEPTED");
    if (result.status !== "ACCEPTED") return;
    assert.equal(result.evaluations[0]?.capture.responseId, callerId);
  });
});
