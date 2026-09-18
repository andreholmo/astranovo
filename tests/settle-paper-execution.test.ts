import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_EXECUTION_POLICY, PaperBroker } from "../src/broker/paper-broker.js";
import { createFillEvent } from "../src/ledger/events.js";
import type { FillEvent } from "../src/ledger/events.js";
import { AgentLedger, LedgerAgentMismatchError, LedgerConflictError } from "../src/ledger/ledger.js";
import { applyEvent, createWallet, positionOf, type Wallet } from "../src/portfolio/portfolio.js";
import { parseRiskPolicy, type RiskPolicy } from "../src/risk/policy.js";
import {
  executePaperOrderWithRisk,
  type ExecutePaperOrderWithRiskResult
} from "../src/execution/execute-paper-order-with-risk.js";
import {
  settlePaperExecution,
  type SettlePaperExecutionRequest
} from "../src/execution/settle-paper-execution.js";
import { AT, FREE_POLICY, LATER, START_CASH_MICROS, intent } from "./support/fixtures.js";

const paperBroker = new PaperBroker();

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

function riskPolicy(overrides: Record<string, unknown> = {}): RiskPolicy {
  return parseRiskPolicy(basePolicyInput(overrides));
}

/** A wallet for `agentId` that already holds ACME bought with `buyPositionPct` of `cashMicros`. */
function walletWithPosition(
  cashMicros: bigint,
  buyPositionPct: number,
  agentId = "trend-following"
): Wallet {
  const base = createWallet(agentId, cashMicros);
  const outcome = paperBroker.execute({
    intent: intent({ agentId, positionPct: buyPositionPct }),
    wallet: base,
    policy: FREE_POLICY,
    occurredAt: AT
  });
  assert.equal(outcome.status, "FILLED");
  return applyEvent(base, outcome.event);
}

function approvedResult(
  overrides: Partial<{
    readonly agentId: string;
    readonly wallet: Wallet;
    readonly orderId: string;
    readonly side: "BUY" | "SELL";
    readonly positionPct: number;
  }> = {}
): { readonly wallet: Wallet; readonly executionResult: ExecutePaperOrderWithRiskResult } {
  const agentId = overrides.agentId ?? "trend-following";
  const wallet = overrides.wallet ?? createWallet(agentId, START_CASH_MICROS);
  const executionResult = executePaperOrderWithRisk({
    intent: intent({
      agentId,
      ...(overrides.orderId !== undefined ? { orderId: overrides.orderId } : {}),
      ...(overrides.side !== undefined ? { side: overrides.side } : {}),
      ...(overrides.positionPct !== undefined ? { positionPct: overrides.positionPct } : {})
    }),
    wallet,
    riskPolicy: riskPolicy(),
    executionPolicy: FREE_POLICY,
    broker: paperBroker,
    evaluatedAt: AT,
    occurredAt: AT
  });
  return { wallet, executionResult };
}

function baseRequest(
  overrides: Partial<SettlePaperExecutionRequest> = {}
): SettlePaperExecutionRequest {
  const agentId = "trend-following";
  const wallet = overrides.wallet ?? createWallet(agentId, START_CASH_MICROS);
  return {
    executionResult:
      overrides.executionResult ?? approvedResult({ agentId, wallet }).executionResult,
    wallet,
    ledger: overrides.ledger ?? AgentLedger.empty(agentId)
  };
}

describe("RISK_REJECTED", () => {
  it("creates zero events and returns the same wallet and ledger by reference", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const ledger = AgentLedger.empty("trend-following");
    const executionResult = executePaperOrderWithRisk({
      intent: intent(),
      wallet,
      riskPolicy: riskPolicy({ circuitBreaker: true }),
      executionPolicy: FREE_POLICY,
      broker: paperBroker,
      evaluatedAt: AT,
      occurredAt: AT
    });
    assert.equal(executionResult.status, "RISK_REJECTED");

    const result = settlePaperExecution({ executionResult, wallet, ledger });

    assert.equal(result.status, "RISK_REJECTED");
    assert.equal(result.wallet, wallet);
    assert.equal(result.ledger, ledger);
    assert.equal(ledger.events.length, 0);
  });
});

describe("BUY filled", () => {
  it("appends one event and updates cash and position once", () => {
    const agentId = "trend-following";
    const wallet = createWallet(agentId, START_CASH_MICROS);
    const ledger = AgentLedger.empty(agentId);
    const { executionResult } = approvedResult({ agentId, wallet });
    assert.equal(executionResult.status, "BROKER_EXECUTED");
    if (executionResult.status !== "BROKER_EXECUTED") return;
    assert.equal(executionResult.executionOutcome.status, "FILLED");

    const result = settlePaperExecution({ executionResult, wallet, ledger });

    assert.equal(result.status, "BROKER_RECORDED");
    if (result.status !== "BROKER_RECORDED") return;
    assert.equal(result.appended, true);
    assert.equal(result.event, executionResult.executionOutcome.event);
    assert.equal(result.ledger.events.length, 1);
    assert.equal(result.wallet.cashMicros, 0n);
    assert.equal(positionOf(result.wallet, "ACME")?.quantityAtoms, 10_00n);
  });
});

describe("SELL filled", () => {
  it("appends one event and updates cash and position once", () => {
    const agentId = "trend-following";
    const wallet = walletWithPosition(START_CASH_MICROS, 1, agentId);
    const ledger = AgentLedger.empty(agentId);
    const { executionResult } = approvedResult({
      agentId,
      wallet,
      side: "SELL",
      positionPct: 0.5
    });
    assert.equal(executionResult.status, "BROKER_EXECUTED");
    if (executionResult.status !== "BROKER_EXECUTED") return;
    assert.equal(executionResult.executionOutcome.status, "FILLED");

    const result = settlePaperExecution({ executionResult, wallet, ledger });

    assert.equal(result.status, "BROKER_RECORDED");
    if (result.status !== "BROKER_RECORDED") return;
    assert.equal(result.appended, true);
    assert.equal(result.ledger.events.length, 1);
    assert.equal(result.wallet.cashMicros > 0n, true);
    assert.equal(positionOf(result.wallet, "ACME")?.quantityAtoms, 5_00n);
  });
});

describe("PaperBroker rejection", () => {
  it("is appended to the ledger but leaves the wallet unchanged by reference", () => {
    const agentId = "trend-following";
    const wallet = createWallet(agentId, START_CASH_MICROS);
    const ledger = AgentLedger.empty(agentId);
    const { executionResult } = approvedResult({ agentId, wallet, side: "SELL", positionPct: 1 });
    assert.equal(executionResult.status, "BROKER_EXECUTED");
    if (executionResult.status !== "BROKER_EXECUTED") return;
    assert.equal(executionResult.executionOutcome.status, "REJECTED");

    const result = settlePaperExecution({ executionResult, wallet, ledger });

    assert.equal(result.status, "BROKER_RECORDED");
    if (result.status !== "BROKER_RECORDED") return;
    assert.equal(result.appended, true);
    assert.equal(result.ledger.events.length, 1);
    assert.equal(result.ledger.events[0]?.type, "REJECTION");
    assert.equal(result.wallet, wallet, "a rejection must not produce a new wallet");
  });
});

describe("identical replay", () => {
  it("returns appended: false, no second event and no second wallet effect", () => {
    const agentId = "trend-following";
    const wallet = createWallet(agentId, START_CASH_MICROS);
    const ledger = AgentLedger.empty(agentId);
    const { executionResult } = approvedResult({ agentId, wallet });

    const first = settlePaperExecution({ executionResult, wallet, ledger });
    assert.equal(first.status, "BROKER_RECORDED");
    if (first.status !== "BROKER_RECORDED") return;
    assert.equal(first.appended, true);

    const second = settlePaperExecution({
      executionResult,
      wallet: first.wallet,
      ledger: first.ledger
    });
    assert.equal(second.status, "BROKER_RECORDED");
    if (second.status !== "BROKER_RECORDED") return;

    assert.equal(second.appended, false);
    assert.equal(second.ledger, first.ledger, "a replay must not produce a new ledger");
    assert.equal(second.wallet, first.wallet, "a replay must not move cash or position again");
    assert.equal(second.event, first.event);
    assert.equal(second.ledger.events.length, 1);
  });
});

describe("conflict on the same orderId", () => {
  it("throws LedgerConflictError when the content differs", () => {
    const agentId = "trend-following";
    const orderId = "shared-order";
    const first = approvedResult({ agentId, orderId });
    const second = approvedResult({ agentId, orderId, positionPct: 0.5 });

    const ledger = settlePaperExecution({
      executionResult: first.executionResult,
      wallet: first.wallet,
      ledger: AgentLedger.empty(agentId)
    });
    assert.equal(ledger.status, "BROKER_RECORDED");
    if (ledger.status !== "BROKER_RECORDED") return;

    assert.throws(
      () =>
        settlePaperExecution({
          executionResult: second.executionResult,
          wallet: ledger.wallet,
          ledger: ledger.ledger
        }),
      LedgerConflictError
    );
    assert.equal(ledger.ledger.events.length, 1, "a conflict must leave the ledger untouched");
  });
});

describe("wallet and ledger of different agents", () => {
  it("fails closed before any append is attempted", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const ledger = AgentLedger.empty("momentum");
    const { executionResult } = approvedResult({ agentId: "trend-following", wallet });

    assert.throws(() => settlePaperExecution({ executionResult, wallet, ledger }));
    assert.equal(ledger.events.length, 0);
  });
});

describe("an event belonging to another agent", () => {
  it("fails closed via the ledger's own agent check", () => {
    const agentId = "trend-following";
    const wallet = createWallet(agentId, START_CASH_MICROS);
    const ledger = AgentLedger.empty(agentId);
    const { executionResult } = approvedResult({ agentId, wallet });
    assert.equal(executionResult.status, "BROKER_EXECUTED");
    if (executionResult.status !== "BROKER_EXECUTED") return;
    assert.equal(executionResult.executionOutcome.status, "FILLED");
    const original = executionResult.executionOutcome.event as FillEvent;
    const { eventId: _eventId, ...draft } = original;

    const foreignEvent = createFillEvent({ ...draft, agentId: "momentum" });
    const foreignResult: ExecutePaperOrderWithRiskResult = Object.freeze({
      status: "BROKER_EXECUTED" as const,
      riskDecision: executionResult.riskDecision,
      executionOutcome: Object.freeze({ status: "FILLED" as const, event: foreignEvent })
    });

    assert.throws(
      () => settlePaperExecution({ executionResult: foreignResult, wallet, ledger }),
      LedgerAgentMismatchError
    );
    assert.equal(ledger.events.length, 0);
  });
});

describe("agent isolation", () => {
  it("settling agent A does not change agent B's ledger or wallet", () => {
    const walletA = createWallet("trend-following", START_CASH_MICROS);
    const ledgerA = AgentLedger.empty("trend-following");
    const walletB = createWallet("momentum", START_CASH_MICROS);
    const ledgerB = AgentLedger.empty("momentum");
    const { executionResult } = approvedResult({ agentId: "trend-following", wallet: walletA });

    settlePaperExecution({ executionResult, wallet: walletA, ledger: ledgerA });

    assert.equal(walletB.cashMicros, START_CASH_MICROS);
    assert.deepEqual(walletB.positions, []);
    assert.equal(ledgerB.events.length, 0);
  });
});

describe("immutability", () => {
  it("freezes a RISK_REJECTED result", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const executionResult = executePaperOrderWithRisk({
      intent: intent(),
      wallet,
      riskPolicy: riskPolicy({ circuitBreaker: true }),
      executionPolicy: FREE_POLICY,
      broker: paperBroker,
      evaluatedAt: AT,
      occurredAt: AT
    });
    const result = settlePaperExecution({
      executionResult,
      wallet,
      ledger: AgentLedger.empty("trend-following")
    });
    assert.ok(Object.isFrozen(result));
  });

  it("freezes a BROKER_RECORDED result, its ledger and its wallet", () => {
    const result = settlePaperExecution(baseRequest());
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.ledger));
    assert.ok(Object.isFrozen(result.wallet));
    if (result.status === "BROKER_RECORDED") {
      assert.ok(Object.isFrozen(result.event));
    }
  });
});

describe("no mutation of inputs", () => {
  it("does not mutate the executionResult, wallet or ledger passed in", () => {
    const agentId = "trend-following";
    const wallet = createWallet(agentId, START_CASH_MICROS);
    const ledger = AgentLedger.empty(agentId);
    const { executionResult } = approvedResult({ agentId, wallet });
    const executionResultBefore = JSON.stringify(executionResult, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    const walletBefore = { cash: wallet.cashMicros, positions: [...wallet.positions] };

    settlePaperExecution({ executionResult, wallet, ledger });

    const executionResultAfter = JSON.stringify(executionResult, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    assert.equal(executionResultAfter, executionResultBefore);
    assert.equal(wallet.cashMicros, walletBefore.cash);
    assert.deepEqual(wallet.positions, walletBefore.positions);
    assert.equal(ledger.events.length, 0);
  });
});

describe("determinism", () => {
  it("produces the same accounting outcome for the same canonical input", () => {
    const agentId = "trend-following";
    const first = approvedResult({ agentId });
    const second = approvedResult({ agentId });

    const firstResult = settlePaperExecution({
      executionResult: first.executionResult,
      wallet: first.wallet,
      ledger: AgentLedger.empty(agentId)
    });
    const secondResult = settlePaperExecution({
      executionResult: second.executionResult,
      wallet: second.wallet,
      ledger: AgentLedger.empty(agentId)
    });

    assert.equal(firstResult.status, secondResult.status);
    assert.equal(firstResult.wallet.cashMicros, secondResult.wallet.cashMicros);
    assert.deepEqual(firstResult.wallet.positions, secondResult.wallet.positions);
    if (firstResult.status === "BROKER_RECORDED" && secondResult.status === "BROKER_RECORDED") {
      assert.deepEqual(firstResult.event, secondResult.event);
      assert.equal(firstResult.appended, secondResult.appended);
    }
  });

  it("uses evaluatedAt and occurredAt independently through to the settled event", () => {
    const agentId = "trend-following";
    const wallet = createWallet(agentId, START_CASH_MICROS);
    const executionResult = executePaperOrderWithRisk({
      intent: intent({ agentId }),
      wallet,
      riskPolicy: riskPolicy(),
      executionPolicy: DEFAULT_EXECUTION_POLICY,
      broker: paperBroker,
      evaluatedAt: AT,
      occurredAt: LATER
    });

    const result = settlePaperExecution({
      executionResult,
      wallet,
      ledger: AgentLedger.empty(agentId)
    });

    assert.equal(result.status, "BROKER_RECORDED");
    if (result.status === "BROKER_RECORDED") {
      assert.equal(result.event.occurredAt, LATER);
    }
  });
});
