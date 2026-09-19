import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { PaperBroker } from "../src/broker/paper-broker.js";
import type { LedgerEvent } from "../src/ledger/events.js";
import { applyEvent, createWallet, type Wallet } from "../src/portfolio/portfolio.js";
import { valueWalletAt } from "../src/metrics/value-wallet-at.js";
import { AT, FREE_POLICY, LATER, START_CASH_MICROS, intent } from "./support/fixtures.js";

const broker = new PaperBroker();

function execute(wallet: Wallet, overrides: Parameters<typeof intent>[0] = {}): LedgerEvent {
  return broker.execute({
    intent: intent({ agentId: wallet.agentId, ...overrides }),
    wallet,
    policy: FREE_POLICY,
    occurredAt: AT
  }).event;
}

/** Wallet holding 1000 ACME atoms (10.00 units), bought for exactly US$100, cash at zero. */
function walletWithAcme(agentId = "trend-following"): Wallet {
  const base = createWallet(agentId, START_CASH_MICROS);
  return applyEvent(base, execute(base, { positionPct: 1 }));
}

/**
 * Wallet holding 1000 ZULU atoms and 500 ALFA atoms, US$50 cash remaining.
 *
 * Uses `positionPct` values that are exact binary fractions (0.5) so the
 * resulting quantities are hand-checkable without floating-point rounding
 * inside `fractionToMicros` obscuring the arithmetic.
 */
function walletWithTwoPositions(agentId = "trend-following"): Wallet {
  let wallet = createWallet(agentId, 200_000_000n);
  wallet = applyEvent(wallet, execute(wallet, { orderId: "o-z", asset: "ZULU", positionPct: 0.5 }));
  wallet = applyEvent(wallet, execute(wallet, { orderId: "o-a", asset: "ALFA", positionPct: 0.5 }));
  return wallet;
}

interface SnapshotOverrides {
  readonly schemaVersion?: number;
  readonly snapshotId?: string;
  readonly source?: string;
  readonly asset?: string;
  readonly quote?: string;
  readonly asOf?: string;
  readonly availableAt?: string;
  readonly price?: number;
  readonly spreadBps?: number;
  readonly complete?: boolean;
}

function snapshot(overrides: SnapshotOverrides = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    snapshotId: "snap-acme-1",
    source: "fixture",
    asset: "ACME",
    quote: "USD",
    asOf: AT,
    availableAt: AT,
    price: 10,
    spreadBps: 0,
    complete: true,
    ...overrides
  };
}

describe("cash-only wallet", () => {
  it("accepts an empty snapshot list and equityMicros equals cashMicros", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);

    const point = valueWalletAt(wallet, AT, []);

    assert.equal(point.agentId, "trend-following");
    assert.equal(point.cashMicros, START_CASH_MICROS);
    assert.deepEqual(point.positions, []);
    assert.equal(point.positionsValueMicros, 0n);
    assert.equal(point.equityMicros, point.cashMicros);
    assert.deepEqual(point.snapshotIds, []);
  });
});

describe("one position", () => {
  it("values it against its snapshot price", () => {
    const wallet = walletWithAcme();

    const point = valueWalletAt(wallet, AT, [snapshot({ price: 10 })]);

    assert.equal(point.cashMicros, 0n);
    assert.equal(point.positions.length, 1);
    assert.equal(point.positions[0]?.asset, "ACME");
    assert.equal(point.positions[0]?.quantityAtoms, 1000n);
    assert.equal(point.positions[0]?.priceMicros, 10_000_000n);
    assert.equal(point.positions[0]?.valueMicros, 100_000_000n);
    assert.equal(point.positionsValueMicros, 100_000_000n);
    assert.equal(point.equityMicros, 100_000_000n);
    assert.deepEqual(point.snapshotIds, ["snap-acme-1"]);
  });
});

describe("multiple positions", () => {
  it("sums each position's value correctly", () => {
    const wallet = walletWithTwoPositions();

    const point = valueWalletAt(wallet, AT, [
      snapshot({ snapshotId: "snap-zulu", asset: "ZULU", price: 12 }),
      snapshot({ snapshotId: "snap-alfa", asset: "ALFA", price: 8 })
    ]);

    assert.equal(point.cashMicros, 50_000_000n);
    assert.equal(point.positions.map((p) => p.asset).join(","), "ALFA,ZULU");
    assert.equal(point.positions[0]?.valueMicros, 40_000_000n);
    assert.equal(point.positions[1]?.valueMicros, 120_000_000n);
    assert.equal(point.positionsValueMicros, 160_000_000n);
    assert.equal(point.equityMicros, 210_000_000n);
  });

  it("does not depend on the order snapshots are supplied in", () => {
    const wallet = walletWithTwoPositions();
    const zulu = snapshot({ snapshotId: "snap-zulu", asset: "ZULU", price: 12 });
    const alfa = snapshot({ snapshotId: "snap-alfa", asset: "ALFA", price: 8 });

    const first = valueWalletAt(wallet, AT, [zulu, alfa]);
    const second = valueWalletAt(wallet, AT, [alfa, zulu]);

    assert.deepEqual(first, second);
  });
});

describe("conservative floor rounding", () => {
  it("truncates a fractional position value down instead of rounding", () => {
    const base = createWallet("trend-following", 100_000n);
    const wallet = applyEvent(base, execute(base, { positionPct: 1 }));
    assert.equal(wallet.positions[0]?.quantityAtoms, 1n);
    assert.equal(wallet.cashMicros, 0n);

    const point = valueWalletAt(wallet, AT, [snapshot({ price: 3.333333 })]);

    // floor(1 * 3_333_333 / 100) = floor(33_333.33) = 33_333, not 33_334.
    assert.equal(point.positions[0]?.valueMicros, 33_333n);
  });
});

describe("anti-look-ahead", () => {
  it("accepts a snapshot available exactly at valuedAt", () => {
    const wallet = walletWithAcme();

    const point = valueWalletAt(wallet, AT, [snapshot({ availableAt: AT })]);

    assert.equal(point.positions.length, 1);
  });

  it("rejects a snapshot available after valuedAt", () => {
    const wallet = walletWithAcme();

    assert.throws(
      () => valueWalletAt(wallet, AT, [snapshot({ availableAt: LATER })]),
      ContractValidationError
    );
  });
});

describe("fail-closed snapshot rules", () => {
  it("rejects an incomplete snapshot", () => {
    const wallet = walletWithAcme();

    assert.throws(
      () => valueWalletAt(wallet, AT, [snapshot({ complete: false })]),
      ContractValidationError
    );
  });

  it("rejects a snapshot quoted in something other than USD", () => {
    const wallet = walletWithAcme();

    assert.throws(
      () => valueWalletAt(wallet, AT, [snapshot({ quote: "EUR" })]),
      ContractValidationError
    );
  });

  it("rejects a wallet position with no matching snapshot", () => {
    const wallet = walletWithAcme();

    assert.throws(() => valueWalletAt(wallet, AT, []), ContractValidationError);
  });

  it("rejects duplicate snapshots for the same asset", () => {
    const wallet = walletWithAcme();

    assert.throws(
      () =>
        valueWalletAt(wallet, AT, [
          snapshot({ snapshotId: "snap-1" }),
          snapshot({ snapshotId: "snap-2" })
        ]),
      ContractValidationError
    );
  });

  it("rejects a snapshot for an asset the wallet does not hold", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);

    assert.throws(() => valueWalletAt(wallet, AT, [snapshot()]), ContractValidationError);
  });

  it("fails closed when the price cannot be represented exactly in six decimal places", () => {
    const wallet = walletWithAcme();

    assert.throws(
      () => valueWalletAt(wallet, AT, [snapshot({ price: 3.1234567 })]),
      ContractValidationError
    );
  });

  it("fails closed on overflow when summing position values", () => {
    // A single BUY through the PaperBroker can never reach a value this
    // large (MAX_ATOMS/MAX_MICROS bound every real fill), so the wallet is
    // constructed directly to exercise valueWalletAt's own overflow guard.
    const wallet: Wallet = Object.freeze({
      agentId: "trend-following",
      initialCashMicros: 0n,
      cashMicros: 0n,
      positions: Object.freeze([Object.freeze({ asset: "ACME", assetScale: 0, quantityAtoms: 2n })])
    });

    assert.throws(
      () => valueWalletAt(wallet, AT, [snapshot({ price: 9_000_000_000_000 })]),
      ContractValidationError
    );
  });
});

describe("immutability", () => {
  it("freezes the returned EquityPoint and its collections", () => {
    const wallet = walletWithAcme();

    const point = valueWalletAt(wallet, AT, [snapshot()]);

    assert.ok(Object.isFrozen(point));
    assert.ok(Object.isFrozen(point.positions));
    assert.ok(Object.isFrozen(point.positions[0]));
    assert.ok(Object.isFrozen(point.snapshotIds));
  });

  it("does not mutate the wallet or the snapshots passed in", () => {
    const wallet = walletWithAcme();
    const walletBefore = { cash: wallet.cashMicros, positions: [...wallet.positions] };
    const rawSnapshot = snapshot();
    const snapshotBefore = { ...rawSnapshot };

    valueWalletAt(wallet, AT, [rawSnapshot]);

    assert.equal(wallet.cashMicros, walletBefore.cash);
    assert.deepEqual(wallet.positions, walletBefore.positions);
    assert.deepEqual(rawSnapshot, snapshotBefore);
  });
});

describe("agent isolation", () => {
  it("values two agents' wallets independently", () => {
    const walletA = walletWithAcme("trend-following");
    const walletB = createWallet("momentum", START_CASH_MICROS);

    const pointA = valueWalletAt(walletA, AT, [snapshot()]);
    const pointB = valueWalletAt(walletB, AT, []);

    assert.equal(pointA.agentId, "trend-following");
    assert.equal(pointB.agentId, "momentum");
    assert.equal(pointB.equityMicros, START_CASH_MICROS);
    assert.equal(walletB.cashMicros, START_CASH_MICROS);
  });
});

describe("determinism", () => {
  it("produces an identical EquityPoint for the same canonical input", () => {
    const wallet = walletWithAcme();

    const first = valueWalletAt(wallet, AT, [snapshot()]);
    const second = valueWalletAt(wallet, AT, [snapshot()]);

    assert.deepEqual(first, second);
  });
});
