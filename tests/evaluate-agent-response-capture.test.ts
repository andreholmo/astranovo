import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentRequest } from "../src/agent/agent-adapter.js";
import { ContractValidationError } from "../src/domain/errors.js";
import {
  AGENT_RESPONSE_REJECTION_CODES,
  evaluateAgentResponseCapture,
  type AgentResponseRejectionCode
} from "../src/agent/evaluate-agent-response-capture.js";

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

const VALID_CAPTURE_INPUT = {
  request: REQUEST,
  responseId: "response-1",
  rawResponse: VALID_RAW_RESPONSE,
  promptVersion: "prompt-v1",
  model: "stub-model"
};

describe("evaluateAgentResponseCapture ACCEPTED", () => {
  it("accepts a raw response that decodes to an aligned proposal", () => {
    const evaluation = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);

    assert.equal(evaluation.status, "ACCEPTED");
    if (evaluation.status !== "ACCEPTED") return;
    assert.equal(evaluation.proposal.action, "HOLD");
    assert.equal(evaluation.proposal.agentId, "trend-following");
    assert.equal(evaluation.capture.rawResponse, VALID_RAW_RESPONSE);
  });
});

describe("evaluateAgentResponseCapture REJECTED codes", () => {
  it("rejects malformed JSON with INVALID_JSON", () => {
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: "not json at all {{{"
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.equal(evaluation.code, "INVALID_JSON");
  });

  it("rejects valid JSON that fails AgentProposal validation with INVALID_PROPOSAL", () => {
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: JSON.stringify({ action: "FLY_TO_THE_MOON" })
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.equal(evaluation.code, "INVALID_PROPOSAL");
  });

  it("rejects a proposal with a different agentId with AGENT_ID_MISMATCH", () => {
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, agentId: "momentum" })
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.equal(evaluation.code, "AGENT_ID_MISMATCH");
  });

  it("rejects a proposal with a different cycleId with CYCLE_ID_MISMATCH", () => {
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, cycleId: "cycle-2" })
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.equal(evaluation.code, "CYCLE_ID_MISMATCH");
  });

  it("rejects a proposal with a different promptVersion with PROMPT_VERSION_MISMATCH", () => {
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, promptVersion: "prompt-v2" })
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.equal(evaluation.code, "PROMPT_VERSION_MISMATCH");
  });

  it("rejects a proposal with a different model with MODEL_MISMATCH", () => {
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, model: "other-model" })
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.equal(evaluation.code, "MODEL_MISMATCH");
  });

  it("only ever produces one of the six closed codes", () => {
    const scenarios: readonly [unknown, AgentResponseRejectionCode][] = [
      [{ ...VALID_CAPTURE_INPUT, rawResponse: "{{{" }, "INVALID_JSON"],
      [
        { ...VALID_CAPTURE_INPUT, rawResponse: JSON.stringify({ action: "NOPE" }) },
        "INVALID_PROPOSAL"
      ],
      [
        { ...VALID_CAPTURE_INPUT, rawResponse: JSON.stringify({ ...VALID_PROPOSAL, agentId: "momentum" }) },
        "AGENT_ID_MISMATCH"
      ],
      [
        { ...VALID_CAPTURE_INPUT, rawResponse: JSON.stringify({ ...VALID_PROPOSAL, cycleId: "cycle-2" }) },
        "CYCLE_ID_MISMATCH"
      ],
      [
        {
          ...VALID_CAPTURE_INPUT,
          rawResponse: JSON.stringify({ ...VALID_PROPOSAL, promptVersion: "prompt-v2" })
        },
        "PROMPT_VERSION_MISMATCH"
      ],
      [
        { ...VALID_CAPTURE_INPUT, rawResponse: JSON.stringify({ ...VALID_PROPOSAL, model: "other-model" }) },
        "MODEL_MISMATCH"
      ]
    ];

    for (const [input, expectedCode] of scenarios) {
      const evaluation = evaluateAgentResponseCapture(input);
      assert.equal(evaluation.status, "REJECTED");
      if (evaluation.status !== "REJECTED") continue;
      assert.equal(evaluation.code, expectedCode);
      assert.ok(AGENT_RESPONSE_REJECTION_CODES.includes(evaluation.code));
    }
  });
});

describe("evaluateAgentResponseCapture preserves the capture byte for byte", () => {
  it("keeps rawResponse identical on ACCEPTED", () => {
    const raw = `${JSON.stringify(VALID_PROPOSAL, null, 2)}\n`;
    const evaluation = evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, rawResponse: raw });

    assert.equal(evaluation.capture.rawResponse, raw);
  });

  it("keeps rawResponse identical on REJECTED, including malformed JSON", () => {
    const raw = "not json at all {{{ \n\t weird\u0007content";
    const evaluation = evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, rawResponse: raw });

    assert.equal(evaluation.status, "REJECTED");
    assert.equal(evaluation.capture.rawResponse, raw);
  });

  it("preserves unicode content exactly on ACCEPTED", () => {
    const raw = JSON.stringify({ ...VALID_PROPOSAL, reason: "café 🚀 – no edge" });
    const evaluation = evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, rawResponse: raw });

    assert.equal(evaluation.capture.rawResponse, raw);
    assert.equal(evaluation.status, "ACCEPTED");
    if (evaluation.status !== "ACCEPTED") return;
    assert.equal(evaluation.proposal.reason, "café 🚀 – no edge");
  });
});

describe("evaluateAgentResponseCapture never exposes raw or agent-supplied content", () => {
  it("does not include the malformed raw text anywhere in a REJECTED evaluation's code", () => {
    const secret = "SECRET_TOKEN_ABC123";
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: `not json ${secret} {{{`
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.ok(!evaluation.code.includes(secret));
    assert.ok(AGENT_RESPONSE_REJECTION_CODES.includes(evaluation.code));
  });

  it("does not include an arbitrary field's value anywhere in a REJECTED evaluation's code", () => {
    const secret = "unexpected-agent";
    const evaluation = evaluateAgentResponseCapture({
      ...VALID_CAPTURE_INPUT,
      rawResponse: JSON.stringify({ ...VALID_PROPOSAL, agentId: secret })
    });

    assert.equal(evaluation.status, "REJECTED");
    if (evaluation.status !== "REJECTED") return;
    assert.ok(!evaluation.code.includes(secret));
  });

  it("a forged capture's rejection error names only contract/field/requirement, never the value", () => {
    const secret = "SECRET_TOKEN_NOT_A_CAPTURE";
    try {
      evaluateAgentResponseCapture(secret);
      assert.fail("expected evaluateAgentResponseCapture to throw");
    } catch (error) {
      assert.ok(error instanceof ContractValidationError);
      assert.ok(!error.message.includes(secret));
    }
  });
});

describe("evaluateAgentResponseCapture fails closed on a forged or structurally invalid capture", () => {
  it("throws ContractValidationError for a non-object value, before evaluating content", () => {
    assert.throws(() => evaluateAgentResponseCapture("not an object"), ContractValidationError);
    assert.throws(() => evaluateAgentResponseCapture(null), ContractValidationError);
    assert.throws(() => evaluateAgentResponseCapture(undefined), ContractValidationError);
    assert.throws(() => evaluateAgentResponseCapture([VALID_CAPTURE_INPUT]), ContractValidationError);
  });

  it("throws for a capture missing rawResponse, before any JSON parsing happens", () => {
    const { rawResponse: _rawResponse, ...rest } = VALID_CAPTURE_INPUT;
    assert.throws(() => evaluateAgentResponseCapture(rest), ContractValidationError);
  });

  it("throws for a capture with an invalid nested request, before evaluating content", () => {
    assert.throws(
      () =>
        evaluateAgentResponseCapture({
          ...VALID_CAPTURE_INPUT,
          request: { schemaVersion: 1, agentId: "", cycleId: "cycle-1", snapshotId: "snapshot-1" }
        }),
      ContractValidationError
    );
  });

  it("throws for a blank promptVersion, before evaluating content", () => {
    assert.throws(
      () => evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, promptVersion: "   " }),
      ContractValidationError
    );
  });

  it("throws for a non-string responseId, before evaluating content", () => {
    assert.throws(
      () => evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, responseId: 123 }),
      ContractValidationError
    );
  });
});

describe("evaluateAgentResponseCapture immutability and non-mutation", () => {
  it("freezes an ACCEPTED evaluation, its capture and its proposal", () => {
    const evaluation = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);

    assert.ok(Object.isFrozen(evaluation));
    assert.ok(Object.isFrozen(evaluation.capture));
    if (evaluation.status === "ACCEPTED") {
      assert.ok(Object.isFrozen(evaluation.proposal));
    }
    assert.throws(() => {
      (evaluation as { capture: unknown }).capture = null;
    }, TypeError);
  });

  it("freezes a REJECTED evaluation and its capture", () => {
    const evaluation = evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, rawResponse: "{{{" });

    assert.ok(Object.isFrozen(evaluation));
    assert.ok(Object.isFrozen(evaluation.capture));
    assert.throws(() => {
      (evaluation as { code: unknown }).code = "MODEL_MISMATCH";
    }, TypeError);
  });

  it("does not mutate the input object passed to it", () => {
    const input = { ...VALID_CAPTURE_INPUT };
    const before = JSON.stringify(input);

    evaluateAgentResponseCapture(input);

    assert.equal(JSON.stringify(input), before);
  });

  it("does not mutate the AgentRequest instance passed as request", () => {
    const before = { ...REQUEST };

    evaluateAgentResponseCapture({ ...VALID_CAPTURE_INPUT, request: REQUEST });

    assert.deepEqual({ ...REQUEST }, before);
  });
});

describe("evaluateAgentResponseCapture determinism", () => {
  it("produces field-for-field identical ACCEPTED evaluations for the same canonical input", () => {
    const first = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);
    const second = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);

    assert.equal(first.status, "ACCEPTED");
    assert.equal(second.status, "ACCEPTED");
    if (first.status !== "ACCEPTED" || second.status !== "ACCEPTED") return;
    assert.deepEqual(
      { capture: { ...first.capture, request: { ...first.capture.request } }, proposal: { ...first.proposal } },
      { capture: { ...second.capture, request: { ...second.capture.request } }, proposal: { ...second.proposal } }
    );
  });

  it("produces field-for-field identical REJECTED evaluations for the same canonical input", () => {
    const rejectedInput = { ...VALID_CAPTURE_INPUT, rawResponse: "{{{" };
    const first = evaluateAgentResponseCapture(rejectedInput);
    const second = evaluateAgentResponseCapture(rejectedInput);

    assert.equal(first.status, "REJECTED");
    assert.equal(second.status, "REJECTED");
    if (first.status !== "REJECTED" || second.status !== "REJECTED") return;
    assert.equal(first.code, second.code);
    assert.deepEqual(
      { ...first.capture, request: { ...first.capture.request } },
      { ...second.capture, request: { ...second.capture.request } }
    );
  });
});

describe("evaluateAgentResponseCapture offline: no clock, timer, randomness, network or I/O", () => {
  it("never reads the clock: identical input produces an identical evaluation regardless of call time", async () => {
    const first = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);

    assert.equal(first.status, "ACCEPTED");
    assert.equal(second.status, "ACCEPTED");
    if (first.status !== "ACCEPTED" || second.status !== "ACCEPTED") return;
    assert.deepEqual(
      { capture: { ...first.capture, request: { ...first.capture.request } }, proposal: { ...first.proposal } },
      { capture: { ...second.capture, request: { ...second.capture.request } }, proposal: { ...second.proposal } }
    );
  });

  it("is a plain synchronous function: no Promise is returned", () => {
    const result = evaluateAgentResponseCapture(VALID_CAPTURE_INPUT);
    assert.ok(!(result instanceof Promise));
  });
});
