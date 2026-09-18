/**
 * The deterministic facade that makes the mandatory sequence explicit:
 *
 * `OrderIntent` validado → `evaluateRisk` → bloqueio OU `PaperBroker.execute`.
 *
 * Per D-003, an order the Risk Manager rejects can never reach a broker. This
 * module is the only place that wires the two together, so that invariant is
 * structural rather than something every caller has to remember to respect.
 *
 * `executePaperOrderWithRisk` is a pure function: it evaluates risk exactly
 * once, calls the broker at most once, never reads the clock, never mutates
 * its inputs, and never touches the ledger or a portfolio. Approval by the
 * Risk Manager is not a guaranteed fill — the `PaperBroker` can still reject
 * for cash, position, quantity or cost reasons, and that rejection is
 * returned as-is, not reinterpreted.
 *
 * A broker whose `kind` is not exactly `"paper"` is rejected fail-closed
 * before risk is evaluated or the broker is touched: this facade authorises
 * only the `PaperBroker` that already exists in this repository (D-002), not
 * a testnet or live adapter.
 *
 * Unexpected exceptions from `evaluateRisk` or `broker.execute` are not
 * caught here. Catching and silently reinterpreting them would hide a bug
 * behind a result that looks like a normal outcome.
 */

import type { ExecutionPolicy, OrderIntent } from "../domain/contracts.js";
import type { Broker, ExecutionOutcome } from "../broker/broker.js";
import type { Wallet } from "../portfolio/portfolio.js";
import type { RiskPolicy } from "../risk/policy.js";
import { evaluateRisk } from "../risk/risk-manager.js";
import type { RiskDecision } from "../risk/decision.js";

/** The only broker kind this facade is authorised to call. */
const PAPER_BROKER_KIND = "paper";

/** Everything one call to {@link executePaperOrderWithRisk} depends on. */
export interface ExecutePaperOrderWithRiskRequest {
  /** Already-validated order intent. Never mutated. */
  readonly intent: OrderIntent;
  /** Immutable snapshot of the *same agent's* wallet. Never mutated. */
  readonly wallet: Wallet;
  readonly riskPolicy: RiskPolicy;
  readonly executionPolicy: ExecutionPolicy;
  /** Broker to execute against. Rejected fail-closed unless `kind === "paper"`. */
  readonly broker: Broker;
  /** Canonical UTC instant recorded on the `RiskDecision`. Caller-supplied; never the system clock. */
  readonly evaluatedAt: string;
  /** Canonical UTC instant recorded on the broker's event. Caller-supplied; never the system clock. */
  readonly occurredAt: string;
}

/**
 * The structured, immutable outcome of one call: a risk rejection that never
 * reached a broker, or a broker outcome for an order the Risk Manager
 * approved. There is no third variant — this facade never invents a ledger
 * event of its own.
 */
export type ExecutePaperOrderWithRiskResult =
  | { readonly status: "RISK_REJECTED"; readonly riskDecision: RiskDecision }
  | {
      readonly status: "BROKER_EXECUTED";
      readonly riskDecision: RiskDecision;
      readonly executionOutcome: ExecutionOutcome;
    };

/**
 * Runs one order through the mandatory sequence: evaluate risk exactly once,
 * then either stop at the rejection or call the paper broker exactly once
 * with the same intent, wallet, execution policy and instant this function
 * received. Does not resize, correct or reinterpret the order, and does not
 * apply any event to a ledger or portfolio — the caller owns that step.
 */
export function executePaperOrderWithRisk(
  request: ExecutePaperOrderWithRiskRequest
): ExecutePaperOrderWithRiskResult {
  const { intent, wallet, riskPolicy, executionPolicy, broker, evaluatedAt, occurredAt } = request;

  if (broker.kind !== PAPER_BROKER_KIND) {
    throw new Error(
      `executePaperOrderWithRisk: broker.kind must be "${PAPER_BROKER_KIND}", got "${broker.kind}"`
    );
  }

  const riskDecision = evaluateRisk({ intent, wallet, policy: riskPolicy, evaluatedAt });
  if (!riskDecision.approved) {
    return Object.freeze({ status: "RISK_REJECTED" as const, riskDecision });
  }

  const executionOutcome = broker.execute({ intent, wallet, policy: executionPolicy, occurredAt });
  return Object.freeze({ status: "BROKER_EXECUTED" as const, riskDecision, executionOutcome });
}
