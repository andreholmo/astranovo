import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import { finalizeBoundedAgentAttempts } from "../src/agent/finalize-bounded-agent-attempts.js";
import { parseAgentRetryPolicy, type AgentRetryPolicy } from "../src/agent/retry-policy.js";
import { runBoundedAgentAttempts } from "../src/agent/run-bounded-agent-attempts.js";
import {
  runFinalizedAgentCycle,
  type RunBoundedAgentAttemptsRequest
} from "../src/agent/run-finalized-agent-cycle.js";

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
  public readonly requestedResponseOrder: unknown[] = [];
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
    this.requestedResponseOrder.push(response);
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
  assert.fail("expected runFinalizedAgentCycle to reject");
}

describe("runFinalizedAgentCycle: rejects once, then accepts", () => {
  it("returns ACCEPTED, preserving captures, proposal, order and ids", async () => {
    const responseIds = ["r-first", "r-second"];
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE]);

    const finalized = await runFinalizedAgentCycle(
      baseInput({ adapter, policy: policy(2), responseIds })
    );

    assert.equal(adapter.callCount, 2);
    assert.equal(finalized.status, "ACCEPTED");
    if (finalized.status !== "ACCEPTED") return;
    assert.equal(finalized.evaluations.length, 2);
    assert.deepEqual(
      finalized.evaluations.map((evaluation) => evaluation.status),
      ["REJECTED", "ACCEPTED"]
    );
    assert.deepEqual(
      finalized.evaluations.map((evaluation) => evaluation.capture.responseId),
      responseIds
    );
    assert.deepEqual(jsonClone(finalized.result.proposal), jsonClone(VALID_PROPOSAL));
  });
});

describe("runFinalizedAgentCycle: converts exhaustion into HOLD", () => {
  for (const maxAttempts of [1, 2, 3]) {
    it(`returns HOLD with reason and closed codes in order for maxAttempts=${maxAttempts}`, async () => {
      const responseIds = ids(maxAttempts);
      const adapter = new SequentialAdapter(Array.from({ length: maxAttempts }, () => INVALID_JSON_RESPONSE));

      const finalized = await runFinalizedAgentCycle(
        baseInput({ adapter, policy: policy(maxAttempts), responseIds })
      );

      assert.equal(adapter.callCount, maxAttempts);
      assert.equal(finalized.status, "HOLD");
      if (finalized.status !== "HOLD") return;
      assert.equal(finalized.reason, "ATTEMPTS_EXHAUSTED");
      assert.equal(finalized.evaluations.length, maxAttempts);
      assert.ok(finalized.evaluations.every((evaluation) => evaluation.status === "REJECTED"));
      assert.deepEqual(finalized.rejectionCodes, Array.from({ length: maxAttempts }, () => "INVALID_JSON"));
      assert.deepEqual(
        finalized.evaluations.map((evaluation) => evaluation.capture.responseId),
        responseIds
      );
    });
  }
});

describe("runFinalizedAgentCycle: adapter is called exactly as many times as needed", () => {
  it("makes no further call once accepted, even though more ids/responses were available", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    const finalized = await runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }));

    assert.equal(adapter.callCount, 1);
    assert.equal(finalized.status, "ACCEPTED");
  });

  it("never calls the adapter again after a thrown failure", async () => {
    const secret = "SECRET_TOKEN_FROM_ADAPTER";
    const adapter = new ThrowingAdapter(new Error(secret));

    const error = await expectRejection(
      runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }))
    );

    assert.equal(adapter.callCount, 1);
    assert.ok(!error.message.includes(secret));
  });

  it("never exceeds policy.maxAttempts calls when every attempt is rejected", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE]);

    const finalized = await runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }));

    assert.equal(adapter.callCount, 3);
    assert.equal(finalized.status, "HOLD");
  });
});

describe("runFinalizedAgentCycle: each explicit responseId is used once and in order", () => {
  it("threads caller-supplied responseIds through to each evaluation's capture in order", async () => {
    const responseIds = ["alpha", "beta", "gamma"];
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE]);

    const finalized = await runFinalizedAgentCycle(
      baseInput({ adapter, policy: policy(3), responseIds })
    );

    assert.equal(finalized.status, "ACCEPTED");
    if (finalized.status !== "ACCEPTED") return;
    assert.deepEqual(
      finalized.evaluations.map((evaluation) => evaluation.capture.responseId),
      responseIds
    );
  });
});

describe("runFinalizedAgentCycle: invalid or forged input fails before the first adapter call", () => {
  it("rejects a null input value without calling the adapter", async () => {
    await expectRejection(runFinalizedAgentCycle(null as never));
  });

  it("rejects an array input value without calling the adapter", async () => {
    await expectRejection(runFinalizedAgentCycle([] as never));
  });

  it("rejects too few responseIds for the policy, without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds: ids(2) }))
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a duplicate responseId without calling the adapter", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runFinalizedAgentCycle(
        baseInput({ adapter, policy: policy(3), responseIds: ["same-id", "same-id", "other-id"] })
      )
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a null adapter without calling it", async () => {
    await expectRejection(runFinalizedAgentCycle(baseInput({ adapter: null as unknown as AgentAdapter })));
  });

  it("fails closed without leaking a secret thrown by a Proxy over responseIds, and never calls the adapter", async () => {
    const secret = "SECRET_FROM_RESPONSE_IDS_ARRAY_PROXY";
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);
    const forgedResponseIds = new Proxy(["id-1", "id-2", "id-3"], {
      get(): never {
        throw new Error(secret);
      }
    });

    const error = await expectRejection(
      runFinalizedAgentCycle(
        baseInput({ adapter, policy: policy(3), responseIds: forgedResponseIds as unknown as readonly string[] })
      )
    );

    assert.ok(!error.message.includes(secret));
    assert.equal(adapter.callCount, 0);
  });
});

describe("runFinalizedAgentCycle: adapter exceptions stay sanitized and start no new attempt", () => {
  it("propagates a sanitized error and makes exactly one call when adapter.call throws", async () => {
    const secret = "SECRET_FROM_ADAPTER_THROW";
    const adapter = new ThrowingAdapter(new Error(secret));

    const error = await expectRejection(
      runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }))
    );

    assert.ok(error instanceof ContractValidationError);
    assert.ok(!error.message.includes(secret));
    assert.equal(adapter.callCount, 1);
  });

  it("propagates a sanitized error and makes exactly one call when the raw response is not a string", async () => {
    const adapter = new SequentialAdapter([42, ACCEPTED_RESPONSE, ACCEPTED_RESPONSE]);

    await expectRejection(
      runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds: ids(3) }))
    );

    assert.equal(adapter.callCount, 1);
  });
});

describe("runFinalizedAgentCycle: results and lists are frozen; inputs are not mutated", () => {
  it("freezes an ACCEPTED outcome and its evaluations list", async () => {
    const adapter = new SequentialAdapter([ACCEPTED_RESPONSE]);

    const finalized = await runFinalizedAgentCycle(baseInput({ adapter }));

    assert.ok(Object.isFrozen(finalized));
    assert.ok(Object.isFrozen((finalized as { evaluations: unknown }).evaluations));
  });

  it("freezes a HOLD outcome, its evaluations list and its rejectionCodes list", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE]);

    const finalized = await runFinalizedAgentCycle(baseInput({ adapter, policy: policy(1), responseIds: ids(1) }));

    assert.ok(Object.isFrozen(finalized));
    assert.ok(Object.isFrozen((finalized as { evaluations: unknown }).evaluations));
    assert.ok(Object.isFrozen((finalized as { rejectionCodes: unknown }).rejectionCodes));
  });

  it("does not mutate the responseIds array or the AgentRequest passed in", async () => {
    const adapter = new SequentialAdapter([INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE]);
    const responseIds = ids(3);
    const beforeIds = [...responseIds];
    const beforeRequest = { ...REQUEST };

    await runFinalizedAgentCycle(baseInput({ adapter, policy: policy(3), responseIds }));

    assert.deepEqual(responseIds, beforeIds);
    assert.deepEqual({ ...REQUEST }, beforeRequest);
  });
});

describe("runFinalizedAgentCycle: determinism", () => {
  it("produces a field-for-field identical ACCEPTED outcome for the same input", async () => {
    const responses = [INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE];
    const first = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );
    const second = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });

  it("produces a field-for-field identical HOLD outcome for the same input", async () => {
    const responses = [INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE];
    const first = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(2), responseIds: ids(2) })
    );
    const second = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(2), responseIds: ids(2) })
    );

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});

describe("runFinalizedAgentCycle: no duplicated proposal, capture, validation, retry or finalization", () => {
  it("matches calling runBoundedAgentAttempts then finalizeBoundedAgentAttempts directly, for ACCEPTED", async () => {
    const responses = [INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE];
    const composed = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(2), responseIds: ids(2) })
    );
    const bounded = await runBoundedAgentAttempts(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(2), responseIds: ids(2) })
    );
    const directlyFinalized = finalizeBoundedAgentAttempts(bounded);

    assert.deepEqual(jsonClone(composed), jsonClone(directlyFinalized));
  });

  it("matches calling runBoundedAgentAttempts then finalizeBoundedAgentAttempts directly, for HOLD", async () => {
    const responses = [INVALID_JSON_RESPONSE, INVALID_JSON_RESPONSE];
    const composed = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(2), responseIds: ids(2) })
    );
    const bounded = await runBoundedAgentAttempts(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(2), responseIds: ids(2) })
    );
    const directlyFinalized = finalizeBoundedAgentAttempts(bounded);

    assert.deepEqual(jsonClone(composed), jsonClone(directlyFinalized));
  });
});

describe("runFinalizedAgentCycle: offline, no clock, timer, randomness, network or I/O", () => {
  it("returns an identical result regardless of elapsed wall-clock time between calls", async () => {
    const responses = [INVALID_JSON_RESPONSE, ACCEPTED_RESPONSE];
    const first = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runFinalizedAgentCycle(
      baseInput({ adapter: new SequentialAdapter(responses), policy: policy(3), responseIds: ids(3) })
    );

    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});
