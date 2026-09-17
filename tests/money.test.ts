import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import {
  MAX_ATOMS,
  MAX_MICROS,
  MICROS_PER_UNIT,
  addBounded,
  atomsToDecimalString,
  formatIntegerString,
  fractionToMicros,
  microsFromUsdNumber,
  microsToUsdString,
  mulDivCeil,
  mulDivFloor,
  parseAssetScale,
  parseAtomsString,
  parseBps,
  parseMicrosString,
  scaleFactor,
  subtractChecked
} from "../src/money/fixed-point.js";

function assertRejected(run: () => unknown, field: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError, "expected a ContractValidationError");
    assert.equal(error.field, field, `wrong field, got ${error.field}`);
    return true;
  });
}

describe("canonical decimal strings", () => {
  it("parses canonical non-negative integers", () => {
    assert.equal(parseMicrosString("0", "T", "value"), 0n);
    assert.equal(parseMicrosString("100000000", "T", "value"), 100_000_000n);
    assert.equal(parseAtomsString("1", "T", "value"), 1n);
  });

  it("rejects non-canonical spellings of the same number", () => {
    for (const text of ["01", "+1", "-1", "-0", "1.0", "1e3", "1_000", " 1", "1 ", "", "0x10"]) {
      assertRejected(() => parseMicrosString(text, "T", "value"), "value");
    }
  });

  it("rejects values that are not strings", () => {
    for (const value of [1, 1n, null, undefined, {}, ["1"]]) {
      assertRejected(() => parseMicrosString(value, "T", "value"), "value");
    }
  });

  it("rejects overflow beyond the sanity bounds", () => {
    assertRejected(() => parseMicrosString((MAX_MICROS + 1n).toString(), "T", "value"), "value");
    assertRejected(() => parseAtomsString((MAX_ATOMS + 1n).toString(), "T", "value"), "value");
    assert.equal(parseMicrosString(MAX_MICROS.toString(), "T", "value"), MAX_MICROS);
  });

  it("round-trips through the JSON boundary", () => {
    const value = 123_456_789n;
    assert.equal(parseMicrosString(formatIntegerString(value), "T", "value"), value);
  });

  it("refuses to format a negative value", () => {
    assertRejected(() => formatIntegerString(-1n), "value");
  });
});

describe("USD numbers to micros", () => {
  it("converts exactly", () => {
    assert.equal(microsFromUsdNumber(100, "T", "budget"), 100_000_000n);
    assert.equal(microsFromUsdNumber(0.000001, "T", "budget"), 1n);
    assert.equal(microsFromUsdNumber(0.1, "T", "budget"), 100_000n);
    assert.equal(microsFromUsdNumber(0, "T", "budget"), 0n);
    assert.equal(microsFromUsdNumber(1234.567891, "T", "budget"), 1_234_567_891n);
  });

  it("rejects more precision than micros can hold, instead of rounding money", () => {
    assertRejected(() => microsFromUsdNumber(0.0000001, "T", "budget"), "budget");
    assertRejected(() => microsFromUsdNumber(1.2345678, "T", "budget"), "budget");
  });

  it("rejects NaN, Infinity, negatives and non-numbers", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, "100", null]) {
      assertRejected(() => microsFromUsdNumber(value, "T", "budget"), "budget");
    }
  });

  it("rejects exponential notation and values above the bound", () => {
    assertRejected(() => microsFromUsdNumber(1e21, "T", "budget"), "budget");
    assertRejected(() => microsFromUsdNumber(1e15, "T", "budget"), "budget");
  });
});

describe("fractions to micros", () => {
  it("converts fractions that fit six decimals exactly", () => {
    assert.equal(fractionToMicros(1, "T", "positionPct"), MICROS_PER_UNIT);
    assert.equal(fractionToMicros(0, "T", "positionPct"), 0n);
    assert.equal(fractionToMicros(0.5, "T", "positionPct"), 500_000n);
    assert.equal(fractionToMicros(0.08, "T", "positionPct"), 80_000n);
    assert.equal(fractionToMicros(0.000001, "T", "positionPct"), 1n);
  });

  it("truncates rather than rounding a size up", () => {
    assert.equal(fractionToMicros(1 / 3, "T", "positionPct"), 333_333n);
    assert.equal(fractionToMicros(2 / 3, "T", "positionPct"), 666_666n);
    assert.equal(fractionToMicros(0.0000009, "T", "positionPct"), 0n);
  });

  it("is deterministic for the same double", () => {
    assert.equal(fractionToMicros(0.07, "T", "p"), fractionToMicros(0.07, "T", "p"));
  });

  it("rejects fractions outside [0, 1] and non-finite values", () => {
    for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
      assertRejected(() => fractionToMicros(value, "T", "positionPct"), "positionPct");
    }
  });
});

describe("scales and basis points", () => {
  it("accepts scales from 0 to 18", () => {
    assert.equal(parseAssetScale(0, "T", "assetScale"), 0);
    assert.equal(parseAssetScale(8, "T", "assetScale"), 8);
    assert.equal(parseAssetScale(18, "T", "assetScale"), 18);
    assert.equal(scaleFactor(8), 100_000_000n);
    assert.equal(scaleFactor(0), 1n);
  });

  it("rejects invalid scales", () => {
    for (const value of [-1, 19, 1.5, Number.NaN, "8", null]) {
      assertRejected(() => parseAssetScale(value, "T", "assetScale"), "assetScale");
    }
  });

  it("accepts non-negative integer basis points within the cap", () => {
    assert.equal(parseBps(0, "T", "feeBps", 10_000), 0);
    assert.equal(parseBps(10_000, "T", "feeBps", 10_000), 10_000);
  });

  it("rejects fractional, negative, excessive and non-numeric basis points", () => {
    for (const value of [-1, 1.5, 10_001, Number.NaN, Number.POSITIVE_INFINITY, "10"]) {
      assertRejected(() => parseBps(value, "T", "feeBps", 10_000), "feeBps");
    }
  });
});

describe("rounding helpers", () => {
  it("floors and ceils in the documented direction", () => {
    assert.equal(mulDivFloor(7n, 1n, 2n), 3n);
    assert.equal(mulDivCeil(7n, 1n, 2n), 4n);
    assert.equal(mulDivFloor(8n, 1n, 2n), 4n);
    assert.equal(mulDivCeil(8n, 1n, 2n), 4n);
    assert.equal(mulDivCeil(0n, 5n, 2n), 0n);
    assert.equal(mulDivFloor(0n, 5n, 2n), 0n);
  });

  it("never loses precision on large values", () => {
    const atoms = 12_345_678_901_234_567n;
    const price = 987_654_321n;
    assert.equal(mulDivFloor(atoms, price, 100_000_000n), (atoms * price) / 100_000_000n);
  });

  it("rejects negative operands and a non-positive divisor", () => {
    assertRejected(() => mulDivFloor(-1n, 2n, 2n), "a");
    assertRejected(() => mulDivCeil(1n, -2n, 2n), "b");
    assertRejected(() => mulDivFloor(1n, 2n, 0n), "divisor");
    assertRejected(() => mulDivCeil(1n, 2n, -2n), "divisor");
  });
});

describe("checked arithmetic", () => {
  it("adds within the bound and rejects above it", () => {
    assert.equal(addBounded(2n, 3n, 10n, "value"), 5n);
    assertRejected(() => addBounded(6n, 5n, 10n, "value"), "value");
  });

  it("subtracts without ever going below zero", () => {
    assert.equal(subtractChecked(5n, 5n, "cashMicros"), 0n);
    assert.equal(subtractChecked(5n, 2n, "cashMicros"), 3n);
    assertRejected(() => subtractChecked(2n, 5n, "cashMicros"), "cashMicros");
  });
});

describe("display helpers", () => {
  it("renders micros and atoms with their full scale", () => {
    assert.equal(microsToUsdString(100_000_000n), "100.000000");
    assert.equal(microsToUsdString(1n), "0.000001");
    assert.equal(microsToUsdString(0n), "0.000000");
    assert.equal(atomsToDecimalString(980n, 2), "9.80");
    assert.equal(atomsToDecimalString(100_000_000n, 8), "1.00000000");
    assert.equal(atomsToDecimalString(5n, 0), "5");
  });

  it("refuses to render negative amounts", () => {
    assertRejected(() => microsToUsdString(-1n), "micros");
    assertRejected(() => atomsToDecimalString(-1n, 8), "atoms");
  });
});
