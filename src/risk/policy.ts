/**
 * The risk policy: the deterministic, fully-configurable limits the Risk
 * Manager applies before any order reaches the broker.
 *
 * Mirrors the validator conventions of `src/domain/contracts.ts` — a hand
 * rolled, allocation-free validator, not a schema library — so a risk policy
 * behaves exactly like every other contract in this repository: parsing
 * never mutates its input, an invalid policy throws rather than silently
 * coercing, and the returned value is frozen. Fee, spread and size
 * conversions are never reimplemented here; basis points are validated with
 * `parseBps` from `src/money/fixed-point.ts`, the single source of truth for
 * that arithmetic.
 *
 * Per TASK-004 this is intentionally the smallest policy that can gate a
 * single order: no daily loss, drawdown, cooldown, liquidity or trade-window
 * limits exist yet. Those are separate, later slices.
 */

import { rejectContract } from "../domain/errors.js";
import { parseBps } from "../money/fixed-point.js";

/** Largest basis-point figure accepted by a risk limit: 100%. */
export const MAX_RISK_POLICY_BPS = 10_000;
/** Sanity bound on how many open positions a policy may allow. Not a business rule. */
export const MAX_OPEN_POSITIONS_BOUND = 1_000_000;
/** Sanity bound on how many assets an allowlist may name. Not a business rule. */
export const MAX_ALLOWED_ASSETS = 256;

const RISK_POLICY = "RiskPolicy";
/** Mirrors `ExecutionPolicy.policyVersion`'s identifier pattern in `src/domain/contracts.ts`. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_IDENTIFIER_LENGTH = 64;
/** Mirrors `OrderIntent.asset`'s symbol pattern in `src/domain/contracts.ts`. */
const SYMBOL_PATTERN = /^[A-Z0-9]{1,16}$/;

/**
 * The first, minimal slice of risk configuration.
 *
 * `maxOrderPositionBps` bounds how large a single order's own `positionPct`
 * may be, in basis points of the fraction requested. `maxAssetExposureBps`
 * bounds the projected value of one asset's position after a BUY, in basis
 * points of the cash-plus-that-asset baseline documented in
 * `src/risk/risk-manager.ts`. Neither loss, drawdown, cooldown nor liquidity
 * limits are part of this slice.
 */
export interface RiskPolicy {
  readonly schemaVersion: 1;
  /** Stable identifier of this policy, recorded on every decision. */
  readonly policyVersion: string;
  /** Assets a new order may name. Empty blocks every order. */
  readonly allowedAssets: readonly string[];
  readonly maxOrderPositionBps: number;
  readonly maxAssetExposureBps: number;
  /** Maximum number of distinct assets a wallet may hold at once. */
  readonly maxOpenPositions: number;
  /** When `true`, every new order is blocked regardless of every other rule. */
  readonly circuitBreaker: boolean;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(RISK_POLICY, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireSchemaVersion(value: unknown): 1 {
  if (value !== 1) rejectContract(RISK_POLICY, "schemaVersion", "must be exactly 1");
  return 1;
}

function requirePolicyVersion(value: unknown): string {
  if (typeof value !== "string") rejectContract(RISK_POLICY, "policyVersion", "must be a string");
  if (value.length === 0 || value.trim().length === 0) {
    rejectContract(RISK_POLICY, "policyVersion", "must not be empty or blank");
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    rejectContract(RISK_POLICY, "policyVersion", `must be at most ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    rejectContract(RISK_POLICY, "policyVersion", "must be alphanumeric with . _ : - separators");
  }
  return value;
}

function requireAllowedAssets(value: unknown): readonly string[] {
  if (!Array.isArray(value)) rejectContract(RISK_POLICY, "allowedAssets", "must be an array");
  if (value.length > MAX_ALLOWED_ASSETS) {
    rejectContract(RISK_POLICY, "allowedAssets", `must hold at most ${MAX_ALLOWED_ASSETS} assets`);
  }
  const seen = new Set<string>();
  const assets = value.map((entry: unknown): string => {
    if (typeof entry !== "string" || !SYMBOL_PATTERN.test(entry)) {
      rejectContract(RISK_POLICY, "allowedAssets", "must list uppercase symbols of 1 to 16 characters");
    }
    if (seen.has(entry)) {
      rejectContract(RISK_POLICY, "allowedAssets", "must not contain duplicate assets");
    }
    seen.add(entry);
    return entry;
  });
  return Object.freeze(assets);
}

function requireMaxOpenPositions(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    rejectContract(RISK_POLICY, "maxOpenPositions", "must be an integer");
  }
  if (value < 0) rejectContract(RISK_POLICY, "maxOpenPositions", "must not be negative");
  if (value > MAX_OPEN_POSITIONS_BOUND) {
    rejectContract(RISK_POLICY, "maxOpenPositions", `must be at most ${MAX_OPEN_POSITIONS_BOUND}`);
  }
  return value;
}

function requireCircuitBreaker(value: unknown): boolean {
  if (typeof value !== "boolean") rejectContract(RISK_POLICY, "circuitBreaker", "must be a boolean");
  return value;
}

/** Validates a risk policy and returns a frozen copy. Input is not mutated. */
export function parseRiskPolicy(value: unknown): RiskPolicy {
  const source = requireObject(value);
  const parsed: RiskPolicy = {
    schemaVersion: requireSchemaVersion(source.schemaVersion),
    policyVersion: requirePolicyVersion(source.policyVersion),
    allowedAssets: requireAllowedAssets(source.allowedAssets),
    maxOrderPositionBps: parseBps(
      source.maxOrderPositionBps,
      RISK_POLICY,
      "maxOrderPositionBps",
      MAX_RISK_POLICY_BPS
    ),
    maxAssetExposureBps: parseBps(
      source.maxAssetExposureBps,
      RISK_POLICY,
      "maxAssetExposureBps",
      MAX_RISK_POLICY_BPS
    ),
    maxOpenPositions: requireMaxOpenPositions(source.maxOpenPositions),
    circuitBreaker: requireCircuitBreaker(source.circuitBreaker)
  };
  return Object.freeze(parsed);
}
