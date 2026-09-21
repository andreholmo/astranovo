import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import {
  evaluateAgentResponseCapture,
  type AcceptedAgentResponseEvaluation,
  type AgentResponseEvaluation,
  type AgentResponseRejectionCode,
  type RejectedAgentResponseEvaluation
} from "../src/agent/evaluate-agent-response-capture.js";
import {
  finalizeBoundedAgentAttempts,
  type FinalizedBoundedAgentAttemptsResult
} from "../src/agent/finalize-bounded-agent-attempts.js";
import {
  type AcceptedBoundedAgentAttempts,
  type AttemptsExhaustedBoundedAgentAttempts,
  type BoundedAgentAttemptsResult
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

function accepted(responseId = "response-accepted"): AcceptedAgentResponseEvaluation {
  const evaluation = evaluateAgentResponseCapture({
    request: REQUEST,
    responseId,
    rawResponse: JSON.stringify(VALID_PROPOSAL),
    promptVersion: PROMPT_VERSION,
    model: MODEL
  });
  assert.equal(evaluation.status, "ACCEPTED");
  return evaluation as AcceptedAgentResponseEvaluation;
}

function rejected(
  responseId: string,
  code: AgentResponseRejectionCode = "INVALID_JSON"
): RejectedAgentResponseEvaluation {
  const rawResponse = ((): string => {
    switch (code) {
      case "INVALID_JSON":
        return "not json at all {{{";
      case "INVALID_PROPOSAL":
        return JSON.stringify({ action: "FLY_TO_THE_MOON" });
      case "AGENT_ID_MISMATCH":
        return JSON.stringify({ ...VALID_PROPOSAL, agentId: "momentum" });
      case "CYCLE_ID_MISMATCH":
        return JSON.stringify({ ...VALID_PROPOSAL, cycleId: "cycle-2" });
      case "PROMPT_VERSION_MISMATCH":
        return JSON.stringify({ ...VALID_PROPOSAL, promptVersion: "prompt-v2" });
      case "MODEL_MISMATCH":
        return JSON.stringify({ ...VALID_PROPOSAL, model: "other-model" });
    }
  })();
  const evaluation = evaluateAgentResponseCapture({
    request: REQUEST,
    responseId,
    rawResponse,
    promptVersion: PROMPT_VERSION,
    model: MODEL
  });
  assert.equal(evaluation.status, "REJECTED");
  return evaluation as RejectedAgentResponseEvaluation;
}

function acceptedResult(
  rejectedCount: number,
  acceptedId = "response-accepted"
): AcceptedBoundedAgentAttempts {
  const evaluations: AgentResponseEvaluation[] = [];
  for (let index = 0; index < rejectedCount; index += 1) {
    evaluations.push(rejected(`r${index}`));
  }
  const acceptedEvaluation = accepted(acceptedId);
  evaluations.push(acceptedEvaluation);
  return Object.freeze({
    status: "ACCEPTED",
    evaluations: Object.freeze(evaluations),
    result: acceptedEvaluation
  });
}

function exhaustedResult(rejectionCount: number): AttemptsExhaustedBoundedAgentAttempts {
  const evaluations: RejectedAgentResponseEvaluation[] = [];
  for (let index = 0; index < rejectionCount; index += 1) {
    evaluations.push(rejected(`r${index}`));
  }
  return Object.freeze({
    status: "ATTEMPTS_EXHAUSTED",
    evaluations: Object.freeze(evaluations),
    rejectionCodes: Object.freeze(evaluations.map((evaluation) => evaluation.code))
  });
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function expectRejection(fn: () => unknown): ContractValidationError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ContractValidationError);
    return error;
  }
  assert.fail("expected finalizeBoundedAgentAttempts to reject");
}

describe("finalizeBoundedAgentAttempts: ACCEPTED preserved", () => {
  it("preserves the accepted proposal, capture, history and order on the first attempt", () => {
    const input = acceptedResult(0);
    const finalized = finalizeBoundedAgentAttempts(input);

    assert.equal(finalized.status, "ACCEPTED");
    if (finalized.status !== "ACCEPTED") return;
    assert.equal(finalized.evaluations.length, 1);
    assert.deepEqual(jsonClone(finalized.result), jsonClone(input.result));
    assert.deepEqual(jsonClone(finalized.evaluations), jsonClone(input.evaluations));
  });

  it("preserves every evaluation in order after rejections, plus the acceptance", () => {
    const input = acceptedResult(2);
    const finalized = finalizeBoundedAgentAttempts(input);

    assert.equal(finalized.status, "ACCEPTED");
    if (finalized.status !== "ACCEPTED") return;
    assert.equal(finalized.evaluations.length, 3);
    assert.deepEqual(
      finalized.evaluations.map((evaluation) => evaluation.status),
      ["REJECTED", "REJECTED", "ACCEPTED"]
    );
    assert.deepEqual(
      finalized.evaluations.map((evaluation) => evaluation.capture.responseId),
      ["r0", "r1", "response-accepted"]
    );
    assert.equal(finalized.result.proposal.action, "HOLD");
  });

  it("does not create a second proposal or alter action, confidence, size or evidence", () => {
    const input = acceptedResult(0);
    const finalized = finalizeBoundedAgentAttempts(input);

    assert.equal(finalized.status, "ACCEPTED");
    if (finalized.status !== "ACCEPTED") return;
    assert.deepEqual(jsonClone(finalized.result.proposal), jsonClone(input.result.proposal));
  });
});

describe("finalizeBoundedAgentAttempts: ATTEMPTS_EXHAUSTED converted to HOLD", () => {
  for (const rejectionCount of [1, 2, 3]) {
    it(`converts ${rejectionCount} rejection(s) into HOLD with a closed reason and aligned codes`, () => {
      const input = exhaustedResult(rejectionCount);
      const finalized = finalizeBoundedAgentAttempts(input);

      assert.equal(finalized.status, "HOLD");
      if (finalized.status !== "HOLD") return;
      assert.equal(finalized.reason, "ATTEMPTS_EXHAUSTED");
      assert.equal(finalized.evaluations.length, rejectionCount);
      assert.ok(finalized.evaluations.every((evaluation) => evaluation.status === "REJECTED"));
      assert.deepEqual([...finalized.rejectionCodes], [...input.rejectionCodes]);
      assert.deepEqual(
        finalized.evaluations.map((evaluation) => evaluation.code),
        [...finalized.rejectionCodes]
      );
    });
  }

  it("never fabricates an AgentProposal, price, position, confidence or evidence in HOLD", () => {
    const finalized = finalizeBoundedAgentAttempts(exhaustedResult(2));
    assert.equal(finalized.status, "HOLD");
    if (finalized.status !== "HOLD") return;
    assert.equal("result" in finalized, false);
    for (const evaluation of finalized.evaluations) {
      assert.equal("proposal" in evaluation, false);
    }
  });
});

describe("finalizeBoundedAgentAttempts: frozen results, no mutation", () => {
  it("freezes an ACCEPTED outcome and its evaluations list", () => {
    const finalized = finalizeBoundedAgentAttempts(acceptedResult(1));
    assert.ok(Object.isFrozen(finalized));
    assert.ok(Object.isFrozen((finalized as { evaluations: unknown }).evaluations));
  });

  it("freezes a HOLD outcome, its evaluations list and its rejectionCodes list", () => {
    const finalized = finalizeBoundedAgentAttempts(exhaustedResult(2));
    assert.ok(Object.isFrozen(finalized));
    assert.ok(Object.isFrozen((finalized as { evaluations: unknown }).evaluations));
    assert.ok(Object.isFrozen((finalized as { rejectionCodes: unknown }).rejectionCodes));
  });

  it("does not mutate the input result for ACCEPTED", () => {
    const input = acceptedResult(1);
    const before = jsonClone(input);
    finalizeBoundedAgentAttempts(input);
    assert.deepEqual(jsonClone(input), before);
  });

  it("does not mutate the input result for ATTEMPTS_EXHAUSTED", () => {
    const input = exhaustedResult(2);
    const before = jsonClone(input);
    finalizeBoundedAgentAttempts(input);
    assert.deepEqual(jsonClone(input), before);
  });
});

describe("finalizeBoundedAgentAttempts: determinism", () => {
  it("produces a field-for-field identical ACCEPTED outcome for the same valid data", () => {
    const input = acceptedResult(1);
    const first = finalizeBoundedAgentAttempts(input);
    const second = finalizeBoundedAgentAttempts(input);
    assert.deepEqual(jsonClone(first), jsonClone(second));
  });

  it("produces a field-for-field identical HOLD outcome for the same valid data", () => {
    const input = exhaustedResult(3);
    const first = finalizeBoundedAgentAttempts(input);
    const second = finalizeBoundedAgentAttempts(input);
    assert.deepEqual(jsonClone(first), jsonClone(second));
  });
});

describe("finalizeBoundedAgentAttempts: rejects a tampered union", () => {
  it("rejects an invalid status", () => {
    const forged = { ...acceptedResult(0), status: "PENDING" } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects null and array input values", () => {
    expectRejection(() => finalizeBoundedAgentAttempts(null as never));
    expectRejection(() => finalizeBoundedAgentAttempts([] as never));
  });

  it("rejects a divergent accepted result (different capture than the last evaluation)", () => {
    const input = acceptedResult(0);
    const otherAccepted = accepted("some-other-response");
    const forged = { ...input, result: otherAccepted } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects a divergent accepted result (tampered proposal field)", () => {
    const input = acceptedResult(0);
    const forged = {
      ...input,
      result: { ...input.result, proposal: { ...input.result.proposal, positionPct: 0.5, action: "BUY" } }
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an ACCEPTED evaluation inside the ATTEMPTS_EXHAUSTED branch", () => {
    const input = exhaustedResult(1);
    const forged = {
      ...input,
      evaluations: [...input.evaluations, accepted("sneaked-in")]
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects a divergent rejection code (tampered top-level rejectionCodes)", () => {
    const input = exhaustedResult(2);
    const forged = {
      ...input,
      rejectionCodes: ["AGENT_ID_MISMATCH", "AGENT_ID_MISMATCH"]
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects a divergent rejection code (tampered evaluation entry code)", () => {
    const input = exhaustedResult(1);
    const [first] = input.evaluations;
    const forged = {
      ...input,
      evaluations: [{ ...first, code: "MODEL_MISMATCH" }]
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an empty evaluations list for ACCEPTED", () => {
    const forged = { status: "ACCEPTED", evaluations: [], result: accepted() } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an empty evaluations list for ATTEMPTS_EXHAUSTED", () => {
    const forged = {
      status: "ATTEMPTS_EXHAUSTED",
      evaluations: [],
      rejectionCodes: []
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an evaluations list above the limit of three, for ACCEPTED", () => {
    const input = acceptedResult(3);
    expectRejection(() => finalizeBoundedAgentAttempts(input));
  });

  it("rejects an evaluations list above the limit of three, for ATTEMPTS_EXHAUSTED", () => {
    const input = exhaustedResult(4);
    expectRejection(() => finalizeBoundedAgentAttempts(input));
  });

  it("rejects an ACCEPTED evaluation that is not the last one", () => {
    const input = exhaustedResult(1);
    const forged = {
      status: "ACCEPTED",
      evaluations: [accepted("first"), ...input.evaluations],
      result: accepted("first")
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an ACCEPTED union whose last evaluation is not actually accepted", () => {
    const input = exhaustedResult(2);
    const forged = {
      status: "ACCEPTED",
      evaluations: input.evaluations,
      result: accepted()
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });
});

describe("finalizeBoundedAgentAttempts: rejects incompatible and extra properties", () => {
  it("rejects an extra top-level property on an ACCEPTED union", () => {
    const input = acceptedResult(0);
    const forged = { ...input, injected: "unexpected" } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an extra top-level property on an ATTEMPTS_EXHAUSTED union, present as undefined", () => {
    const input = exhaustedResult(1);
    const forged = { ...input, injected: undefined } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects a missing top-level property on an ACCEPTED union", () => {
    const input = acceptedResult(0);
    const { result: _result, ...rest } = input;
    expectRejection(() => finalizeBoundedAgentAttempts(rest as unknown as BoundedAgentAttemptsResult));
  });

  it("rejects an extra property on an evaluation entry", () => {
    const input = exhaustedResult(1);
    const [first] = input.evaluations;
    const forged = {
      ...input,
      evaluations: [{ ...first, injected: "unexpected" }]
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an evaluation entry carrying an own `proposal` property set to undefined", () => {
    const input = exhaustedResult(1);
    const [first] = input.evaluations;
    const forged = {
      ...input,
      evaluations: [{ ...first, proposal: undefined }]
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects an accepted evaluation entry carrying an own `code` property set to undefined", () => {
    const input = acceptedResult(0);
    const forged = {
      ...input,
      evaluations: [{ ...input.evaluations[0], code: undefined }],
      result: { ...input.result, code: undefined }
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });

  it("rejects a proposal carrying an injected extra property", () => {
    const input = acceptedResult(0);
    const forged = {
      ...input,
      result: { ...input.result, proposal: { ...input.result.proposal, injected: "unexpected" } }
    } as unknown as BoundedAgentAttemptsResult;
    expectRejection(() => finalizeBoundedAgentAttempts(forged));
  });
});

describe("finalizeBoundedAgentAttempts: forged getters and Proxy objects fail closed", () => {
  it("fails closed without leaking a secret thrown by a getter for the top-level status", () => {
    const secret = "SECRET_FROM_STATUS_GETTER";
    const forged: Record<string, unknown> = { evaluations: [], result: accepted() };
    Object.defineProperty(forged, "status", {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error(secret);
      }
    });

    const error = expectRejection(() => finalizeBoundedAgentAttempts(forged as unknown as BoundedAgentAttemptsResult));
    assert.ok(!error.message.includes(secret));
  });

  it("fails closed without leaking a secret thrown by a getter for evaluations", () => {
    const secret = "SECRET_FROM_EVALUATIONS_GETTER";
    const forged: Record<string, unknown> = { status: "ACCEPTED", result: accepted() };
    Object.defineProperty(forged, "evaluations", {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error(secret);
      }
    });

    const error = expectRejection(() => finalizeBoundedAgentAttempts(forged as unknown as BoundedAgentAttemptsResult));
    assert.ok(!error.message.includes(secret));
  });

  it("fails closed without leaking a secret thrown by a Proxy over a real evaluations array", () => {
    const secret = "SECRET_FROM_EVALUATIONS_ARRAY_PROXY";
    const input = acceptedResult(1);
    const forgedEvaluations = new Proxy([...input.evaluations], {
      get(): never {
        throw new Error(secret);
      }
    });
    const forged = { ...input, evaluations: forgedEvaluations } as unknown as BoundedAgentAttemptsResult;

    const error = expectRejection(() => finalizeBoundedAgentAttempts(forged));
    assert.ok(!error.message.includes(secret));
  });

  it("fails closed without leaking a secret thrown by a getter on an evaluation entry's capture", () => {
    const secret = "SECRET_FROM_CAPTURE_GETTER";
    const input = exhaustedResult(1);
    const [first] = input.evaluations;
    assert.ok(first);
    const forgedEntry: Record<string, unknown> = { status: first.status, code: first.code };
    Object.defineProperty(forgedEntry, "capture", {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error(secret);
      }
    });
    const forged = { ...input, evaluations: [forgedEntry] } as unknown as BoundedAgentAttemptsResult;

    const error = expectRejection(() => finalizeBoundedAgentAttempts(forged));
    assert.ok(!error.message.includes(secret));
  });

  it("fails closed without leaking a secret thrown by a getter deep inside a capture's own fields", () => {
    const secret = "SECRET_FROM_RESPONSE_ID_GETTER";
    const input = exhaustedResult(1);
    const [first] = input.evaluations;
    assert.ok(first);
    const forgedCapture: Record<string, unknown> = { ...first.capture };
    Object.defineProperty(forgedCapture, "responseId", {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error(secret);
      }
    });
    const forged = {
      ...input,
      evaluations: [{ ...first, capture: forgedCapture }]
    } as unknown as BoundedAgentAttemptsResult;

    const error = expectRejection(() => finalizeBoundedAgentAttempts(forged));
    assert.ok(!error.message.includes(secret));
  });

  it("fails closed without leaking a secret thrown by a getter on the top-level result", () => {
    const secret = "SECRET_FROM_RESULT_GETTER";
    const input = acceptedResult(0);
    const forged: Record<string, unknown> = { status: "ACCEPTED", evaluations: input.evaluations };
    Object.defineProperty(forged, "result", {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error(secret);
      }
    });

    const error = expectRejection(() => finalizeBoundedAgentAttempts(forged as unknown as BoundedAgentAttemptsResult));
    assert.ok(!error.message.includes(secret));
  });
});

describe("finalizeBoundedAgentAttempts: offline, no adapter, retry, timer, randomness, network or I/O", () => {
  it("computes the outcome purely from its argument, offline and synchronously", () => {
    const originalDateNow = Date.now;
    const originalMathRandom = Math.random;
    const originalSetTimeout = globalThis.setTimeout;
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;

    Date.now = () => {
      throw new Error("Date.now must not be called");
    };
    Math.random = () => {
      throw new Error("Math.random must not be called");
    };
    globalThis.setTimeout = (() => {
      throw new Error("setTimeout must not be called");
    }) as unknown as typeof globalThis.setTimeout;
    (globalThis as { fetch?: unknown }).fetch = () => {
      throw new Error("fetch must not be called");
    };

    try {
      const result: FinalizedBoundedAgentAttemptsResult = finalizeBoundedAgentAttempts(acceptedResult(1));
      assert.equal(result.status, "ACCEPTED");
      assert.ok(!(result instanceof Promise));
    } finally {
      Date.now = originalDateNow;
      Math.random = originalMathRandom;
      globalThis.setTimeout = originalSetTimeout;
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it("never touches an AgentAdapter-shaped object: it has no adapter parameter", () => {
    const input = exhaustedResult(2);
    const before = jsonClone(input);
    finalizeBoundedAgentAttempts(input);
    assert.deepEqual(jsonClone(input), before);
  });
});
