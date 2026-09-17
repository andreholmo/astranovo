/**
 * The broker seam.
 *
 * A broker turns an `OrderIntent` plus a wallet and a cost policy into exactly
 * one ledger event: a fill or a rejection. It is a **pure function** — it does
 * not mutate the wallet, does not touch the ledger, and does not read the
 * clock; the instant is supplied by the caller. The caller is what appends the
 * event and derives the new wallet, which is why a rejection cannot change the
 * accounting even by accident.
 *
 * `PaperBroker` is the only implementation and the only one authorised in this
 * phase (D-002). This interface exists so that a future adapter has a shape to
 * fit, not because one is planned: no testnet, exchange or live broker is part
 * of this repository.
 */

import type { ExecutionPolicy, OrderIntent } from "../domain/contracts.js";
import type { FillEvent, RejectionEvent } from "../ledger/events.js";
import type { Wallet } from "../portfolio/portfolio.js";

/** Everything an execution decision depends on. */
export interface ExecutionRequest {
  readonly intent: OrderIntent;
  /** The wallet as it stands before this order. Never mutated. */
  readonly wallet: Wallet;
  readonly policy: ExecutionPolicy;
  /** Canonical UTC instant recorded on the resulting event. */
  readonly occurredAt: string;
}

/** The outcome of an execution attempt: one event, and nothing else. */
export type ExecutionOutcome =
  | { readonly status: "FILLED"; readonly event: FillEvent }
  | { readonly status: "REJECTED"; readonly event: RejectionEvent };

export interface Broker {
  /** Identifies the implementation in logs and reports. */
  readonly kind: string;
  execute(request: ExecutionRequest): ExecutionOutcome;
}
