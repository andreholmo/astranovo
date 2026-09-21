import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/errors.js";
import { parseAgentRequest, type AgentAdapter, type AgentRequest } from "../src/agent/agent-adapter.js";
import { StubAgentAdapter } from "../src/agent/stub-agent-adapter.js";
import { runSingleAgentAttempt } from "../src/agent/run-single-agent-attempt.js";

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
  assert.fail("expected runSingleAgentAttempt to reject");
}

describe("runSingleAgentAttempt happy path", () => {
  it("returns the capture and validated proposal using StubAgentAdapter", async () => {
    const adapter = stubAdapterWithResponse(VALID_RAW_RESPONSE);

    const result = await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(result.capture.rawResponse, VALID_RAW_RESPONSE);
    assert.equal(result.capture.responseId, "response-1");
    assert.equal(result.capture.promptVersion, "prompt-v1");
    assert.equal(result.capture.model, "stub-model");
    assert.equal(result.proposal.action, "HOLD");
    assert.equal(result.proposal.agentId, "trend-following");
    assert.equal(result.proposal.cycleId, "cycle-1");
  });
});

describe("runSingleAgentAttempt calls the adapter exactly once", () => {
  it("calls adapter.call exactly once on success", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(adapter.callCount, 1);
  });

  it("calls adapter.call exactly once even when the response is later rejected", async () => {
    const adapter = new CountingAdapter("not json at all");

    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.equal(adapter.callCount, 1);
  });

  it("never calls the adapter when metadata is invalid", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT, responseId: "" }));

    assert.equal(adapter.callCount, 0);
  });

  it("a single-use StubAgentAdapter route cannot answer a second attempt", async () => {
    const adapter = stubAdapterWithResponse(VALID_RAW_RESPONSE);

    await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });
});

describe("runSingleAgentAttempt preserves the raw response byte for byte", () => {
  it("keeps rawResponse in the capture identical to what the adapter returned", async () => {
    const raw = `${JSON.stringify(VALID_PROPOSAL, null, 2)}\n`;
    const adapter = new CountingAdapter(raw);

    const result = await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(result.capture.rawResponse, raw);
  });

  it("preserves unicode content exactly inside the reason field", async () => {
    const raw = JSON.stringify({ ...VALID_PROPOSAL, reason: "café 🚀 – no edge" });
    const adapter = new CountingAdapter(raw);

    const result = await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(result.capture.rawResponse, raw);
    assert.equal(result.proposal.reason, "café 🚀 – no edge");
  });
});

describe("runSingleAgentAttempt rejects a non-string raw response", () => {
  it("rejects an object response", async () => {
    const adapter = new CountingAdapter({ action: "HOLD" });
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });

  it("rejects undefined, null and numeric responses", async () => {
    for (const response of [undefined, null, 42]) {
      const adapter = new CountingAdapter(response);
      await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
    }
  });
});

describe("runSingleAgentAttempt rejects invalid JSON and invalid proposals", () => {
  it("rejects a raw response that is not valid JSON", async () => {
    const adapter = new CountingAdapter("not json at all {{{");
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });

  it("rejects valid JSON that fails AgentProposal validation", async () => {
    const adapter = new CountingAdapter(JSON.stringify({ action: "FLY_TO_THE_MOON" }));
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });
});

describe("runSingleAgentAttempt rejects identity/provenance divergence", () => {
  it("rejects a proposal with a different agentId", async () => {
    const adapter = new CountingAdapter(JSON.stringify({ ...VALID_PROPOSAL, agentId: "momentum" }));
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });

  it("rejects a proposal with a different cycleId", async () => {
    const adapter = new CountingAdapter(JSON.stringify({ ...VALID_PROPOSAL, cycleId: "cycle-2" }));
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });

  it("rejects a proposal with a different promptVersion", async () => {
    const adapter = new CountingAdapter(JSON.stringify({ ...VALID_PROPOSAL, promptVersion: "prompt-v2" }));
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });

  it("rejects a proposal with a different model", async () => {
    const adapter = new CountingAdapter(JSON.stringify({ ...VALID_PROPOSAL, model: "other-model" }));
    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));
  });
});

describe("runSingleAgentAttempt error messages never expose raw or agent-supplied content", () => {
  it("does not include arbitrary agent content in a non-string rejection", async () => {
    const secret = "super-secret-token-xyz";
    const adapter = new CountingAdapter({ token: secret });

    const error = await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
  });

  it("does not include the malformed raw text in an invalid-JSON rejection", async () => {
    const secret = "SECRET_TOKEN_ABC123";
    const adapter = new CountingAdapter(`not json ${secret} {{{`);

    const error = await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
  });

  it("does not include a diverging field's value in an alignment rejection", async () => {
    const secret = "unexpected-agent";
    const adapter = new CountingAdapter(JSON.stringify({ ...VALID_PROPOSAL, agentId: secret }));

    const error = await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
  });
});

describe("runSingleAgentAttempt immutability and non-mutation", () => {
  it("freezes the returned result, its capture and its proposal", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const result = await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.capture));
    assert.ok(Object.isFrozen(result.proposal));
    assert.throws(() => {
      (result as { capture: unknown }).capture = null;
    }, TypeError);
  });

  it("does not mutate the AgentRequest instance passed in", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const before = { ...REQUEST };

    await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.deepEqual({ ...REQUEST }, before);
  });

  it("does not mutate the request input object passed to it", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const input = { adapter, ...BASE_INPUT };
    const beforeMetadata = { responseId: input.responseId, promptVersion: input.promptVersion, model: input.model };

    await runSingleAgentAttempt(input);

    assert.deepEqual(
      { responseId: input.responseId, promptVersion: input.promptVersion, model: input.model },
      beforeMetadata
    );
  });
});

describe("runSingleAgentAttempt determinism", () => {
  it("produces field-for-field identical results for the same canonical input", async () => {
    const first = await runSingleAgentAttempt({ adapter: new CountingAdapter(VALID_RAW_RESPONSE), ...BASE_INPUT });
    const second = await runSingleAgentAttempt({ adapter: new CountingAdapter(VALID_RAW_RESPONSE), ...BASE_INPUT });

    assert.deepEqual(
      { capture: { ...first.capture, request: { ...first.capture.request } }, proposal: { ...first.proposal } },
      { capture: { ...second.capture, request: { ...second.capture.request } }, proposal: { ...second.proposal } }
    );
  });
});

describe("runSingleAgentAttempt offline: no clock, timer, randomness, network or I/O", () => {
  it("never reads the clock: identical input produces an identical result regardless of call time", async () => {
    const first = await runSingleAgentAttempt({ adapter: new CountingAdapter(VALID_RAW_RESPONSE), ...BASE_INPUT });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runSingleAgentAttempt({ adapter: new CountingAdapter(VALID_RAW_RESPONSE), ...BASE_INPUT });

    assert.deepEqual(
      { capture: { ...first.capture, request: { ...first.capture.request } }, proposal: { ...first.proposal } },
      { capture: { ...second.capture, request: { ...second.capture.request } }, proposal: { ...second.proposal } }
    );
  });

  it("does not fabricate a responseId: the capture carries exactly the caller-supplied value", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const result = await runSingleAgentAttempt({ adapter, ...BASE_INPUT, responseId: "caller-chosen-id" });

    assert.equal(result.capture.responseId, "caller-chosen-id");
  });

  it("resolves entirely from the given in-memory adapter, an inherently offline dependency", async () => {
    const adapter = stubAdapterWithResponse(VALID_RAW_RESPONSE);

    const result = await runSingleAgentAttempt({ adapter, ...BASE_INPUT });

    assert.equal(result.proposal.action, "HOLD");
  });
});

describe("runSingleAgentAttempt validates the adapter fail-closed before calling it", () => {
  it("rejects a null adapter", async () => {
    await expectRejection(
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: null as unknown as AgentAdapter })
    );
  });

  it("rejects an adapter object with no call function", async () => {
    await expectRejection(
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: {} as unknown as AgentAdapter })
    );
  });

  it("rejects an adapter whose call property is not a function", async () => {
    await expectRejection(
      runSingleAgentAttempt({
        ...BASE_INPUT,
        adapter: { call: "not-a-function" } as unknown as AgentAdapter
      })
    );
  });

  it("rejects a non-object adapter without exposing its value in the error message", async () => {
    const secret = "SECRET_TOKEN_NOT_AN_ADAPTER";

    const error = await expectRejection(
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: secret as unknown as AgentAdapter })
    );

    assert.ok(!error.message.includes(secret));
  });
});

describe("runSingleAgentAttempt sanitizes exceptions thrown by adapter.call", () => {
  it("converts a thrown Error carrying a secret into a sanitized ContractValidationError, with exactly one call", async () => {
    const secret = "SECRET_TOKEN_ABC123";
    const adapter = new ThrowingAdapter(new Error(secret));

    const error = await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
    assert.equal(adapter.callCount, 1);
  });

  it("converts a thrown non-Error value into a sanitized ContractValidationError, with exactly one call", async () => {
    const secret = "another-arbitrary-secret-value";
    const adapter = new ThrowingAdapter(secret);

    const error = await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.ok(!error.message.includes(secret));
    assert.equal(adapter.callCount, 1);
  });

  it("does not retry after adapter.call throws", async () => {
    const adapter = new ThrowingAdapter(new Error("boom"));

    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT }));

    assert.equal(adapter.callCount, 1);
  });
});

describe("runSingleAgentAttempt validates metadata fail-closed before calling the adapter", () => {
  it("rejects an invalid AgentRequest without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const invalidRequest = {
      schemaVersion: 1,
      agentId: "",
      cycleId: "cycle-1",
      snapshotId: "snapshot-1"
    } as unknown as AgentRequest;

    await expectRejection(
      runSingleAgentAttempt({
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

    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT, promptVersion: "   " }));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects an empty model without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT, model: "" }));

    assert.equal(adapter.callCount, 0);
  });

  it("rejects a non-string responseId without calling the adapter", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    await expectRejection(
      runSingleAgentAttempt({
        adapter,
        ...BASE_INPUT,
        responseId: 123 as unknown as string
      })
    );

    assert.equal(adapter.callCount, 0);
  });
});

describe("runSingleAgentAttempt keeps its original public validation messages byte for byte", () => {
  it("keeps the original adapter validation message and contract name", async () => {
    const error = await expectRejection(
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: {} as unknown as AgentAdapter })
    );

    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(
      error.message,
      "Invalid RunSingleAgentAttempt: adapter must be an object exposing a call(request) function"
    );
  });

  it("keeps the original message for a non-object adapter without exposing its value", async () => {
    const secret = "SECRET_TOKEN_NOT_AN_ADAPTER";

    const error = await expectRejection(
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: secret as unknown as AgentAdapter })
    );

    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(
      error.message,
      "Invalid RunSingleAgentAttempt: adapter must be an object exposing a call(request) function"
    );
    assert.ok(!error.message.includes(secret));
  });

  it("keeps the original responseId validation message and contract name", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const error = await expectRejection(
      runSingleAgentAttempt({ adapter, ...BASE_INPUT, responseId: 123 as unknown as string })
    );

    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(error.message, "Invalid RunSingleAgentAttempt: responseId must be a string");
    assert.equal(adapter.callCount, 0);
  });

  it("keeps the original promptVersion validation message and contract name", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const error = await expectRejection(
      runSingleAgentAttempt({ adapter, ...BASE_INPUT, promptVersion: "   " })
    );

    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(error.message, "Invalid RunSingleAgentAttempt: promptVersion must not be empty or blank");
    assert.equal(adapter.callCount, 0);
  });

  it("keeps the original model validation message and contract name", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);

    const error = await expectRejection(runSingleAgentAttempt({ adapter, ...BASE_INPUT, model: "" }));

    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(error.message, "Invalid RunSingleAgentAttempt: model must not be empty or blank");
    assert.equal(adapter.callCount, 0);
  });

  it("keeps the original AgentRequest validation contract name", async () => {
    const adapter = new CountingAdapter(VALID_RAW_RESPONSE);
    const invalidRequest = {
      schemaVersion: 1,
      agentId: "",
      cycleId: "cycle-1",
      snapshotId: "snapshot-1"
    } as unknown as AgentRequest;

    const error = await expectRejection(
      runSingleAgentAttempt({ adapter, ...BASE_INPUT, request: invalidRequest })
    );

    assert.notEqual(error.contract, "RunAuditableAgentAttempt");
    assert.equal(adapter.callCount, 0);
  });
});

describe("runSingleAgentAttempt sanitizes a forged adapter whose call getter/proxy throws", () => {
  it("fails closed without leaking a secret thrown by a getter for call, reading it exactly once and never calling it", async () => {
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
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: forgedAdapter as unknown as AgentAdapter })
    );

    assert.ok(!error.message.includes(secret));
    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(
      error.message,
      "Invalid RunSingleAgentAttempt: adapter must be an object exposing a call(request) function"
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
      runSingleAgentAttempt({ ...BASE_INPUT, adapter: forgedAdapter as unknown as AgentAdapter })
    );

    assert.ok(!error.message.includes(secret));
    assert.equal(error.contract, "RunSingleAgentAttempt");
    assert.equal(trapReads, 1);
  });
});
