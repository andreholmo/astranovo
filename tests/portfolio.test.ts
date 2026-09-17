import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { PaperBroker } from "../src/broker/paper-broker.js";
import { AgentLedger, Ledger } from "../src/ledger/ledger.js";
import { createFillEvent, type FillEvent, type LedgerEvent } from "../src/ledger/events.js";
import { loadAgentsConfig, parseAgentsConfig } from "../src/config/load-agents.js";
import {
  applyAppendResult,
  applyEvent,
  createInitialWallets,
  createPortfolio,
  createWallet,
  positionOf,
  replayPortfolio,
  replayWallet,
  walletOf,
  type Wallet
} from "../src/portfolio/portfolio.js";
import { AT, COSTED_POLICY, FREE_POLICY, LATER, START_CASH_MICROS, intent } from "./support/fixtures.js";

const broker = new PaperBroker();

function execute(
  wallet: Wallet,
  overrides: Parameters<typeof intent>[0],
  policy = FREE_POLICY,
  occurredAt = AT
): LedgerEvent {
  return broker.execute({
    intent: intent({ agentId: wallet.agentId, ...overrides }),
    wallet,
    policy,
    occurredAt
  }).event;
}

describe("initial wallets", () => {
  it("funds six isolated wallets with US$100 each", async () => {
    const wallets = createInitialWallets(await loadAgentsConfig());

    assert.equal(wallets.length, 6);
    for (const wallet of wallets) {
      assert.equal(wallet.cashMicros, 100_000_000n);
      assert.equal(wallet.initialCashMicros, 100_000_000n);
      assert.deepEqual(wallet.positions, []);
      assert.ok(Object.isFrozen(wallet));
    }
    assert.deepEqual(
      wallets.map((wallet) => wallet.agentId),
      [
        "trend-following",
        "mean-reversion",
        "breakout",
        "momentum",
        "volatility-filtered",
        "conservative-baseline"
      ]
    );
  });

  it("extends to a seventh agent with its own budget", async () => {
    const shipped = await loadAgentsConfig();
    const config = parseAgentsConfig({
      schemaVersion: 1,
      agents: [
        ...shipped.agents.map((agent) => ({ ...agent })),
        {
          id: "liquidity-aware",
          name: "Liquidity Aware",
          strategy: "liquidity-aware",
          enabled: true,
          initialBudgetUsd: 250.5,
          mode: "optimized"
        }
      ]
    });
    const wallets = createInitialWallets(config);

    assert.equal(wallets.length, 7);
    assert.equal(wallets[6]?.agentId, "liquidity-aware");
    assert.equal(wallets[6]?.cashMicros, 250_500_000n);
  });

  it("funds only the enabled agents", () => {
    const config = parseAgentsConfig({
      schemaVersion: 1,
      agents: [
        { id: "a", name: "A", strategy: "a", enabled: true, initialBudgetUsd: 100, mode: "reference" },
        { id: "b", name: "B", strategy: "b", enabled: false, initialBudgetUsd: 100, mode: "reference" }
      ]
    });

    assert.deepEqual(
      createInitialWallets(config).map((wallet) => wallet.agentId),
      ["a"]
    );
  });

  it("rejects a budget that micros cannot hold exactly", () => {
    const config = parseAgentsConfig({
      schemaVersion: 1,
      agents: [
        {
          id: "a",
          name: "A",
          strategy: "a",
          enabled: true,
          initialBudgetUsd: 0.0000001,
          mode: "reference"
        }
      ]
    });

    assert.throws(() => createInitialWallets(config), ContractValidationError);
  });
});

describe("applying events", () => {
  it("leaves the wallet untouched on a rejection", () => {
    const wallet = createWallet("trend-following", 0n);
    const event = execute(wallet, { side: "SELL" });

    assert.equal(event.type, "REJECTION");
    assert.equal(applyEvent(wallet, event), wallet, "a rejection returns the very same wallet");
  });

  it("never mutates the wallet it is applied to", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const before = { cash: wallet.cashMicros, positions: [...wallet.positions] };
    applyEvent(wallet, execute(wallet, {}));

    assert.equal(wallet.cashMicros, before.cash);
    assert.deepEqual(wallet.positions, before.positions);
  });

  it("keeps positions sorted by asset so equal wallets compare equal", () => {
    let wallet = createWallet("trend-following", 300_000_000n);
    wallet = applyEvent(wallet, execute(wallet, { orderId: "o-z", asset: "ZULU", positionPct: 0.3 }));
    wallet = applyEvent(wallet, execute(wallet, { orderId: "o-a", asset: "ALFA", positionPct: 0.3 }));

    assert.deepEqual(
      wallet.positions.map((position) => position.asset),
      ["ALFA", "ZULU"]
    );
  });

  it("refuses an event belonging to another agent", () => {
    const wallet = createWallet("momentum", START_CASH_MICROS);
    const foreign = execute(createWallet("trend-following", START_CASH_MICROS), {});

    assert.throws(() => applyEvent(wallet, foreign), ContractValidationError);
  });

  it("refuses a fill that would overdraw the wallet", () => {
    const wallet = createWallet("trend-following", 1_000n);
    const overdraft = forgedFill({ totalMicros: 2_000n, side: "BUY" });

    assert.throws(() => applyEvent(wallet, overdraft), ContractValidationError);
  });

  it("refuses a fill that would sell more than the position", () => {
    let wallet = createWallet("trend-following", START_CASH_MICROS);
    wallet = applyEvent(wallet, execute(wallet, {}));
    const oversell = forgedFill({ side: "SELL", quantityAtoms: 5_000n, totalMicros: 1n });

    assert.throws(() => applyEvent(wallet, oversell), ContractValidationError);
  });

  it("refuses a fill whose asset scale disagrees with the position", () => {
    let wallet = createWallet("trend-following", START_CASH_MICROS);
    wallet = applyEvent(wallet, execute(wallet, {}));
    const mismatched = forgedFill({ side: "BUY", quantityAtoms: 1n, totalMicros: 1n, assetScale: 8 });

    assert.throws(() => applyEvent(wallet, mismatched), ContractValidationError);
  });

  function forgedFill(overrides: Partial<FillEvent>): FillEvent {
    return createFillEvent({
      schemaVersion: 1,
      type: "FILL",
      orderId: "forged",
      cycleId: "cycle-1",
      agentId: "trend-following",
      side: "BUY",
      asset: "ACME",
      quote: "USD",
      assetScale: 2,
      quantityAtoms: 1n,
      referencePriceMicros: 10_000_000n,
      effectivePriceMicros: 10_000_000n,
      grossMicros: 1n,
      feeMicros: 0n,
      totalMicros: 1n,
      feeBps: 0,
      spreadBps: 0,
      slippageBps: 0,
      occurredAt: AT,
      policyVersion: "free",
      ...overrides
    });
  }
});

describe("idempotent application", () => {
  it("does not apply an event that the ledger recognised as a replay", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const event = execute(wallet, {});

    const first = AgentLedger.empty("trend-following").append(event);
    const afterFirst = applyAppendResult(wallet, first);
    const second = first.ledger.append(event);
    const afterSecond = applyAppendResult(afterFirst, second);

    assert.equal(second.appended, false);
    assert.equal(afterSecond, afterFirst, "a replay must not move cash a second time");
    assert.equal(afterSecond.cashMicros, 0n);
    assert.equal(positionOf(afterSecond, "ACME")?.quantityAtoms, 1000n);
  });
});

describe("replay", () => {
  it("rebuilds cash and positions exactly", () => {
    let wallet = createWallet("trend-following", START_CASH_MICROS);
    const events: LedgerEvent[] = [];

    for (const step of [
      { orderId: "o1", side: "BUY", positionPct: 0.5, at: AT },
      { orderId: "o2", side: "BUY", positionPct: 0.5, at: AT },
      { orderId: "o3", side: "SELL", positionPct: 0.25, at: LATER },
      { orderId: "o4", side: "SELL", positionPct: 1, at: LATER },
      { orderId: "o5", side: "SELL", positionPct: 1, at: LATER }
    ] as const) {
      const event = execute(wallet, { orderId: step.orderId, side: step.side, positionPct: step.positionPct }, COSTED_POLICY, step.at);
      events.push(event);
      wallet = applyEvent(wallet, event);
    }

    const replayed = replayWallet("trend-following", START_CASH_MICROS, events);

    assert.deepEqual(replayed, wallet);
    assert.equal(replayed.cashMicros, wallet.cashMicros);
    assert.deepEqual(replayed.positions, wallet.positions);
    assert.ok(
      events.some((event) => event.type === "REJECTION"),
      "the sequence must include a rejection so replay is proven to skip it"
    );
  });

  it("is stable across repeated replays", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const events = [execute(wallet, {})];

    assert.deepEqual(
      replayWallet("trend-following", START_CASH_MICROS, events),
      replayWallet("trend-following", START_CASH_MICROS, events)
    );
  });

  it("rebuilds a whole portfolio from its ledgers", () => {
    const agentIds = ["trend-following", "momentum"];
    let ledger = Ledger.forAgents(agentIds);
    let wallets = agentIds.map((agentId) => createWallet(agentId, START_CASH_MICROS));

    wallets = wallets.map((wallet) => {
      const event = execute(wallet, { orderId: `buy-${wallet.agentId}`, positionPct: 0.5 });
      ledger = ledger.append(event).ledger;
      return applyEvent(wallet, event);
    });

    const live = createPortfolio(wallets);
    const replayed = replayPortfolio(wallets, (agentId) => ledger.agent(agentId)?.events ?? []);

    assert.deepEqual(replayed, live);
    assert.equal(walletOf(replayed, "trend-following")?.cashMicros, 50_000_000n);
    assert.equal(walletOf(replayed, "unknown"), undefined);
  });
});

describe("agent isolation", () => {
  it("leaves every other wallet untouched when one agent trades", async () => {
    const wallets = createInitialWallets(await loadAgentsConfig());
    const [first, ...rest] = wallets;
    assert.ok(first !== undefined);

    const traded = applyEvent(first, execute(first, {}));

    assert.equal(traded.cashMicros, 0n);
    for (const other of rest) {
      assert.equal(other.cashMicros, 100_000_000n);
      assert.deepEqual(other.positions, []);
    }
    assert.equal(first.cashMicros, 100_000_000n, "the pre-trade wallet is unchanged");
  });

  it("keeps two agents on the same asset independent", () => {
    const a = createWallet("trend-following", START_CASH_MICROS);
    const b = createWallet("momentum", START_CASH_MICROS);

    const afterA = applyEvent(a, execute(a, { positionPct: 1 }));
    const afterB = applyEvent(b, execute(b, { positionPct: 0.25 }));

    assert.equal(positionOf(afterA, "ACME")?.quantityAtoms, 1000n);
    assert.equal(positionOf(afterB, "ACME")?.quantityAtoms, 250n);
    assert.equal(afterA.cashMicros, 0n);
    assert.equal(afterB.cashMicros, 75_000_000n);
  });
});
