import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildBuyAndHoldBenchmark } from "../src/benchmark/build-buy-and-hold-benchmark.js";
import { buildCashBenchmark } from "../src/benchmark/build-cash-benchmark.js";
import { compareBuyAndHoldToCash } from "../src/benchmark/compare-buy-and-hold-to-cash.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";
import { AT, COSTED_POLICY, FREE_POLICY, LATER, SCALE, START_CASH_MICROS } from "./support/fixtures.js";

/** One instant strictly between `AT` and `LATER`. */
const MID = "2026-09-17T18:07:00.000Z";

const AGENT_ID = "trend-following";

function snapshotFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const availableAt = overrides.availableAt ?? AT;
  return {
    schemaVersion: 1,
    snapshotId: "snap-1",
    source: "fixture",
    asset: "ACME",
    quote: "USD",
    asOf: availableAt,
    availableAt,
    price: 10,
    spreadBps: 0,
    complete: true,
    ...overrides
  };
}

/** Buy-and-hold benchmark over `[AT, LATER]`, price rising 10 -> `endPrice`, frictionless. */
function buyAndHoldOverAtLater(endPrice: number, agentId = AGENT_ID) {
  const raws = [
    snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
    snapshotFor({ snapshotId: "close", price: endPrice, availableAt: LATER })
  ];
  return buildBuyAndHoldBenchmark(
    agentId,
    START_CASH_MICROS,
    raws,
    "ACME",
    "USD",
    SCALE,
    [AT, LATER],
    FREE_POLICY
  );
}

function cashOverAtLater(initialCashMicros = START_CASH_MICROS, agentId = AGENT_ID) {
  return buildCashBenchmark(agentId, initialCashMicros, [AT, LATER]);
}

describe("buy-and-hold outperforms cash", () => {
  it("reports OUTPERFORMED with the exact positive difference", () => {
    const comparison = compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), cashOverAtLater());

    assert.equal(comparison.comparisonKind, "BUY_AND_HOLD_VS_CASH");
    assert.equal(comparison.agentId, AGENT_ID);
    assert.equal(comparison.startedAt, AT);
    assert.equal(comparison.endedAt, LATER);
    assert.equal(comparison.pointCount, 2);
    assert.equal(comparison.initialCashMicros, START_CASH_MICROS);
    assert.equal(comparison.buyAndHoldEndingEquityMicros, 120_000_000n);
    assert.equal(comparison.cashEndingEquityMicros, 100_000_000n);
    assert.equal(comparison.result, "OUTPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 20_000_000n);
  });
});

describe("buy-and-hold loses to cash", () => {
  it("reports UNDERPERFORMED with the exact positive difference", () => {
    const comparison = compareBuyAndHoldToCash(buyAndHoldOverAtLater(8), cashOverAtLater());

    assert.equal(comparison.buyAndHoldEndingEquityMicros, 80_000_000n);
    assert.equal(comparison.cashEndingEquityMicros, 100_000_000n);
    assert.equal(comparison.result, "UNDERPERFORMED");
    assert.equal(comparison.differenceMagnitudeMicros, 20_000_000n);
  });
});

describe("tie", () => {
  it("reports TIED with zero difference when ending equities are equal", () => {
    const comparison = compareBuyAndHoldToCash(buyAndHoldOverAtLater(10), cashOverAtLater());

    assert.equal(comparison.result, "TIED");
    assert.equal(comparison.differenceMagnitudeMicros, 0n);
  });
});

describe("entry costs below starting capital", () => {
  it("accepts a first buy-and-hold equity point below initial cash, from entry costs", () => {
    const raw = snapshotFor();
    const buyAndHold = buildBuyAndHoldBenchmark(
      AGENT_ID,
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      COSTED_POLICY
    );
    const cash = buildCashBenchmark(AGENT_ID, START_CASH_MICROS, [AT]);

    assert.ok(buyAndHold.points[0]!.equityMicros < START_CASH_MICROS);

    const comparison = compareBuyAndHoldToCash(buyAndHold, cash);

    assert.equal(comparison.result, "UNDERPERFORMED");
    assert.equal(comparison.buyAndHoldEndingEquityMicros, 98_030_200n);
    assert.equal(comparison.cashEndingEquityMicros, START_CASH_MICROS);
    assert.equal(comparison.differenceMagnitudeMicros, 1_969_800n);
  });
});

describe("fail-closed on forged kind", () => {
  it("rejects a buy-and-hold benchmark with a forged kind", () => {
    const benchmark = { ...buyAndHoldOverAtLater(12), kind: "FORGED" as unknown as "BUY_AND_HOLD" };
    assert.throws(() => compareBuyAndHoldToCash(benchmark, cashOverAtLater()), ContractValidationError);
  });

  it("rejects a cash benchmark with a forged kind", () => {
    const benchmark = { ...cashOverAtLater(), kind: "FORGED" as unknown as "CASH" };
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), benchmark), ContractValidationError);
  });
});

describe("fail-closed on incompatible or internally inconsistent agentId", () => {
  it("rejects a different agentId between the two benchmarks", () => {
    const cash = cashOverAtLater(START_CASH_MICROS, "momentum");
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), cash), ContractValidationError);
  });

  it("rejects a buy-and-hold benchmark whose internal summary.agentId diverges from its own agentId", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, summary: { ...buyAndHold.summary, agentId: "momentum" } };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });

  it("rejects a cash benchmark whose internal summary.agentId diverges from its own agentId", () => {
    const cash = cashOverAtLater();
    const forged = { ...cash, summary: { ...cash.summary, agentId: "momentum" } };
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), forged), ContractValidationError);
  });
});

describe("fail-closed on different initial capital", () => {
  it("rejects a cash benchmark funded with a different initialCashMicros", () => {
    const cash = cashOverAtLater(200_000_000n);
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), cash), ContractValidationError);
  });
});

describe("fail-closed on different window or point count", () => {
  it("rejects a different pointCount between the two benchmarks", () => {
    const cash = buildCashBenchmark(AGENT_ID, START_CASH_MICROS, [AT]);
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), cash), ContractValidationError);
  });

  it("rejects a different endedAt between the two benchmarks", () => {
    const raw = snapshotFor({ snapshotId: "open", price: 10, availableAt: AT });
    const buyAndHold = buildBuyAndHoldBenchmark(
      AGENT_ID,
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT, MID],
      FREE_POLICY
    );
    assert.throws(() => compareBuyAndHoldToCash(buyAndHold, cashOverAtLater()), ContractValidationError);
  });
});

describe("fail-closed on internally inconsistent cash benchmark", () => {
  it("rejects a cash benchmark whose starting equity diverges from initialCashMicros", () => {
    const cash = cashOverAtLater();
    const forged = { ...cash, summary: { ...cash.summary, startingEquityMicros: 90_000_000n } };
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), forged), ContractValidationError);
  });

  it("rejects a cash benchmark whose ending equity diverges from initialCashMicros", () => {
    const cash = cashOverAtLater();
    const forged = { ...cash, summary: { ...cash.summary, endingEquityMicros: 90_000_000n } };
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), forged), ContractValidationError);
  });
});

describe("fail-closed on inconsistent buy-and-hold initial fill", () => {
  it("rejects an initial fill that is not a BUY", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, side: "SELL" as const }
    };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });

  it("rejects an initial fill whose agentId diverges from the benchmark's agentId", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, agentId: "momentum" }
    };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });

  it("rejects an initial fill whose asset diverges from the benchmark's asset", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, asset: "OTHER" }
    };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });

  it("rejects an initial fill whose quote diverges from the benchmark's quote", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = {
      ...buyAndHold,
      initialFill: { ...buyAndHold.initialFill, quote: "EUR" }
    };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });

  it("rejects a buy-and-hold benchmark whose last point diverges from its own summary.endingEquityMicros", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, summary: { ...buyAndHold.summary, endingEquityMicros: 999_000_000n } };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });
});

describe("fail-closed on invalid monetary values", () => {
  it("rejects a forged non-bigint initialCashMicros", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, initialCashMicros: "100000000" as unknown as bigint };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });

  it("rejects a forged negative ending equity", () => {
    const cash = cashOverAtLater();
    const forged = { ...cash, summary: { ...cash.summary, endingEquityMicros: -1n } };
    assert.throws(() => compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), forged), ContractValidationError);
  });

  it("rejects a forged ending equity above the sanity bound", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const forged = { ...buyAndHold, summary: { ...buyAndHold.summary, endingEquityMicros: MAX_MICROS + 1n } };
    assert.throws(() => compareBuyAndHoldToCash(forged, cashOverAtLater()), ContractValidationError);
  });
});

describe("immutability", () => {
  it("freezes the returned comparison", () => {
    const comparison = compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), cashOverAtLater());
    assert.ok(Object.isFrozen(comparison));
  });

  it("does not mutate the inputs", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const cash = cashOverAtLater();
    const buyAndHoldBefore = { ...buyAndHold };
    const cashBefore = { ...cash };

    compareBuyAndHoldToCash(buyAndHold, cash);

    assert.deepEqual(buyAndHold, buyAndHoldBefore);
    assert.deepEqual(cash, cashBefore);
  });
});

describe("determinism", () => {
  it("produces an identical comparison for the same canonical input", () => {
    const buyAndHold = buyAndHoldOverAtLater(12);
    const cash = cashOverAtLater();

    const first = compareBuyAndHoldToCash(buyAndHold, cash);
    const second = compareBuyAndHoldToCash(buyAndHold, cash);

    assert.deepEqual(first, second);
  });
});

describe("offline", () => {
  it("uses only injected data, with no clock, network or randomness", () => {
    const comparison = compareBuyAndHoldToCash(buyAndHoldOverAtLater(12), cashOverAtLater());

    assert.equal(typeof comparison.buyAndHoldEndingEquityMicros, "bigint");
    assert.equal(typeof comparison.cashEndingEquityMicros, "bigint");
    assert.equal(typeof comparison.differenceMagnitudeMicros, "bigint");
  });
});
