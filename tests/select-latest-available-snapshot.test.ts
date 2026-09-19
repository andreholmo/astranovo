import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { selectLatestAvailableSnapshot } from "../src/replay/select-latest-available-snapshot.js";
import { AT, LATER } from "./support/fixtures.js";

/** One instant before `AT`, hand-checkable alongside the fixtures' `AT`/`LATER`. */
const EARLIER = "2026-09-17T17:30:00.000Z";
/** One instant before `EARLIER`. */
const EARLIEST = "2026-09-17T17:00:00.000Z";

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
    // Defaults to availableAt (not AT) so overriding only availableAt to an
    // earlier instant never violates the unrelated `asOf <= availableAt`
    // contract rule.
    asOf: availableAt,
    availableAt,
    price: 10,
    spreadBps: 0,
    complete: true,
    ...overrides
  };
}

describe("single eligible snapshot", () => {
  it("selects the only eligible snapshot", () => {
    const raw = snapshotFor("ACME", "USD", { snapshotId: "only" });

    const selected = selectLatestAvailableSnapshot([raw], "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "only");
    assert.equal(selected.asset, "ACME");
    assert.equal(selected.quote, "USD");
  });
});

describe("multiple past snapshots", () => {
  it("picks the most recent among several eligible snapshots", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "earliest", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "latest", availableAt: EARLIER }),
      snapshotFor("ACME", "USD", { snapshotId: "middle", availableAt: EARLIEST })
    ];

    const selected = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "latest");
    assert.equal(selected.availableAt, EARLIER);
  });
});

describe("boundary at decisionAt", () => {
  it("accepts a snapshot available exactly at decisionAt", () => {
    const raw = snapshotFor("ACME", "USD", { snapshotId: "on-time", availableAt: AT });

    const selected = selectLatestAvailableSnapshot([raw], "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "on-time");
  });
});

describe("future snapshots", () => {
  it("ignores a future snapshot and selects the latest past one", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "past", availableAt: EARLIER }),
      snapshotFor("ACME", "USD", { snapshotId: "future", availableAt: LATER })
    ];

    const selected = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "past");
  });
});

describe("other pairs are ignored", () => {
  it("ignores a snapshot for a different asset", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "right" }),
      snapshotFor("ZULU", "USD", { snapshotId: "wrong-asset" })
    ];

    const selected = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "right");
  });

  it("ignores a snapshot for a different quote", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "right" }),
      snapshotFor("ACME", "EUR", { snapshotId: "wrong-quote" })
    ];

    const selected = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "right");
  });

  it("never validates an entry for a different pair, even if malformed", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "right" }),
      { asset: "ZULU", quote: "USD", price: -1 }
    ];

    const selected = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "right");
  });
});

describe("fail-closed absence", () => {
  it("rejects an empty snapshot collection", () => {
    assert.throws(
      () => selectLatestAvailableSnapshot([], "ACME", "USD", AT),
      ContractValidationError
    );
  });

  it("rejects when every snapshot of the pair is in the future", () => {
    const raw = snapshotFor("ACME", "USD", { availableAt: LATER });

    assert.throws(
      () => selectLatestAvailableSnapshot([raw], "ACME", "USD", AT),
      ContractValidationError
    );
  });

  it("rejects when only other pairs are present", () => {
    const raw = snapshotFor("ZULU", "USD");

    assert.throws(
      () => selectLatestAvailableSnapshot([raw], "ACME", "USD", AT),
      ContractValidationError
    );
  });
});

describe("fail-closed tie", () => {
  it("rejects two eligible snapshots tied on the greatest availableAt", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "tie-a", availableAt: AT }),
      snapshotFor("ACME", "USD", { snapshotId: "tie-b", availableAt: AT })
    ];

    assert.throws(
      () => selectLatestAvailableSnapshot(raws, "ACME", "USD", AT),
      ContractValidationError
    );
  });

  it("does not reject a tie that is not at the greatest availableAt", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "tie-a", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "tie-b", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "winner", availableAt: EARLIER })
    ];

    const selected = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.equal(selected.snapshotId, "winner");
  });
});

describe("fail-closed decisionAt", () => {
  it("rejects a decisionAt without milliseconds", () => {
    assert.throws(
      () =>
        selectLatestAvailableSnapshot(
          [snapshotFor("ACME", "USD")],
          "ACME",
          "USD",
          "2026-09-17T18:00:00Z"
        ),
      ContractValidationError
    );
  });

  it("rejects a decisionAt with a non-Z offset", () => {
    assert.throws(
      () =>
        selectLatestAvailableSnapshot(
          [snapshotFor("ACME", "USD")],
          "ACME",
          "USD",
          "2026-09-17T18:00:00.000+00:00"
        ),
      ContractValidationError
    );
  });
});

describe("fail-closed malformed snapshot", () => {
  it("rejects a malformed snapshot of the requested pair even when it is in the future", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "past", availableAt: EARLIER }),
      snapshotFor("ACME", "USD", { snapshotId: "future-malformed", availableAt: LATER, price: -5 })
    ];

    assert.throws(
      () => selectLatestAvailableSnapshot(raws, "ACME", "USD", AT),
      ContractValidationError
    );
  });
});

describe("order independence", () => {
  it("produces the same result regardless of input order", () => {
    const a = snapshotFor("ACME", "USD", { snapshotId: "a", availableAt: EARLIEST });
    const b = snapshotFor("ACME", "USD", { snapshotId: "b", availableAt: EARLIER });
    const c = snapshotFor("ZULU", "USD", { snapshotId: "c" });

    const first = selectLatestAvailableSnapshot([a, b, c], "ACME", "USD", AT);
    const second = selectLatestAvailableSnapshot([c, b, a], "ACME", "USD", AT);
    const third = selectLatestAvailableSnapshot([b, c, a], "ACME", "USD", AT);

    assert.deepEqual(first, second);
    assert.deepEqual(first, third);
    assert.equal(first.snapshotId, "b");
  });
});

describe("no mutation of input", () => {
  it("does not mutate the snapshot collection or its entries", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "a" }),
      snapshotFor("ZULU", "USD", { snapshotId: "b" })
    ];
    const before = raws.map((entry) => ({ ...entry }));

    selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.deepEqual(raws, before);
  });
});

describe("immutability of the result", () => {
  it("returns a frozen MarketSnapshot", () => {
    const raw = snapshotFor("ACME", "USD");

    const selected = selectLatestAvailableSnapshot([raw], "ACME", "USD", AT);

    assert.ok(Object.isFrozen(selected));
  });
});

describe("determinism", () => {
  it("produces an identical result for the same canonical input", () => {
    const raws = [
      snapshotFor("ACME", "USD", { snapshotId: "a", availableAt: EARLIEST }),
      snapshotFor("ACME", "USD", { snapshotId: "b", availableAt: EARLIER })
    ];

    const first = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);
    const second = selectLatestAvailableSnapshot(raws, "ACME", "USD", AT);

    assert.deepEqual(first, second);
  });
});
