import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import type { EquityPoint } from "../src/metrics/value-wallet-at.js";
import { summarizeDrawdownRate } from "../src/metrics/summarize-drawdown-rate.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";

const T1 = "2026-09-17T18:00:00.000Z";
const T2 = "2026-09-17T18:01:00.000Z";
const T3 = "2026-09-17T18:02:00.000Z";
const T4 = "2026-09-17T18:03:00.000Z";

interface PointOverrides {
  readonly agentId?: string;
  readonly valuedAt?: string;
  readonly equityMicros?: bigint;
}

/** A minimal, hand-checkable `EquityPoint`; only agentId/valuedAt/equityMicros matter here. */
function point(overrides: PointOverrides = {}): EquityPoint {
  return Object.freeze({
    agentId: "trend-following",
    valuedAt: T1,
    cashMicros: 0n,
    positions: Object.freeze([]),
    positionsValueMicros: 0n,
    equityMicros: 100_000_000n,
    snapshotIds: Object.freeze([]),
    ...overrides
  });
}

describe("zero drawdown", () => {
  it("returns maxDrawdownBps 0 for a strictly increasing series", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 150_000_000n }),
      point({ valuedAt: T3, equityMicros: 200_000_000n })
    ];

    const summary = summarizeDrawdownRate(series);

    assert.equal(summary.agentId, "trend-following");
    assert.equal(summary.startedAt, T1);
    assert.equal(summary.endedAt, T3);
    assert.equal(summary.pointCount, 3);
    assert.equal(summary.maxDrawdownMicros, 0n);
    assert.equal(summary.maxDrawdownPeakEquityMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T1);
    assert.equal(summary.maxDrawdownBps, 0);
    assert.equal(summary.rounding, "FLOOR");
  });
});

describe("100% drawdown", () => {
  it("returns maxDrawdownBps 10_000 when equity falls to zero", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 0n })
    ];

    const summary = summarizeDrawdownRate(series);

    assert.equal(summary.maxDrawdownMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownPeakEquityMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownBps, 10_000);
  });
});

describe("fractional drawdown", () => {
  it("floors the basis-point ratio instead of rounding", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 300_000_000n }),
      point({ valuedAt: T2, equityMicros: 200_000_000n })
    ];

    const summary = summarizeDrawdownRate(series);

    // 100_000_000 / 300_000_000 = 33.333...% → floor(3333.33...) bps = 3333, not 3334.
    assert.equal(summary.maxDrawdownMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownBps, 3_333);
  });
});

describe("correct peak when it is not the overall final peak", () => {
  it("uses the peak the largest drawdown actually fell from", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 50_000_000n }),
      point({ valuedAt: T3, equityMicros: 1_000_000_000n }),
      point({ valuedAt: T4, equityMicros: 990_000_000n })
    ];

    const summary = summarizeDrawdownRate(series);

    // The largest absolute drawdown (50_000_000) fell from the T1 peak
    // (100_000_000), not from the higher, later T3 peak (1_000_000_000) that
    // only produced a much smaller absolute drawdown (10_000_000).
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownPeakEquityMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownMicros, 50_000_000n);
    assert.equal(summary.maxDrawdownBps, 5_000);
  });
});

describe("recovery after the trough", () => {
  it("preserves the evidence of the largest drawdown", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 150_000_000n }),
      point({ valuedAt: T2, equityMicros: 100_000_000n }),
      point({ valuedAt: T3, equityMicros: 150_000_000n })
    ];

    const summary = summarizeDrawdownRate(series);

    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T2);
    assert.equal(summary.maxDrawdownPeakEquityMicros, 150_000_000n);
    assert.equal(summary.maxDrawdownMicros, 50_000_000n);
    assert.equal(summary.maxDrawdownBps, 3_333);
  });
});

describe("single-point series", () => {
  it("returns zero drawdown and bps for one point", () => {
    const series = [point({ valuedAt: T1, equityMicros: 100_000_000n })];

    const summary = summarizeDrawdownRate(series);

    assert.equal(summary.pointCount, 1);
    assert.equal(summary.startedAt, T1);
    assert.equal(summary.endedAt, T1);
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T1);
    assert.equal(summary.maxDrawdownPeakEquityMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownMicros, 0n);
    assert.equal(summary.maxDrawdownBps, 0);
  });
});

describe("fail-closed input rules delegated to summarizeEquitySeries", () => {
  it("rejects an empty collection", () => {
    assert.throws(() => summarizeDrawdownRate([]), ContractValidationError);
  });

  it("rejects points from mixed agents", () => {
    const series = [
      point({ agentId: "trend-following", valuedAt: T1 }),
      point({ agentId: "momentum", valuedAt: T2 })
    ];

    assert.throws(() => summarizeDrawdownRate(series), ContractValidationError);
  });

  it("rejects a non-canonical timestamp", () => {
    const series = [point({ valuedAt: "2026-09-17T18:00:00Z" })];

    assert.throws(() => summarizeDrawdownRate(series), ContractValidationError);
  });

  it("rejects out-of-order timestamps", () => {
    const series = [point({ valuedAt: T2 }), point({ valuedAt: T1 })];

    assert.throws(() => summarizeDrawdownRate(series), ContractValidationError);
  });

  it("rejects invalid money (negative equity)", () => {
    const series = [point({ equityMicros: -1n })];

    assert.throws(() => summarizeDrawdownRate(series), ContractValidationError);
  });

  it("rejects invalid money (equity above the sanity bound)", () => {
    const series = [point({ equityMicros: MAX_MICROS + 1n })];

    assert.throws(() => summarizeDrawdownRate(series), ContractValidationError);
  });
});

describe("immutability", () => {
  it("freezes the returned DrawdownRateSummary", () => {
    const series = [point({ valuedAt: T1 })];

    const summary = summarizeDrawdownRate(series);

    assert.ok(Object.isFrozen(summary));
  });

  it("does not mutate the points passed in", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 50_000_000n })
    ];
    const before = series.map((p) => ({ agentId: p.agentId, valuedAt: p.valuedAt, equityMicros: p.equityMicros }));

    summarizeDrawdownRate(series);

    const after = series.map((p) => ({ agentId: p.agentId, valuedAt: p.valuedAt, equityMicros: p.equityMicros }));
    assert.deepEqual(after, before);
  });
});

describe("determinism", () => {
  it("produces an identical summary for the same canonical input", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 50_000_000n }),
      point({ valuedAt: T3, equityMicros: 1_000_000_000n })
    ];

    const first = summarizeDrawdownRate(series);
    const second = summarizeDrawdownRate(series);

    assert.deepEqual(first, second);
  });
});
