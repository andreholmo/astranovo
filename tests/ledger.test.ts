import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PaperBroker } from "../src/broker/paper-broker.js";
import type { FillEvent, LedgerEvent, RejectionEvent } from "../src/ledger/events.js";
import {
  EVENT_ID_LENGTH,
  createFillEvent,
  createRejectionEvent,
  serializeEvent
} from "../src/ledger/events.js";
import {
  AgentLedger,
  Ledger,
  LedgerAgentMismatchError,
  LedgerConflictError
} from "../src/ledger/ledger.js";
import { createWallet } from "../src/portfolio/portfolio.js";
import { AT, FREE_POLICY, LATER, START_CASH_MICROS, intent } from "./support/fixtures.js";

const broker = new PaperBroker();

/** A fill produced by the broker for a wallet holding `cashMicros`. */
function fillFor(cashMicros: bigint, orderId = "order-1", agentId = "trend-following"): FillEvent {
  const outcome = broker.execute({
    intent: intent({ orderId, agentId }),
    wallet: createWallet(agentId, cashMicros),
    policy: FREE_POLICY,
    occurredAt: AT
  });
  assert.equal(outcome.status, "FILLED");
  return outcome.event as FillEvent;
}

function rejectionFor(orderId = "order-2", agentId = "trend-following"): RejectionEvent {
  const outcome = broker.execute({
    intent: intent({ orderId, agentId, side: "SELL" }),
    wallet: createWallet(agentId, 0n),
    policy: FREE_POLICY,
    occurredAt: AT
  });
  assert.equal(outcome.status, "REJECTED");
  return outcome.event as RejectionEvent;
}

describe("event identity", () => {
  it("derives a deterministic id from the content", () => {
    const first = fillFor(START_CASH_MICROS);
    const second = fillFor(START_CASH_MICROS);

    assert.equal(first.eventId, second.eventId);
    assert.equal(first.eventId.length, EVENT_ID_LENGTH);
    assert.match(first.eventId, /^[0-9a-f]+$/);
  });

  it("gives different content a different id", () => {
    assert.notEqual(fillFor(START_CASH_MICROS).eventId, fillFor(50_000_000n).eventId);
    assert.notEqual(fillFor(START_CASH_MICROS).eventId, rejectionFor("order-1").eventId);
  });

  it("does not depend on the order the draft fields were written in", () => {
    const draft = { ...fillFor(START_CASH_MICROS) } as Record<string, unknown>;
    delete draft.eventId;
    const reversed = Object.fromEntries(Object.entries(draft).reverse());

    assert.equal(
      createFillEvent(draft as unknown as Omit<FillEvent, "eventId">).eventId,
      createFillEvent(reversed as unknown as Omit<FillEvent, "eventId">).eventId
    );
  });

  it("changes when any recorded field changes", () => {
    const base = fillFor(START_CASH_MICROS);
    const draft = { ...base } as Record<string, unknown>;
    delete draft.eventId;

    const later = createFillEvent({
      ...(draft as unknown as Omit<FillEvent, "eventId">),
      occurredAt: LATER
    });
    assert.notEqual(later.eventId, base.eventId);
  });

  it("freezes every event", () => {
    assert.ok(Object.isFrozen(fillFor(START_CASH_MICROS)));
    assert.ok(Object.isFrozen(rejectionFor()));
  });
});

describe("serialization at the JSON boundary", () => {
  it("writes every bigint as a canonical decimal string", () => {
    const serialized = serializeEvent(fillFor(START_CASH_MICROS));

    assert.equal(serialized.quantityAtoms, "1000");
    assert.equal(serialized.referencePriceMicros, "10000000");
    assert.equal(serialized.totalMicros, "100000000");
    assert.equal(serialized.feeMicros, "0");
    assert.equal(typeof serialized.assetScale, "number");
    assert.ok(Object.isFrozen(serialized));
  });

  it("survives JSON round-tripping without losing precision", () => {
    const serialized = serializeEvent(fillFor(START_CASH_MICROS));
    const restored = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;

    assert.deepEqual(restored, { ...serialized });
    assert.equal(BigInt(restored.totalMicros as string), 100_000_000n);
  });

  it("serializes a rejection with its stable code", () => {
    const serialized = serializeEvent(rejectionFor());

    assert.equal(serialized.type, "REJECTION");
    assert.equal(serialized.code, "NO_POSITION");
    assert.equal(serialized.eventId, rejectionFor().eventId);
  });
});

describe("AgentLedger", () => {
  it("starts empty and appends immutably", () => {
    const empty = AgentLedger.empty("trend-following");
    const result = empty.append(fillFor(START_CASH_MICROS));

    assert.equal(empty.events.length, 0, "the original ledger must not change");
    assert.equal(result.ledger.events.length, 1);
    assert.equal(result.appended, true);
    assert.notEqual(result.ledger, empty);
    assert.ok(Object.isFrozen(result.ledger.events));
  });

  it("treats an identical re-append as a replay, not a second event", () => {
    const event = fillFor(START_CASH_MICROS);
    const first = AgentLedger.empty("trend-following").append(event);
    const second = first.ledger.append(event);

    assert.equal(second.appended, false);
    assert.equal(second.ledger, first.ledger, "a replay must not produce a new ledger");
    assert.equal(second.event, event);
    assert.equal(second.ledger.events.length, 1);
  });

  it("treats a recomputed but identical event as a replay too", () => {
    const first = AgentLedger.empty("trend-following").append(fillFor(START_CASH_MICROS));
    const second = first.ledger.append(fillFor(START_CASH_MICROS));

    assert.equal(second.appended, false);
    assert.equal(second.ledger.events.length, 1);
  });

  it("rejects the same orderId with different content as a conflict", () => {
    const ledger = AgentLedger.empty("trend-following").append(fillFor(START_CASH_MICROS)).ledger;

    assert.throws(
      () => ledger.append(fillFor(50_000_000n)),
      (error: unknown) => {
        assert.ok(error instanceof LedgerConflictError);
        assert.equal(error.code, "ORDER_ID_CONFLICT");
        assert.equal(error.orderId, "order-1");
        return true;
      }
    );
    assert.equal(ledger.events.length, 1, "a conflict must leave the ledger untouched");
  });

  it("treats a fill and a rejection for one orderId as a conflict", () => {
    const ledger = AgentLedger.empty("trend-following").append(fillFor(START_CASH_MICROS)).ledger;
    assert.throws(() => ledger.append(rejectionFor("order-1")), LedgerConflictError);
  });

  it("refuses an event belonging to another agent", () => {
    const ledger = AgentLedger.empty("trend-following");
    assert.throws(() => ledger.append(fillFor(START_CASH_MICROS, "x", "momentum")), LedgerAgentMismatchError);
  });

  it("looks an order up by id", () => {
    const ledger = AgentLedger.empty("trend-following").append(fillFor(START_CASH_MICROS)).ledger;

    assert.equal(ledger.eventForOrder("order-1")?.orderId, "order-1");
    assert.equal(ledger.eventForOrder("missing"), undefined);
  });

  it("rebuilds from stored events and collapses replays", () => {
    const event = fillFor(START_CASH_MICROS);
    const other = rejectionFor("order-2");
    const rebuilt = AgentLedger.from("trend-following", [event, other, event]);

    assert.equal(rebuilt.events.length, 2);
    assert.deepEqual(
      rebuilt.events.map((stored: LedgerEvent) => stored.orderId),
      ["order-1", "order-2"]
    );
  });
});

describe("Ledger across agents", () => {
  const agentIds = ["trend-following", "momentum", "breakout"];

  it("keeps one independent ledger per agent", () => {
    const ledger = Ledger.forAgents(agentIds);

    assert.deepEqual(ledger.agentIds, agentIds);
    for (const agentId of agentIds) assert.equal(ledger.agent(agentId)?.events.length, 0);
    assert.equal(ledger.agent("unknown"), undefined);
  });

  it("does not touch another agent when one agent records an event", () => {
    const before = Ledger.forAgents(agentIds);
    const momentumBefore = before.agent("momentum");
    const after = before.append(fillFor(START_CASH_MICROS)).ledger;

    assert.equal(after.agent("trend-following")?.events.length, 1);
    assert.equal(after.agent("momentum")?.events.length, 0);
    assert.equal(after.agent("momentum"), momentumBefore, "untouched agents keep the same ledger");
    assert.equal(before.agent("trend-following")?.events.length, 0, "the old ledger is unchanged");
  });

  it("lets two agents reuse the same orderId without colliding", () => {
    let ledger = Ledger.forAgents(agentIds);
    ledger = ledger.append(fillFor(START_CASH_MICROS, "order-1", "trend-following")).ledger;
    ledger = ledger.append(fillFor(START_CASH_MICROS, "order-1", "momentum")).ledger;

    assert.equal(ledger.agent("trend-following")?.events.length, 1);
    assert.equal(ledger.agent("momentum")?.events.length, 1);
  });

  it("propagates replay and conflict semantics", () => {
    const event = fillFor(START_CASH_MICROS);
    const first = Ledger.forAgents(agentIds).append(event);
    const replay = first.ledger.append(event);

    assert.equal(replay.appended, false);
    assert.equal(replay.ledger, first.ledger);
    assert.throws(() => first.ledger.append(fillFor(50_000_000n)), LedgerConflictError);
  });

  it("refuses an event from an agent it does not know", () => {
    assert.throws(
      () => Ledger.forAgents(["momentum"]).append(fillFor(START_CASH_MICROS)),
      LedgerAgentMismatchError
    );
  });
});

describe("rejection events", () => {
  it("record a stable code and carry the policy version", () => {
    const event = createRejectionEvent({
      schemaVersion: 1,
      type: "REJECTION",
      orderId: "order-9",
      cycleId: "cycle-1",
      agentId: "trend-following",
      side: "BUY",
      asset: "ACME",
      quote: "USD",
      code: "INSUFFICIENT_CASH",
      occurredAt: AT,
      policyVersion: "free"
    });

    assert.equal(event.code, "INSUFFICIENT_CASH");
    assert.equal(event.policyVersion, "free");
    assert.ok(Object.isFrozen(event));
  });
});
