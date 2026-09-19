import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError, parseAgentProposal } from "../src/domain/contracts.js";
import { parseAgentRequest, type AgentRequest } from "../src/agent/agent-adapter.js";
import { StubAgentAdapter } from "../src/agent/stub-agent-adapter.js";

const REQUEST_A: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "trend-following",
  cycleId: "cycle-1",
  snapshotId: "snapshot-1"
});

const REQUEST_B: AgentRequest = parseAgentRequest({
  schemaVersion: 1,
  agentId: "momentum",
  cycleId: "cycle-2",
  snapshotId: "snapshot-2"
});

const VALID_PROPOSAL_RESPONSE = {
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
  promptVersion: "v1",
  model: "stub"
};

describe("parseAgentRequest", () => {
  it("accepts a well-formed request and freezes it", () => {
    const request = parseAgentRequest({
      schemaVersion: 1,
      agentId: "trend-following",
      cycleId: "cycle-1",
      snapshotId: "snapshot-1"
    });
    assert.equal(request.agentId, "trend-following");
    assert.equal(request.cycleId, "cycle-1");
    assert.equal(request.snapshotId, "snapshot-1");
    assert.ok(Object.isFrozen(request));
  });

  it("rejects a non-object request", () => {
    assert.throws(() => parseAgentRequest("not an object"), ContractValidationError);
    assert.throws(() => parseAgentRequest(null), ContractValidationError);
  });

  it("rejects an empty agentId", () => {
    assert.throws(
      () => parseAgentRequest({ schemaVersion: 1, agentId: "", cycleId: "cycle-1", snapshotId: "snapshot-1" }),
      ContractValidationError
    );
  });

  it("rejects an agentId that is not a lowercase slug", () => {
    assert.throws(
      () =>
        parseAgentRequest({
          schemaVersion: 1,
          agentId: "Trend Following",
          cycleId: "cycle-1",
          snapshotId: "snapshot-1"
        }),
      ContractValidationError
    );
  });

  it("rejects a missing cycleId", () => {
    assert.throws(
      () => parseAgentRequest({ schemaVersion: 1, agentId: "trend-following", snapshotId: "snapshot-1" }),
      ContractValidationError
    );
  });

  it("rejects a blank snapshotId", () => {
    assert.throws(
      () =>
        parseAgentRequest({
          schemaVersion: 1,
          agentId: "trend-following",
          cycleId: "cycle-1",
          snapshotId: "   "
        }),
      ContractValidationError
    );
  });

  it("rejects the wrong schemaVersion", () => {
    assert.throws(
      () =>
        parseAgentRequest({
          schemaVersion: 2,
          agentId: "trend-following",
          cycleId: "cycle-1",
          snapshotId: "snapshot-1"
        }),
      ContractValidationError
    );
  });
});

describe("StubAgentAdapter routed response", () => {
  it("returns exactly the routed response for the matching request", () => {
    const response = { note: "routed" };
    const adapter = new StubAgentAdapter({
      routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response }]
    });

    const result = adapter.call(REQUEST_A);

    assert.equal(result, response);
  });

  it("resolves two independent keys to their own distinct responses", () => {
    const responseA = { note: "a" };
    const responseB = { note: "b" };
    const adapter = new StubAgentAdapter({
      routes: [
        { agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: responseA },
        { agentId: "momentum", cycleId: "cycle-2", snapshotId: "snapshot-2", response: responseB }
      ]
    });

    assert.equal(adapter.call(REQUEST_A), responseA);
    assert.equal(adapter.call(REQUEST_B), responseB);
  });
});

describe("StubAgentAdapter fail-closed behaviour", () => {
  it("rejects an invalid request", () => {
    const adapter = new StubAgentAdapter({
      routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: null }]
    });

    assert.throws(
      () => adapter.call({ schemaVersion: 1, agentId: "", cycleId: "cycle-1", snapshotId: "snapshot-1" } as AgentRequest),
      ContractValidationError
    );
  });

  it("rejects a request with no configured route", () => {
    const adapter = new StubAgentAdapter({ routes: [] });

    assert.throws(() => adapter.call(REQUEST_A), ContractValidationError);
  });

  it("rejects a duplicate key in the configuration", () => {
    assert.throws(
      () =>
        new StubAgentAdapter({
          routes: [
            { agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: 1 },
            { agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: 2 }
          ]
        }),
      ContractValidationError
    );
  });

  it("rejects a second call for the same key", () => {
    const adapter = new StubAgentAdapter({
      routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: "ok" }]
    });

    assert.equal(adapter.call(REQUEST_A), "ok");
    assert.throws(() => adapter.call(REQUEST_A), ContractValidationError);
  });
});

describe("StubAgentAdapter never interprets the raw response", () => {
  it("preserves a malformed response exactly, unmodified", () => {
    const malformed = { action: "FLY_TO_THE_MOON", positionPct: "all of it" };
    const adapter = new StubAgentAdapter({
      routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: malformed }]
    });

    const result = adapter.call(REQUEST_A);

    assert.equal(result, malformed);
    assert.deepEqual(result, malformed);
  });

  it("forwards a primitive or undefined response untouched", () => {
    const adapter = new StubAgentAdapter({
      routes: [
        { agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: undefined },
        { agentId: "momentum", cycleId: "cycle-2", snapshotId: "snapshot-2", response: "raw-text" }
      ]
    });

    assert.equal(adapter.call(REQUEST_A), undefined);
    assert.equal(adapter.call(REQUEST_B), "raw-text");
  });
});

describe("integration with parseAgentProposal", () => {
  it("accepts a valid routed response and rejects an invalid one", () => {
    const adapter = new StubAgentAdapter({
      routes: [
        {
          agentId: "trend-following",
          cycleId: "cycle-1",
          snapshotId: "snapshot-1",
          response: VALID_PROPOSAL_RESPONSE
        },
        {
          agentId: "momentum",
          cycleId: "cycle-2",
          snapshotId: "snapshot-2",
          response: { action: "BUY" }
        }
      ]
    });

    const validRaw = adapter.call(REQUEST_A);
    const proposal = parseAgentProposal(validRaw);
    assert.equal(proposal.action, "HOLD");
    assert.equal(proposal.agentId, "trend-following");

    const invalidRaw = adapter.call(REQUEST_B);
    assert.throws(() => parseAgentProposal(invalidRaw), ContractValidationError);
  });
});

describe("immutability and non-mutation", () => {
  it("does not mutate the config object or its routes passed to the constructor", () => {
    const routes = [
      { agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: { a: 1 } }
    ];
    const config = { routes };
    const before = JSON.stringify(config);

    const adapter = new StubAgentAdapter(config);
    adapter.call(REQUEST_A);

    assert.equal(JSON.stringify(config), before);
  });

  it("keeps working correctly after the caller mutates its own config array post-construction", () => {
    const routes = [
      { agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: "first" }
    ];
    const adapter = new StubAgentAdapter({ routes });
    routes.push({ agentId: "momentum", cycleId: "cycle-2", snapshotId: "snapshot-2", response: "second" });

    assert.equal(adapter.call(REQUEST_A), "first");
    assert.throws(() => adapter.call(REQUEST_B), ContractValidationError);
  });

  it("does not mutate the AgentRequest passed to call", () => {
    const adapter = new StubAgentAdapter({
      routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response: "ok" }]
    });
    const before = { ...REQUEST_A };

    adapter.call(REQUEST_A);

    assert.deepEqual({ ...REQUEST_A }, before);
  });
});

describe("determinism", () => {
  it("returns the identical response for the same canonical request across independently built adapters", () => {
    const response = { value: 42 };
    const build = () =>
      new StubAgentAdapter({
        routes: [{ agentId: "trend-following", cycleId: "cycle-1", snapshotId: "snapshot-1", response }]
      });

    const first = build();
    const second = build();

    assert.equal(first.call(REQUEST_A), response);
    assert.equal(second.call(REQUEST_A), response);
  });
});
