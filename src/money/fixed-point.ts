/**
 * Fixed-point money and quantity arithmetic.
 *
 * This is the **only** module allowed to convert between external
 * representations (JSON strings, JavaScript numbers) and internal accounting
 * values, and the only one that decides how a division rounds. Every other
 * module composes the helpers here; no module reimplements a formula.
 *
 * ## Representation
 *
 * - **USD amounts** are `bigint` **micros**: 1 USD = 1_000_000 micros, i.e.
 *   six decimal places (US$0.000001). Binary floating point is never the
 *   source of truth for money.
 * - **Asset quantities** are `bigint` **atoms**: integers in the asset's own
 *   atomic unit. The number of decimals is the asset's `scale`, carried
 *   explicitly alongside every quantity (the shipped fixture uses 8).
 * - **Prices** are micros of quote per **one whole unit** of the asset, so a
 *   notional is `atoms * priceMicros / 10^scale`.
 * - **JSON boundaries** carry every `bigint` as a canonical decimal string:
 *   digits only, no sign, no leading zeros, no exponent, no separators.
 *   `"100000000"` is one hundred USD in micros.
 *
 * ## Rounding policy
 *
 * Rounding always favours a conservative simulation — the simulated agent
 * never gets a better price, a smaller cost or a larger quantity than reality
 * would give it:
 *
 * | Quantity being computed | Rounding | Why |
 * |---|---|---|
 * | quantity that can be bought | floor | never buy more than the cash covers |
 * | quantity to sell from a position | floor | never sell more than is held |
 * | amount paid on a BUY | ceil | pay no less than the true cost |
 * | amount received on a SELL | floor | receive no more than the true proceeds |
 * | fees and other costs | ceil | costs are never understated |
 * | a fraction such as `positionPct` | truncate at 6 dp | deterministic, never rounds a size up |
 *
 * All values handled here are non-negative; there is no short selling and no
 * negative cash in this milestone, so `floor` and `truncate` coincide and the
 * helpers reject negative operands rather than silently guessing a direction.
 */

import { rejectContract } from "../domain/errors.js";

/** Decimal places of a USD micro amount. */
export const MICROS_DECIMALS = 6;
/** Micros in one USD. */
export const MICROS_PER_UNIT = 1_000_000n;
/** Basis-point denominator: 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;
/** Twice {@link BPS_DENOMINATOR}, used to apply half of a quoted spread. */
export const HALF_SPREAD_DENOMINATOR = 20_000n;
/** Largest asset scale accepted, in decimal places. */
export const MAX_ASSET_SCALE = 18;
/** Sanity bound for USD micro amounts (about US$9.2 trillion). */
export const MAX_MICROS = 2n ** 63n - 1n;
/** Sanity bound for atomic asset quantities. */
export const MAX_ATOMS = 2n ** 96n - 1n;

/** A USD amount in micros. Always non-negative in this milestone. */
export type Micros = bigint;
/** An asset quantity in atomic units. Always non-negative. */
export type Atoms = bigint;

const MONEY = "Money";
const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const PLAIN_DECIMAL_PATTERN = /^[0-9]+(?:\.[0-9]+)?$/;

/* -------------------------------------------------------------------------- */
/* Canonical decimal strings — the JSON boundary                              */
/* -------------------------------------------------------------------------- */

/**
 * Parses a canonical non-negative decimal string into a `bigint`.
 *
 * Rejects anything that is not exactly how the value would be printed back:
 * an empty string, a sign, leading zeros (`"01"`), a decimal point, an
 * exponent (`"1e3"`), separators (`"1_000"`), surrounding whitespace, and any
 * value above `maximum`. Two different strings can therefore never denote the
 * same accounting value.
 */
export function parseNonNegativeIntegerString(
  value: unknown,
  contract: string,
  field: string,
  maximum: bigint
): bigint {
  if (typeof value !== "string") {
    rejectContract(contract, field, "must be a canonical decimal string");
  }
  if (!CANONICAL_INTEGER_PATTERN.test(value)) {
    rejectContract(
      contract,
      field,
      "must be a canonical decimal string: digits only, no sign, no leading zeros"
    );
  }
  const parsed = BigInt(value);
  if (parsed > maximum) rejectContract(contract, field, `must be at most ${maximum}`);
  return parsed;
}

/** Renders a `bigint` as the canonical decimal string used at JSON boundaries. */
export function formatIntegerString(value: bigint): string {
  if (value < 0n) rejectContract(MONEY, "value", "must not be negative");
  return value.toString();
}

/** Parses a canonical decimal string into a USD micro amount. */
export function parseMicrosString(value: unknown, contract: string, field: string): Micros {
  return parseNonNegativeIntegerString(value, contract, field, MAX_MICROS);
}

/** Parses a canonical decimal string into an atomic asset quantity. */
export function parseAtomsString(value: unknown, contract: string, field: string): Atoms {
  return parseNonNegativeIntegerString(value, contract, field, MAX_ATOMS);
}

/* -------------------------------------------------------------------------- */
/* Scales                                                                     */
/* -------------------------------------------------------------------------- */

/** Validates an asset scale: an integer from 0 to {@link MAX_ASSET_SCALE}. */
export function parseAssetScale(value: unknown, contract: string, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    rejectContract(contract, field, "must be an integer");
  }
  if (value < 0 || value > MAX_ASSET_SCALE) {
    rejectContract(contract, field, `must be between 0 and ${MAX_ASSET_SCALE}`);
  }
  return value;
}

/** `10^scale`: the number of atoms in one whole unit of the asset. */
export function scaleFactor(scale: number): bigint {
  return 10n ** BigInt(parseAssetScale(scale, MONEY, "scale"));
}

/* -------------------------------------------------------------------------- */
/* Conversions from JavaScript numbers                                        */
/* -------------------------------------------------------------------------- */

/**
 * Converts a USD amount expressed as a JavaScript number into micros,
 * **exactly**. A value that cannot be written with at most six decimal places
 * — or that is written in exponential notation — is rejected rather than
 * rounded, because configured budgets must mean precisely what they say.
 */
export function microsFromUsdNumber(value: unknown, contract: string, field: string): Micros {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    rejectContract(contract, field, "must be a finite number");
  }
  if (value < 0) rejectContract(contract, field, "must not be negative");
  const text = value.toString();
  if (!PLAIN_DECIMAL_PATTERN.test(text)) {
    rejectContract(contract, field, "must be a plain decimal without exponent notation");
  }
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > MICROS_DECIMALS) {
    rejectContract(contract, field, `must have at most ${MICROS_DECIMALS} decimal places`);
  }
  const micros = BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction.padEnd(MICROS_DECIMALS, "0"));
  if (micros > MAX_MICROS) rejectContract(contract, field, `must be at most ${MAX_MICROS} micros`);
  return micros;
}

/**
 * Converts a fraction in [0, 1] into micros of a unit, **truncating** at six
 * decimal places.
 *
 * Unlike {@link microsFromUsdNumber} this never rejects for excess precision:
 * `positionPct` is a policy input, not an amount of money, and a proposal of
 * `1/3` is a legitimate request for "a third, as closely as we can size it".
 * Truncation keeps the resulting order size at or below what was asked and is
 * fully deterministic for a given double.
 */
export function fractionToMicros(value: unknown, contract: string, field: string): bigint {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    rejectContract(contract, field, "must be a finite number");
  }
  if (value < 0 || value > 1) rejectContract(contract, field, "must be between 0 and 1");
  const text = value.toFixed(20);
  const [whole = "0", fraction = ""] = text.split(".");
  const truncated = fraction.slice(0, MICROS_DECIMALS).padEnd(MICROS_DECIMALS, "0");
  return BigInt(whole) * MICROS_PER_UNIT + BigInt(truncated);
}

/** Validates a basis-point figure: an integer from 0 to `maximum`. */
export function parseBps(
  value: unknown,
  contract: string,
  field: string,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    rejectContract(contract, field, "must be an integer");
  }
  if (value < 0) rejectContract(contract, field, "must not be negative");
  if (value > maximum) rejectContract(contract, field, `must be at most ${maximum}`);
  return value;
}

/* -------------------------------------------------------------------------- */
/* Display helpers — never used as an accounting value                        */
/* -------------------------------------------------------------------------- */

/** Renders micros as a human-readable USD string, e.g. `100.000000`. */
export function microsToUsdString(value: Micros): string {
  assertNonNegative(value, "micros");
  const whole = value / MICROS_PER_UNIT;
  const fraction = (value % MICROS_PER_UNIT).toString().padStart(MICROS_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

/** Renders atoms as a human-readable decimal quantity for the given scale. */
export function atomsToDecimalString(value: Atoms, scale: number): string {
  assertNonNegative(value, "atoms");
  const factor = scaleFactor(scale);
  if (scale === 0) return value.toString();
  const whole = value / factor;
  const fraction = (value % factor).toString().padStart(scale, "0");
  return `${whole}.${fraction}`;
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                 */
/* -------------------------------------------------------------------------- */

function assertNonNegative(value: bigint, field: string): void {
  if (typeof value !== "bigint") rejectContract(MONEY, field, "must be a bigint");
  if (value < 0n) rejectContract(MONEY, field, "must not be negative");
}

/** `floor(a * b / divisor)` for non-negative operands. */
export function mulDivFloor(a: bigint, b: bigint, divisor: bigint): bigint {
  assertNonNegative(a, "a");
  assertNonNegative(b, "b");
  if (divisor <= 0n) rejectContract(MONEY, "divisor", "must be greater than 0");
  return (a * b) / divisor;
}

/** `ceil(a * b / divisor)` for non-negative operands. */
export function mulDivCeil(a: bigint, b: bigint, divisor: bigint): bigint {
  assertNonNegative(a, "a");
  assertNonNegative(b, "b");
  if (divisor <= 0n) rejectContract(MONEY, "divisor", "must be greater than 0");
  const product = a * b;
  if (product === 0n) return 0n;
  return (product + divisor - 1n) / divisor;
}

/** Adds two non-negative amounts, guarding the sanity bound. */
export function addBounded(a: bigint, b: bigint, maximum: bigint, field: string): bigint {
  assertNonNegative(a, field);
  assertNonNegative(b, field);
  const total = a + b;
  if (total > maximum) rejectContract(MONEY, field, `must be at most ${maximum}`);
  return total;
}

/** Subtracts `b` from `a`, refusing to produce a negative result. */
export function subtractChecked(a: bigint, b: bigint, field: string): bigint {
  assertNonNegative(a, field);
  assertNonNegative(b, field);
  if (b > a) rejectContract(MONEY, field, "must not go below 0");
  return a - b;
}
