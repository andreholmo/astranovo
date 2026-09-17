import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError, orderIntentFromProposal, parseAgentProposal, parseOrderIntent } from "../src/domain/contracts.js";
import { DEFAULT_EXECUTION_POLICY, PaperBroker } from "../src/broker/paper-broker.js";
import type { ExecutionOutcome } from "../src/broker/broker.js";
import type { ExecutionPolicy } from "../src/domain/contracts.js";
import type { FillEvent } from "../src/ledger/events.js";
import { applyEvent, createWallet, positionOf, type Wallet } from "../src/portfolio/portfolio.js";
import {
  AT,
  COSTED_POLICY,
  FREE_POLICY,
  LATER,
  PRICE_MICROS,
  SCALE,
  START_CASH_MICROS,
  intent
} from "./support/fixtures.js";

const broker = new PaperBroker();

function wallet(cashMicros: bigint = START_CASH_MICROS): Wallet {
  return createWallet("trend-following", cashMicros);
}

function execute(
  current: Wallet,
  overrides: Parameters<typeof intent>[0] = {},
  policy: ExecutionPolicy = FREE_POLICY,
  occurredAt: string = AT
): ExecutionOutcome {
  return broker.execute({ intent: intent(overrides), wallet: current, policy, occurredAt });
}

function expectFill(outcome: ExecutionOutcome): FillEvent {
  assert.equal(outcome.status, "FILLED", `expected a fill, got ${outcome.status}`);
  assert.equal(outcome.event.type, "FILL");
  return outcome.event as FillEvent;
}

function expectRejection(outcome: ExecutionOutcome, code: string): void {
  assert.equal(outcome.status, "REJECTED", "expected a rejection");
  assert.equal(outcome.event.type, "REJECTION");
  if (outcome.event.type === "REJECTION") assert.equal(outcome.event.code, code);
}

describe("BUY without costs", () => {
  it("spends the whole budget at the reference price", () => {
    // US$100 at US$10.00 per unit buys 10.00 units = 1000 atoms at scale 2.
    const fill = expectFill(execute(wallet()));

    assert.equal(fill.quantityAtoms, 1000n);
    assert.equal(fill.effectivePriceMicros, 10_000_000n);
    assert.equal(fill.grossMicros, 100_000_000n);
    assert.equal(fill.feeMicros, 0n);
    assert.equal(fill.totalMicros, 100_000_000n);
    assert.equal(fill.referencePriceMicros, 10_000_000n);
    assert.equal(fill.policyVersion, "free");
  });

  it("leaves no cash behind and no cash missing", () => {
    const after = applyEvent(wallet(), expectFill(execute(wallet())));

    assert.equal(after.cashMicros, 0n);
    assert.equal(positionOf(after, "ACME")?.quantityAtoms, 1000n);
    assert.equal(positionOf(after, "ACME")?.assetScale, SCALE);
  });

  it("sizes a partial budget by positionPct", () => {
    // 25% of US$100 is US$25, which buys 2.50 units = 250 atoms.
    const fill = expectFill(execute(wallet(), { positionPct: 0.25 }));

    assert.equal(fill.quantityAtoms, 250n);
    assert.equal(fill.totalMicros, 25_000_000n);
  });
});

describe("BUY with fee, spread and slippage", () => {
  it("pays half the spread and the fee, both rounded against the trader", () => {
    // BUY price = 10.00 * (1 + 1%) = US$10.10, so 101_000 micros per atom.
    // 980 atoms: gross 98_980_000, fee 1% = 989_800, total 99_969_800.
    // 981 atoms would cost 100_071_810, more than the US$100 available.
    const fill = expectFill(execute(wallet(), {}, COSTED_POLICY));

    assert.equal(fill.effectivePriceMicros, 10_100_000n);
    assert.equal(fill.quantityAtoms, 980n);
    assert.equal(fill.grossMicros, 98_980_000n);
    assert.equal(fill.feeMicros, 989_800n);
    assert.equal(fill.totalMicros, 99_969_800n);
  });

  it("buys strictly less than the same order would buy for free", () => {
    const free = expectFill(execute(wallet()));
    const costed = expectFill(execute(wallet(), {}, COSTED_POLICY));

    assert.ok(costed.quantityAtoms < free.quantityAtoms, "costs must reduce the quantity bought");
    assert.ok(costed.feeMicros > 0n, "a fee must be charged");
  });

  it("applies slippage on top of the spread", () => {
    const policy: ExecutionPolicy = { ...COSTED_POLICY, slippageBps: 50, policyVersion: "slipped" };
    // price = 10.00 * (20000 + 200 + 100) / 20000 = US$10.15
    const fill = expectFill(execute(wallet(), {}, policy));

    assert.equal(fill.effectivePriceMicros, 10_150_000n);
    assert.equal(fill.slippageBps, 50);
    assert.equal(fill.spreadBps, 200);
  });

  it("never leaves cash negative, whatever the budget or the costs", () => {
    const policies: ExecutionPolicy[] = [
      FREE_POLICY,
      COSTED_POLICY,
      DEFAULT_EXECUTION_POLICY,
      { ...COSTED_POLICY, feeBps: 9_999, spreadBps: 9_999, slippageBps: 4_999, policyVersion: "extreme" }
    ];
    const budgets = [1n, 7n, 999n, 100_001n, START_CASH_MICROS, 987_654_321n];

    for (const policy of policies) {
      for (const cash of budgets) {
        for (const positionPct of [1, 0.999999, 0.5, 0.000001]) {
          const start = wallet(cash);
          const outcome = execute(start, { positionPct }, policy);
          if (outcome.status === "REJECTED") continue;
          const after = applyEvent(start, outcome.event);
          assert.ok(after.cashMicros >= 0n, "cash must never go negative");
          assert.equal(after.cashMicros, cash - outcome.event.totalMicros);
          assert.ok(outcome.event.totalMicros <= cash, "spend must fit the wallet");
        }
      }
    }
  });
});

describe("BUY rejections", () => {
  it("rejects when the wallet has no cash", () => {
    expectRejection(execute(wallet(0n)), "INSUFFICIENT_CASH");
  });

  it("rejects when the requested fraction of cash rounds down to nothing", () => {
    expectRejection(execute(wallet(1n), { positionPct: 0.000001 }), "INSUFFICIENT_CASH");
  });

  it("rejects when the budget cannot pay for a single atom", () => {
    // One atom costs 100_000 micros; the wallet holds 99_999.
    expectRejection(execute(wallet(99_999n)), "QUANTITY_TOO_SMALL");
  });

  it("fills for exactly one atom when the budget just covers it", () => {
    const fill = expectFill(execute(wallet(100_000n)));
    assert.equal(fill.quantityAtoms, 1n);
    assert.equal(fill.totalMicros, 100_000n);
  });
});

describe("SELL", () => {
  function walletHolding(atoms: bigint, cashMicros = 0n): Wallet {
    const start = createWallet("trend-following", cashMicros + 100_000n * atoms);
    return applyEvent(
      start,
      expectFill(
        broker.execute({
          intent: intent({ orderId: "seed" }),
          wallet: start,
          policy: FREE_POLICY,
          occurredAt: AT
        })
      )
    );
  }

  it("sells a fraction of the position, not of the capital", () => {
    // 1000 atoms held; 40% of the position is 400 atoms, worth US$40 at 10.00.
    const held = walletHolding(1000n);
    const fill = expectFill(
      execute(held, { orderId: "sell-1", side: "SELL", positionPct: 0.4 }, FREE_POLICY, LATER)
    );

    assert.equal(fill.quantityAtoms, 400n);
    assert.equal(fill.totalMicros, 40_000_000n);

    const after = applyEvent(held, fill);
    assert.equal(positionOf(after, "ACME")?.quantityAtoms, 600n);
    assert.equal(after.cashMicros, 40_000_000n);
  });

  it("sells the whole position and removes it", () => {
    const held = walletHolding(1000n);
    const fill = expectFill(
      execute(held, { orderId: "sell-all", side: "SELL", positionPct: 1 }, FREE_POLICY, LATER)
    );
    const after = applyEvent(held, fill);

    assert.equal(fill.quantityAtoms, 1000n);
    assert.equal(after.cashMicros, 100_000_000n);
    assert.equal(positionOf(after, "ACME"), undefined);
    assert.deepEqual(after.positions, []);
  });

  it("receives less than the reference value once costs apply", () => {
    // SELL price = 10.00 * (1 - 1%) = US$9.90. 490 atoms -> gross 48_510_000,
    // fee 1% = 485_100, proceeds 48_024_900.
    const held = walletHolding(980n);
    const fill = expectFill(
      execute(held, { orderId: "sell-costed", side: "SELL", positionPct: 0.5 }, COSTED_POLICY, LATER)
    );

    assert.equal(fill.effectivePriceMicros, 9_900_000n);
    assert.equal(fill.quantityAtoms, 490n);
    assert.equal(fill.grossMicros, 48_510_000n);
    assert.equal(fill.feeMicros, 485_100n);
    assert.equal(fill.totalMicros, 48_024_900n);
  });

  it("round-trips at a loss once costs are paid", () => {
    const start = wallet();
    const bought = expectFill(execute(start, {}, COSTED_POLICY));
    const afterBuy = applyEvent(start, bought);
    const sold = expectFill(
      execute(afterBuy, { orderId: "sell-rt", side: "SELL", positionPct: 1 }, COSTED_POLICY, LATER)
    );
    const afterSell = applyEvent(afterBuy, sold);

    assert.equal(positionOf(afterSell, "ACME"), undefined);
    assert.ok(
      afterSell.cashMicros < START_CASH_MICROS,
      "a costed round trip must end with less cash than it started with"
    );
  });

  it("rejects a sale with no position in the asset", () => {
    expectRejection(execute(wallet(), { side: "SELL" }), "NO_POSITION");
    expectRejection(
      execute(walletHolding(1000n), { side: "SELL", asset: "OTHER" }),
      "NO_POSITION"
    );
  });

  it("rejects when the fraction of the position rounds down to nothing", () => {
    expectRejection(
      execute(walletHolding(1n), { side: "SELL", positionPct: 0.4 }, FREE_POLICY, LATER),
      "QUANTITY_TOO_SMALL"
    );
  });

  it("rejects when spread and slippage consume the whole price", () => {
    const policy: ExecutionPolicy = {
      schemaVersion: 1,
      policyVersion: "degenerate",
      feeBps: 0,
      spreadBps: 10_000,
      slippageBps: 5_000
    };
    expectRejection(
      execute(walletHolding(1000n), { side: "SELL" }, policy, LATER),
      "COSTS_EXCEED_PRICE"
    );
  });

  it("rejects when the fee would swallow the whole proceeds", () => {
    const policy: ExecutionPolicy = {
      schemaVersion: 1,
      policyVersion: "allfee",
      feeBps: 10_000,
      spreadBps: 0,
      slippageBps: 0
    };
    expectRejection(
      execute(walletHolding(1000n), { side: "SELL" }, policy, LATER),
      "COSTS_EXCEED_PROCEEDS"
    );
  });

  it("never sells more than the position held", () => {
    for (const positionPct of [1, 0.999999, 0.5]) {
      const held = walletHolding(777n);
      const outcome = execute(held, { side: "SELL", positionPct }, COSTED_POLICY, LATER);
      if (outcome.status === "REJECTED") continue;
      assert.ok(outcome.event.quantityAtoms <= 777n, "cannot sell more than is held");
      const after = applyEvent(held, outcome.event);
      assert.ok((positionOf(after, "ACME")?.quantityAtoms ?? 0n) >= 0n);
      assert.ok(after.cashMicros >= held.cashMicros, "a sale never reduces cash");
    }
  });
});

describe("HOLD never reaches the broker", () => {
  it("produces no order intent at all", () => {
    const proposal = parseAgentProposal({
      schemaVersion: 1,
      proposalId: "p-1",
      cycleId: "cycle-1",
      agentId: "trend-following",
      action: "HOLD",
      asset: "ACME",
      confidence: 0.5,
      positionPct: 0,
      reason: "waiting",
      veto: false,
      evidenceIds: [],
      promptVersion: "p1",
      model: "stub"
    });

    assert.equal(
      orderIntentFromProposal(proposal, {
        orderId: "order-1",
        quote: "USD",
        referencePriceMicros: PRICE_MICROS,
        assetScale: SCALE,
        createdAt: AT
      }),
      null
    );
  });

  it("turns BUY and SELL proposals into intents that keep their size", () => {
    for (const action of ["BUY", "SELL"] as const) {
      const proposal = parseAgentProposal({
        schemaVersion: 1,
        proposalId: "p-2",
        cycleId: "cycle-1",
        agentId: "trend-following",
        action,
        asset: "ACME",
        confidence: 0.5,
        positionPct: 0.25,
        reason: "sized",
        veto: false,
        evidenceIds: [],
        promptVersion: "p1",
        model: "stub"
      });
      const built = orderIntentFromProposal(proposal, {
        orderId: `order-${action}`,
        quote: "USD",
        referencePriceMicros: PRICE_MICROS,
        assetScale: SCALE,
        createdAt: AT
      });

      assert.ok(built !== null);
      assert.equal(built.side, action);
      assert.equal(built.positionPct, 0.25);
    }
  });
});

describe("OrderIntent validation", () => {
  it("rejects a zero or out-of-range size", () => {
    for (const positionPct of [0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => parseOrderIntent({ ...rawIntent(), positionPct }),
        ContractValidationError
      );
    }
  });

  it("rejects a non-canonical or non-positive reference price", () => {
    for (const referencePriceMicros of ["0", "01", "-1", "1.5", "1e7", 10_000_000, ""]) {
      assert.throws(
        () => parseOrderIntent({ ...rawIntent(), referencePriceMicros }),
        ContractValidationError
      );
    }
  });

  it("rejects an unknown side and an invalid scale", () => {
    assert.throws(() => parseOrderIntent({ ...rawIntent(), side: "HOLD" }), ContractValidationError);
    assert.throws(() => parseOrderIntent({ ...rawIntent(), side: "buy" }), ContractValidationError);
    assert.throws(() => parseOrderIntent({ ...rawIntent(), assetScale: 19 }), ContractValidationError);
    assert.throws(() => parseOrderIntent({ ...rawIntent(), assetScale: 1.5 }), ContractValidationError);
  });

  it("rejects a non-canonical timestamp", () => {
    assert.throws(
      () => parseOrderIntent({ ...rawIntent(), createdAt: "2026-09-17T18:00:00Z" }),
      ContractValidationError
    );
  });

  it("returns a frozen intent and does not mutate the input", () => {
    const input = rawIntent();
    const before = structuredClone(input);
    const parsed = parseOrderIntent(input);

    assert.ok(Object.isFrozen(parsed));
    assert.deepEqual(input, before);
    assert.equal(parsed.referencePriceMicros, 10_000_000n);
  });

  function rawIntent(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      orderId: "order-1",
      cycleId: "cycle-1",
      agentId: "trend-following",
      side: "BUY",
      asset: "ACME",
      quote: "USD",
      positionPct: 1,
      referencePriceMicros: PRICE_MICROS,
      assetScale: SCALE,
      createdAt: AT
    };
  }
});

describe("broker determinism and purity", () => {
  it("produces an identical event for identical inputs", () => {
    const a = expectFill(execute(wallet(), {}, COSTED_POLICY));
    const b = expectFill(execute(wallet(), {}, COSTED_POLICY));

    assert.equal(a.eventId, b.eventId);
    assert.deepEqual(a, b);
  });

  it("never mutates the wallet it is given", () => {
    const start = wallet();
    const snapshot = { cashMicros: start.cashMicros, positions: [...start.positions] };
    execute(start, {}, COSTED_POLICY);

    assert.equal(start.cashMicros, snapshot.cashMicros);
    assert.deepEqual(start.positions, snapshot.positions);
    assert.ok(Object.isFrozen(start));
  });

  it("refuses an order that belongs to another agent", () => {
    assert.throws(() =>
      broker.execute({
        intent: intent({ agentId: "momentum" }),
        wallet: wallet(),
        policy: FREE_POLICY,
        occurredAt: AT
      })
    );
  });
});
