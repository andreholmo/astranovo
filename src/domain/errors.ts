/**
 * Shared validation error surface.
 *
 * Lives in its own module so that `src/money` and `src/domain/contracts` can
 * both use it without an import cycle. `src/domain/contracts.ts` re-exports
 * `ContractValidationError` and `describeContractError`, so importing them
 * from there keeps working.
 */

/**
 * A contract violation. Carries the contract name, the field and the
 * requirement that failed — never the rejected value itself.
 */
export class ContractValidationError extends Error {
  public readonly contract: string;
  public readonly field: string;
  public readonly requirement: string;

  public constructor(contract: string, field: string, requirement: string) {
    super(`Invalid ${contract}: ${field} ${requirement}`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.field = field;
    this.requirement = requirement;
  }
}

/**
 * Renders any error as a single safe line for user-facing output: no stack,
 * no cause chain, no payload content. Unknown errors are reported generically
 * rather than leaking a message from an unexpected source.
 */
export function describeContractError(error: unknown): string {
  if (error instanceof ContractValidationError) return error.message;
  return "Validation failed for an unexpected reason.";
}

/** Throws a {@link ContractValidationError}. Never returns. */
export function rejectContract(contract: string, field: string, requirement: string): never {
  throw new ContractValidationError(contract, field, requirement);
}
