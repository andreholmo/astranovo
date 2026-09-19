import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildCashBenchmark } from "../src/benchmark/build-cash-benchmark.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";

const T1 = "2026-09-17T18:00:00.000Z";
const T2 = "2026-09-17T18:01:00.000Z";
const T3 = "2026-09-17T18:02:00.000Z";

/** Fictitious US$100, matching the fixture budget used across the repo. */
const CASH_100 = 100_000_000n;

describe("single instant", () => {
  it("produces one flat point equal to the fictitious US$100 initial cash", () => {
    const benchmark = buildCashBenchmark("trend-following", CASH_100, [T1]);

    assert.equal(benchmark.kind, "CASH");
    assert.equal(benchmark.agentId, "trend-following");
    assert.equal(benchmark.initialCashMicros, CASH_100);
    assert.equal(benchmark.points.length, 1);
    assert.equal(benchmark.points[0]?.valuedAt, T1);
    assert.equal(benchmark.points[0]?.cashMicros, CASH_100);
    assert.equal(benchmark.points[0]?.equityMicros, CASH_100);
    assert.deepEqual(benchmark.points[0]?.positions, []);
    assert.deepEqual(benchmark.points[0]?.snapshotIds, []);
    assert.equal(benchmark.summary.pnlDirection, "FLAT");
    assert.equal(benchmark.summary.pnlMagnitudeMicros, 0n);
    assert.equal(benchmark.summary.maxDrawdownMicros, 0n);
  });
});

describe("several instants", () => {
  it("keeps cash and equity constant at every point, aligned to the given timestamps", () => {
    const benchmark = buildCashBenchmark("trend-following", CASH_100, [T1, T2, T3]);

    assert.equal(benchmark.points.length, 3);
    assert.deepEqual(benchmark.points.map((point) => point.valuedAt), [T1, T2, T3]);
    for (const point of benchmark.points) {
      assert.equal(point.cashMicros, CASH_100);
      assert.equal(point.equityMicros, CASH_100);
      assert.deepEqual(point.positions, []);
      assert.deepEqual(point.snapshotIds, []);
    }

    assert.equal(benchmark.summary.pointCount, 3);
    assert.equal(benchmark.summary.startingEquityMicros, CASH_100);
    assert.equal(benchmark.summary.endingEquityMicros, CASH_100);
    assert.equal(benchmark.summary.pnlDirection, "FLAT");
    assert.equal(benchmark.summary.pnlMagnitudeMicros, 0n);
    assert.equal(benchmark.summary.maxDrawdownMicros, 0n);
  });
});

describe("fail-closed input rules", () => {
  it("rejects an empty timestamp list", () => {
    assert.throws(() => buildCashBenchmark("trend-following", CASH_100, []), ContractValidationError);
  });

  it("rejects a duplicate timestamp", () => {
    assert.throws(() => buildCashBenchmark("trend-following", CASH_100, [T1, T1]), ContractValidationError);
  });

  it("rejects out-of-order timestamps", () => {
    assert.throws(() => buildCashBenchmark("trend-following", CASH_100, [T2, T1]), ContractValidationError);
  });

  it("rejects a non-canonical timestamp", () => {
    assert.throws(
      () => buildCashBenchmark("trend-following", CASH_100, ["2026-09-17T18:00:00Z"]),
      ContractValidationError
    );
  });

  it("rejects negative initial cash", () => {
    assert.throws(() => buildCashBenchmark("trend-following", -1n, [T1]), ContractValidationError);
  });

  it("rejects an initial cash of the wrong type", () => {
    assert.throws(
      () => buildCashBenchmark("trend-following", "100000000" as unknown as bigint, [T1]),
      ContractValidationError
    );
  });

  it("rejects initial cash above the sanity bound", () => {
    assert.throws(
      () => buildCashBenchmark("trend-following", MAX_MICROS + 1n, [T1]),
      ContractValidationError
    );
  });
});

describe("agent isolation", () => {
  it("keeps two agents' benchmarks independent", () => {
    const benchmarkA = buildCashBenchmark("trend-following", 100_000_000n, [T1, T2]);
    const benchmarkB = buildCashBenchmark("momentum", 250_000_000n, [T1, T2]);

    assert.equal(benchmarkA.agentId, "trend-following");
    assert.equal(benchmarkB.agentId, "momentum");
    assert.equal(benchmarkA.initialCashMicros, 100_000_000n);
    assert.equal(benchmarkB.initialCashMicros, 250_000_000n);
    assert.equal(benchmarkA.points[0]?.equityMicros, 100_000_000n);
    assert.equal(benchmarkB.points[0]?.equityMicros, 250_000_000n);
  });
});

describe("immutability", () => {
  it("freezes the benchmark, its points and their collections", () => {
    const benchmark = buildCashBenchmark("trend-following", CASH_100, [T1, T2]);

    assert.ok(Object.isFrozen(benchmark));
    assert.ok(Object.isFrozen(benchmark.points));
    for (const point of benchmark.points) {
      assert.ok(Object.isFrozen(point));
      assert.ok(Object.isFrozen(point.positions));
      assert.ok(Object.isFrozen(point.snapshotIds));
    }
    assert.ok(Object.isFrozen(benchmark.summary));
  });

  it("does not mutate the timestamp collection passed in", () => {
    const valuedAt = [T1, T2, T3];
    const before = [...valuedAt];

    buildCashBenchmark("trend-following", CASH_100, valuedAt);

    assert.deepEqual(valuedAt, before);
  });
});

describe("determinism", () => {
  it("produces an identical benchmark for the same canonical input", () => {
    const first = buildCashBenchmark("trend-following", CASH_100, [T1, T2, T3]);
    const second = buildCashBenchmark("trend-following", CASH_100, [T1, T2, T3]);

    assert.deepEqual(first, second);
  });
});
