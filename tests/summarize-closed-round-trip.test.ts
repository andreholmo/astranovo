import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { createFillEvent, type FillEvent } from "../src/ledger/events.js";
import { summarizeClosedRoundTrip } from "../src/metrics/summarize-closed-round-trip.js";
import { AT, LATER } from "./support/fixtures.js";

const AGENT = "trend-following";
const OTHER_AGENT = "momentum";
const ASSET = "ACME";
const OTHER_ASSET = "BETA";
const QUOTE = "USD";
const SCALE = 2;
const QUANTITY_ATOMS = 1000n;

type FillDraft = Omit<FillEvent, "eventId">;

/** A hand-checkable opening BUY: no fee, no spread by default. */
function buyFill(overrides: Partial<FillDraft> = {}): FillEvent {
  const draft: FillDraft = {
    schemaVersion: 1,
    type: "FILL",
    orderId: "order-buy",
    cycleId: "cycle-1",
    agentId: AGENT,
    side: "BUY",
    asset: ASSET,
    quote: QUOTE,
    assetScale: SCALE,
    quantityAtoms: QUANTITY_ATOMS,
    referencePriceMicros: 10_000_000n,
    effectivePriceMicros: 10_000_000n,
    grossMicros: 100_000_000n,
    feeMicros: 0n,
    totalMicros: 100_000_000n,
    feeBps: 0,
    spreadBps: 0,
    slippageBps: 0,
    occurredAt: AT,
    policyVersion: "free",
    ...overrides
  };
  return createFillEvent(draft);
}

/** A hand-checkable closing SELL of the same quantity/asset/agent as {@link buyFill}. */
function sellFill(overrides: Partial<FillDraft> = {}): FillEvent {
  const draft: FillDraft = {
    schemaVersion: 1,
    type: "FILL",
    orderId: "order-sell",
    cycleId: "cycle-1",
    agentId: AGENT,
    side: "SELL",
    asset: ASSET,
    quote: QUOTE,
    assetScale: SCALE,
    quantityAtoms: QUANTITY_ATOMS,
    referencePriceMicros: 10_000_000n,
    effectivePriceMicros: 10_000_000n,
    grossMicros: 100_000_000n,
    feeMicros: 0n,
    totalMicros: 100_000_000n,
    feeBps: 0,
    spreadBps: 0,
    slippageBps: 0,
    occurredAt: LATER,
    policyVersion: "free",
    ...overrides
  };
  return createFillEvent(draft);
}

describe("gain, loss and tie", () => {
  it("reports WIN when net proceeds exceed realised cost", () => {
    const result = summarizeClosedRoundTrip(
      buyFill({ totalMicros: 100_000_000n }),
      sellFill({ totalMicros: 110_000_000n })
    );

    assert.equal(result.direction, "WIN");
    assert.equal(result.realizedCostMicros, 100_000_000n);
    assert.equal(result.netProceedsMicros, 110_000_000n);
    assert.equal(result.resultMagnitudeMicros, 10_000_000n);
  });

  it("reports LOSS when net proceeds fall short of realised cost", () => {
    const result = summarizeClosedRoundTrip(
      buyFill({ totalMicros: 100_000_000n }),
      sellFill({ totalMicros: 90_000_000n })
    );

    assert.equal(result.direction, "LOSS");
    assert.equal(result.resultMagnitudeMicros, 10_000_000n);
  });

  it("reports BREAK_EVEN when net proceeds exactly equal realised cost", () => {
    const result = summarizeClosedRoundTrip(
      buyFill({ totalMicros: 100_000_000n }),
      sellFill({ totalMicros: 100_000_000n })
    );

    assert.equal(result.direction, "BREAK_EVEN");
    assert.equal(result.resultMagnitudeMicros, 0n);
  });
});

describe("exact 1 micro difference", () => {
  it("reports WIN with magnitude 1 when proceeds exceed cost by exactly 1 micro", () => {
    const result = summarizeClosedRoundTrip(
      buyFill({ totalMicros: 100_000_000n }),
      sellFill({ totalMicros: 100_000_001n })
    );

    assert.equal(result.direction, "WIN");
    assert.equal(result.resultMagnitudeMicros, 1n);
  });

  it("reports LOSS with magnitude 1 when proceeds fall short of cost by exactly 1 micro", () => {
    const result = summarizeClosedRoundTrip(
      buyFill({ totalMicros: 100_000_000n }),
      sellFill({ totalMicros: 99_999_999n })
    );

    assert.equal(result.direction, "LOSS");
    assert.equal(result.resultMagnitudeMicros, 1n);
  });
});

describe("fees already reflected in totalMicros", () => {
  it("uses totalMicros as-is instead of adding feeMicros a second time", () => {
    // BUY: gross 100_000_000 + fee 1_000_000 = totalMicros 101_000_000.
    // SELL: gross 105_000_000 - fee 1_050_000 = totalMicros 103_950_000.
    const result = summarizeClosedRoundTrip(
      buyFill({ grossMicros: 100_000_000n, feeMicros: 1_000_000n, totalMicros: 101_000_000n }),
      sellFill({ grossMicros: 105_000_000n, feeMicros: 1_050_000n, totalMicros: 103_950_000n })
    );

    assert.equal(result.realizedCostMicros, 101_000_000n);
    assert.equal(result.netProceedsMicros, 103_950_000n);
    assert.equal(result.direction, "WIN");
    // 103_950_000 - 101_000_000, not adjusted by feeMicros again.
    assert.equal(result.resultMagnitudeMicros, 2_950_000n);
  });
});

describe("rejection by divergent identity fields", () => {
  it("rejects a SELL fill from a different agent", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ agentId: OTHER_AGENT })),
      ContractValidationError
    );
  });

  it("rejects a SELL fill of a different asset", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ asset: OTHER_ASSET })),
      ContractValidationError
    );
  });

  it("rejects a SELL fill quoted in a different currency", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ quote: "EUR" })),
      ContractValidationError
    );
  });

  it("rejects a SELL fill with a different asset scale", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ assetScale: 3 })),
      ContractValidationError
    );
  });

  it("rejects a SELL fill of a different quantity", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ quantityAtoms: 999n })),
      ContractValidationError
    );
  });
});

describe("fail-closed structural rules", () => {
  it("rejects an inverted opening side", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill({ side: "SELL" }), sellFill()),
      ContractValidationError
    );
  });

  it("rejects an inverted closing side", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ side: "BUY" })),
      ContractValidationError
    );
  });

  it("rejects the same fill passed as both the opening and the closing leg", () => {
    const buy = buyFill();
    // A real single fill can never be both a BUY and a SELL at once, so the
    // only way to exercise "repeated fill" independently of the side check
    // is to forge a closing leg that shares the opening leg's eventId.
    const forgedSell = Object.freeze({ ...sellFill(), eventId: buy.eventId });

    assert.throws(() => summarizeClosedRoundTrip(buy, forgedSell), ContractValidationError);
  });

  it("rejects a non-canonical occurredAt", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill(), sellFill({ occurredAt: "2026-09-17T18:15:00Z" })),
      ContractValidationError
    );
  });

  it("rejects a closing timestamp equal to the opening timestamp", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill({ occurredAt: AT }), sellFill({ occurredAt: AT })),
      ContractValidationError
    );
  });

  it("rejects a closing timestamp before the opening timestamp", () => {
    assert.throws(
      () => summarizeClosedRoundTrip(buyFill({ occurredAt: LATER }), sellFill({ occurredAt: AT })),
      ContractValidationError
    );
  });

  it("rejects invalid money on the opening leg", () => {
    const forgedBuy = Object.freeze({ ...buyFill(), totalMicros: -1n });

    assert.throws(() => summarizeClosedRoundTrip(forgedBuy, sellFill()), ContractValidationError);
  });

  it("rejects invalid money on the closing leg", () => {
    const forgedSell = Object.freeze({ ...sellFill(), totalMicros: -1n });

    assert.throws(() => summarizeClosedRoundTrip(buyFill(), forgedSell), ContractValidationError);
  });
});

describe("immutability, non-mutation and determinism", () => {
  it("freezes the returned result", () => {
    const result = summarizeClosedRoundTrip(buyFill(), sellFill());

    assert.ok(Object.isFrozen(result));
  });

  it("does not mutate either fill passed in", () => {
    const buy = buyFill();
    const sell = sellFill();
    const buyBefore = { ...buy };
    const sellBefore = { ...sell };

    summarizeClosedRoundTrip(buy, sell);

    assert.deepEqual({ ...buy }, buyBefore);
    assert.deepEqual({ ...sell }, sellBefore);
  });

  it("produces an identical result for the same canonical input", () => {
    const buy = buyFill();
    const sell = sellFill({ totalMicros: 110_000_000n });

    const first = summarizeClosedRoundTrip(buy, sell);
    const second = summarizeClosedRoundTrip(buy, sell);

    assert.deepEqual(first, second);
  });
});

describe("result identity", () => {
  it("carries the exact eventIds of both legs and the common trade identity", () => {
    const buy = buyFill();
    const sell = sellFill();

    const result = summarizeClosedRoundTrip(buy, sell);

    assert.equal(result.buyEventId, buy.eventId);
    assert.equal(result.sellEventId, sell.eventId);
    assert.equal(result.agentId, AGENT);
    assert.equal(result.asset, ASSET);
    assert.equal(result.quote, QUOTE);
    assert.equal(result.assetScale, SCALE);
    assert.equal(result.quantityAtoms, QUANTITY_ATOMS);
    assert.equal(result.openedAt, AT);
    assert.equal(result.closedAt, LATER);
  });
});
