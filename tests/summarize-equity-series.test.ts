import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import type { EquityPoint } from "../src/metrics/value-wallet-at.js";
import { summarizeEquitySeries } from "../src/metrics/summarize-equity-series.js";
import { MAX_MICROS } from "../src/money/fixed-point.js";

const T1 = "2026-09-17T18:00:00.000Z";
const T2 = "2026-09-17T18:01:00.000Z";
const T3 = "2026-09-17T18:02:00.000Z";
const T4 = "2026-09-17T18:03:00.000Z";
const T5 = "2026-09-17T18:04:00.000Z";

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

describe("single point series", () => {
  it("produces a FLAT P&L and zero drawdown", () => {
    const series = [point({ valuedAt: T1, equityMicros: 100_000_000n })];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.agentId, "trend-following");
    assert.equal(summary.startedAt, T1);
    assert.equal(summary.endedAt, T1);
    assert.equal(summary.pointCount, 1);
    assert.equal(summary.startingEquityMicros, 100_000_000n);
    assert.equal(summary.endingEquityMicros, 100_000_000n);
    assert.equal(summary.pnlDirection, "FLAT");
    assert.equal(summary.pnlMagnitudeMicros, 0n);
    assert.equal(summary.peakEquityMicros, 100_000_000n);
    assert.equal(summary.maxDrawdownMicros, 0n);
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T1);
  });
});

describe("gain", () => {
  it("reports GAIN with the exact magnitude", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 150_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.pnlDirection, "GAIN");
    assert.equal(summary.pnlMagnitudeMicros, 50_000_000n);
  });
});

describe("loss", () => {
  it("reports LOSS with the exact magnitude", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 150_000_000n }),
      point({ valuedAt: T2, equityMicros: 100_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.pnlDirection, "LOSS");
    assert.equal(summary.pnlMagnitudeMicros, 50_000_000n);
  });
});

describe("flat result", () => {
  it("reports FLAT when ending equity equals starting equity", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 100_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.pnlDirection, "FLAT");
    assert.equal(summary.pnlMagnitudeMicros, 0n);
    assert.equal(summary.maxDrawdownMicros, 0n);
  });
});

describe("new peak followed by a drawdown", () => {
  it("measures the drawdown from the new peak", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 150_000_000n }),
      point({ valuedAt: T3, equityMicros: 120_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.peakEquityMicros, 150_000_000n);
    assert.equal(summary.maxDrawdownMicros, 30_000_000n);
    assert.equal(summary.maxDrawdownPeakAt, T2);
    assert.equal(summary.maxDrawdownTroughAt, T3);
    assert.equal(summary.pnlDirection, "GAIN");
    assert.equal(summary.pnlMagnitudeMicros, 20_000_000n);
  });
});

describe("partial recovery", () => {
  it("keeps the deepest drawdown even after a partial recovery", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 150_000_000n }),
      point({ valuedAt: T2, equityMicros: 100_000_000n }),
      point({ valuedAt: T3, equityMicros: 120_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.peakEquityMicros, 150_000_000n);
    assert.equal(summary.maxDrawdownMicros, 50_000_000n);
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T2);
    assert.equal(summary.pnlDirection, "LOSS");
    assert.equal(summary.pnlMagnitudeMicros, 30_000_000n);
  });
});

describe("full recovery", () => {
  it("returns to FLAT P&L without erasing the historical max drawdown", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 150_000_000n }),
      point({ valuedAt: T2, equityMicros: 100_000_000n }),
      point({ valuedAt: T3, equityMicros: 150_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.pnlDirection, "FLAT");
    assert.equal(summary.pnlMagnitudeMicros, 0n);
    assert.equal(summary.peakEquityMicros, 150_000_000n);
    assert.equal(summary.maxDrawdownMicros, 50_000_000n);
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T2);
  });
});

describe("multiple drawdowns", () => {
  it("picks the largest drawdown across several episodes", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 90_000_000n }),
      point({ valuedAt: T3, equityMicros: 130_000_000n }),
      point({ valuedAt: T4, equityMicros: 80_000_000n }),
      point({ valuedAt: T5, equityMicros: 110_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.peakEquityMicros, 130_000_000n);
    assert.equal(summary.maxDrawdownMicros, 50_000_000n);
    assert.equal(summary.maxDrawdownPeakAt, T3);
    assert.equal(summary.maxDrawdownTroughAt, T4);
    assert.equal(summary.pnlDirection, "GAIN");
    assert.equal(summary.pnlMagnitudeMicros, 10_000_000n);
  });
});

describe("tie on maximum drawdown", () => {
  it("keeps the first chronological episode", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 80_000_000n }),
      point({ valuedAt: T3, equityMicros: 100_000_000n }),
      point({ valuedAt: T4, equityMicros: 80_000_000n })
    ];

    const summary = summarizeEquitySeries(series);

    assert.equal(summary.maxDrawdownMicros, 20_000_000n);
    assert.equal(summary.maxDrawdownPeakAt, T1);
    assert.equal(summary.maxDrawdownTroughAt, T2);
  });
});

describe("fail-closed input rules", () => {
  it("rejects an empty list", () => {
    assert.throws(() => summarizeEquitySeries([]), ContractValidationError);
  });

  it("rejects points from mixed agents", () => {
    const series = [
      point({ agentId: "trend-following", valuedAt: T1 }),
      point({ agentId: "momentum", valuedAt: T2 })
    ];

    assert.throws(() => summarizeEquitySeries(series), ContractValidationError);
  });

  it("rejects a duplicate timestamp", () => {
    const series = [point({ valuedAt: T1 }), point({ valuedAt: T1 })];

    assert.throws(() => summarizeEquitySeries(series), ContractValidationError);
  });

  it("rejects out-of-order timestamps", () => {
    const series = [point({ valuedAt: T2 }), point({ valuedAt: T1 })];

    assert.throws(() => summarizeEquitySeries(series), ContractValidationError);
  });

  it("rejects a non-canonical timestamp", () => {
    const series = [point({ valuedAt: "2026-09-17T18:00:00Z" })];

    assert.throws(() => summarizeEquitySeries(series), ContractValidationError);
  });

  it("rejects a negative equity value", () => {
    const series = [point({ equityMicros: -1n })];

    assert.throws(() => summarizeEquitySeries(series), ContractValidationError);
  });

  it("rejects an equity value above the sanity bound", () => {
    const series = [point({ equityMicros: MAX_MICROS + 1n })];

    assert.throws(() => summarizeEquitySeries(series), ContractValidationError);
  });
});

describe("immutability", () => {
  it("freezes the returned EquitySeriesSummary", () => {
    const series = [point({ valuedAt: T1 })];

    const summary = summarizeEquitySeries(series);

    assert.ok(Object.isFrozen(summary));
  });

  it("does not mutate the points passed in", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 150_000_000n })
    ];
    const before = series.map((p) => ({ agentId: p.agentId, valuedAt: p.valuedAt, equityMicros: p.equityMicros }));

    summarizeEquitySeries(series);

    const after = series.map((p) => ({ agentId: p.agentId, valuedAt: p.valuedAt, equityMicros: p.equityMicros }));
    assert.deepEqual(after, before);
  });
});

describe("determinism", () => {
  it("produces an identical summary for the same canonical input", () => {
    const series = [
      point({ valuedAt: T1, equityMicros: 100_000_000n }),
      point({ valuedAt: T2, equityMicros: 80_000_000n }),
      point({ valuedAt: T3, equityMicros: 130_000_000n })
    ];

    const first = summarizeEquitySeries(series);
    const second = summarizeEquitySeries(series);

    assert.deepEqual(first, second);
  });
});
