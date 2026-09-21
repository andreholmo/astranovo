import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/errors.js";
import {
  serializeFinalizedAgentCyclesSummary,
  type FinalizedAgentCyclesSummary
} from "../src/agent/serialize-finalized-agent-cycles-summary.js";

function summary(overrides: Partial<FinalizedAgentCyclesSummary> = {}): FinalizedAgentCyclesSummary {
  const base: FinalizedAgentCyclesSummary = {
    total: 3,
    acceptedCount: 1,
    holdCount: 1,
    failedCount: 1,
    acceptedItemIds: ["a1"],
    holdItemIds: ["h1"],
    failedItemIds: ["f1"]
  };
  return { ...base, ...overrides };
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function expectRejection(action: () => unknown): ContractValidationError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ContractValidationError);
    return error;
  }
  assert.fail("expected serializeFinalizedAgentCyclesSummary to throw");
}

describe("serializeFinalizedAgentCyclesSummary: canonical output for a valid summary", () => {
  it("produces the exact canonical JSON, in fixed key order, for a mixed summary", () => {
    const value = summary({
      total: 6,
      acceptedCount: 2,
      holdCount: 2,
      failedCount: 2,
      acceptedItemIds: ["a1", "a2"],
      holdItemIds: ["h1", "h2"],
      failedItemIds: ["f1", "f2"]
    });

    const json = serializeFinalizedAgentCyclesSummary(value);

    assert.equal(
      json,
      '{"total":6,"acceptedCount":2,"holdCount":2,"failedCount":2,"acceptedItemIds":["a1","a2"],"holdItemIds":["h1","h2"],"failedItemIds":["f1","f2"]}'
    );
  });

  it("accepts all-empty categories when total is zero", () => {
    const value = summary({
      total: 0,
      acceptedCount: 0,
      holdCount: 0,
      failedCount: 0,
      acceptedItemIds: [],
      holdItemIds: [],
      failedItemIds: []
    });

    const json = serializeFinalizedAgentCyclesSummary(value);

    assert.equal(
      json,
      '{"total":0,"acceptedCount":0,"holdCount":0,"failedCount":0,"acceptedItemIds":[],"holdItemIds":[],"failedItemIds":[]}'
    );
  });

  it("contains no whitespace or line breaks", () => {
    const json = serializeFinalizedAgentCyclesSummary(summary());

    assert.ok(!json.includes(" "));
    assert.ok(!json.includes("\n"));
  });

  it("preserves each category's own itemId order, unsorted", () => {
    const value = summary({
      total: 3,
      acceptedCount: 3,
      holdCount: 0,
      failedCount: 0,
      acceptedItemIds: ["z", "a", "m"],
      holdItemIds: [],
      failedItemIds: []
    });

    const json = serializeFinalizedAgentCyclesSummary(value);

    assert.ok(json.includes('"acceptedItemIds":["z","a","m"]'));
  });
});

describe("serializeFinalizedAgentCyclesSummary: determinism", () => {
  it("produces byte-identical output for field-for-field identical inputs", () => {
    const first = serializeFinalizedAgentCyclesSummary(summary());
    const second = serializeFinalizedAgentCyclesSummary(summary());

    assert.equal(first, second);
  });

  it("produces byte-identical output across repeated calls on the same value", () => {
    const value = summary();

    assert.equal(serializeFinalizedAgentCyclesSummary(value), serializeFinalizedAgentCyclesSummary(value));
  });
});

describe("serializeFinalizedAgentCyclesSummary: invalid or forged summary structure fails closed", () => {
  it("rejects null", () => {
    expectRejection(() => serializeFinalizedAgentCyclesSummary(null as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects an array standing in for the summary", () => {
    expectRejection(() => serializeFinalizedAgentCyclesSummary([] as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a primitive standing in for the summary", () => {
    expectRejection(() => serializeFinalizedAgentCyclesSummary("nope" as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a summary with an extra enumerable property", () => {
    const forged = { ...summary(), extra: "nope" };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a summary with an extra non-enumerable property", () => {
    const forged: Record<string, unknown> = { ...summary() };
    Object.defineProperty(forged, "hidden", { value: "secret-field", enumerable: false });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a summary with an extra Symbol-keyed property", () => {
    const forged: Record<string | symbol, unknown> = { ...summary() };
    forged[Symbol("hidden")] = "secret-symbol-field";

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a summary missing a required field", () => {
    const forged = summary() as unknown as Record<string, unknown>;
    delete forged.failedCount;

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a summary with a hostile toJSON overriding serialization", () => {
    const forged = { ...summary(), toJSON: () => ({ total: 0 }) };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("never invokes a toJSON inherited from the prototype chain", () => {
    const proto = { toJSON: () => ({ total: 0, hacked: true }) };
    const forged = Object.assign(Object.create(proto), summary());

    const json = serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary);

    assert.equal(json, JSON.stringify(summary()));
  });
});

describe("serializeFinalizedAgentCyclesSummary: incoherent counts fail closed", () => {
  it("rejects acceptedCount not matching acceptedItemIds length", () => {
    const forged = summary({ acceptedCount: 2, acceptedItemIds: ["a1"] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects holdCount not matching holdItemIds length", () => {
    const forged = summary({ holdCount: 0, holdItemIds: ["h1"] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects failedCount not matching failedItemIds length", () => {
    const forged = summary({ failedCount: 2, failedItemIds: ["f1"] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects total not matching acceptedCount + holdCount + failedCount", () => {
    const forged = summary({ total: 99 });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects a duplicate itemId within the same category", () => {
    const forged = summary({
      total: 4,
      acceptedCount: 2,
      acceptedItemIds: ["dup", "dup"]
    });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects a duplicate itemId across two different categories", () => {
    const forged = summary({ acceptedItemIds: ["shared"], holdItemIds: ["shared"] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });
});

describe("serializeFinalizedAgentCyclesSummary: malformed counts fail closed", () => {
  for (const badValue of [-1, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects total = ${String(badValue)}`, () => {
      expectRejection(() => serializeFinalizedAgentCyclesSummary(summary({ total: badValue })));
    });
  }

  it("rejects a non-number count", () => {
    const forged = { ...summary(), acceptedCount: "1" };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });
});

describe("serializeFinalizedAgentCyclesSummary: malformed itemId lists fail closed", () => {
  it("rejects a non-array itemId list", () => {
    const forged = { ...summary(), acceptedItemIds: "a1" };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a sparse itemId array", () => {
    const sparse: string[] = ["a1"];
    sparse[2] = "a3";
    const forged = summary({ acceptedCount: 3, acceptedItemIds: sparse });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects an itemId array with an extra own property", () => {
    const withExtra: string[] & { extra?: string } = ["a1"];
    withExtra.extra = "nope";
    const forged = { ...summary(), acceptedItemIds: withExtra };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects an empty itemId string", () => {
    const forged = summary({ acceptedItemIds: [""] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects a blank itemId string", () => {
    const forged = summary({ acceptedItemIds: ["   "] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects an itemId longer than the bound", () => {
    const forged = summary({ acceptedItemIds: ["x".repeat(65)] });

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged));
  });

  it("rejects a non-string itemId entry", () => {
    const forged = { ...summary(), acceptedItemIds: [123] };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
  });

  it("rejects a Proxy array whose getOwnPropertyDescriptor trap forges a huge length, without allocating proportional to it", () => {
    const target: string[] = ["a1"];
    const forged = new Proxy(target, {
      getOwnPropertyDescriptor(t, prop): PropertyDescriptor | undefined {
        if (prop === "length") {
          return { value: Number.MAX_SAFE_INTEGER, writable: true, enumerable: false, configurable: false };
        }
        return Object.getOwnPropertyDescriptor(t, prop);
      }
    });
    const forgedSummary = { ...summary(), acceptedItemIds: forged };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forgedSummary as unknown as FinalizedAgentCyclesSummary));
  });

  it("never invokes a get trap for length, even one forging a huge value, so the underlying real array is read safely instead", () => {
    let invoked = false;
    const target: string[] = ["a1"];
    const forged = new Proxy(target, {
      get(t, prop, receiver): unknown {
        if (prop === "length") {
          invoked = true;
          return Number.MAX_SAFE_INTEGER;
        }
        return Reflect.get(t, prop, receiver);
      }
    });
    const forgedSummary = summary({ acceptedCount: 1, acceptedItemIds: forged as unknown as string[] });

    const json = serializeFinalizedAgentCyclesSummary(forgedSummary);

    assert.equal(invoked, false);
    assert.equal(json, JSON.stringify(summary()));
  });
});

describe("serializeFinalizedAgentCyclesSummary: hostile getters and Proxy traps fail closed without leaking a secret", () => {
  it("fails closed when the summary's total getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_TOTAL_GETTER";
    const forged = {
      acceptedCount: 1,
      holdCount: 1,
      failedCount: 1,
      acceptedItemIds: ["a1"],
      holdItemIds: ["h1"],
      failedItemIds: ["f1"],
      get total(): never {
        throw new ContractValidationError("Forged", "total", secret);
      }
    };

    const error = expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when Reflect.ownKeys on the summary throws a forged value", () => {
    const secret = "SECRET_FROM_SUMMARY_OWN_KEYS_TRAP";
    const forged = new Proxy(summary(), {
      ownKeys(): never {
        throw new ContractValidationError("Forged", "ownKeys", secret);
      }
    });

    const error = expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when an itemId list's length descriptor lookup throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_LENGTH_PROXY";
    const forgedList = new Proxy(["a1"], {
      getOwnPropertyDescriptor(target, prop): PropertyDescriptor | undefined {
        if (prop === "length") throw new ContractValidationError("Forged", "length", secret);
        return Object.getOwnPropertyDescriptor(target, prop);
      }
    });
    const forged = { ...summary(), acceptedItemIds: forgedList };

    const error = expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.ok(!error.message.includes(secret));
  });

  it("never invokes an itemId list's length getter that throws a forged ContractValidationError via a get trap", () => {
    const secret = "SECRET_FROM_LENGTH_GET_TRAP";
    let invoked = false;
    const forgedList = new Proxy(["a1"], {
      get(target, prop, receiver): unknown {
        if (prop === "length") {
          invoked = true;
          throw new ContractValidationError("Forged", "length", secret);
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    const forged = summary({ acceptedItemIds: forgedList as unknown as string[] });

    const json = serializeFinalizedAgentCyclesSummary(forged);

    assert.equal(invoked, false);
    assert.equal(json, JSON.stringify(summary()));
  });

  it("fails closed when Reflect.ownKeys on an itemId list throws a forged value", () => {
    const secret = "SECRET_FROM_LIST_OWN_KEYS_TRAP";
    const forgedList = new Proxy(["a1"], {
      ownKeys(): never {
        throw new ContractValidationError("Forged", "ownKeys", secret);
      }
    });
    const forged = { ...summary(), acceptedItemIds: forgedList };

    const error = expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.ok(!error.message.includes(secret));
  });

  it("fails closed when an itemId entry getter throws a forged ContractValidationError", () => {
    const secret = "SECRET_FROM_ITEM_ID_GETTER";
    const forgedList: unknown[] = [];
    Object.defineProperty(forgedList, "0", {
      enumerable: true,
      get(): never {
        throw new ContractValidationError("Forged", "0", secret);
      }
    });
    Object.defineProperty(forgedList, "length", { value: 1, enumerable: false });
    const forged = { ...summary(), acceptedItemIds: forgedList };

    const error = expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.ok(!error.message.includes(secret));
  });
});

describe("serializeFinalizedAgentCyclesSummary: valid-looking accessor properties are never invoked", () => {
  it("rejects a total accessor without ever calling its getter, even though it returns a plausible value", () => {
    let invoked = false;
    const forged = {
      acceptedCount: 1,
      holdCount: 1,
      failedCount: 1,
      acceptedItemIds: ["a1"],
      holdItemIds: ["h1"],
      failedItemIds: ["f1"],
      get total(): number {
        invoked = true;
        return 3;
      }
    };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.equal(invoked, false);
  });

  it("rejects an itemId entry accessor without ever calling its getter, even though it returns a plausible value", () => {
    let invoked = false;
    const forgedList: unknown[] = [];
    Object.defineProperty(forgedList, "0", {
      enumerable: true,
      configurable: true,
      get(): string {
        invoked = true;
        return "a1";
      }
    });
    Object.defineProperty(forgedList, "length", { value: 1, enumerable: false });
    const forged = { ...summary(), acceptedItemIds: forgedList };

    expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));

    assert.equal(invoked, false);
  });

  it("never invokes a total getter that attempts to poison Object.prototype.toJSON before serialization runs", () => {
    const forged = {
      acceptedCount: 1,
      holdCount: 1,
      failedCount: 1,
      acceptedItemIds: ["a1"],
      holdItemIds: ["h1"],
      failedItemIds: ["f1"],
      get total(): number {
        (Object.prototype as unknown as Record<string, unknown>).toJSON = () => ({ poisoned: true });
        return 3;
      }
    };

    try {
      expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
      assert.equal((Object.prototype as unknown as Record<string, unknown>).toJSON, undefined);
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).toJSON;
    }
  });

  it("never invokes an itemId entry getter that attempts to poison Array.prototype.toJSON before serialization runs", () => {
    const forgedList: unknown[] = [];
    Object.defineProperty(forgedList, "0", {
      enumerable: true,
      configurable: true,
      get(): string {
        (Array.prototype as unknown as Record<string, unknown>).toJSON = () => ["poisoned"];
        return "a1";
      }
    });
    Object.defineProperty(forgedList, "length", { value: 1, enumerable: false });
    const forged = { ...summary(), acceptedItemIds: forgedList };

    try {
      expectRejection(() => serializeFinalizedAgentCyclesSummary(forged as unknown as FinalizedAgentCyclesSummary));
      assert.equal((Array.prototype as unknown as Record<string, unknown>).toJSON, undefined);
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>).toJSON;
    }
  });

  it("never invokes an itemId list's length get trap to poison Array.prototype.toJSON, even though the trap returns the correct length", () => {
    let invoked = false;
    const target: string[] = ["a1"];
    const forgedList = new Proxy(target, {
      get(t, prop, receiver): unknown {
        if (prop === "length") {
          invoked = true;
          (Array.prototype as unknown as Record<string, unknown>).toJSON = () => ["poisoned"];
          return Reflect.get(t, prop, receiver);
        }
        return Reflect.get(t, prop, receiver);
      }
    });
    const forged = summary({ acceptedItemIds: forgedList as unknown as string[] });

    try {
      const json = serializeFinalizedAgentCyclesSummary(forged);

      assert.equal(invoked, false);
      assert.equal((Array.prototype as unknown as Record<string, unknown>).toJSON, undefined);
      assert.equal(json, JSON.stringify(summary()));
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>).toJSON;
    }
  });

  it("never picks up a toJSON already poisoned onto Object.prototype/Array.prototype ahead of the call, unrelated to the input", () => {
    const expectedJson =
      '{"total":3,"acceptedCount":1,"holdCount":1,"failedCount":1,"acceptedItemIds":["a1"],"holdItemIds":["h1"],"failedItemIds":["f1"]}';
    (Object.prototype as unknown as Record<string, unknown>).toJSON = () => ({ poisoned: true });
    (Array.prototype as unknown as Record<string, unknown>).toJSON = () => ["poisoned"];

    try {
      const json = serializeFinalizedAgentCyclesSummary(summary());

      assert.equal(json, expectedJson);
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).toJSON;
      delete (Array.prototype as unknown as Record<string, unknown>).toJSON;
    }
  });
});

describe("serializeFinalizedAgentCyclesSummary: no mutation of the input", () => {
  it("does not mutate a plain, unfrozen input summary or its itemId lists", () => {
    const value = summary({
      total: 4,
      acceptedCount: 2,
      acceptedItemIds: ["a1", "a2"]
    });
    const before = jsonClone(value);

    serializeFinalizedAgentCyclesSummary(value);

    assert.deepEqual(jsonClone(value), before);
  });

  it("does not freeze the input summary", () => {
    const value = summary();

    serializeFinalizedAgentCyclesSummary(value);

    assert.ok(!Object.isFrozen(value));
  });

  it("accepts an already-frozen summary, as produced by summarizeFinalizedAgentCycles, unchanged", () => {
    const value = Object.freeze(summary());

    const json = serializeFinalizedAgentCyclesSummary(value);

    assert.equal(json, JSON.stringify(summary()));
  });
});
