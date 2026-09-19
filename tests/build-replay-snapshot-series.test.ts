import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { buildReplaySnapshotSeries } from "../src/replay/build-replay-snapshot-series.js";
import { AT, LATER } from "./support/fixtures.js";

/** One instant before `AT`, hand-checkable alongside the fixtures' `AT`/`LATER`. */
const EARLIER = "2026-09-17T17:30:00.000Z";
/** One instant before `EARLIER`. */
const EARLIEST = "2026-09-17T17:00:00.000Z";
/** One instant after `LATER`. */
const EVEN_LATER = "2026-09-17T18:30:00.000Z";

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

function snapshotFor(
  asset: string,
  quote: string,
  overrides: SnapshotOverrides = {}
): Record<string, unknown> {
  const availableAt = overrides.availableAt ?? AT;
  return {
    schemaVersion: 1,
    snapshotId: "snap-1",
    source: "fixture",
    asset,
    quote,
    asOf: availableAt,
    availableAt,
    price: 10,
    spreadBps: 0,
    complete: true,
    ...overrides
  };
}

describe("single instant", () => {
  it("builds a one-point series", () => {
    const raw = snapshotFor("ACME", "USD", { snapshotId: "only" });

    const series = buildReplaySnapshotSeries([raw], "ACME", "USD", [AT]);

    assert.equal(series.length, 1);
    assert.equal(series[0]?.decisionAt, AT);
    assert.equal(series[0]?.snapshot.snapshotId, "only");
  });
});

describe("multiple instants", () => {
  it("builds a chronological series across several instants", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "early", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "mid", availableAt: EARLIER }),
      snapshotFor("ACME", "USD", { snapshotId: "late", availableAt: AT })
    ];

    const series = buildReplaySnapshotSeries(raws, "ACME", "USD", [EARLIEST, EARLIER, AT]);

    assert.deepEqual(
      series.map((point) => point.decisionAt),
      [EARLIEST, EARLIER, AT]
    );
    assert.deepEqual(
      series.map((point) => point.snapshot.snapshotId),
      ["early", "mid", "late"]
    );
  });

  it("only switches snapshot once a newer one has become available", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "first", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "second", availableAt: AT })
    ];

    const series = buildReplaySnapshotSeries(raws, "ACME", "USD", [EARLIER, AT, LATER]);

    assert.deepEqual(
      series.map((point) => point.snapshot.snapshotId),
      ["first", "second", "second"]
    );
  });
});

describe("boundary at decisionAt", () => {
  it("accepts a snapshot available exactly at decisionAt", () => {
    const raw = snapshotFor("ACME", "USD", { snapshotId: "on-time", availableAt: AT });

    const series = buildReplaySnapshotSeries([raw], "ACME", "USD", [AT]);

    assert.equal(series[0]?.snapshot.snapshotId, "on-time");
  });
});

describe("no look-ahead", () => {
  it("never lets a future snapshot appear before it is available", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "past", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "future", availableAt: EVEN_LATER })
    ];

    const series = buildReplaySnapshotSeries(raws, "ACME", "USD", [EARLIER, AT]);

    assert.deepEqual(
      series.map((point) => point.snapshot.snapshotId),
      ["past", "past"]
    );
  });
});

describe("fail-closed decisionTimes shape", () => {
  it("rejects an empty decisionTimes collection", () => {
    assert.throws(
      () => buildReplaySnapshotSeries([], "ACME", "USD", []),
      ContractValidationError
    );
  });

  it("rejects a non-canonical instant", () => {
    const raw = snapshotFor("ACME", "USD");

    assert.throws(
      () => buildReplaySnapshotSeries([raw], "ACME", "USD", ["2026-09-17T18:00:00Z"]),
      ContractValidationError
    );
  });

  it("rejects duplicated instants", () => {
    const raw = snapshotFor("ACME", "USD");

    assert.throws(
      () => buildReplaySnapshotSeries([raw], "ACME", "USD", [AT, AT]),
      ContractValidationError
    );
  });

  it("rejects out-of-order instants", () => {
    const raw = snapshotFor("ACME", "USD");

    assert.throws(
      () => buildReplaySnapshotSeries([raw], "ACME", "USD", [AT, EARLIER]),
      ContractValidationError
    );
  });
});

describe("propagates selection failures", () => {
  it("propagates absence of an eligible snapshot", () => {
    const raw = snapshotFor("ACME", "USD", { availableAt: LATER });

    assert.throws(
      () => buildReplaySnapshotSeries([raw], "ACME", "USD", [AT]),
      ContractValidationError
    );
  });

  it("propagates a tie on the greatest availableAt", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "tie-a", availableAt: AT }),
      snapshotFor("ACME", "USD", { snapshotId: "tie-b", availableAt: AT })
    ];

    assert.throws(
      () => buildReplaySnapshotSeries(raws, "ACME", "USD", [AT]),
      ContractValidationError
    );
  });

  it("propagates a malformed snapshot of the requested pair", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "past", availableAt: EARLIER }),
      snapshotFor("ACME", "USD", { snapshotId: "malformed", availableAt: EVEN_LATER, price: -5 })
    ];

    assert.throws(
      () => buildReplaySnapshotSeries(raws, "ACME", "USD", [AT]),
      ContractValidationError
    );
  });

  it("ignores snapshots of other pairs, as the underlying primitive does", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "right" }),
      snapshotFor("ZULU", "USD", { snapshotId: "wrong-asset" })
    ];

    const series = buildReplaySnapshotSeries(raws, "ACME", "USD", [AT]);

    assert.equal(series[0]?.snapshot.snapshotId, "right");
  });
});

describe("no mutation of input", () => {
  it("does not mutate the snapshot collection or its entries", () => {
    const raws = [snapshotFor("ACME", "USD", { snapshotId: "a" })];
    const before = raws.map((entry) => ({ ...entry }));

    buildReplaySnapshotSeries(raws, "ACME", "USD", [AT]);

    assert.deepEqual(raws, before);
  });

  it("does not mutate the decisionTimes collection", () => {
    const raw = snapshotFor("ACME", "USD", { availableAt: EARLIEST });
    const decisionTimes = [EARLIER, AT];
    const before = [...decisionTimes];

    buildReplaySnapshotSeries([raw], "ACME", "USD", decisionTimes);

    assert.deepEqual(decisionTimes, before);
  });
});

describe("immutability of the result", () => {
  it("freezes each point and the outer series", () => {
    const raw = snapshotFor("ACME", "USD");

    const series = buildReplaySnapshotSeries([raw], "ACME", "USD", [AT]);

    assert.ok(Object.isFrozen(series));
    assert.ok(Object.isFrozen(series[0]));
    assert.ok(Object.isFrozen(series[0]?.snapshot));
  });
});

describe("determinism", () => {
  it("produces an identical result for the same canonical input", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "a", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "b", availableAt: EARLIER })
    ];
    const decisionTimes = [EARLIER, AT];

    const first = buildReplaySnapshotSeries(raws, "ACME", "USD", decisionTimes);
    const second = buildReplaySnapshotSeries(raws, "ACME", "USD", decisionTimes);

    assert.deepEqual(first, second);
  });
});
