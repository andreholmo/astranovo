/**
 * A local, deterministic `AgentAdapter` for tests and replay fixtures: every
 * response is scripted ahead of time and keyed exactly by `agentId` +
 * `cycleId` + `snapshotId`. There is no clock, no randomness, no network, no
 * SDK and no I/O, and no fallback — a request that does not match a
 * configured route, or that reuses a route already consumed, fails closed
 * rather than guessing or retrying.
 *
 * The stub never inspects, validates, corrects or completes the routed
 * response: it is forwarded exactly as configured, malformed or not, so that
 * `parseAgentProposal` downstream is the only place that judges it.
 */

import { rejectContract } from "../domain/errors.js";
import { type AgentAdapter, type AgentRequest, parseAgentRequest } from "./agent-adapter.js";

const STUB_AGENT_ADAPTER_CONFIG = "StubAgentAdapterConfig";
const STUB_AGENT_ADAPTER_REQUEST = "StubAgentAdapterRequest";

/** One scripted response, keyed by the exact request it answers. */
export interface StubAgentRoute {
  readonly agentId: string;
  readonly cycleId: string;
  readonly snapshotId: string;
  /** Forwarded exactly as given; never inspected, validated or repaired by the stub. */
  readonly response: unknown;
}

/** Configuration for {@link StubAgentAdapter}. */
export interface StubAgentAdapterConfig {
  readonly routes: readonly StubAgentRoute[];
}

function routeKey(agentId: string, cycleId: string, snapshotId: string): string {
  return JSON.stringify([agentId, cycleId, snapshotId]);
}

function requireRoutes(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectContract(STUB_AGENT_ADAPTER_CONFIG, "value", "must be a JSON object");
  }
  const routes = (value as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) {
    rejectContract(STUB_AGENT_ADAPTER_CONFIG, "routes", "must be an array");
  }
  return routes;
}

/**
 * A local, deterministic, single-use-per-key `AgentAdapter`.
 *
 * Each configured route may answer exactly one call: the key it was
 * registered under is consumed on first use, so a second call for the same
 * `agentId`/`cycleId`/`snapshotId` fails closed instead of replaying, and no
 * unrouted request is ever answered by inference or partial match.
 */
export class StubAgentAdapter implements AgentAdapter {
  readonly #responsesByKey: ReadonlyMap<string, unknown>;
  readonly #consumedKeys = new Set<string>();

  public constructor(config: unknown) {
    const routes = requireRoutes(config);
    const responsesByKey = new Map<string, unknown>();
    for (const rawRoute of routes) {
      if (typeof rawRoute !== "object" || rawRoute === null || Array.isArray(rawRoute)) {
        rejectContract(STUB_AGENT_ADAPTER_CONFIG, "routes entry", "must be a JSON object");
      }
      const route = rawRoute as {
        readonly agentId?: unknown;
        readonly cycleId?: unknown;
        readonly snapshotId?: unknown;
        readonly response?: unknown;
      };
      const request = parseAgentRequest({
        schemaVersion: 1,
        agentId: route.agentId,
        cycleId: route.cycleId,
        snapshotId: route.snapshotId
      });
      const key = routeKey(request.agentId, request.cycleId, request.snapshotId);
      if (responsesByKey.has(key)) {
        rejectContract(
          STUB_AGENT_ADAPTER_CONFIG,
          "routes",
          "must not configure the same agentId/cycleId/snapshotId combination twice"
        );
      }
      responsesByKey.set(key, route.response);
    }
    this.#responsesByKey = responsesByKey;
  }

  /**
   * Returns the routed response for one request, consuming its key.
   *
   * Fails closed with `ContractValidationError` for an invalid request, a
   * request with no configured route, or a route already consumed by a prior
   * call.
   */
  public call(request: AgentRequest): unknown {
    const parsed = parseAgentRequest(request);
    const key = routeKey(parsed.agentId, parsed.cycleId, parsed.snapshotId);
    if (!this.#responsesByKey.has(key)) {
      rejectContract(STUB_AGENT_ADAPTER_REQUEST, "request", "must match a configured route");
    }
    if (this.#consumedKeys.has(key)) {
      rejectContract(STUB_AGENT_ADAPTER_REQUEST, "request", "must not reuse an already-consumed route");
    }
    this.#consumedKeys.add(key);
    return this.#responsesByKey.get(key);
  }
}
