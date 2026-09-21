/**
 * Shared, fail-closed primitives for validating the small pieces of
 * untrusted input every attempt boundary in this directory needs before an
 * `AgentAdapter` is ever touched: a JSON input object, a bounded
 * identifying/version string, and an adapter exposing a `call` function.
 *
 * Internal to `src/agent` — not exported outside it and not part of any
 * public contract — so that `../run-auditable-agent-attempt.js` and
 * `../run-bounded-agent-attempts.js` share exactly one implementation of
 * this boundary instead of two independently maintained copies. Every
 * message here is byte-for-byte what both callers already threw before this
 * extraction.
 *
 * `readProperty` exists because a forged input object — a `Proxy`, or a
 * plain object with a throwing getter — can make any single property read
 * throw an arbitrary value, including a secret. Any read of an untrusted
 * object's property in this module goes through it, so a throwing read is
 * treated exactly like an absent property (`undefined`) and is never
 * rethrown.
 */

import { rejectContract } from "../../domain/errors.js";
import { type AgentAdapter } from "../agent-adapter.js";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Reads `source[key]` defensively: a forged object can make any property a
 * getter (directly, or via a `Proxy` `get` trap) that throws instead of
 * returning a value, and whatever it throws — message, stack, cause, a
 * secret — must never escape this read. Any exception here is treated
 * exactly like the property being absent (`undefined`), never rethrown.
 */
export function readProperty(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

export function requireInputObject(value: unknown, contract: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(contract, "value", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Validates a short identifying/version string: non-empty, non-blank, bounded
 * and free of control characters. Used only for `responseId`(s),
 * `promptVersion` and `model` metadata — validated before the adapter is
 * ever touched, never for agent-supplied content.
 */
export function requireBoundedText(
  value: unknown,
  contract: string,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    rejectContract(contract, field, "must be a string");
  }
  if (value.length === 0 || value.trim().length === 0) {
    rejectContract(contract, field, "must not be empty or blank");
  }
  if (value.length > maxLength) {
    rejectContract(contract, field, `must be at most ${maxLength} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    rejectContract(contract, field, "must not contain control characters");
  }
  return value;
}

/**
 * Validates fail-closed, before any call is attempted, that `value` is a
 * usable `AgentAdapter` — an object exposing a `call` function. Never invokes
 * it and never inspects its result. Reading the `call` property itself goes
 * through {@link readProperty}, so a forged adapter cannot use a throwing
 * getter/proxy to leak a value through this check.
 */
export function requireAdapter(value: unknown, contract: string): AgentAdapter {
  const isObject = typeof value === "object" && value !== null;
  const call = isObject ? readProperty(value, "call") : undefined;
  if (!isObject || typeof call !== "function") {
    rejectContract(contract, "adapter", "must be an object exposing a call(request) function");
  }
  return value as AgentAdapter;
}
