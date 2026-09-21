import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/errors.js";
import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { StubAgentAdapter } from "../src/agent/stub-agent-adapter.js";
import {
  runAuditableAgentAttempt,
  runAuditableAgentAttemptAs
} from "../src/agent/run-auditable-agent-attempt.js";

const REQUEST: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "trend-following",
  cycleId: "cycle-1",
  snapshotId: "snapshot-1"
});

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
  promptVersion: "prompt-v1",
  model: "stub-model"
};

const VALID_RAW_RESPONSE = JSON.stringify(VALID_PROPOSAL);

const BASE_INPUT = {
  request: REQUEST,
  responseId: "response-1",
  promptVersion: "prompt-v1",
  model: "stub-model"
};

class CountingAdapter implements AgentAdapter {
  public callCount = 0;
  readonly #response: unknown;

  public constructor(response: unknown) {
    this.#response = response;
  }

  public call(_request: AgentRequest): unknown {
    this.callCount += 1;
    return this.#response;
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

function stubAdapterWithResponse(response: unknown): StubAgentAdapter {
  return new StubAgentAdapter({
    routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response }]
  });
}

async function expectRejection(promise: Promise<unknown>): Promise<ContractValidationError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ContractValidationError);
    return error;
  }
  assert.fail("expected runAuditableAgentAttempt to reject");
}

describe("runAuditableAgentAttempt ACCEPTED", () => {
  it("calls the adapter exactly once and returns ACCEPTED with capture and proposal", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const evaluation = await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(adapter.callCount, 1);
    assert.equal(evaluation.status, "ACCEPTED");
    if (evaluation.status !== "ACCEPTED") return;
    assert.equal(evaluation.capture.rawResponse, VALID_RAW_RESPONSE);
    assert.equal(evaluation.capture.responseId, "response-1");
    assert.equal(evaluation.proposal.action, "HOLD");
    assert.equal(evaluation.proposal.agentId, "trend-following");
  });

  it("resolves entirely from a StubAgentAdapter, an inherently offline dependency", async () => {
    const adapter = stubAdapterWithResponse(VALID_RAW_RESPONSE);

    const evaluation = await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(evaluation.status, "ACCEPTED");
  });
});

describe("runAuditableAgentAttempt REJECTED evaluations are returned as data, not thrown", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly rawResponse: string; readonly code: string }> = [
    { name: "invalid JSON", rawResponse: "not json at all {{{", code: "INVALID_JSON" },
    {
      name: "an invalid proposal shape",
      rawResponse: JSON.stringify({ action: "FLY_TO_THE_MOON" }),
      code: "INVALID_PROPOSAL"
    },
    {
      name: "a mismatched agentId",
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, agentId: "momentum" }),
      code: "AGENT_ID_MISMATCH"
    },
    {
      name: "a mismatched cycleId",
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, cycleId: "cycle-2" }),
      code: "CYCLE_ID_MISMATCH"
    },
    {
      name: "a mismatched promptVersion",
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, promptVersion: "prompt-v2" }),
      code: "PROMPT_VERSION_MISMATCH"
    },
    {
      name: "a mismatched model",
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, model: "other-model" }),
      code: "MODEL_MISMATCH"
    }
  ];

  for (const testCase of cases) {
    it(`returns REJECTED(${testCase.code}) for ${testCase.name}, preserving the capture byte for byte`, async () => {
      const adapter = new CountingAdapter(testCase.rawResponse);

      const evaluation = await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

      assert.equal(adapter.callCount, 1);
      assert.equal(evaluation.status, "REJECTED");
      if (evaluation.status !== "REJECTED") return;
      assert.equal(evaluation.code, testCase.code);
      assert.equal(evaluation.capture.rawResponse, testCase.rawResponse);
    });
  }
});

describe("runAuditableAgentAttempt fails closed (throws) when no valid capture exists", () => {
  it("throws and does not call the adapter a second time when the raw response is not a string", async () => {
    const adapter = new CountingAdapter({ action: "HOLD" });

    await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.equal(adapter.callCount, 1);
  });

  it("throws for undefined, null and numeric responses", async () => {
    for (const response of [undefined, null, 42]) {
      const adapter = new CountingAdapter(response);
      await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));
      assert.equal(adapter.callCount, 1);
    }
  });

  it("converts a thrown Error carrying a secret into a sanitized ContractValidationError, with exactly one call", async () => {
    const secret = "SECRET_TOKEN_ABC123";
    const adapter = new ThrowingAdapter(new Error(secret));

    const error = await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
    assert.equal(adapter.callCount, 1);
  });

  it("converts a thrown non-Error value into a sanitized ContractValidationError, with exactly one call", async () => {
    const secret = "another-arbitrary-secret-value";
    const adapter = new ThrowingAdapter(secret);

    const error = await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
    assert.equal(adapter.callCount, 1);
  });

  it("does not retry after adapter.call throws", async () => {
    const adapter = new ThrowingAdapter(new Error("boom"));

    await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.equal(adapter.callCount, 1);
  });
});

describe("runAuditableAgentAttempt validates fail-closed before ever calling the adapter", () => {
  it("rejects a null input value without calling the adapter", async () => {
    await expectRejection(runAuditableAgentAttempt(null as never));
  });

  it("rejects an array input value without calling the adapter", async () => {
    await expectRejection(runAuditableAgentAttempt([] as never));
  });

  it("rejects a null adapter without calling it", async () => {
    await expectRejection(
      runAuditableAgentAttempt({ ...BASE_INPUT, adapter: null as unknown as AgentAdapter })
    );
  });

  it("rejects an adapter object with no call function", async () => {
    await expectRejection(
      runAuditableAgentAttempt({ ...BASE_INPUT, adapter: {} as unknown as AgentAdapter })
    );
  });

  it("rejects an adapter whose call property is not a function", async () => {
    await expectRejection(
      runAuditableAgentAttempt({
        ...BASE_INPUT,
        adapter: { call: "not-a-function" } as unknown as AgentAdapter
      })
    );
  });

  it("rejects a non-object adapter without exposing its value in the error message", async () => {
    const secret = "SECRET_TOKEN_NOT_AN_ADAPTER";

    const error = await expectRejection(
      runAuditableAgentAttempt({ ...BASE_INPUT, adapter: secret as unknown as AgentAdapter })
    );

    assert.ok(!error.message.includes(secret));
  });

  it("rejects an invalid AgentRequest without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const invalidRequest = {
      schemaVersion: 1,
      agentId: "",
      cycleId: "cycle-1",
      snapshotId: "snapshot-1"
    } as unknown as AgentRequest;

    await expectRejection(
      runAuditableAgentAttempt({
        adapter,
        request: invalidRequest,
        responseId: "response-1",
        promptVersion: "prompt-v1",
        model: "stub-model"
      })
    );

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a blank promptVersion without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT, promptVersion: "   " }));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an empty model without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT, model: "" }));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a non-string responseId without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await expectRejection(
      runAuditableAgentAttempt({
        adapter,
        ...BASE_INPUT,
        responseId: 123 as unknown as string
      })
    );

    assert.equal(adapter.callCount, 0);
  });
});

describe("runAuditableAgentAttempt immutability, non-mutation and determinism", () => {
  it("freezes an ACCEPTED evaluation, its capture and its proposal", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const evaluation = await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

    assert.ok(Object.isFrozen(evaluation));
    if (evaluation.status !== "ACCEPTED") return assert.fail();
    assert.ok(Object.isFrozen(evaluation.capture));
    assert.ok(Object.isFrozen(evaluation.proposal));
    assert.throws(() => {
      (evaluation as { capture: unknown }).capture = null;
    }, TypeError);
  });

  it("freezes a REJECTED evaluation and its capture", async () => {
    const adapter = new CountingAdapter("not json at all");

    const evaluation = await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

    assert.ok(Object.isFrozen(evaluation));
    if (evaluation.status !== "REJECTED") return assert.fail();
    assert.ok(Object.isFrozen(evaluation.capture));
  });

  it("does not mutate the AgentRequest instance passed in", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const before = { ...REQUEST };

    await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

    assert.deepEqual({ ...REQUEST }, before);
  });

  it("does not mutate the input object passed to it", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const input = { adapter, ...BASE_INPUT };
    const beforeMetadata = { responseId: input.responseId, promptVersion: input.promptVersion, model: input.model };

    await runAuditableAgentAttempt(input);

    assert.deepEqual(
      { responseId: input.responseId, promptVersion: input.promptVersion, model: input.model },
      beforeMetadata
    );
  });

  it("produces field-for-field identical ACCEPTED evaluations for the same canonical input", async () => {
    const first = await runAuditableAgentAttempt({ adapter: new CountingAdapter(VALID_RAW_RESPONSE), ...BASE_INPUT });
    const second = await runAuditableAgentAttempt({
      adapter: new CountingAdapter(VALID_RAW_RESPONSE),
      ...BASE_INPUT
    });

    assert.deepEqual(
      JSON.parse(JSON.stringify(first)) as unknown,
      JSON.parse(JSON.stringify(second)) as unknown
    );
  });
});

describe("runAuditableAgentAttempt is offline: no clock, timer, randomness, network or I/O", () => {
  it("never reads the clock: identical input produces an identical result regardless of call time", async () => {
    const first = await runAuditableAgentAttempt({ adapter: new CountingAdapter(VALID_RAW_RESPONSE), ...BASE_INPUT });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runAuditableAgentAttempt({
      adapter: new CountingAdapter(VALID_RAW_RESPONSE),
      ...BASE_INPUT
    });

    assert.deepEqual(
      JSON.parse(JSON.stringify(first)) as unknown,
      JSON.parse(JSON.stringify(second)) as unknown
    );
  });

  it("does not fabricate a responseId: the capture carries exactly the caller-supplied value", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const evaluation = await runAuditableAgentAttempt({ adapter, ...BASE_INPUT, responseId: "caller-chosen-id" });

    assert.equal(evaluation.capture.responseId, "caller-chosen-id");
  });

  it("never calls the adapter more than once regardless of outcome (single-use StubAgentAdapter route)", async () => {
    const adapter = stubAdapterWithResponse(VALID_RAW_RESPONSE);

    await runAuditableAgentAttempt({ adapter, ...BASE_INPUT });

    await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));
  });
});

describe("runAuditableAgentAttempt error messages never expose raw or agent-supplied content", () => {
  it("does not include arbitrary agent content in a non-string rejection", async () => {
    const secret = "super-secret-token-xyz";
    const adapter = new CountingAdapter({ token: secret });

    const error = await expectRejection(runAuditableAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
  });
});

describe("runAuditableAgentAttemptAs raises every pre-call validation under the caller-supplied contract name", () => {
  it("names the caller's contract for a non-object input value", async () => {
    const error = await expectRejection(runAuditableAgentAttemptAs("CallerContract", null as never));

    assert.equal(error.contract, "CallerContract");
  });

  it("names the caller's contract for an invalid adapter", async () => {
    const error = await expectRejection(
      runAuditableAgentAttemptAs("CallerContract", {
        ...BASE_INPUT,
        adapter: {} as unknown as AgentAdapter
      })
    );

    assert.equal(error.contract, "CallerContract");
  });

  it("names the caller's contract for an invalid responseId, promptVersion and model", async () => {
    const overridesList: ReadonlyArray<Record<string, unknown>> = [
      { responseId: 123 },
      { promptVersion: "   " },
      { model: "" }
    ];

    for (const overrides of overridesList) {
      const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
      const error = await expectRejection(
        runAuditableAgentAttemptAs("CallerContract", { adapter, ...BASE_INPUT, ...overrides } as never)
      );

      assert.equal(error.contract, "CallerContract");
      assert.equal(adapter.callCount, 0);
    }
  });

  it("runAuditableAgentAttempt itself always uses its own module contract name", async () => {
    const error = await expectRejection(
      runAuditableAgentAttempt({ ...BASE_INPUT, adapter: null as unknown as AgentAdapter })
    );

    assert.equal(error.contract, "RunAuditableAgentAttempt");
  });
});

describe("runAuditableAgentAttempt sanitizes a forged adapter whose call getter/proxy throws", () => {
  it("fails closed without leaking a secret thrown by a getter for call, reading it exactly once", async () => {
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
      runAuditableAgentAttempt({ ...BASE_INPUT, adapter: forgedAdapter as unknown as AgentAdapter })
    );

    assert.ok(!error.message.includes(secret));
    assert.equal(
      error.message,
      "Invalid RunAuditableAgentAttempt: adapter must be an object exposing a call(request) function"
    );
    assert.equal(getterReads, 1);
  });

  it("fails closed without leaking a secret thrown by a Proxy get trap for call, reading it exactly once", async () => {
    const secret = "SECRET_FROM_PROXY_TRAP";
    let trapReads = 0;
    const forgedAdapter = new Proxy(
      {},
      {
        get(_target, property): unknown {
          if (property === "call") {
            trapReads += 1;
            throw new Error(secret);
          }
          return undefined;
        }
      }
    );

    const error = await expectRejection(
      runAuditableAgentAttempt({ ...BASE_INPUT, adapter: forgedAdapter as unknown as AgentAdapter })
    );

    assert.ok(!error.message.includes(secret));
    assert.equal(trapReads, 1);
  });
});

describe("runAuditableAgentAttempt sanitizes a forged field of the input object", () => {
  it("fails closed without leaking a secret thrown by a getter for responseId, and never calls the adapter", async () => {
    const secret = "SECRET_FROM_RESPONSE_ID_GETTER";
    let getterReads = 0;
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const forgedInput: Record<string, unknown> = {
      adapter,
      request: REQUEST,
      promptVersion: "prompt-v1",
      model: "stub-model"
    };
    Object.defineProperty(forgedInput, "responseId", {
      enumerable: true,
      configurable: true,
      get(): never {
        getterReads += 1;
        throw new Error(secret);
      }
    });

    const error = await expectRejection(runAuditableAgentAttempt(forgedInput as never));

    assert.ok(!error.message.includes(secret));
    assert.equal(getterReads, 1);
    assert.equal(adapter.callCount, 0);
  });
});
