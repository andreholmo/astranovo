/**
 * The cost model, in one place.
 *
 * Every formula the broker uses lives here and is built only from the
 * primitives in `src/money/fixed-point.ts`. No other module computes a price,
 * a notional or a fee.
 *
 * ## Effective price
 *
 * Half of the quoted spread is paid on each side, plus the full slippage
 * allowance, always against the trader:
 *
 * ```text
 * BUY  effective = ceil (reference * (20000 + spreadBps + 2*slippageBps) / 20000)
 * SELL effective = floor(reference * (20000 - spreadBps - 2*slippageBps) / 20000)
 * ```
 *
 * The denominator is twice the basis-point denominator so that half a spread
 * is expressed exactly in integers, with no intermediate rounding. A SELL
 * whose costs consume the whole price yields no price at all rather than a
 * negative one.
 *
 * ## Notional and fee
 *
 * ```text
 * gross(BUY)  = ceil (quantityAtoms * effectivePrice / 10^assetScale)
 * gross(SELL) = floor(quantityAtoms * effectivePrice / 10^assetScale)
 * fee         = ceil (gross * feeBps / 10000)
 * ```
 *
 * A BUY pays `gross + fee`; a SELL receives `gross - fee`.
 */

import type { ExecutionPolicy } from "../domain/contracts.js";
import {
  BPS_DENOMINATOR,
  HALF_SPREAD_DENOMINATOR,
  mulDivCeil,
  mulDivFloor,
  type Atoms,
  type Micros
} from "../money/fixed-point.js";

/** Effective purchase price per whole unit, in micros. Rounded up. */
export function buyPriceMicros(referencePriceMicros: Micros, policy: ExecutionPolicy): Micros {
  const numerator =
    HALF_SPREAD_DENOMINATOR + BigInt(policy.spreadBps) + 2n * BigInt(policy.slippageBps);
  return mulDivCeil(referencePriceMicros, numerator, HALF_SPREAD_DENOMINATOR);
}

/**
 * Effective sale price per whole unit, in micros, rounded down.
 *
 * Returns `null` when spread and slippage consume the whole reference price,
 * so the caller rejects the order instead of executing at zero or below.
 */
export function sellPriceMicros(
  referencePriceMicros: Micros,
  policy: ExecutionPolicy
): Micros | null {
  const deduction = BigInt(policy.spreadBps) + 2n * BigInt(policy.slippageBps);
  if (deduction >= HALF_SPREAD_DENOMINATOR) return null;
  const numerator = HALF_SPREAD_DENOMINATOR - deduction;
  const price = mulDivFloor(referencePriceMicros, numerator, HALF_SPREAD_DENOMINATOR);
  return price === 0n ? null : price;
}

/** Notional paid for a quantity, rounded up. */
export function grossMicrosPaid(
  quantityAtoms: Atoms,
  priceMicros: Micros,
  assetScaleFactor: bigint
): Micros {
  return mulDivCeil(quantityAtoms, priceMicros, assetScaleFactor);
}

/** Notional received for a quantity, rounded down. */
export function grossMicrosReceived(
  quantityAtoms: Atoms,
  priceMicros: Micros,
  assetScaleFactor: bigint
): Micros {
  return mulDivFloor(quantityAtoms, priceMicros, assetScaleFactor);
}

/** Fee charged on a gross notional, rounded up. */
export function feeMicros(grossMicros: Micros, feeBps: number): Micros {
  return mulDivCeil(grossMicros, BigInt(feeBps), BPS_DENOMINATOR);
}

/** Total cash a BUY of this quantity would cost: `gross + fee`. */
export function buyCostMicros(
  quantityAtoms: Atoms,
  priceMicros: Micros,
  assetScaleFactor: bigint,
  feeBps: number
): Micros {
  const gross = grossMicrosPaid(quantityAtoms, priceMicros, assetScaleFactor);
  return gross + feeMicros(gross, feeBps);
}

/**
 * Largest quantity, in atoms, whose total cost fits the budget.
 *
 * `buyCostMicros` is non-decreasing in quantity because both roundings are
 * monotone, so the answer is found by an exact binary search rather than by a
 * division that the two `ceil` steps would make slightly wrong. The upper
 * bound is one atom past what the budget could buy even with no fee, which is
 * therefore always unaffordable.
 */
export function maxAffordableAtoms(
  budgetMicros: Micros,
  priceMicros: Micros,
  assetScaleFactor: bigint,
  feeBps: number
): Atoms {
  if (budgetMicros <= 0n || priceMicros <= 0n) return 0n;

  let affordable = 0n;
  let unaffordable = mulDivFloor(budgetMicros, assetScaleFactor, priceMicros) + 1n;

  while (unaffordable - affordable > 1n) {
    const candidate = (affordable + unaffordable) / 2n;
    if (buyCostMicros(candidate, priceMicros, assetScaleFactor, feeBps) <= budgetMicros) {
      affordable = candidate;
    } else {
      unaffordable = candidate;
    }
  }
  return affordable;
}
