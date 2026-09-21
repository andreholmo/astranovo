import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import {
  decideAgentAttemptProgress,
  type AgentAttemptProgress
} from "../src/agent/decide-agent-attempt-progress.js";
import {
  evaluateAgentResponseCapture,
  type AcceptedAgentResponseEvaluation,
  type AgentResponseEvaluation,
  type AgentResponseRejectionCode,
  type RejectedAgentResponseEvaluation
} from "../src/agent/evaluate-agent-response-capture.js";
import {
  MAX_AGENT_RETRY_ATTEMPTS,
  MIN_AGENT_RETRY_ATTEMPTS,
  parseAgentRetryPolicy,
  type AgentRetryPolicy
} from "../src/agent/retry-policy.js";

const REQUEST: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "trend-following",
  cycleId: "cycle-1",
  snapshotId: "snapshot-1"
});

const OTHER_REQUEST: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "momentum",
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

function policy(maxAttempts: number): AgentRetryPolicy {
  return parseAgentRetryPolicy({ maxAttempts });
}

describe("decideAgentAttemptProgress: empty history", () => {
  it("returns ATTEMPT_AVAILABLE with completedAttempts 0, for every policy value", () => {
    for (let maxAttempts = MIN_AGENT_RETRY_ATTEMPTS; maxAttempts <= MAX_AGENT_RETRY_ATTEMPTS; maxAttempts++) {
      const progress = decideAgentAttemptProgress(policy(maxAttempts), []);
      assert.equal(progress.status, "ATTEMPT_AVAILABLE");
      if (progress.status !== "ATTEMPT_AVAILABLE") continue;
      assert.equal(progress.completedAttempts, 0);
      assert.equal(progress.maxAttempts, maxAttempts);
      assert.equal("lastRejectionCode" in progress, false);
    }
  });
});

describe("decideAgentAttemptProgress: rejections below the limit", () => {
  it("returns ATTEMPT_AVAILABLE with the correct count and the last rejection code", () => {
    const progress = decideAgentAttemptProgress(policy(3), [
      rejected("r1", "INVALID_JSON"),
      rejected("r2", "INVALID_PROPOSAL")
    ]);

    assert.equal(progress.status, "ATTEMPT_AVAILABLE");
    if (progress.status !== "ATTEMPT_AVAILABLE") return;
    assert.equal(progress.completedAttempts, 2);
    assert.equal(progress.maxAttempts, 3);
    assert.equal(progress.lastRejectionCode, "INVALID_PROPOSAL");
  });

  it("reports only the most recent code, not the first, across mismatched codes", () => {
    const progress = decideAgentAttemptProgress(policy(3), [
      rejected("r1", "AGENT_ID_MISMATCH"),
      rejected("r2", "CYCLE_ID_MISMATCH")
    ]);

    assert.equal(progress.status, "ATTEMPT_AVAILABLE");
    if (progress.status !== "ATTEMPT_AVAILABLE") return;
    assert.equal(progress.lastRejectionCode, "CYCLE_ID_MISMATCH");
  });
});

describe("decideAgentAttemptProgress: rejections at the limit", () => {
  it("returns ATTEMPTS_EXHAUSTED with every code, for every policy value", () => {
    for (let maxAttempts = MIN_AGENT_RETRY_ATTEMPTS; maxAttempts <= MAX_AGENT_RETRY_ATTEMPTS; maxAttempts++) {
      const codes: AgentResponseRejectionCode[] = [];
      const results: RejectedAgentResponseEvaluation[] = [];
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code: AgentResponseRejectionCode = attempt % 2 === 0 ? "INVALID_JSON" : "INVALID_PROPOSAL";
        codes.push(code);
        results.push(rejected(`r${attempt}`, code));
      }

      const progress = decideAgentAttemptProgress(policy(maxAttempts), results);
      assert.equal(progress.status, "ATTEMPTS_EXHAUSTED", `maxAttempts=${maxAttempts}`);
      if (progress.status !== "ATTEMPTS_EXHAUSTED") continue;
      assert.equal(progress.completedAttempts, maxAttempts);
      assert.equal(progress.maxAttempts, maxAttempts);
      assert.deepEqual([...progress.rejectionCodes], codes);
    }
  });
});

describe("decideAgentAttemptProgress: rejections above the limit fail closed", () => {
  it("throws ContractValidationError when results exceed policy.maxAttempts", () => {
    const results = [rejected("r1"), rejected("r2"), rejected("r3")];
    assert.throws(() => decideAgentAttemptProgress(policy(2), results), ContractValidationError);
  });
});

describe("decideAgentAttemptProgress: acceptance", () => {
  it("returns ACCEPTED on the first attempt", () => {
    const acceptedResult = accepted();
    const progress = decideAgentAttemptProgress(policy(3), [acceptedResult]);

    assert.equal(progress.status, "ACCEPTED");
    if (progress.status !== "ACCEPTED") return;
    assert.equal(progress.completedAttempts, 1);
    assert.equal(progress.result.proposal.action, "HOLD");
    assert.equal(progress.result.capture.rawResponse, acceptedResult.capture.rawResponse);
  });

  it("returns ACCEPTED after rejections, counting every attempt", () => {
    const progress = decideAgentAttemptProgress(policy(3), [
      rejected("r1"),
      rejected("r2"),
      accepted("r3")
    ]);

    assert.equal(progress.status, "ACCEPTED");
    if (progress.status !== "ACCEPTED") return;
    assert.equal(progress.completedAttempts, 3);
  });

  it("accepts on the very last allowed attempt, not ATTEMPTS_EXHAUSTED", () => {
    const progress = decideAgentAttemptProgress(policy(2), [rejected("r1"), accepted("r2")]);
    assert.equal(progress.status, "ACCEPTED");
  });
});

describe("decideAgentAttemptProgress: an attempt after ACCEPTED fails closed", () => {
  it("throws when a rejection follows an accepted result", () => {
    const results = [accepted("r1"), rejected("r2")];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("throws when an acceptance follows an accepted result", () => {
    const results = [accepted("r1"), accepted("r2")];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("throws when the accepted result is sandwiched between rejections", () => {
    const results = [rejected("r1"), accepted("r2"), rejected("r3")];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });
});

describe("decideAgentAttemptProgress: invalid policy fails closed", () => {
  it("rejects a forged policy above the upper bound", () => {
    const forged = { maxAttempts: 100 } as AgentRetryPolicy;
    assert.throws(() => decideAgentAttemptProgress(forged, []), ContractValidationError);
  });

  it("rejects a forged policy with zero maxAttempts", () => {
    const forged = { maxAttempts: 0 } as AgentRetryPolicy;
    assert.throws(() => decideAgentAttemptProgress(forged, []), ContractValidationError);
  });

  it("rejects a forged policy with a fractional maxAttempts", () => {
    const forged = { maxAttempts: 1.5 } as AgentRetryPolicy;
    assert.throws(() => decideAgentAttemptProgress(forged, []), ContractValidationError);
  });

  it("rejects a non-object policy", () => {
    assert.throws(
      () => decideAgentAttemptProgress(null as unknown as AgentRetryPolicy, []),
      ContractValidationError
    );
    assert.throws(
      () => decideAgentAttemptProgress("policy" as unknown as AgentRetryPolicy, []),
      ContractValidationError
    );
  });
});

describe("decideAgentAttemptProgress: forged or structurally invalid results fail closed", () => {
  it("rejects a non-array results value", () => {
    assert.throws(
      () => decideAgentAttemptProgress(policy(3), "not an array" as unknown as AgentResponseEvaluation[]),
      ContractValidationError
    );
    assert.throws(
      () => decideAgentAttemptProgress(policy(3), null as unknown as AgentResponseEvaluation[]),
      ContractValidationError
    );
  });

  it("rejects an entry that is not an object", () => {
    const results = ["not an evaluation"] as unknown as AgentResponseEvaluation[];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("rejects an entry missing capture entirely", () => {
    const results = [{ status: "ACCEPTED" }] as unknown as AgentResponseEvaluation[];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("rejects an entry whose nested capture is missing rawResponse", () => {
    const real = accepted();
    const { rawResponse: _rawResponse, ...restCapture } = real.capture;
    const forged = { status: "ACCEPTED", capture: restCapture, proposal: real.proposal };
    assert.throws(
      () => decideAgentAttemptProgress(policy(3), [forged as unknown as AgentResponseEvaluation]),
      ContractValidationError
    );
  });

  it("fails closed on an entry declared ACCEPTED whose own capture actually rejects, instead of silently downgrading it", () => {
    const real = rejected("r1", "INVALID_JSON");
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: { ...VALID_PROPOSAL }
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on an entry declared REJECTED whose own capture actually accepts, instead of silently upgrading it", () => {
    const real = accepted("r1");
    const forged = {
      status: "REJECTED",
      capture: real.capture,
      code: "INVALID_JSON"
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on a REJECTED entry with a tampered rejection code", () => {
    const real = rejected("r1", "INVALID_JSON");
    const forged = {
      status: "REJECTED",
      capture: real.capture,
      code: "INVALID_PROPOSAL"
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on a REJECTED entry carrying an incompatible proposal payload", () => {
    const real = rejected("r1", "INVALID_JSON");
    const forged = {
      status: "REJECTED",
      capture: real.capture,
      code: real.code,
      proposal: { ...VALID_PROPOSAL }
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on an ACCEPTED entry with a tampered proposal field", () => {
    const real = accepted("r1");
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: { ...real.proposal, positionPct: 0.99, action: "BUY", reason: "tampered" }
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on an ACCEPTED entry carrying an incompatible rejection code payload", () => {
    const real = accepted("r1");
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: real.proposal,
      code: "INVALID_JSON"
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on a REJECTED entry carrying an own `proposal` property set to undefined", () => {
    const real = rejected("r1", "INVALID_JSON");
    const forged = {
      status: "REJECTED",
      capture: real.capture,
      code: real.code,
      proposal: undefined
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on an ACCEPTED entry carrying an own `code` property set to undefined", () => {
    const real = accepted("r1");
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: real.proposal,
      code: undefined
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on a REJECTED entry carrying an injected extra property", () => {
    const real = rejected("r1", "INVALID_JSON");
    const forged = {
      status: "REJECTED",
      capture: real.capture,
      code: real.code,
      injected: "unexpected"
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on an ACCEPTED entry carrying an injected extra property", () => {
    const real = accepted("r1");
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: real.proposal,
      injected: "unexpected"
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("fails closed on an ACCEPTED entry whose proposal carries an injected extra property", () => {
    const real = accepted("r1");
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: { ...real.proposal, injected: "unexpected" }
    } as unknown as AgentResponseEvaluation;

    assert.throws(() => decideAgentAttemptProgress(policy(1), [forged]), ContractValidationError);
  });

  it("does not leak the tampered proposal's content in the thrown error", () => {
    const real = accepted("r1");
    const secret = "TAMPERED_PROPOSAL_SECRET";
    const forged = {
      status: "ACCEPTED",
      capture: real.capture,
      proposal: { ...real.proposal, reason: secret }
    } as unknown as AgentResponseEvaluation;

    try {
      decideAgentAttemptProgress(policy(1), [forged]);
      assert.fail("expected decideAgentAttemptProgress to throw");
    } catch (error) {
      assert.ok(error instanceof ContractValidationError);
      assert.ok(!error.message.includes(secret));
    }
  });
});

describe("decideAgentAttemptProgress: divergent provenance fails closed", () => {
  it("rejects captures with different agentId", () => {
    const other = evaluateAgentResponseCapture({
      request: OTHER_REQUEST,
      responseId: "r2",
      rawResponse: "not json {{{",
      promptVersion: PROMPT_VERSION,
      model: MODEL
    });
    const results = [rejected("r1"), other];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("rejects captures with different cycleId", () => {
    const otherCycleRequest = parseAgentRequest({
      schemaVersion: 1,
      agentId: "trend-following",
      cycleId: "cycle-2",
      snapshotId: "snapshot-1"
    });
    const other = evaluateAgentResponseCapture({
      request: otherCycleRequest,
      responseId: "r2",
      rawResponse: "not json {{{",
      promptVersion: PROMPT_VERSION,
      model: MODEL
    });
    const results = [rejected("r1"), other];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("rejects captures with different promptVersion", () => {
    const other = evaluateAgentResponseCapture({
      request: REQUEST,
      responseId: "r2",
      rawResponse: "not json {{{",
      promptVersion: "prompt-v2",
      model: MODEL
    });
    const results = [rejected("r1"), other];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });

  it("rejects captures with different model", () => {
    const other = evaluateAgentResponseCapture({
      request: REQUEST,
      responseId: "r2",
      rawResponse: "not json {{{",
      promptVersion: PROMPT_VERSION,
      model: "other-model"
    });
    const results = [rejected("r1"), other];
    assert.throws(() => decideAgentAttemptProgress(policy(3), results), ContractValidationError);
  });
});

describe("decideAgentAttemptProgress never exposes raw response, secrets or arbitrary content", () => {
  it("does not leak a secret embedded in a rejected raw response, in ATTEMPT_AVAILABLE", () => {
    const secret = "SECRET_TOKEN_ABC123";
    const evaluation = evaluateAgentResponseCapture({
      request: REQUEST,
      responseId: "r1",
      rawResponse: `not json ${secret} {{{`,
      promptVersion: PROMPT_VERSION,
      model: MODEL
    });
    assert.equal(evaluation.status, "REJECTED");

    const progress = decideAgentAttemptProgress(policy(3), [evaluation]);
    assert.ok(!JSON.stringify(progress).includes(secret));
  });

  it("does not leak a secret embedded in a rejected raw response, in ATTEMPTS_EXHAUSTED", () => {
    const secret = "SECRET_TOKEN_XYZ789";
    const evaluation = evaluateAgentResponseCapture({
      request: REQUEST,
      responseId: "r1",
      rawResponse: `not json ${secret} {{{`,
      promptVersion: PROMPT_VERSION,
      model: MODEL
    });
    assert.equal(evaluation.status, "REJECTED");

    const progress = decideAgentAttemptProgress(policy(1), [evaluation]);
    assert.ok(!JSON.stringify(progress).includes(secret));
  });

  it("does not leak a secret in the thrown error for a provenance mismatch", () => {
    const secret = "unexpected-agent-secret";
    const secretRequest = parseAgentRequest({
      schemaVersion: 1,
      agentId: "trend-following",
      cycleId: "cycle-1",
      snapshotId: "snapshot-1"
    });
    const other = evaluateAgentResponseCapture({
      request: secretRequest,
      responseId: "r2",
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, reason: secret }),
      promptVersion: PROMPT_VERSION,
      model: MODEL
    });
    try {
      decideAgentAttemptProgress(policy(3), [rejected("r1"), other, rejected("r3")]);
      assert.fail("expected decideAgentAttemptProgress to throw");
    } catch (error) {
      assert.ok(error instanceof ContractValidationError);
      assert.ok(!error.message.includes(secret));
    }
  });

  it("allows the accepted capture and proposal to be preserved only in ACCEPTED", () => {
    const progress = decideAgentAttemptProgress(policy(1), [accepted()]);
    assert.equal(progress.status, "ACCEPTED");
    if (progress.status !== "ACCEPTED") return;
    assert.equal(typeof progress.result.capture.rawResponse, "string");
  });
});

describe("decideAgentAttemptProgress: immutability and non-mutation", () => {
  it("freezes an ATTEMPT_AVAILABLE progress", () => {
    const progress = decideAgentAttemptProgress(policy(3), [rejected("r1")]);
    assert.ok(Object.isFrozen(progress));
    assert.throws(() => {
      (progress as { completedAttempts: number }).completedAttempts = 99;
    }, TypeError);
  });

  it("freezes an ATTEMPTS_EXHAUSTED progress and its rejectionCodes array", () => {
    const progress = decideAgentAttemptProgress(policy(1), [rejected("r1")]);
    assert.equal(progress.status, "ATTEMPTS_EXHAUSTED");
    if (progress.status !== "ATTEMPTS_EXHAUSTED") return;
    assert.ok(Object.isFrozen(progress));
    assert.ok(Object.isFrozen(progress.rejectionCodes));
  });

  it("freezes an ACCEPTED progress", () => {
    const progress = decideAgentAttemptProgress(policy(1), [accepted()]);
    assert.ok(Object.isFrozen(progress));
  });

  it("does not mutate the policy passed in", () => {
    const usedPolicy = policy(2);
    const before = JSON.stringify(usedPolicy);
    decideAgentAttemptProgress(usedPolicy, [rejected("r1")]);
    assert.equal(JSON.stringify(usedPolicy), before);
  });

  it("does not mutate the results array or its entries", () => {
    const results = [rejected("r1"), rejected("r2")];
    const before = JSON.stringify(results);
    decideAgentAttemptProgress(policy(3), results);
    assert.equal(JSON.stringify(results), before);
  });
});

describe("decideAgentAttemptProgress: determinism", () => {
  it("produces field-for-field identical ATTEMPT_AVAILABLE progress for the same canonical input", () => {
    const results = [rejected("r1"), rejected("r2")];
    const first = decideAgentAttemptProgress(policy(3), results) as AgentAttemptProgress;
    const second = decideAgentAttemptProgress(policy(3), results) as AgentAttemptProgress;
    assert.deepEqual(first, second);
  });

  it("produces field-for-field identical ACCEPTED progress for the same canonical input", () => {
    const results = [rejected("r1"), accepted("r2")];
    const first = decideAgentAttemptProgress(policy(3), results);
    const second = decideAgentAttemptProgress(policy(3), results);
    assert.equal(first.status, "ACCEPTED");
    assert.equal(second.status, "ACCEPTED");
    if (first.status !== "ACCEPTED" || second.status !== "ACCEPTED") return;
    assert.deepEqual(
      { ...first, result: { ...first.result, capture: { ...first.result.capture, request: { ...first.result.capture.request } } } },
      { ...second, result: { ...second.result, capture: { ...second.result.capture, request: { ...second.result.capture.request } } } }
    );
  });
});

describe("decideAgentAttemptProgress offline: no clock, timer, randomness, network or I/O", () => {
  it("computes a decision purely from its arguments, offline and synchronously", () => {
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
      const result = decideAgentAttemptProgress(policy(3), [rejected("r1"), accepted("r2")]);
      assert.equal(result.status, "ACCEPTED");
      assert.ok(!(result instanceof Promise));
    } finally {
      Date.now = originalDateNow;
      Math.random = originalMathRandom;
      globalThis.setTimeout = originalSetTimeout;
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it("never invokes an AgentAdapter: it has no adapter parameter and never touches one", () => {
    const results = [rejected("r1")];
    const before = JSON.stringify(results);
    const progress = decideAgentAttemptProgress(policy(2), results);
    assert.equal(progress.status, "ATTEMPT_AVAILABLE");
    assert.equal(JSON.stringify(results), before);
  });
});
