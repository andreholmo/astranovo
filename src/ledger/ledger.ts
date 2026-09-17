/**
 * Append-only, immutable ledgers with per-order idempotency.
 *
 * Nothing here mutates: appending returns a new ledger and leaves the previous
 * one untouched, so a caller can always hold on to an earlier state.
 *
 * Idempotency rule (per `orderId`, per agent):
 *
 * - the same `orderId` with identical content is a **replay**: the stored
 *   event is returned, `appended` is `false`, and no second event exists;
 * - the same `orderId` with different content is a **conflict**: it throws,
 *   because two different outcomes for one order would make the ledger
 *   ambiguous and the replayed portfolio non-reproducible;
 * - identity is the event's content hash, so this needs no bookkeeping beyond
 *   the events themselves.
 *
 * Each agent owns an independent ledger. An append for one agent never touches
 * another agent's events.
 */

import type { LedgerEvent } from "./events.js";

/** Raised when one `orderId` is recorded twice with different content. */
export class LedgerConflictError extends Error {
  /** Stable code, safe to log. */
  public readonly code = "ORDER_ID_CONFLICT";
  public readonly orderId: string;
  public readonly agentId: string;

  public constructor(agentId: string, orderId: string) {
    super(`Ledger conflict: order ${orderId} of agent ${agentId} already exists with different content`);
    this.name = "LedgerConflictError";
    this.agentId = agentId;
    this.orderId = orderId;
  }
}

/** Raised when an event is appended to the ledger of a different agent. */
export class LedgerAgentMismatchError extends Error {
  public readonly code = "AGENT_MISMATCH";

  public constructor(expected: string, received: string) {
    super(`Ledger of agent ${expected} cannot accept an event of agent ${received}`);
    this.name = "LedgerAgentMismatchError";
  }
}

/** Outcome of an append: the new ledger, the stored event, and whether it is new. */
export interface AppendResult<T> {
  readonly ledger: T;
  readonly event: LedgerEvent;
  /** `false` when the event was already present — a replay, not a new record. */
  readonly appended: boolean;
}

/** One agent's append-only event log. */
export class AgentLedger {
  public readonly agentId: string;
  public readonly events: readonly LedgerEvent[];
  readonly #byOrderId: ReadonlyMap<string, LedgerEvent>;

  private constructor(
    agentId: string,
    events: readonly LedgerEvent[],
    byOrderId: ReadonlyMap<string, LedgerEvent>
  ) {
    this.agentId = agentId;
    this.events = events;
    this.#byOrderId = byOrderId;
    Object.freeze(this);
  }

  /** An empty ledger for one agent. */
  public static empty(agentId: string): AgentLedger {
    return new AgentLedger(agentId, Object.freeze([]), new Map());
  }

  /** Rebuilds a ledger from stored events, applying the same idempotency rules. */
  public static from(agentId: string, events: readonly LedgerEvent[]): AgentLedger {
    let ledger = AgentLedger.empty(agentId);
    for (const event of events) ledger = ledger.append(event).ledger;
    return ledger;
  }

  /** The event recorded for an order, if any. */
  public eventForOrder(orderId: string): LedgerEvent | undefined {
    return this.#byOrderId.get(orderId);
  }

  /**
   * Appends an event, or recognises it as a replay.
   *
   * Throws {@link LedgerConflictError} when the same `orderId` was already
   * recorded with different content, and {@link LedgerAgentMismatchError} when
   * the event belongs to another agent.
   */
  public append(event: LedgerEvent): AppendResult<AgentLedger> {
    if (event.agentId !== this.agentId) {
      throw new LedgerAgentMismatchError(this.agentId, event.agentId);
    }
    const existing = this.#byOrderId.get(event.orderId);
    if (existing !== undefined) {
      if (existing.eventId === event.eventId) {
        return Object.freeze({ ledger: this, event: existing, appended: false });
      }
      throw new LedgerConflictError(this.agentId, event.orderId);
    }
    const events = Object.freeze([...this.events, event]);
    const byOrderId = new Map(this.#byOrderId);
    byOrderId.set(event.orderId, event);
    return Object.freeze({
      ledger: new AgentLedger(this.agentId, events, byOrderId),
      event,
      appended: true
    });
  }
}

/** The ledgers of every agent in a run, keyed by agent id. */
export class Ledger {
  readonly #byAgentId: ReadonlyMap<string, AgentLedger>;

  private constructor(byAgentId: ReadonlyMap<string, AgentLedger>) {
    this.#byAgentId = byAgentId;
    Object.freeze(this);
  }

  /** Empty ledgers for the given agents, in the order supplied. */
  public static forAgents(agentIds: readonly string[]): Ledger {
    const byAgentId = new Map<string, AgentLedger>();
    for (const agentId of agentIds) byAgentId.set(agentId, AgentLedger.empty(agentId));
    return new Ledger(byAgentId);
  }

  /** The agent ids held, in insertion order. */
  public get agentIds(): readonly string[] {
    return Object.freeze([...this.#byAgentId.keys()]);
  }

  /** One agent's ledger, or `undefined` when the agent is unknown. */
  public agent(agentId: string): AgentLedger | undefined {
    return this.#byAgentId.get(agentId);
  }

  /**
   * Appends to the ledger of the event's agent, leaving every other agent's
   * ledger untouched and identical by reference.
   */
  public append(event: LedgerEvent): AppendResult<Ledger> {
    const current = this.#byAgentId.get(event.agentId);
    if (current === undefined) {
      throw new LedgerAgentMismatchError([...this.#byAgentId.keys()].join(","), event.agentId);
    }
    const result = current.append(event);
    if (!result.appended) {
      return Object.freeze({ ledger: this, event: result.event, appended: false });
    }
    const byAgentId = new Map(this.#byAgentId);
    byAgentId.set(event.agentId, result.ledger);
    return Object.freeze({ ledger: new Ledger(byAgentId), event: result.event, appended: true });
  }
}
