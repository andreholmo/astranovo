import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ContractValidationError,
  MAX_AGENT_RETRY_ATTEMPTS,
  MIN_AGENT_RETRY_ATTEMPTS,
  parseAgentRetryPolicy,
  shouldRetryAgentAttempt,
  type AgentRetryPolicy
} from "../src/agent/retry-policy.js";

describe("parseAgentRetryPolicy", () => {
  it("accepts the lower bound and freezes the result", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: MIN_AGENT_RETRY_ATTEMPTS });
    assert.equal(policy.maxAttempts, 1);
    assert.ok(Object.isFrozen(policy));
  });

  it("accepts the upper bound", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: MAX_AGENT_RETRY_ATTEMPTS });
    assert.equal(policy.maxAttempts, 3);
  });

  it("accepts the value in between the bounds", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 2 });
    assert.equal(policy.maxAttempts, 2);
  });

  it("rejects a non-object value", () => {
    assert.throws(() => parseAgentRetryPolicy("not an object"), ContractValidationError);
    assert.throws(() => parseAgentRetryPolicy(null), ContractValidationError);
    assert.throws(() => parseAgentRetryPolicy(undefined), ContractValidationError);
    assert.throws(() => parseAgentRetryPolicy([1]), ContractValidationError);
  });

  it("rejects zero attempts", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: 0 }), ContractValidationError);
  });

  it("rejects a value above the upper bound", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: 4 }), ContractValidationError);
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: 100 }), ContractValidationError);
  });

  it("rejects a negative value", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: -1 }), ContractValidationError);
  });

  it("rejects a fractional value", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: 1.5 }), ContractValidationError);
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: 2.0001 }), ContractValidationError);
  });

  it("rejects NaN", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: Number.NaN }), ContractValidationError);
  });

  it("rejects infinite values", () => {
    assert.throws(
      () => parseAgentRetryPolicy({ maxAttempts: Number.POSITIVE_INFINITY }),
      ContractValidationError
    );
    assert.throws(
      () => parseAgentRetryPolicy({ maxAttempts: Number.NEGATIVE_INFINITY }),
      ContractValidationError
    );
  });

  it("rejects a string", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: "3" }), ContractValidationError);
  });

  it("rejects an object", () => {
    assert.throws(() => parseAgentRetryPolicy({ maxAttempts: { value: 3 } }), ContractValidationError);
  });

  it("rejects a missing maxAttempts field", () => {
    assert.throws(() => parseAgentRetryPolicy({}), ContractValidationError);
  });

  it("drops unknown fields, keeping only maxAttempts", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 2, backoffMs: 1000, jitter: true });
    assert.deepEqual(Object.keys(policy), ["maxAttempts"]);
  });

  it("does not mutate the input object", () => {
    const input = { maxAttempts: 2 };
    const before = JSON.stringify(input);
    parseAgentRetryPolicy(input);
    assert.equal(JSON.stringify(input), before);
  });

  it("is deterministic for the same canonical input", () => {
    const first = parseAgentRetryPolicy({ maxAttempts: 2 });
    const second = parseAgentRetryPolicy({ maxAttempts: 2 });
    assert.deepEqual(first, second);
  });
});

describe("shouldRetryAgentAttempt", () => {
  it("allows a retry below the limit, for every policy value", () => {
    for (let maxAttempts = MIN_AGENT_RETRY_ATTEMPTS; maxAttempts <= MAX_AGENT_RETRY_ATTEMPTS; maxAttempts++) {
      const policy = parseAgentRetryPolicy({ maxAttempts });
      for (let completed = 0; completed < maxAttempts; completed++) {
        assert.equal(
          shouldRetryAgentAttempt(policy, completed),
          true,
          `maxAttempts=${maxAttempts}, completedAttempts=${completed}`
        );
      }
    }
  });

  it("denies a retry once the limit is reached, for every policy value", () => {
    for (let maxAttempts = MIN_AGENT_RETRY_ATTEMPTS; maxAttempts <= MAX_AGENT_RETRY_ATTEMPTS; maxAttempts++) {
      const policy = parseAgentRetryPolicy({ maxAttempts });
      assert.equal(shouldRetryAgentAttempt(policy, maxAttempts), false, `maxAttempts=${maxAttempts}`);
    }
  });

  it("denies a retry past the limit", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 2 });
    assert.equal(shouldRetryAgentAttempt(policy, 3), false);
    assert.equal(shouldRetryAgentAttempt(policy, 100), false);
  });

  it("allows the very first attempt when zero attempts have completed", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 1 });
    assert.equal(shouldRetryAgentAttempt(policy, 0), true);
  });

  it("rejects a negative completedAttempts", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 3 });
    assert.throws(() => shouldRetryAgentAttempt(policy, -1), ContractValidationError);
  });

  it("rejects a fractional completedAttempts", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 3 });
    assert.throws(() => shouldRetryAgentAttempt(policy, 1.5), ContractValidationError);
  });

  it("rejects NaN and infinite completedAttempts", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 3 });
    assert.throws(() => shouldRetryAgentAttempt(policy, Number.NaN), ContractValidationError);
    assert.throws(
      () => shouldRetryAgentAttempt(policy, Number.POSITIVE_INFINITY),
      ContractValidationError
    );
  });

  it("rejects a string or object completedAttempts", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 3 });
    assert.throws(
      () => shouldRetryAgentAttempt(policy, "1" as unknown as number),
      ContractValidationError
    );
    assert.throws(
      () => shouldRetryAgentAttempt(policy, { value: 1 } as unknown as number),
      ContractValidationError
    );
  });

  it("does not mutate the policy or return a new structure to freeze", () => {
    const policy: AgentRetryPolicy = parseAgentRetryPolicy({ maxAttempts: 2 });
    const before = JSON.stringify(policy);
    shouldRetryAgentAttempt(policy, 1);
    assert.equal(JSON.stringify(policy), before);
  });

  it("is deterministic for the same canonical input", () => {
    const policy = parseAgentRetryPolicy({ maxAttempts: 2 });
    assert.equal(shouldRetryAgentAttempt(policy, 1), shouldRetryAgentAttempt(policy, 1));
  });

  it("rejects a forged policy above the upper bound instead of allowing extra retries", () => {
    const forged = { maxAttempts: 100 } as AgentRetryPolicy;
    assert.throws(() => shouldRetryAgentAttempt(forged, 3), ContractValidationError);
  });

  it("rejects a forged policy with zero maxAttempts", () => {
    const forged = { maxAttempts: 0 } as AgentRetryPolicy;
    assert.throws(() => shouldRetryAgentAttempt(forged, 0), ContractValidationError);
  });

  it("rejects a forged policy with a fractional maxAttempts", () => {
    const forged = { maxAttempts: 1.5 } as AgentRetryPolicy;
    assert.throws(() => shouldRetryAgentAttempt(forged, 0), ContractValidationError);
  });

  it("rejects a forged policy with a non-numeric maxAttempts", () => {
    const forged = { maxAttempts: "3" } as unknown as AgentRetryPolicy;
    assert.throws(() => shouldRetryAgentAttempt(forged, 0), ContractValidationError);
  });

  it("rejects a forged policy with an infinite maxAttempts", () => {
    const forged = { maxAttempts: Number.POSITIVE_INFINITY } as AgentRetryPolicy;
    assert.throws(() => shouldRetryAgentAttempt(forged, 0), ContractValidationError);
  });

  it("rejects a non-object policy passed directly", () => {
    assert.throws(
      () => shouldRetryAgentAttempt(null as unknown as AgentRetryPolicy, 0),
      ContractValidationError
    );
    assert.throws(
      () => shouldRetryAgentAttempt("policy" as unknown as AgentRetryPolicy, 0),
      ContractValidationError
    );
  });
});

describe("no clock, timer, randomness, network or I/O", () => {
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
      const policy = parseAgentRetryPolicy({ maxAttempts: 3 });
      assert.equal(shouldRetryAgentAttempt(policy, 0), true);
      assert.equal(shouldRetryAgentAttempt(policy, 3), false);
    } finally {
      Date.now = originalDateNow;
      Math.random = originalMathRandom;
      globalThis.setTimeout = originalSetTimeout;
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });
});
