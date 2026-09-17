import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ContractValidationError,
  MAX_EVIDENCE_IDS,
  MAX_NAME_LENGTH,
  MAX_REASON_LENGTH,
  describeContractError,
  parseAgentConfig,
  parseAgentProposal,
  parseMarketSnapshot
} from "../src/domain/contracts.js";

type Payload = Record<string, unknown>;

function agentConfig(overrides: Payload = {}): Payload {
  return {
    id: "trend-following",
    name: "Trend Following",
    strategy: "trend-following",
    enabled: true,
    initialBudgetUsd: 100,
    mode: "reference",
    ...overrides
  };
}

function marketSnapshot(overrides: Payload = {}): Payload {
  return {
    schemaVersion: 1,
    snapshotId: "snap-0001",
    source: "fixture",
    asset: "BTC",
    quote: "USD",
    asOf: "2026-09-17T18:00:00.000Z",
    availableAt: "2026-09-17T18:00:05.000Z",
    price: 64250.5,
    spreadBps: 4.5,
    complete: true,
    ...overrides
  };
}

function agentProposal(overrides: Payload = {}): Payload {
  return {
    schemaVersion: 1,
    proposalId: "prop-0001",
    cycleId: "cycle-0001",
    agentId: "trend-following",
    action: "BUY",
    asset: "BTC",
    confidence: 0.73,
    positionPct: 0.08,
    reason: "Higher highs on the closed candles available at the snapshot.",
    veto: false,
    evidenceIds: ["snap-0001"],
    promptVersion: "p1",
    model: "stub",
    ...overrides
  };
}

function withoutKey(payload: Payload, key: string): Payload {
  const copy = { ...payload };
  delete copy[key];
  return copy;
}

/** Asserts the call fails with a ContractValidationError on the named field. */
function assertRejected(run: () => unknown, contract: string, field: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError, "expected a ContractValidationError");
    assert.equal(error.contract, contract, "wrong contract name");
    assert.equal(error.field, field, `wrong field, got ${error.field}`);
    return true;
  });
}

describe("AgentConfig", () => {
  it("accepts a well-formed entry and returns a frozen copy", () => {
    const input = agentConfig();
    const parsed = parseAgentConfig(input);

    assert.equal(parsed.id, "trend-following");
    assert.equal(parsed.initialBudgetUsd, 100);
    assert.equal(parsed.mode, "reference");
    assert.ok(Object.isFrozen(parsed), "parsed config must be frozen");
    assert.notEqual(parsed as unknown, input as unknown, "must not return the input object");
  });

  it("does not mutate the input object", () => {
    const input = agentConfig();
    const before = structuredClone(input);
    parseAgentConfig(input);
    assert.deepEqual(input, before);
  });

  it("drops unknown fields instead of trusting them", () => {
    const parsed = parseAgentConfig(agentConfig({ initialBudgetBrl: 500, admin: true }));
    assert.deepEqual(Object.keys(parsed).sort(), [
      "enabled",
      "id",
      "initialBudgetUsd",
      "mode",
      "name",
      "strategy"
    ]);
  });

  it("is deterministic across repeated calls", () => {
    const input = agentConfig();
    assert.deepEqual(parseAgentConfig(input), parseAgentConfig(input));
  });

  it("rejects a non-object value", () => {
    assertRejected(() => parseAgentConfig(null), "AgentConfig", "value");
    assertRejected(() => parseAgentConfig([agentConfig()]), "AgentConfig", "value");
    assertRejected(() => parseAgentConfig("trend-following"), "AgentConfig", "value");
  });

  it("rejects missing required fields", () => {
    for (const field of ["id", "name", "strategy", "enabled", "initialBudgetUsd", "mode"]) {
      assertRejected(() => parseAgentConfig(withoutKey(agentConfig(), field)), "AgentConfig", field);
    }
  });

  it("rejects wrong types", () => {
    assertRejected(() => parseAgentConfig(agentConfig({ id: 7 })), "AgentConfig", "id");
    assertRejected(() => parseAgentConfig(agentConfig({ enabled: "true" })), "AgentConfig", "enabled");
    assertRejected(
      () => parseAgentConfig(agentConfig({ initialBudgetUsd: "100" })),
      "AgentConfig",
      "initialBudgetUsd"
    );
  });

  it("rejects NaN and Infinity budgets", () => {
    for (const budget of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assertRejected(
        () => parseAgentConfig(agentConfig({ initialBudgetUsd: budget })),
        "AgentConfig",
        "initialBudgetUsd"
      );
    }
  });

  it("rejects a non-positive budget", () => {
    for (const budget of [0, -1, -0.01]) {
      assertRejected(
        () => parseAgentConfig(agentConfig({ initialBudgetUsd: budget })),
        "AgentConfig",
        "initialBudgetUsd"
      );
    }
  });

  it("rejects empty, blank, oversized and control-character strings", () => {
    assertRejected(() => parseAgentConfig(agentConfig({ name: "" })), "AgentConfig", "name");
    assertRejected(() => parseAgentConfig(agentConfig({ name: "   " })), "AgentConfig", "name");
    assertRejected(
      () => parseAgentConfig(agentConfig({ name: "a".repeat(MAX_NAME_LENGTH + 1) })),
      "AgentConfig",
      "name"
    );
    assertRejected(
      () => parseAgentConfig(agentConfig({ name: "Trend\u0007Following" })),
      "AgentConfig",
      "name"
    );
    assertRejected(
      () => parseAgentConfig(agentConfig({ name: "Trend\u001bFollowing" })),
      "AgentConfig",
      "name"
    );
  });

  it("rejects ids and strategies that are not lowercase slugs", () => {
    for (const id of ["Trend-Following", "trend_following", "trend following", "-trend", "trend-"]) {
      assertRejected(() => parseAgentConfig(agentConfig({ id })), "AgentConfig", "id");
    }
    assertRejected(
      () => parseAgentConfig(agentConfig({ strategy: "Trend Following" })),
      "AgentConfig",
      "strategy"
    );
  });

  it("rejects an unknown mode", () => {
    for (const mode of ["hybrid", "REFERENCE", "", 1]) {
      assertRejected(() => parseAgentConfig(agentConfig({ mode })), "AgentConfig", "mode");
    }
  });

  it("accepts the optimized mode", () => {
    assert.equal(parseAgentConfig(agentConfig({ mode: "optimized" })).mode, "optimized");
  });
});

describe("MarketSnapshot", () => {
  it("accepts a well-formed snapshot and returns a frozen copy", () => {
    const parsed = parseMarketSnapshot(marketSnapshot());

    assert.equal(parsed.snapshotId, "snap-0001");
    assert.equal(parsed.asset, "BTC");
    assert.equal(parsed.price, 64250.5);
    assert.ok(Object.isFrozen(parsed), "parsed snapshot must be frozen");
  });

  it("does not mutate the input object", () => {
    const input = marketSnapshot();
    const before = structuredClone(input);
    parseMarketSnapshot(input, { notAfter: "2026-09-17T18:00:10.000Z" });
    assert.deepEqual(input, before);
  });

  it("accepts availableAt equal to asOf", () => {
    const parsed = parseMarketSnapshot(
      marketSnapshot({ availableAt: "2026-09-17T18:00:00.000Z" })
    );
    assert.equal(parsed.availableAt, parsed.asOf);
  });

  it("rejects availableAt before asOf as a look-ahead leak", () => {
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ availableAt: "2026-09-17T17:59:59.999Z" })),
      "MarketSnapshot",
      "availableAt"
    );
  });

  it("rejects a snapshot available after the supplied notAfter instant", () => {
    assertRejected(
      () =>
        parseMarketSnapshot(marketSnapshot(), { notAfter: "2026-09-17T18:00:04.999Z" }),
      "MarketSnapshot",
      "availableAt"
    );
  });

  it("accepts a snapshot available exactly at the notAfter instant", () => {
    const parsed = parseMarketSnapshot(marketSnapshot(), {
      notAfter: "2026-09-17T18:00:05.000Z"
    });
    assert.equal(parsed.availableAt, "2026-09-17T18:00:05.000Z");
  });

  it("rejects a non-canonical notAfter instant", () => {
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot(), { notAfter: "2026-09-17T18:00:05Z" }),
      "MarketSnapshot",
      "notAfter"
    );
  });

  it("rejects non-canonical timestamps", () => {
    const nonCanonical = [
      "2026-09-17T18:00:00Z",
      "2026-09-17T18:00:00.000+00:00",
      "2026-09-17t18:00:00.000z",
      "2026-09-17 18:00:00.000Z",
      "2026-09-17T18:00:00.000",
      "2026-02-30T00:00:00.000Z",
      "not-a-timestamp"
    ];
    for (const asOf of nonCanonical) {
      assertRejected(
        () => parseMarketSnapshot(marketSnapshot({ asOf, availableAt: asOf })),
        "MarketSnapshot",
        "asOf"
      );
    }
  });

  it("rejects a wrong schema version", () => {
    for (const schemaVersion of [0, 2, "1", null]) {
      assertRejected(
        () => parseMarketSnapshot(marketSnapshot({ schemaVersion })),
        "MarketSnapshot",
        "schemaVersion"
      );
    }
  });

  it("rejects missing required fields", () => {
    const fields = [
      "schemaVersion",
      "snapshotId",
      "source",
      "asset",
      "quote",
      "asOf",
      "availableAt",
      "price",
      "spreadBps",
      "complete"
    ];
    for (const field of fields) {
      assertRejected(
        () => parseMarketSnapshot(withoutKey(marketSnapshot(), field)),
        "MarketSnapshot",
        field
      );
    }
  });

  it("rejects NaN and Infinity in numeric fields", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assertRejected(
        () => parseMarketSnapshot(marketSnapshot({ price: value })),
        "MarketSnapshot",
        "price"
      );
      assertRejected(
        () => parseMarketSnapshot(marketSnapshot({ spreadBps: value })),
        "MarketSnapshot",
        "spreadBps"
      );
    }
  });

  it("rejects a non-positive price and a negative spread", () => {
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ price: 0 })),
      "MarketSnapshot",
      "price"
    );
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ price: -1 })),
      "MarketSnapshot",
      "price"
    );
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ spreadBps: -0.1 })),
      "MarketSnapshot",
      "spreadBps"
    );
  });

  it("accepts a zero spread", () => {
    assert.equal(parseMarketSnapshot(marketSnapshot({ spreadBps: 0 })).spreadBps, 0);
  });

  it("rejects malformed symbols and identifiers", () => {
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ asset: "btc" })),
      "MarketSnapshot",
      "asset"
    );
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ quote: "US DOLLAR" })),
      "MarketSnapshot",
      "quote"
    );
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ snapshotId: "-snap" })),
      "MarketSnapshot",
      "snapshotId"
    );
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ source: "fix\u0000ture" })),
      "MarketSnapshot",
      "source"
    );
  });

  it("rejects a non-boolean complete flag", () => {
    assertRejected(
      () => parseMarketSnapshot(marketSnapshot({ complete: "yes" })),
      "MarketSnapshot",
      "complete"
    );
  });

  it("accepts an explicitly incomplete snapshot; refusing to trade on it is a later decision", () => {
    assert.equal(parseMarketSnapshot(marketSnapshot({ complete: false })).complete, false);
  });
});

describe("AgentProposal", () => {
  it("accepts a well-formed proposal and returns a frozen copy", () => {
    const parsed = parseAgentProposal(agentProposal());

    assert.equal(parsed.action, "BUY");
    assert.equal(parsed.positionPct, 0.08);
    assert.ok(Object.isFrozen(parsed), "parsed proposal must be frozen");
    assert.ok(Object.isFrozen(parsed.evidenceIds), "evidenceIds must be frozen");
  });

  it("does not mutate the input object", () => {
    const input = agentProposal();
    const before = structuredClone(input);
    parseAgentProposal(input);
    assert.deepEqual(input, before);
  });

  it("accepts HOLD with exactly zero size", () => {
    const parsed = parseAgentProposal(agentProposal({ action: "HOLD", positionPct: 0 }));
    assert.equal(parsed.action, "HOLD");
    assert.equal(parsed.positionPct, 0);
  });

  it("rejects HOLD with a non-zero size", () => {
    for (const positionPct of [0.0001, 0.5, 1]) {
      assertRejected(
        () => parseAgentProposal(agentProposal({ action: "HOLD", positionPct })),
        "AgentProposal",
        "positionPct"
      );
    }
  });

  it("rejects BUY and SELL with a zero size as ambiguous", () => {
    for (const action of ["BUY", "SELL"]) {
      assertRejected(
        () => parseAgentProposal(agentProposal({ action, positionPct: 0 })),
        "AgentProposal",
        "positionPct"
      );
    }
  });

  it("accepts SELL, whose size means a fraction of the current position", () => {
    const parsed = parseAgentProposal(agentProposal({ action: "SELL", positionPct: 1 }));
    assert.equal(parsed.action, "SELL");
    assert.equal(parsed.positionPct, 1);
  });

  it("rejects an unknown action and never guesses from free text", () => {
    for (const action of ["buy", "LONG", "SHORT", "", 1, null]) {
      assertRejected(
        () => parseAgentProposal(agentProposal({ action })),
        "AgentProposal",
        "action"
      );
    }
  });

  it("rejects percentages outside [0, 1]", () => {
    for (const positionPct of [-0.01, 1.01, 8]) {
      assertRejected(
        () => parseAgentProposal(agentProposal({ positionPct })),
        "AgentProposal",
        "positionPct"
      );
    }
    for (const confidence of [-0.01, 1.01, 100]) {
      assertRejected(
        () => parseAgentProposal(agentProposal({ confidence })),
        "AgentProposal",
        "confidence"
      );
    }
  });

  it("rejects NaN and Infinity in numeric fields", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assertRejected(
        () => parseAgentProposal(agentProposal({ confidence: value })),
        "AgentProposal",
        "confidence"
      );
      assertRejected(
        () => parseAgentProposal(agentProposal({ positionPct: value })),
        "AgentProposal",
        "positionPct"
      );
    }
  });

  it("rejects missing required fields", () => {
    const fields = [
      "schemaVersion",
      "proposalId",
      "cycleId",
      "agentId",
      "action",
      "asset",
      "confidence",
      "positionPct",
      "reason",
      "veto",
      "evidenceIds",
      "promptVersion",
      "model"
    ];
    for (const field of fields) {
      assertRejected(
        () => parseAgentProposal(withoutKey(agentProposal(), field)),
        "AgentProposal",
        field
      );
    }
  });

  it("rejects an oversized or control-character reason", () => {
    assertRejected(
      () => parseAgentProposal(agentProposal({ reason: "a".repeat(MAX_REASON_LENGTH + 1) })),
      "AgentProposal",
      "reason"
    );
    assertRejected(
      () => parseAgentProposal(agentProposal({ reason: "ok\u009fno" })),
      "AgentProposal",
      "reason"
    );
    assertRejected(() => parseAgentProposal(agentProposal({ reason: "" })), "AgentProposal", "reason");
  });

  it("rejects too many evidence identifiers", () => {
    const evidenceIds = Array.from({ length: MAX_EVIDENCE_IDS + 1 }, (_, index) => `ev-${index}`);
    assertRejected(
      () => parseAgentProposal(agentProposal({ evidenceIds })),
      "AgentProposal",
      "evidenceIds"
    );
  });

  it("accepts exactly the maximum number of evidence identifiers", () => {
    const evidenceIds = Array.from({ length: MAX_EVIDENCE_IDS }, (_, index) => `ev-${index}`);
    assert.equal(
      parseAgentProposal(agentProposal({ evidenceIds })).evidenceIds.length,
      MAX_EVIDENCE_IDS
    );
  });

  it("rejects duplicate evidence identifiers", () => {
    assertRejected(
      () => parseAgentProposal(agentProposal({ evidenceIds: ["snap-1", "snap-1"] })),
      "AgentProposal",
      "evidenceIds"
    );
  });

  it("rejects malformed evidence identifiers and a non-array", () => {
    assertRejected(
      () => parseAgentProposal(agentProposal({ evidenceIds: ["snap 1"] })),
      "AgentProposal",
      "evidenceIds entry"
    );
    assertRejected(
      () => parseAgentProposal(agentProposal({ evidenceIds: "snap-1" })),
      "AgentProposal",
      "evidenceIds"
    );
  });

  it("accepts an empty evidence list", () => {
    assert.deepEqual(parseAgentProposal(agentProposal({ evidenceIds: [] })).evidenceIds, []);
  });

  it("rejects a non-boolean veto", () => {
    assertRejected(() => parseAgentProposal(agentProposal({ veto: "no" })), "AgentProposal", "veto");
  });

  it("records a veto without inferring anything about the action", () => {
    const parsed = parseAgentProposal(agentProposal({ veto: true }));
    assert.equal(parsed.veto, true);
    assert.equal(parsed.action, "BUY");
  });

  it("rejects an agentId that is not a slug", () => {
    assertRejected(
      () => parseAgentProposal(agentProposal({ agentId: "Trend Following" })),
      "AgentProposal",
      "agentId"
    );
  });
});

describe("error reporting", () => {
  it("names the field and the requirement without echoing the value", () => {
    assert.throws(
      () => parseAgentConfig(agentConfig({ initialBudgetUsd: -500.25 })),
      (error: unknown) => {
        assert.ok(error instanceof ContractValidationError);
        assert.equal(error.message, "Invalid AgentConfig: initialBudgetUsd must be greater than 0");
        assert.ok(!error.message.includes("500.25"), "must not echo the rejected value");
        return true;
      }
    );
  });

  it("describes errors as a single safe line with no stack", () => {
    try {
      parseAgentProposal(agentProposal({ action: "buy" }));
      assert.fail("expected a rejection");
    } catch (error) {
      const description = describeContractError(error);
      assert.equal(description, "Invalid AgentProposal: action must be one of: BUY, SELL, HOLD");
      assert.ok(!description.includes("\n"), "must be a single line");
      assert.ok(!description.includes("at "), "must not contain a stack frame");
    }
  });

  it("does not leak the message of an unexpected error", () => {
    assert.equal(
      describeContractError(new Error("token=secret")),
      "Validation failed for an unexpected reason."
    );
  });
});
