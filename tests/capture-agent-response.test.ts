import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentRequest, type AgentRequest } from "../src/agent/agent-adapter.js";
import {
  captureAgentResponse,
  ContractValidationError,
  MAX_MODEL_LENGTH,
  MAX_PROMPT_VERSION_LENGTH,
  MAX_RAW_RESPONSE_LENGTH,
  MAX_RESPONSE_ID_LENGTH
} from "../src/agent/capture-agent-response.js";

const REQUEST_A: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "trend-following",
  cycleId: "cycle-1",
  snapshotId: "snapshot-1"
});

const VALID_INPUT = {
  request: REQUEST_A,
  responseId: "response-1",
  rawResponse: '{"action":"HOLD"}',
  promptVersion: "prompt-v1",
  model: "stub-model"
};

describe("captureAgentResponse valid capture", () => {
  it("builds a capture with a frozen copy of the request", () => {
    const capture = captureAgentResponse(VALID_INPUT);

    assert.equal(capture.responseId, "response-1");
    assert.equal(capture.rawResponse, '{"action":"HOLD"}');
    assert.equal(capture.promptVersion, "prompt-v1");
    assert.equal(capture.model, "stub-model");
    assert.deepEqual({ ...capture.request }, { ...REQUEST_A });
    assert.notEqual(capture.request, REQUEST_A);
    assert.ok(Object.isFrozen(capture));
    assert.ok(Object.isFrozen(capture.request));
  });

  it("accepts a raw, unparsed request object and revalidates it", () => {
    const capture = captureAgentResponse({
      ...VALID_INPUT,
      request: { schemaVersion: 1, agentId: "momentum", cycleId: "cycle-2", snapshotId: "snapshot-2" }
    });

    assert.equal(capture.request.agentId, "momentum");
    assert.ok(Object.isFrozen(capture.request));
  });
});

describe("captureAgentResponse preserves rawResponse byte for byte", () => {
  it("preserves text that is not valid JSON, unmodified", () => {
    const malformed = "not json at all {{{ \n\t weird\u0007content";
    const capture = captureAgentResponse({ ...VALID_INPUT, rawResponse: malformed });

    assert.equal(capture.rawResponse, malformed);
  });

  it("preserves newlines, tabs and unicode content exactly", () => {
    const raw = "line one\nline two\ttabbed – café 🚀";
    const capture = captureAgentResponse({ ...VALID_INPUT, rawResponse: raw });

    assert.equal(capture.rawResponse, raw);
  });

  it("preserves a raw response containing only whitespace", () => {
    const raw = "   ";
    const capture = captureAgentResponse({ ...VALID_INPUT, rawResponse: raw });

    assert.equal(capture.rawResponse, raw);
  });
});

describe("captureAgentResponse invalid responseId/promptVersion/model", () => {
  it("rejects a missing responseId", () => {
    const { responseId: _responseId, ...rest } = VALID_INPUT;
    assert.throws(() => captureAgentResponse(rest), ContractValidationError);
  });

  it("rejects an empty responseId", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, responseId: "" }),
      ContractValidationError
    );
  });

  it("rejects a blank responseId", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, responseId: "   " }),
      ContractValidationError
    );
  });

  it("rejects a non-string responseId", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, responseId: 123 }),
      ContractValidationError
    );
  });

  it("rejects a responseId over the length limit", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, responseId: "a".repeat(MAX_RESPONSE_ID_LENGTH + 1) }),
      ContractValidationError
    );
  });

  it("accepts a responseId exactly at the length limit", () => {
    const capture = captureAgentResponse({
      ...VALID_INPUT,
      responseId: "a".repeat(MAX_RESPONSE_ID_LENGTH)
    });
    assert.equal(capture.responseId.length, MAX_RESPONSE_ID_LENGTH);
  });

  it("rejects a responseId containing a control character", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, responseId: "resp\u0007onse" }),
      ContractValidationError
    );
  });

  it("rejects an empty promptVersion", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, promptVersion: "" }),
      ContractValidationError
    );
  });

  it("rejects a promptVersion over the length limit", () => {
    assert.throws(
      () =>
        captureAgentResponse({
          ...VALID_INPUT,
          promptVersion: "a".repeat(MAX_PROMPT_VERSION_LENGTH + 1)
        }),
      ContractValidationError
    );
  });

  it("rejects a promptVersion containing a control character", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, promptVersion: "v1\u0000" }),
      ContractValidationError
    );
  });

  it("rejects an empty model", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, model: "" }),
      ContractValidationError
    );
  });

  it("rejects a model over the length limit", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, model: "a".repeat(MAX_MODEL_LENGTH + 1) }),
      ContractValidationError
    );
  });

  it("rejects a model containing a control character", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, model: "stub\u001bmodel" }),
      ContractValidationError
    );
  });
});

describe("captureAgentResponse invalid rawResponse", () => {
  it("rejects an empty rawResponse", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, rawResponse: "" }),
      ContractValidationError
    );
  });

  it("rejects a missing rawResponse", () => {
    const { rawResponse: _rawResponse, ...rest } = VALID_INPUT;
    assert.throws(() => captureAgentResponse(rest), ContractValidationError);
  });

  it("rejects a non-string rawResponse", () => {
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, rawResponse: { action: "BUY" } }),
      ContractValidationError
    );
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, rawResponse: null }),
      ContractValidationError
    );
    assert.throws(
      () => captureAgentResponse({ ...VALID_INPUT, rawResponse: 42 }),
      ContractValidationError
    );
  });

  it("rejects a rawResponse over the length limit", () => {
    assert.throws(
      () =>
        captureAgentResponse({ ...VALID_INPUT, rawResponse: "a".repeat(MAX_RAW_RESPONSE_LENGTH + 1) }),
      ContractValidationError
    );
  });

  it("accepts a rawResponse exactly at the length limit", () => {
    const capture = captureAgentResponse({
      ...VALID_INPUT,
      rawResponse: "a".repeat(MAX_RAW_RESPONSE_LENGTH)
    });
    assert.equal(capture.rawResponse.length, MAX_RAW_RESPONSE_LENGTH);
  });
});

describe("captureAgentResponse invalid request", () => {
  it("rejects a missing request", () => {
    const { request: _request, ...rest } = VALID_INPUT;
    assert.throws(() => captureAgentResponse(rest), ContractValidationError);
  });

  it("rejects a request with an empty agentId", () => {
    assert.throws(
      () =>
        captureAgentResponse({
          ...VALID_INPUT,
          request: { schemaVersion: 1, agentId: "", cycleId: "cycle-1", snapshotId: "snapshot-1" }
        }),
      ContractValidationError
    );
  });

  it("rejects a request with the wrong schemaVersion", () => {
    assert.throws(
      () =>
        captureAgentResponse({
          ...VALID_INPUT,
          request: { schemaVersion: 2, agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1" }
        }),
      ContractValidationError
    );
  });

  it("rejects a non-object top-level value", () => {
    assert.throws(() => captureAgentResponse("not an object"), ContractValidationError);
    assert.throws(() => captureAgentResponse(null), ContractValidationError);
    assert.throws(() => captureAgentResponse(undefined), ContractValidationError);
    assert.throws(() => captureAgentResponse([VALID_INPUT]), ContractValidationError);
  });
});

describe("captureAgentResponse immutability and non-mutation", () => {
  it("freezes the returned capture and its request", () => {
    const capture = captureAgentResponse(VALID_INPUT);

    assert.throws(() => {
      (capture as { responseId: string }).responseId = "changed";
    }, TypeError);
    assert.throws(() => {
      (capture.request as { agentId: string }).agentId = "changed";
    }, TypeError);
  });

  it("does not mutate the input object passed to it", () => {
    const input = { ...VALID_INPUT };
    const before = JSON.stringify(input);

    captureAgentResponse(input);

    assert.equal(JSON.stringify(input), before);
  });

  it("does not mutate the AgentRequest instance passed as request", () => {
    const before = { ...REQUEST_A };

    captureAgentResponse({ ...VALID_INPUT, request: REQUEST_A });

    assert.deepEqual({ ...REQUEST_A }, before);
  });
});

describe("captureAgentResponse determinism", () => {
  it("produces field-for-field identical captures for the same canonical input", () => {
    const first = captureAgentResponse(VALID_INPUT);
    const second = captureAgentResponse(VALID_INPUT);

    assert.deepEqual(
      { ...first, request: { ...first.request } },
      { ...second, request: { ...second.request } }
    );
  });
});

describe("captureAgentResponse offline and clock/random free", () => {
  it("never reads the clock: identical input produces an identical capture regardless of call time", async () => {
    const first = captureAgentResponse(VALID_INPUT);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = captureAgentResponse(VALID_INPUT);

    assert.deepEqual(
      { ...first, request: { ...first.request } },
      { ...second, request: { ...second.request } }
    );
  });

  it("does not fabricate a responseId: it is exactly the caller-supplied value", () => {
    const capture = captureAgentResponse({ ...VALID_INPUT, responseId: "caller-chosen-id" });
    assert.equal(capture.responseId, "caller-chosen-id");
  });
});
