import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_EXECUTION_POLICY, PaperBroker } from "../src/broker/paper-broker.js";
import type { Broker, ExecutionOutcome, ExecutionRequest } from "../src/broker/broker.js";
import { applyEvent, createWallet, type Wallet } from "../src/portfolio/portfolio.js";
import { parseRiskPolicy, type RiskPolicy } from "../src/risk/policy.js";
import { evaluateRisk } from "../src/risk/risk-manager.js";
import {
  executePaperOrderWithRisk,
  type ExecutePaperOrderWithRiskRequest
} from "../src/execution/execute-paper-order-with-risk.js";
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

/** Records every call it receives and returns a fixed, caller-supplied outcome. */
class SpyBroker implements Broker {
  public readonly kind: string;
  public callCount = 0;
  public lastRequest: ExecutionRequest | undefined;

  constructor(
    private readonly outcome: ExecutionOutcome,
    kind = "paper"
  ) {
    this.kind = kind;
  }

  public execute(request: ExecutionRequest): ExecutionOutcome {
    this.callCount += 1;
    this.lastRequest = request;
    return this.outcome;
  }
}

/** A broker double that throws if it is ever called, for zero-call assertions. */
class NeverCalledBroker implements Broker {
  public callCount = 0;

  constructor(public readonly kind: string = "paper") {}

  public execute(): ExecutionOutcome {
    this.callCount += 1;
    throw new Error("NeverCalledBroker: execute must not be called");
  }
}

function baseRequest(
  overrides: Partial<ExecutePaperOrderWithRiskRequest> = {}
): ExecutePaperOrderWithRiskRequest {
  return {
    intent: intent(),
    wallet: createWallet("trend-following", START_CASH_MICROS),
    riskPolicy: riskPolicy(),
    executionPolicy: FREE_POLICY,
    broker: paperBroker,
    evaluatedAt: AT,
    occurredAt: AT,
    ...overrides
  };
}

describe("risk rejection stops the pipeline", () => {
  it("circuit breaker produces RISK_REJECTED and the broker is called zero times", () => {
    const broker = new NeverCalledBroker();
    const result = executePaperOrderWithRisk(
      baseRequest({ broker, riskPolicy: riskPolicy({ circuitBreaker: true }) })
    );
    assert.equal(result.status, "RISK_REJECTED");
    if (result.status === "RISK_REJECTED") {
      assert.deepEqual(result.riskDecision.codes, ["CIRCUIT_BREAKER_ACTIVE"]);
    }
    assert.equal(broker.callCount, 0);
  });

  it("an asset outside the allowlist produces RISK_REJECTED and the broker is called zero times", () => {
    const broker = new NeverCalledBroker();
    const result = executePaperOrderWithRisk(
      baseRequest({ broker, intent: intent({ asset: "ZULU" }) })
    );
    assert.equal(result.status, "RISK_REJECTED");
    if (result.status === "RISK_REJECTED") {
      assert.deepEqual(result.riskDecision.codes, ["ASSET_NOT_ALLOWED"]);
    }
    assert.equal(broker.callCount, 0);
  });

  it("invalid risk input produces RISK_REJECTED and the broker is called zero times", () => {
    const broker = new NeverCalledBroker();
    const result = executePaperOrderWithRisk(
      baseRequest({ broker, intent: intent({ agentId: "momentum" }) })
    );
    assert.equal(result.status, "RISK_REJECTED");
    if (result.status === "RISK_REJECTED") {
      assert.deepEqual(result.riskDecision.codes, ["INVALID_RISK_INPUT"]);
    }
    assert.equal(broker.callCount, 0);
  });
});

describe("an approved decision reaches the broker exactly once", () => {
  it("calls the broker once, with the intent, wallet, execution policy and instant received", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const orderIntent = intent();
    const cannedOutcome = paperBroker.execute({
      intent: orderIntent,
      wallet,
      policy: DEFAULT_EXECUTION_POLICY,
      occurredAt: AT
    });
    const broker = new SpyBroker(cannedOutcome);

    const result = executePaperOrderWithRisk(
      baseRequest({ broker, wallet, intent: orderIntent, executionPolicy: DEFAULT_EXECUTION_POLICY })
    );

    assert.equal(broker.callCount, 1);
    assert.equal(result.status, "BROKER_EXECUTED");
    if (result.status === "BROKER_EXECUTED") {
      assert.equal(result.executionOutcome, cannedOutcome);
    }
    assert.equal(broker.lastRequest?.intent, orderIntent);
    assert.equal(broker.lastRequest?.wallet, wallet);
    assert.equal(broker.lastRequest?.policy, DEFAULT_EXECUTION_POLICY);
    assert.equal(broker.lastRequest?.occurredAt, AT);
  });
});

describe("BUY approved preserves the PaperBroker's ExecutionOutcome", () => {
  it("returns exactly what the broker computes for the same request", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const expected = paperBroker.execute({
      intent: intent(),
      wallet,
      policy: FREE_POLICY,
      occurredAt: AT
    });

    const result = executePaperOrderWithRisk(baseRequest({ wallet }));

    assert.equal(result.status, "BROKER_EXECUTED");
    if (result.status === "BROKER_EXECUTED") {
      assert.deepEqual(result.executionOutcome, expected);
    }
  });
});

describe("SELL approved preserves the PaperBroker's ExecutionOutcome", () => {
  it("returns exactly what the broker computes for the same request", () => {
    const wallet = walletWithPosition(START_CASH_MICROS, 1);
    const sellIntent = intent({ side: "SELL", positionPct: 0.5 });
    const expected = paperBroker.execute({
      intent: sellIntent,
      wallet,
      policy: FREE_POLICY,
      occurredAt: AT
    });

    const result = executePaperOrderWithRisk(baseRequest({ wallet, intent: sellIntent }));

    assert.equal(result.status, "BROKER_EXECUTED");
    if (result.status === "BROKER_EXECUTED") {
      assert.deepEqual(result.executionOutcome, expected);
    }
  });
});

describe("a rejection produced by the PaperBroker itself", () => {
  it("is preserved as BROKER_EXECUTED with outcome REJECTED", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const sellIntent = intent({ side: "SELL", positionPct: 1 });

    const result = executePaperOrderWithRisk(baseRequest({ wallet, intent: sellIntent }));

    assert.equal(result.status, "BROKER_EXECUTED");
    if (result.status === "BROKER_EXECUTED") {
      assert.equal(result.riskDecision.approved, true);
      assert.equal(result.executionOutcome.status, "REJECTED");
      if (result.executionOutcome.status === "REJECTED") {
        assert.equal(result.executionOutcome.event.code, "NO_POSITION");
      }
    }
  });
});

describe("broker kind fail-closed", () => {
  it("rejects a broker whose kind is not exactly \"paper\", without calling it", () => {
    const broker = new NeverCalledBroker("live");
    assert.throws(() => executePaperOrderWithRisk(baseRequest({ broker })));
    assert.equal(broker.callCount, 0);
  });
});

describe("immutability", () => {
  it("freezes a RISK_REJECTED result", () => {
    const result = executePaperOrderWithRisk(
      baseRequest({ riskPolicy: riskPolicy({ circuitBreaker: true }) })
    );
    assert.ok(Object.isFrozen(result));
  });

  it("freezes a BROKER_EXECUTED result and its ExecutionOutcome", () => {
    const result = executePaperOrderWithRisk(baseRequest());
    assert.ok(Object.isFrozen(result));
    if (result.status === "BROKER_EXECUTED") {
      assert.ok(Object.isFrozen(result.executionOutcome));
      assert.ok(Object.isFrozen(result.executionOutcome.event));
    }
  });
});

describe("no mutation of inputs", () => {
  it("does not mutate the intent, wallet or policies", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const walletBefore = { cash: wallet.cashMicros, positions: [...wallet.positions] };
    const orderIntent = intent();
    const intentBefore = { ...orderIntent };
    const policy = riskPolicy();
    const policyBefore = { ...policy };
    const executionPolicy = FREE_POLICY;
    const executionPolicyBefore = { ...executionPolicy };

    executePaperOrderWithRisk(
      baseRequest({ wallet, intent: orderIntent, riskPolicy: policy, executionPolicy })
    );

    assert.equal(wallet.cashMicros, walletBefore.cash);
    assert.deepEqual(wallet.positions, walletBefore.positions);
    assert.deepEqual(orderIntent, intentBefore);
    assert.deepEqual(policy, policyBefore);
    assert.deepEqual(executionPolicy, executionPolicyBefore);
  });

  it("does not apply any event to the wallet passed in", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    executePaperOrderWithRisk(baseRequest({ wallet }));
    assert.equal(wallet.cashMicros, START_CASH_MICROS);
    assert.deepEqual(wallet.positions, []);
  });
});

describe("agent isolation", () => {
  it("evaluates only the wallet it is given, leaving another agent's wallet untouched", () => {
    const walletA = createWallet("trend-following", START_CASH_MICROS);
    const walletB = createWallet("momentum", START_CASH_MICROS);

    executePaperOrderWithRisk(baseRequest({ wallet: walletA }));

    assert.equal(walletB.cashMicros, START_CASH_MICROS);
    assert.deepEqual(walletB.positions, []);
  });
});

describe("determinism", () => {
  it("produces the same result for the same canonical input and timestamps", () => {
    const request = baseRequest();
    const first = executePaperOrderWithRisk(request);
    const second = executePaperOrderWithRisk(request);
    assert.deepEqual(first, second);
  });

  it("evaluates risk exactly once, matching a direct call with the same input", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const policy = riskPolicy();
    const orderIntent = intent();
    const direct = evaluateRisk({ intent: orderIntent, wallet, policy, evaluatedAt: AT });

    const result = executePaperOrderWithRisk(
      baseRequest({ wallet, riskPolicy: policy, intent: orderIntent })
    );

    assert.deepEqual(result.riskDecision, direct);
  });

  it("uses the evaluatedAt and occurredAt instants it receives independently", () => {
    const wallet = createWallet("trend-following", START_CASH_MICROS);
    const result = executePaperOrderWithRisk(
      baseRequest({ wallet, evaluatedAt: AT, occurredAt: LATER })
    );
    assert.equal(result.riskDecision.evaluatedAt, AT);
    if (result.status === "BROKER_EXECUTED" && result.executionOutcome.status === "FILLED") {
      assert.equal(result.executionOutcome.event.occurredAt, LATER);
    }
  });
});
