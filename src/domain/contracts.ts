/**
 * Core domain contracts for AstraNovo.
 *
 * This module is intentionally free of I/O, clocks and randomness: every
 * function here is a pure, deterministic validator. It implements the
 * "software validates" half of the authority principle in
 * `docs/ARCHITECTURE.md` — an agent proposes, this layer decides whether the
 * proposal is even structurally admissible, and nothing here can move money,
 * open a position or reach a broker.
 *
 * Paper-only. No execution route exists in this repository.
 *
 * Validation policy:
 * - Parsers never mutate their input. They return a frozen copy that contains
 *   only the declared fields; unknown fields are dropped, not trusted.
 * - Errors name the offending field and the requirement it violated, and never
 *   embed the received value, so an error is safe to show to a user or write
 *   to a log without leaking payload content.
 * - Free text is never interpreted as an instruction. Only the typed fields
 *   below carry meaning.
 */

import {
  MAX_MICROS,
  parseAssetScale,
  parseBps,
  parseNonNegativeIntegerString
} from "../money/fixed-point.js";
import { rejectContract } from "./errors.js";

/** Maximum length of a human-readable name. */
export const MAX_NAME_LENGTH = 128;
/** Maximum length of a slug identifier (`id`, `strategy`). */
export const MAX_SLUG_LENGTH = 64;
/** Maximum length of an opaque identifier (`snapshotId`, `cycleId`, ...). */
export const MAX_IDENTIFIER_LENGTH = 64;
/** Maximum length of the free-text rationale attached to a proposal. */
export const MAX_REASON_LENGTH = 500;
/** Maximum length of a short descriptive field (`source`, `promptVersion`). */
export const MAX_SHORT_TEXT_LENGTH = 64;
/** Maximum length of a model identifier. */
export const MAX_MODEL_LENGTH = 128;
/** Maximum number of evidence identifiers a single proposal may cite. */
export const MAX_EVIDENCE_IDS = 32;
/** Upper bound for USD amounts, a sanity limit rather than a policy limit. */
export const MAX_USD_AMOUNT = 1_000_000_000_000;
/** Upper bound for a quoted price. */
export const MAX_PRICE = 1_000_000_000_000_000;
/** Upper bound for a quoted spread, in basis points. */
export const MAX_SPREAD_BPS = 1_000_000;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,16}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
/** Canonical UTC ISO-8601 with milliseconds, e.g. `2026-09-17T18:00:00.000Z`. */
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export { ContractValidationError, describeContractError } from "./errors.js";

function reject(contract: string, field: string, requirement: string): never {
  return rejectContract(contract, field, requirement);
}

function requireObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireSchemaVersion(value: unknown, contract: string): 1 {
  if (value !== 1) reject(contract, "schemaVersion", "must be exactly 1");
  return 1;
}

function requireText(value: unknown, contract: string, field: string, maxLength: number): string {
  if (typeof value !== "string") reject(contract, field, "must be a string");
  if (value.length === 0 || value.trim().length === 0) {
    reject(contract, field, "must not be empty or blank");
  }
  if (value.length > maxLength) reject(contract, field, `must be at most ${maxLength} characters`);
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    reject(contract, field, "must not contain control characters");
  }
  return value;
}

function requireSlug(value: unknown, contract: string, field: string): string {
  const text = requireText(value, contract, field, MAX_SLUG_LENGTH);
  if (!SLUG_PATTERN.test(text)) {
    reject(contract, field, "must be a lowercase slug such as trend-following");
  }
  return text;
}

function requireIdentifier(value: unknown, contract: string, field: string): string {
  const text = requireText(value, contract, field, MAX_IDENTIFIER_LENGTH);
  if (!IDENTIFIER_PATTERN.test(text)) {
    reject(contract, field, "must be alphanumeric with . _ : - separators");
  }
  return text;
}

function requireSymbol(value: unknown, contract: string, field: string): string {
  const text = requireText(value, contract, field, 16);
  if (!SYMBOL_PATTERN.test(text)) {
    reject(contract, field, "must be an uppercase symbol of 1 to 16 characters");
  }
  return text;
}

function requireBoolean(value: unknown, contract: string, field: string): boolean {
  if (typeof value !== "boolean") reject(contract, field, "must be a boolean");
  return value;
}

function requireFiniteNumber(
  value: unknown,
  contract: string,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject(contract, field, "must be a finite number");
  }
  if (value < minimum || value > maximum) {
    reject(contract, field, `must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function requirePositiveNumber(
  value: unknown,
  contract: string,
  field: string,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject(contract, field, "must be a finite number");
  }
  if (value <= 0) reject(contract, field, "must be greater than 0");
  if (value > maximum) reject(contract, field, `must be at most ${maximum}`);
  return value;
}

/**
 * Validates a canonical UTC ISO-8601 timestamp and returns its epoch in
 * milliseconds. Non-canonical spellings of the same instant — offsets other
 * than `Z`, missing milliseconds, lowercase `z` — are rejected so that two
 * runs can never disagree about whether two timestamps are equal.
 */
function requireCanonicalTimestamp(value: unknown, contract: string, field: string): number {
  if (typeof value !== "string") reject(contract, field, "must be a string");
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    reject(contract, field, "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z");
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    reject(contract, field, "must be canonical UTC ISO-8601, e.g. 2026-09-17T18:00:00.000Z");
  }
  return epoch;
}

/**
 * Same check as {@link requireCanonicalTimestamp}, but returns the validated
 * string rather than its epoch, for fields stored as timestamps.
 */
function requireCanonicalTimestampValue(value: unknown, contract: string, field: string): string {
  requireCanonicalTimestamp(value, contract, field);
  return value as string;
}

function requireEnum<T extends string>(
  value: unknown,
  contract: string,
  field: string,
  allowed: readonly T[]
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    reject(contract, field, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/* -------------------------------------------------------------------------- */
/* AgentConfig                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Experimental pipeline an agent belongs to.
 *
 * - `reference`: MODE_A_REFERENCE, the pipeline shaped for comparison against
 *   the audited GPTHEIST structure.
 * - `optimized`: MODE_B_OPTIMIZED, our own specialised architecture.
 *
 * Per D-007 the foundation must keep both possible and must not presume which
 * one wins.
 */
export const AGENT_MODES = ["reference", "optimized"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** One configured agent with its own isolated fictional budget. */
export interface AgentConfig {
  /** Unique slug, stable across runs. */
  readonly id: string;
  /** Human-readable label. Carries no semantics. */
  readonly name: string;
  /** Strategy slug. In M0 this is configuration only, not behaviour. */
  readonly strategy: string;
  /** Whether the agent takes part in a run. */
  readonly enabled: boolean;
  /** Starting fictional capital in USD. Must be finite and positive. */
  readonly initialBudgetUsd: number;
  /** Experimental pipeline this agent belongs to. */
  readonly mode: AgentMode;
}

const AGENT_CONFIG = "AgentConfig";

/** Validates one agent entry and returns a frozen copy. Input is not mutated. */
export function parseAgentConfig(value: unknown): AgentConfig {
  const source = requireObject(value, AGENT_CONFIG);
  const parsed: AgentConfig = {
    id: requireSlug(source.id, AGENT_CONFIG, "id"),
    name: requireText(source.name, AGENT_CONFIG, "name", MAX_NAME_LENGTH),
    strategy: requireSlug(source.strategy, AGENT_CONFIG, "strategy"),
    enabled: requireBoolean(source.enabled, AGENT_CONFIG, "enabled"),
    initialBudgetUsd: requirePositiveNumber(
      source.initialBudgetUsd,
      AGENT_CONFIG,
      "initialBudgetUsd",
      MAX_USD_AMOUNT
    ),
    mode: requireEnum(source.mode, AGENT_CONFIG, "mode", AGENT_MODES)
  };
  return Object.freeze(parsed);
}

/* -------------------------------------------------------------------------- */
/* MarketSnapshot                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A point-in-time view of the market, carrying its own availability instant.
 *
 * Anti-look-ahead rule (D-009): a decision for a cycle may only read snapshots
 * whose `availableAt` is at or before the instant that cycle is allowed to
 * know about. `asOf` is when the market state held; `availableAt` is when that
 * state could first have been observed by us. Publication and propagation
 * delay mean `availableAt >= asOf`, never the reverse — a snapshot claiming to
 * have been available before the state it describes existed is a look-ahead
 * leak and is rejected here rather than downstream.
 */
export interface MarketSnapshot {
  readonly schemaVersion: 1;
  /** Unique identifier of this snapshot. */
  readonly snapshotId: string;
  /** Identifier of the data provider the snapshot came from. */
  readonly source: string;
  /** Base asset symbol, e.g. `BTC`. */
  readonly asset: string;
  /** Quote currency symbol, e.g. `USD`. */
  readonly quote: string;
  /** Instant the market state held, canonical UTC ISO-8601. */
  readonly asOf: string;
  /** Instant the state became observable to us, canonical UTC ISO-8601. */
  readonly availableAt: string;
  /** Reference price in `quote` per `asset`. Finite and positive. */
  readonly price: number;
  /** Quoted spread in basis points. Finite and non-negative. */
  readonly spreadBps: number;
  /** Whether the snapshot carries every field the provider promised. */
  readonly complete: boolean;
}

/** Options for {@link parseMarketSnapshot}. */
export interface MarketSnapshotOptions {
  /**
   * Optional canonical UTC ISO-8601 upper bound. When given, a snapshot that
   * became available after this instant is rejected. The caller supplies the
   * instant explicitly — this module never reads the clock, so validation
   * stays deterministic and replayable.
   */
  readonly notAfter?: string;
}

const MARKET_SNAPSHOT = "MarketSnapshot";

/** Validates a market snapshot and returns a frozen copy. Input is not mutated. */
export function parseMarketSnapshot(
  value: unknown,
  options: MarketSnapshotOptions = {}
): MarketSnapshot {
  const source = requireObject(value, MARKET_SNAPSHOT);
  const schemaVersion = requireSchemaVersion(source.schemaVersion, MARKET_SNAPSHOT);
  const asOf = requireCanonicalTimestamp(source.asOf, MARKET_SNAPSHOT, "asOf");
  const availableAt = requireCanonicalTimestamp(source.availableAt, MARKET_SNAPSHOT, "availableAt");
  if (availableAt < asOf) {
    reject(MARKET_SNAPSHOT, "availableAt", "must be at or after asOf");
  }
  if (options.notAfter !== undefined) {
    const limit = requireCanonicalTimestamp(options.notAfter, MARKET_SNAPSHOT, "notAfter");
    if (availableAt > limit) {
      reject(MARKET_SNAPSHOT, "availableAt", "must not be after the supplied notAfter instant");
    }
  }
  const parsed: MarketSnapshot = {
    schemaVersion,
    snapshotId: requireIdentifier(source.snapshotId, MARKET_SNAPSHOT, "snapshotId"),
    source: requireText(source.source, MARKET_SNAPSHOT, "source", MAX_SHORT_TEXT_LENGTH),
    asset: requireSymbol(source.asset, MARKET_SNAPSHOT, "asset"),
    quote: requireSymbol(source.quote, MARKET_SNAPSHOT, "quote"),
    asOf: source.asOf as string,
    availableAt: source.availableAt as string,
    price: requirePositiveNumber(source.price, MARKET_SNAPSHOT, "price", MAX_PRICE),
    spreadBps: requireFiniteNumber(
      source.spreadBps,
      MARKET_SNAPSHOT,
      "spreadBps",
      0,
      MAX_SPREAD_BPS
    ),
    complete: requireBoolean(source.complete, MARKET_SNAPSHOT, "complete")
  };
  return Object.freeze(parsed);
}

/* -------------------------------------------------------------------------- */
/* AgentProposal                                                              */
/* -------------------------------------------------------------------------- */

/** The three admissible actions. Anything else is rejected, never guessed. */
export const PROPOSAL_ACTIONS = ["BUY", "SELL", "HOLD"] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

/**
 * A structured proposal from one agent for one cycle.
 *
 * A proposal is *not* an order. It is an opinion that the deterministic Risk
 * Manager may later reduce or refuse; approval of this schema means only that
 * the proposal is unambiguous enough to be evaluated.
 *
 * `positionPct` semantics, per the TASK-001 review and `docs/ARCHITECTURE.md`:
 * - `BUY`: fraction of the eligible cash/equity defined by policy;
 * - `SELL`: fraction of the *current position*, not of capital;
 * - `HOLD`: exactly zero.
 *
 * `BUY` and `SELL` with a zero fraction are rejected: they are indistinguishable
 * from `HOLD` in effect but not in intent, and an ambiguous output must fail
 * closed rather than be interpreted (D-003).
 *
 * `confidence` is reported for analysis only. It never widens a risk limit.
 */
export interface AgentProposal {
  readonly schemaVersion: 1;
  /** Unique identifier of this proposal. */
  readonly proposalId: string;
  /** Decision cycle this proposal belongs to. */
  readonly cycleId: string;
  /** `id` of the agent that produced it. */
  readonly agentId: string;
  readonly action: ProposalAction;
  /** Base asset symbol the proposal refers to. */
  readonly asset: string;
  /** Self-reported confidence in [0, 1]. Never overrides a risk rule. */
  readonly confidence: number;
  /** Size fraction in [0, 1]; see the semantics note above. */
  readonly positionPct: number;
  /** Short rationale. Free text, never parsed for instructions. */
  readonly reason: string;
  /** Whether this agent raises a veto. Advisory to the coordinator. */
  readonly veto: boolean;
  /** Identifiers of the evidence the proposal rests on. Unique, bounded. */
  readonly evidenceIds: readonly string[];
  /** Version of the prompt that produced the proposal. */
  readonly promptVersion: string;
  /** Identifier of the model that produced the proposal. */
  readonly model: string;
}

const AGENT_PROPOSAL = "AgentProposal";

function parseEvidenceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) reject(AGENT_PROPOSAL, "evidenceIds", "must be an array");
  if (value.length > MAX_EVIDENCE_IDS) {
    reject(AGENT_PROPOSAL, "evidenceIds", `must hold at most ${MAX_EVIDENCE_IDS} identifiers`);
  }
  const seen = new Set<string>();
  const identifiers = value.map((entry) => {
    const identifier = requireIdentifier(entry, AGENT_PROPOSAL, "evidenceIds entry");
    if (seen.has(identifier)) {
      reject(AGENT_PROPOSAL, "evidenceIds", "must not contain duplicate identifiers");
    }
    seen.add(identifier);
    return identifier;
  });
  return Object.freeze(identifiers);
}

/** Validates an agent proposal and returns a frozen copy. Input is not mutated. */
export function parseAgentProposal(value: unknown): AgentProposal {
  const source = requireObject(value, AGENT_PROPOSAL);
  const action = requireEnum(source.action, AGENT_PROPOSAL, "action", PROPOSAL_ACTIONS);
  const positionPct = requireFiniteNumber(
    source.positionPct,
    AGENT_PROPOSAL,
    "positionPct",
    0,
    1
  );
  if (action === "HOLD" && positionPct !== 0) {
    reject(AGENT_PROPOSAL, "positionPct", "must be exactly 0 when action is HOLD");
  }
  if (action !== "HOLD" && positionPct === 0) {
    reject(AGENT_PROPOSAL, "positionPct", "must be greater than 0 when action is BUY or SELL");
  }
  const parsed: AgentProposal = {
    schemaVersion: requireSchemaVersion(source.schemaVersion, AGENT_PROPOSAL),
    proposalId: requireIdentifier(source.proposalId, AGENT_PROPOSAL, "proposalId"),
    cycleId: requireIdentifier(source.cycleId, AGENT_PROPOSAL, "cycleId"),
    agentId: requireSlug(source.agentId, AGENT_PROPOSAL, "agentId"),
    action,
    asset: requireSymbol(source.asset, AGENT_PROPOSAL, "asset"),
    confidence: requireFiniteNumber(source.confidence, AGENT_PROPOSAL, "confidence", 0, 1),
    positionPct,
    reason: requireText(source.reason, AGENT_PROPOSAL, "reason", MAX_REASON_LENGTH),
    veto: requireBoolean(source.veto, AGENT_PROPOSAL, "veto"),
    evidenceIds: parseEvidenceIds(source.evidenceIds),
    promptVersion: requireText(
      source.promptVersion,
      AGENT_PROPOSAL,
      "promptVersion",
      MAX_SHORT_TEXT_LENGTH
    ),
    model: requireText(source.model, AGENT_PROPOSAL, "model", MAX_MODEL_LENGTH)
  };
  return Object.freeze(parsed);
}

/* -------------------------------------------------------------------------- */
/* ExecutionPolicy                                                            */
/* -------------------------------------------------------------------------- */

/** Largest basis-point figure accepted in an execution policy: 100%. */
export const MAX_POLICY_BPS = 10_000;

/**
 * The cost model a broker applies. Deterministic and fully configurable: the
 * same policy, order and wallet always produce the same fill.
 *
 * `policyVersion` is recorded on every event so a stored run can be read back
 * knowing exactly which cost model produced it.
 */
export interface ExecutionPolicy {
  readonly schemaVersion: 1;
  /** Stable identifier of this cost model, recorded on every event. */
  readonly policyVersion: string;
  /** Trading fee in basis points, charged on the gross notional. */
  readonly feeBps: number;
  /** Quoted spread in basis points; half of it is paid on each side. */
  readonly spreadBps: number;
  /** Additional adverse price movement in basis points. */
  readonly slippageBps: number;
}

const EXECUTION_POLICY = "ExecutionPolicy";

/** Validates an execution policy and returns a frozen copy. */
export function parseExecutionPolicy(value: unknown): ExecutionPolicy {
  const source = requireObject(value, EXECUTION_POLICY);
  const parsed: ExecutionPolicy = {
    schemaVersion: requireSchemaVersion(source.schemaVersion, EXECUTION_POLICY),
    policyVersion: requireIdentifier(source.policyVersion, EXECUTION_POLICY, "policyVersion"),
    feeBps: parseBps(source.feeBps, EXECUTION_POLICY, "feeBps", MAX_POLICY_BPS),
    spreadBps: parseBps(source.spreadBps, EXECUTION_POLICY, "spreadBps", MAX_POLICY_BPS),
    slippageBps: parseBps(source.slippageBps, EXECUTION_POLICY, "slippageBps", MAX_POLICY_BPS)
  };
  return Object.freeze(parsed);
}

/* -------------------------------------------------------------------------- */
/* OrderIntent                                                                */
/* -------------------------------------------------------------------------- */

/** The two sides an order can take. There is no short selling. */
export const ORDER_SIDES = ["BUY", "SELL"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

/**
 * An order a broker may attempt to execute.
 *
 * An intent is still not an order sent anywhere: no execution route exists in
 * this repository. It is the deterministic, fully-specified request that the
 * `PaperBroker` turns into a fill or a rejection.
 *
 * `positionPct` keeps the semantics of `AgentProposal`: on `BUY` it is a
 * fraction of the available cash, on `SELL` a fraction of the current
 * position. A `HOLD` proposal never becomes an `OrderIntent` — see
 * {@link orderIntentFromProposal}.
 *
 * `referencePriceMicros` is micros of `quote` per one whole unit of `asset`.
 * `assetScale` is how many decimal places one whole unit of `asset` has, so a
 * quantity in atoms divided by `10^assetScale` is a quantity in whole units.
 */
export interface OrderIntent {
  readonly schemaVersion: 1;
  readonly orderId: string;
  readonly cycleId: string;
  readonly agentId: string;
  readonly side: OrderSide;
  readonly asset: string;
  readonly quote: string;
  /** Fraction in (0, 1]; a zero-size order is rejected as meaningless. */
  readonly positionPct: number;
  readonly referencePriceMicros: bigint;
  readonly assetScale: number;
  readonly createdAt: string;
}

const ORDER_INTENT = "OrderIntent";

/**
 * Validates an order intent and returns a frozen copy.
 *
 * `referencePriceMicros` crosses the JSON boundary as a canonical decimal
 * string and comes back as a `bigint`; see `src/money/fixed-point.ts`.
 */
export function parseOrderIntent(value: unknown): OrderIntent {
  const source = requireObject(value, ORDER_INTENT);
  const positionPct = requireFiniteNumber(source.positionPct, ORDER_INTENT, "positionPct", 0, 1);
  if (positionPct === 0) {
    rejectContract(ORDER_INTENT, "positionPct", "must be greater than 0");
  }
  const referencePriceMicros = parseNonNegativeIntegerString(
    source.referencePriceMicros,
    ORDER_INTENT,
    "referencePriceMicros",
    MAX_MICROS
  );
  if (referencePriceMicros === 0n) {
    rejectContract(ORDER_INTENT, "referencePriceMicros", "must be greater than 0");
  }
  const parsed: OrderIntent = {
    schemaVersion: requireSchemaVersion(source.schemaVersion, ORDER_INTENT),
    orderId: requireIdentifier(source.orderId, ORDER_INTENT, "orderId"),
    cycleId: requireIdentifier(source.cycleId, ORDER_INTENT, "cycleId"),
    agentId: requireSlug(source.agentId, ORDER_INTENT, "agentId"),
    side: requireEnum(source.side, ORDER_INTENT, "side", ORDER_SIDES),
    asset: requireSymbol(source.asset, ORDER_INTENT, "asset"),
    quote: requireSymbol(source.quote, ORDER_INTENT, "quote"),
    positionPct,
    referencePriceMicros,
    assetScale: parseAssetScale(source.assetScale, ORDER_INTENT, "assetScale"),
    createdAt: requireCanonicalTimestampValue(source.createdAt, ORDER_INTENT, "createdAt")
  };
  return Object.freeze(parsed);
}

/** Everything an `AgentProposal` does not carry but an `OrderIntent` needs. */
export interface OrderContext {
  readonly orderId: string;
  readonly quote: string;
  /** Canonical decimal string of the reference price, in micros. */
  readonly referencePriceMicros: string;
  readonly assetScale: number;
  readonly createdAt: string;
}

/**
 * Turns a validated proposal into an order intent.
 *
 * Returns `null` for `HOLD`: holding is the absence of an order, so nothing
 * reaches the broker and no event is produced. Every other action carries a
 * non-zero `positionPct` by contract, so the resulting intent is always
 * executable-shaped.
 */
export function orderIntentFromProposal(
  proposal: AgentProposal,
  context: OrderContext
): OrderIntent | null {
  if (proposal.action === "HOLD") return null;
  return parseOrderIntent({
    schemaVersion: 1,
    orderId: context.orderId,
    cycleId: proposal.cycleId,
    agentId: proposal.agentId,
    side: proposal.action,
    asset: proposal.asset,
    quote: context.quote,
    positionPct: proposal.positionPct,
    referencePriceMicros: context.referencePriceMicros,
    assetScale: context.assetScale,
    createdAt: context.createdAt
  });
}
