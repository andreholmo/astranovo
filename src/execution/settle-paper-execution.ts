/**
 * The smallest accounting slice of the paper pipeline:
 *
 * `executePaperOrderWithRisk` → PaperBroker event → idempotent ledger append
 * → derived wallet.
 *
 * `settlePaperExecution` takes a result already produced by
 * `executePaperOrderWithRisk`, together with the *same agent's* immutable
 * wallet and `AgentLedger`, and applies exactly the bookkeeping those two
 * already-computed values imply. It never evaluates risk and never calls a
 * broker again — `evaluateRisk` and `Broker.execute` do not appear here.
 *
 * Reuses, without duplicating, `AgentLedger.append` and `applyAppendResult`:
 * every idempotency and invariant rule (replay, conflict, cash/position
 * bounds) lives in `src/ledger/ledger.ts` and `src/portfolio/portfolio.ts`
 * and is inherited here, not reimplemented.
 *
 * Pure and deterministic: no clock, no randomness, no I/O, no mutation of any
 * input. The same input always produces the same result.
 */

import type { ExecutePaperOrderWithRiskResult } from "./execute-paper-order-with-risk.js";
import type { AgentLedger } from "../ledger/ledger.js";
import type { LedgerEvent } from "../ledger/events.js";
import { applyAppendResult, type Wallet } from "../portfolio/portfolio.js";

/** Everything one call to {@link settlePaperExecution} depends on. */
export interface SettlePaperExecutionRequest {
  /** Result already produced by `executePaperOrderWithRisk`. Never mutated. */
  readonly executionResult: ExecutePaperOrderWithRiskResult;
  /** Immutable snapshot of the *same agent's* wallet, before this order. */
  readonly wallet: Wallet;
  /** The *same agent's* ledger, before this order. */
  readonly ledger: AgentLedger;
}

/**
 * The structured, immutable outcome of one settlement: a risk rejection that
 * never touches the ledger or wallet, or a PaperBroker event recorded on the
 * ledger with the wallet it derives.
 */
export type SettlePaperExecutionResult =
  | {
      readonly status: "RISK_REJECTED";
      /** The same wallet instance received, by reference. */
      readonly wallet: Wallet;
      /** The same ledger instance received, by reference. */
      readonly ledger: AgentLedger;
    }
  | {
      readonly status: "BROKER_RECORDED";
      /** The `executionResult` this settlement was computed from. */
      readonly executionResult: ExecutePaperOrderWithRiskResult;
      /** The canonical event stored in the ledger for this order. */
      readonly event: LedgerEvent;
      readonly ledger: AgentLedger;
      readonly wallet: Wallet;
      /** `false` when the event was already recorded — a replay, not a new append. */
      readonly appended: boolean;
    };

/**
 * Settles one already-computed `executePaperOrderWithRisk` result against an
 * agent's ledger and wallet.
 *
 * - `RISK_REJECTED`: no event is invented and nothing is appended; the same
 *   wallet and ledger are returned by reference.
 * - `BROKER_EXECUTED`: exactly `executionOutcome.event` is appended once,
 *   honouring the ledger's own idempotency — an identical replay of the same
 *   `orderId` returns `appended: false` and leaves the wallet unchanged by
 *   reference; a different payload under the same `orderId` throws
 *   `LedgerConflictError`, unchanged from `AgentLedger.append`. A rejection
 *   event is still appended for audit, but `applyAppendResult` never moves
 *   cash or a position for it, so the wallet it returns is the same
 *   reference that was passed in.
 *
 * Throws before any append when `wallet` and `ledger` do not belong to the
 * same agent. An event that belongs to a different agent than `ledger`'s own
 * agent is rejected by `AgentLedger.append` itself (`LedgerAgentMismatchError`),
 * which this function does not catch or reinterpret.
 */
export function settlePaperExecution(
  request: SettlePaperExecutionRequest
): SettlePaperExecutionResult {
  const { executionResult, wallet, ledger } = request;

  if (wallet.agentId !== ledger.agentId) {
    throw new Error(
      `settlePaperExecution: wallet agent "${wallet.agentId}" does not match ledger agent "${ledger.agentId}"`
    );
  }

  if (executionResult.status === "RISK_REJECTED") {
    return Object.freeze({ status: "RISK_REJECTED" as const, wallet, ledger });
  }

  const { event } = executionResult.executionOutcome;
  const appendResult = ledger.append(event);
  const settledWallet = applyAppendResult(wallet, appendResult);

  return Object.freeze({
    status: "BROKER_RECORDED" as const,
    executionResult,
    event: appendResult.event,
    ledger: appendResult.ledger,
    wallet: settledWallet,
    appended: appendResult.appended
  });
}
