import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildBuyAndHoldBenchmark } from "../src/benchmark/build-buy-and-hold-benchmark.js";
import { AT, COSTED_POLICY, FREE_POLICY, LATER, SCALE, START_CASH_MICROS } from "./support/fixtures.js";

/** One instant strictly between `AT` and `LATER`. */
const MID = "2026-09-17T18:07:00.000Z";

interface SnapshotOverrides {
  readonly schemaVersion?: unknown;
  readonly snapshotId?: unknown;
  readonly source?: unknown;
  readonly asset?: unknown;
  readonly quote?: unknown;
  readonly asOf?: unknown;
  readonly availableAt?: unknown;
  readonly price?: unknown;
  readonly spreadBps?: unknown;
  readonly complete?: unknown;
}

function snapshotFor(overrides: SnapshotOverrides = {}): Record<string, unknown> {
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

describe("single purchase at the first instant", () => {
  it("buys once at the first decisionAt and holds the position, frictionless", () => {
    const raw = snapshotFor({ snapshotId: "at-open" });

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      FREE_POLICY
    );

    assert.equal(benchmark.kind, "BUY_AND_HOLD");
    assert.equal(benchmark.agentId, "trend-following");
    assert.equal(benchmark.asset, "ACME");
    assert.equal(benchmark.quote, "USD");
    assert.equal(benchmark.initialCashMicros, START_CASH_MICROS);
    assert.equal(benchmark.initialFill.type, "FILL");
    assert.equal(benchmark.initialFill.side, "BUY");
    assert.equal(benchmark.initialFill.occurredAt, AT);
    assert.equal(benchmark.initialFill.quantityAtoms, 1_000n);
    assert.equal(benchmark.walletAfterPurchase.cashMicros, 0n);
    assert.equal(benchmark.walletAfterPurchase.positions.length, 1);
    assert.equal(benchmark.walletAfterPurchase.positions[0]?.quantityAtoms, 1_000n);
    assert.equal(benchmark.points.length, 1);
    assert.equal(benchmark.points[0]?.equityMicros, START_CASH_MICROS);
    assert.equal(benchmark.summary.pointCount, 1);
  });
});

describe("fill incorporates cost", () => {
  it("charges fee, spread and slippage on the initial purchase, exactly as PaperBroker would", () => {
    const raw = snapshotFor();

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      COSTED_POLICY
    );

    assert.equal(benchmark.initialFill.quantityAtoms, 980n);
    assert.equal(benchmark.initialFill.grossMicros, 98_980_000n);
    assert.equal(benchmark.initialFill.feeMicros, 989_800n);
    assert.equal(benchmark.initialFill.totalMicros, 99_969_800n);
    assert.equal(benchmark.walletAfterPurchase.cashMicros, START_CASH_MICROS - 99_969_800n);
  });

  it("reflects the initial purchase cost in the very first equity point", () => {
    const raw = snapshotFor();

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      COSTED_POLICY
    );

    // 980 atoms marked back at the US$10 reference price: 98_000_000 micros of
    // position value, plus the leftover cash of 30_200 micros — strictly less
    // than the US$100 started with, because the spread and fee were paid.
    assert.equal(benchmark.points[0]?.equityMicros, 98_030_200n);
    assert.ok((benchmark.points[0]?.equityMicros as bigint) < START_CASH_MICROS);
  });
});

describe("mark-to-market direction follows price", () => {
  it("increases equity when the later price is higher", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "up", price: 12, availableAt: LATER })
    ];

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      FREE_POLICY
    );

    assert.equal(benchmark.points[0]?.equityMicros, 100_000_000n);
    assert.equal(benchmark.points[1]?.equityMicros, 120_000_000n);
    assert.equal(benchmark.summary.pnlDirection, "GAIN");
  });

  it("decreases equity when the later price is lower", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "down", price: 8, availableAt: LATER })
    ];

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      FREE_POLICY
    );

    assert.equal(benchmark.points[0]?.equityMicros, 100_000_000n);
    assert.equal(benchmark.points[1]?.equityMicros, 80_000_000n);
    assert.equal(benchmark.summary.pnlDirection, "LOSS");
  });
});

describe("no look-ahead across valuation points", () => {
  it("only picks up a newer snapshot once it has actually become available", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "later", price: 12, availableAt: LATER })
    ];

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, MID, LATER],
      FREE_POLICY
    );

    assert.deepEqual(
      benchmark.points.map((point) => point.equityMicros),
      [100_000_000n, 100_000_000n, 120_000_000n]
    );
    assert.deepEqual(
      benchmark.series.map((point) => point.snapshot.snapshotId),
      ["open", "open", "later"]
    );
  });
});

describe("boundary at decisionAt", () => {
  it("accepts a snapshot available exactly at the first decisionAt", () => {
    const raw = snapshotFor({ availableAt: AT });

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      [raw],
      "ACME",
      "USD",
      SCALE,
      [AT],
      FREE_POLICY
    );

    assert.equal(benchmark.initialFill.occurredAt, AT);
  });
});

describe("fail-closed input rules", () => {
  it("rejects a quote other than USD", () => {
    const raw = snapshotFor({ quote: "EUR" });

    assert.throws(
      () =>
        buildBuyAndHoldBenchmark(
          "trend-following",
          START_CASH_MICROS,
          [raw],
          "ACME",
          "EUR",
          SCALE,
          [AT],
          FREE_POLICY
        ),
      ContractValidationError
    );
  });

  it("rejects a series with no eligible snapshot", () => {
    const raw = snapshotFor({ availableAt: LATER });

    assert.throws(
      () =>
        buildBuyAndHoldBenchmark(
          "trend-following",
          START_CASH_MICROS,
          [raw],
          "ACME",
          "USD",
          SCALE,
          [AT],
          FREE_POLICY
        ),
      ContractValidationError
    );
  });

  it("rejects an empty decisionTimes collection", () => {
    assert.throws(
      () =>
        buildBuyAndHoldBenchmark(
          "trend-following",
          START_CASH_MICROS,
          [],
          "ACME",
          "USD",
          SCALE,
          [],
          FREE_POLICY
        ),
      ContractValidationError
    );
  });

  it("rejects an invalid execution policy", () => {
    const raw = snapshotFor();

    assert.throws(
      () =>
        buildBuyAndHoldBenchmark(
          "trend-following",
          START_CASH_MICROS,
          [raw],
          "ACME",
          "USD",
          SCALE,
          [AT],
          { ...FREE_POLICY, feeBps: -1 }
        ),
      ContractValidationError
    );
  });

  it("rejects zero initial cash as a broker rejection (insufficient cash)", () => {
    const raw = snapshotFor();

    assert.throws(
      () =>
        buildBuyAndHoldBenchmark(
          "trend-following",
          0n,
          [raw],
          "ACME",
          "USD",
          SCALE,
          [AT],
          FREE_POLICY
        ),
      ContractValidationError
    );
  });

  it("rejects a quantity too small for the broker to fill", () => {
    const raw = snapshotFor({ price: 1_000_000 });

    assert.throws(
      () =>
        buildBuyAndHoldBenchmark(
          "trend-following",
          1n,
          [raw],
          "ACME",
          "USD",
          SCALE,
          [AT],
          FREE_POLICY
        ),
      ContractValidationError
    );
  });
});

describe("no final sale", () => {
  it("never sells: the held quantity is identical at every point", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "later", price: 12, availableAt: LATER })
    ];

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      FREE_POLICY
    );

    const quantities = benchmark.points.map((point) => point.positions[0]?.quantityAtoms);
    assert.deepEqual(quantities, [1_000n, 1_000n]);
    assert.equal(benchmark.walletAfterPurchase.positions[0]?.quantityAtoms, 1_000n);
  });
});

describe("exactly one fill and no other order", () => {
  it("produces a single fill whose cost accounts for the entire starting cash under COSTED_POLICY", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "later", price: 10, availableAt: LATER })
    ];

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      COSTED_POLICY
    );

    assert.equal(benchmark.initialFill.quantityAtoms, 980n);
    assert.equal(
      benchmark.walletAfterPurchase.cashMicros,
      START_CASH_MICROS - benchmark.initialFill.totalMicros
    );
    // Held quantity is unchanged at the later point too: no second order ran.
    assert.equal(benchmark.points[1]?.positions[0]?.quantityAtoms, 980n);
  });
});

describe("no mutation of input", () => {
  it("does not mutate the snapshot collection, decisionTimes or the execution policy", () => {
    const raws = [snapshotFor({ snapshotId: "open" })];
    const rawsBefore = raws.map((entry) => ({ ...entry }));
    const decisionTimes = [AT];
    const decisionTimesBefore = [...decisionTimes];
    const policy = { ...FREE_POLICY };
    const policyBefore = { ...policy };

    buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      decisionTimes,
      policy
    );

    assert.deepEqual(raws, rawsBefore);
    assert.deepEqual(decisionTimes, decisionTimesBefore);
    assert.deepEqual(policy, policyBefore);
  });
});

describe("immutability of the result", () => {
  it("freezes the result and every nested collection and object", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "later", price: 12, availableAt: LATER })
    ];

    const benchmark = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      FREE_POLICY
    );

    assert.ok(Object.isFrozen(benchmark));
    assert.ok(Object.isFrozen(benchmark.executionPolicy));
    assert.ok(Object.isFrozen(benchmark.initialFill));
    assert.ok(Object.isFrozen(benchmark.walletAfterPurchase));
    assert.ok(Object.isFrozen(benchmark.walletAfterPurchase.positions));
    assert.ok(Object.isFrozen(benchmark.series));
    assert.ok(Object.isFrozen(benchmark.points));
    for (const point of benchmark.points) {
      assert.ok(Object.isFrozen(point));
    }
  });
});

describe("determinism", () => {
  it("produces an identical benchmark for the same canonical input", () => {
    const raws = [
      snapshotFor({ snapshotId: "open", price: 10, availableAt: AT }),
      snapshotFor({ snapshotId: "later", price: 12, availableAt: LATER })
    ];

    const first = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      COSTED_POLICY
    );
    const second = buildBuyAndHoldBenchmark(
      "trend-following",
      START_CASH_MICROS,
      raws,
      "ACME",
      "USD",
      SCALE,
      [AT, LATER],
      COSTED_POLICY
    );

    assert.deepEqual(first, second);
  });
});
