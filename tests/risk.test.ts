import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import { PaperBroker } from "../src/broker/paper-broker.js";
import type { FillEvent } from "../src/ledger/events.js";
import {
  applyEvent,
  createPortfolio,
  createWallet,
  walletOf,
  type Wallet
} from "../src/portfolio/portfolio.js";
import { parseRiskPolicy, type RiskPolicy } from "../src/risk/policy.js";
import { evaluateRisk, type RiskRequest } from "../src/risk/risk-manager.js";
import { RISK_RULE_CODES, createRiskDecision, type RiskDecision } from "../src/risk/decision.js";
import { AT, FREE_POLICY, START_CASH_MICROS, intent } from "./support/fixtures.js";

const broker = new PaperBroker();

function assertRejected(run: () => unknown, field: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError, "expected a ContractValidationError");
    assert.equal(error.field, field, `wrong field, got ${error.field}`);
    return true;
  });
}

function basePolicyInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    policyVersion: "risk-v1",
    allowedAssets: ["ACME"],
    maxOrderPositionBps: 10_000,
    maxAssetExposureBps: 10_000,
    maxOpenPositions: 5,
    circuitBreaker: false,
    ...overrides
  };
}

function policy(overrides: Record<string, unknown> = {}): RiskPolicy {
  return parseRiskPolicy(basePolicyInput(overrides));
}

/** A wallet for `agentId` that already holds ACME bought with `buyPositionPct` of `cashMicros`. */
function walletWithPosition(
  cashMicros: bigint,
  buyPositionPct: number,
  agentId = "trend-following"
): Wallet {
  const base = createWallet(agentId, cashMicros);
  const outcome = broker.execute({
    intent: intent({ agentId, positionPct: buyPositionPct }),
    wallet: base,
    policy: FREE_POLICY,
    occurredAt: AT
  });
  assert.equal(outcome.status, "FILLED");
  return applyEvent(base, outcome.event as FillEvent);
}

describe("RiskPolicy validation", () => {
  it("accepts a valid policy and freezes it", () => {
    const parsed = policy();
    assert.ok(Object.isFrozen(parsed));
    assert.ok(Object.isFrozen(parsed.allowedAssets));
    assert.equal(parsed.policyVersion, "risk-v1");
  });

  it("rejects each invalid field", () => {
    assertRejected(() => parseRiskPolicy(basePolicyInput({ schemaVersion: 2 })), "schemaVersion");
    assertRejected(() => parseRiskPolicy(basePolicyInput({ policyVersion: "" })), "policyVersion");
    assertRejected(() => parseRiskPolicy(basePolicyInput({ policyVersion: "   " })), "policyVersion");
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ policyVersion: "bad version" })),
      "policyVersion"
    );
    assertRejected(() => parseRiskPolicy(basePolicyInput({ allowedAssets: "ACME" })), "allowedAssets");
    assertRejected(() => parseRiskPolicy(basePolicyInput({ allowedAssets: ["acme"] })), "allowedAssets");
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ allowedAssets: ["ACME", "ACME"] })),
      "allowedAssets"
    );
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ maxOrderPositionBps: -1 })),
      "maxOrderPositionBps"
    );
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ maxOrderPositionBps: 10_001 })),
      "maxOrderPositionBps"
    );
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ maxAssetExposureBps: -1 })),
      "maxAssetExposureBps"
    );
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ maxAssetExposureBps: 10_001 })),
      "maxAssetExposureBps"
    );
    assertRejected(() => parseRiskPolicy(basePolicyInput({ maxOpenPositions: -1 })), "maxOpenPositions");
    assertRejected(() => parseRiskPolicy(basePolicyInput({ maxOpenPositions: 1.5 })), "maxOpenPositions");
    assertRejected(
      () => parseRiskPolicy(basePolicyInput({ circuitBreaker: "false" })),
      "circuitBreaker"
    );
  });
});

describe("circuit breaker", () => {
  it("blocks a BUY", () => {
    const decision = evaluateRisk({
      intent: intent({ side: "BUY" }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ circuitBreaker: true }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["CIRCUIT_BREAKER_ACTIVE"]);
  });

  it("blocks a SELL too", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 1);
    const decision = evaluateRisk({
      intent: intent({ side: "SELL", positionPct: 0.5 }),
      wallet,
      policy: policy({ circuitBreaker: true }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["CIRCUIT_BREAKER_ACTIVE"]);
  });
});

describe("allowlist", () => {
  it("approves an asset on the list", () => {
    const decision = evaluateRisk({
      intent: intent({ asset: "ACME" }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ allowedAssets: ["ACME"] }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
    assert.deepEqual(decision.codes, []);
  });

  it("blocks an asset outside the list", () => {
    const decision = evaluateRisk({
      intent: intent({ asset: "ZULU" }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ allowedAssets: ["ACME"] }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["ASSET_NOT_ALLOWED"]);
  });
});

describe("order size limit", () => {
  it("approves exactly at the boundary", () => {
    const decision = evaluateRisk({
      intent: intent({ positionPct: 0.5 }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ maxOrderPositionBps: 5000, maxAssetExposureBps: 10_000 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
  });

  it("blocks just above the boundary", () => {
    const decision = evaluateRisk({
      intent: intent({ positionPct: 0.5 }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ maxOrderPositionBps: 4999, maxAssetExposureBps: 10_000 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["ORDER_SIZE_LIMIT_EXCEEDED"]);
  });
});

describe("asset exposure limit", () => {
  it("approves exactly at the boundary with no prior position", () => {
    const decision = evaluateRisk({
      intent: intent({ positionPct: 0.5 }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ maxOrderPositionBps: 10_000, maxAssetExposureBps: 5000 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
  });

  it("blocks just above the boundary with no prior position", () => {
    const decision = evaluateRisk({
      intent: intent({ positionPct: 0.5 }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ maxOrderPositionBps: 10_000, maxAssetExposureBps: 4999 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["ASSET_EXPOSURE_LIMIT_EXCEEDED"]);
  });

  it("includes the value of an existing position in the baseline", () => {
    // US$200 wallet buys US$100 of ACME, leaving US$100 cash and US$100 held.
    const wallet = walletWithPosition(200_000_000n, 0.5);
    const decision = evaluateRisk({
      intent: intent({ positionPct: 0.5 }),
      wallet,
      policy: policy({ maxOrderPositionBps: 10_000, maxAssetExposureBps: 7500 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
  });

  it("blocks just above the boundary once the existing position is included", () => {
    const wallet = walletWithPosition(200_000_000n, 0.5);
    const decision = evaluateRisk({
      intent: intent({ positionPct: 0.5 }),
      wallet,
      policy: policy({ maxOrderPositionBps: 10_000, maxAssetExposureBps: 7499 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["ASSET_EXPOSURE_LIMIT_EXCEEDED"]);
  });

  it("does not apply to a SELL that reduces risk", () => {
    const wallet = walletWithPosition(200_000_000n, 0.5);
    const decision = evaluateRisk({
      intent: intent({ side: "SELL", positionPct: 0.5 }),
      wallet,
      policy: policy({ maxOrderPositionBps: 10_000, maxAssetExposureBps: 0, maxOpenPositions: 0 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
    assert.deepEqual(decision.codes, []);
  });
});

describe("max open positions", () => {
  it("blocks a new position once the limit is already reached", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 0.1);
    const decision = evaluateRisk({
      intent: intent({ asset: "ZULU", positionPct: 0.1 }),
      wallet,
      policy: policy({ allowedAssets: ["ACME", "ZULU"], maxOpenPositions: 1 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["MAX_OPEN_POSITIONS_REACHED"]);
  });

  it("allows a new position while the limit still has room", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 0.1);
    const decision = evaluateRisk({
      intent: intent({ asset: "ZULU", positionPct: 0.1 }),
      wallet,
      policy: policy({ allowedAssets: ["ACME", "ZULU"], maxOpenPositions: 2 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
  });

  it("does not count a BUY into an already-held asset as a new position", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 0.1);
    const decision = evaluateRisk({
      intent: intent({ asset: "ACME", positionPct: 0.1 }),
      wallet,
      policy: policy({ maxOpenPositions: 1 }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, true);
  });
});

describe("multiple simultaneous violations", () => {
  it("orders every triggered code the same way, regardless of which rules fired", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 0.1);
    const decision = evaluateRisk({
      intent: intent({ asset: "ZULU", positionPct: 0.5 }),
      wallet,
      policy: policy({
        allowedAssets: [],
        circuitBreaker: true,
        maxOrderPositionBps: 0,
        maxAssetExposureBps: 0,
        maxOpenPositions: 1
      }),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, RISK_RULE_CODES);
  });
});

describe("fail-closed on inconsistent input", () => {
  it("rejects a wallet belonging to a different agent than the order", () => {
    const decision = evaluateRisk({
      intent: intent({ agentId: "momentum" }),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy(),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["INVALID_RISK_INPUT"]);
  });

  it("rejects a non-canonical evaluation timestamp", () => {
    const decision = evaluateRisk({
      intent: intent(),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy(),
      evaluatedAt: "2026-09-17 18:00:00"
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["INVALID_RISK_INPUT"]);
  });

  it("rejects an order whose asset scale disagrees with the held position", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 0.5);
    const decision = evaluateRisk({
      intent: intent({ assetScale: 8 }),
      wallet,
      policy: policy(),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["INVALID_RISK_INPUT"]);
  });

  it("rejects a BUY from a wallet with zero cash and no position, since exposure is undefined", () => {
    const decision = evaluateRisk({
      intent: intent(),
      wallet: createWallet("trend-following", 0n),
      policy: policy(),
      evaluatedAt: AT
    });
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.codes, ["INVALID_RISK_INPUT"]);
  });
});

describe("determinism and immutability", () => {
  it("produces the same id for the same canonical input", () => {
    const request: RiskRequest = {
      intent: intent(),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy(),
      evaluatedAt: AT
    };
    const first = evaluateRisk(request);
    const second = evaluateRisk(request);
    assert.equal(first.id, second.id);
    assert.deepEqual(first, second);
  });

  it("changes the id when the outcome changes", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const approved = evaluateRisk({ intent: intent(), wallet, policy: policy(), evaluatedAt: AT });
    const blocked = evaluateRisk({
      intent: intent(),
      wallet,
      policy: policy({ circuitBreaker: true }),
      evaluatedAt: AT
    });
    assert.notEqual(approved.id, blocked.id);
  });

  it("does not depend on the order the draft fields were written in", () => {
    const decision = evaluateRisk({
      intent: intent(),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy(),
      evaluatedAt: AT
    });
    const draft = { ...decision } as Record<string, unknown>;
    delete draft.id;
    const reversed = Object.fromEntries(Object.entries(draft).reverse());

    assert.equal(
      createRiskDecision(draft as unknown as Omit<RiskDecision, "id">).id,
      createRiskDecision(reversed as unknown as Omit<RiskDecision, "id">).id
    );
  });

  it("freezes the decision and its codes", () => {
    const decision = evaluateRisk({
      intent: intent(),
      wallet: createWallet("trend-following", START_CASH_MICROS),
      policy: policy({ circuitBreaker: true }),
      evaluatedAt: AT
    });
    assert.ok(Object.isFrozen(decision));
    assert.ok(Object.isFrozen(decision.codes));
  });

  it("never mutates the wallet or the intent it evaluates", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 0.5);
    const before = { cash: wallet.cashMicros, positions: [...wallet.positions] };
    const request = intent({ positionPct: 0.25 });
    const requestBefore = { ...request };

    evaluateRisk({ intent: request, wallet, policy: policy(), evaluatedAt: AT });

    assert.equal(wallet.cashMicros, before.cash);
    assert.deepEqual(wallet.positions, before.positions);
    assert.deepEqual(request, requestBefore);
  });
});

describe("agent isolation", () => {
  it("evaluates only the wallet it is given, leaving the rest of the portfolio untouched", () => {
    const walletA = walletWithPosition(START_CASH_MICROS, 0.5, "trend-following");
    const walletB = createWallet("momentum", START_CASH_MICROS);
    const portfolio = createPortfolio([walletA, walletB]);
    const evaluated = walletOf(portfolio, "trend-following");
    assert.ok(evaluated !== undefined);

    evaluateRisk({
      intent: intent({ agentId: "trend-following", positionPct: 0.25 }),
      wallet: evaluated,
      policy: policy(),
      evaluatedAt: AT
    });

    assert.equal(walletOf(portfolio, "momentum")?.cashMicros, START_CASH_MICROS);
    assert.deepEqual(walletOf(portfolio, "momentum")?.positions, []);
  });
});
