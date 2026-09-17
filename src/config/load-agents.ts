/**
 * Agent roster loading and validation.
 *
 * The number of agents is configuration, never code (D-006): nothing in this
 * module knows or cares that the shipped roster happens to hold six entries.
 * Adding a seventh agent is a change to `config/agents.json` alone.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ContractValidationError, parseAgentConfig, type AgentConfig } from "../domain/contracts.js";

/**
 * Upper bound on roster size. This is a resource sanity limit, not a design
 * limit: it exists so a malformed file cannot ask for an unbounded roster.
 */
export const MAX_AGENTS = 1000;

/** Absolute path of the roster shipped with the repository. */
export const DEFAULT_AGENTS_CONFIG_PATH = fileURLToPath(
  new URL("../../../config/agents.json", import.meta.url)
);

/** A validated roster of agents. */
export interface AgentsConfig {
  readonly schemaVersion: 1;
  readonly agents: readonly AgentConfig[];
}

const AGENTS_CONFIG = "AgentsConfig";

function reject(field: string, requirement: string): never {
  throw new ContractValidationError(AGENTS_CONFIG, field, requirement);
}

/**
 * Validates a roster and returns a frozen copy. Pure: no I/O, no clock, and
 * the input object is not mutated.
 *
 * Rejects an empty roster, a roster above {@link MAX_AGENTS}, duplicate agent
 * ids, and any entry that fails {@link parseAgentConfig}.
 */
export function parseAgentsConfig(value: unknown): AgentsConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject("value", "must be a JSON object");
  }
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1) reject("schemaVersion", "must be exactly 1");
  if (!Array.isArray(source.agents)) reject("agents", "must be an array");
  if (source.agents.length === 0) reject("agents", "must contain at least one agent");
  if (source.agents.length > MAX_AGENTS) {
    reject("agents", `must contain at most ${MAX_AGENTS} agents`);
  }

  const seen = new Set<string>();
  const agents = source.agents.map((entry) => {
    const agent = parseAgentConfig(entry);
    if (seen.has(agent.id)) reject("agents", "must not contain duplicate agent ids");
    seen.add(agent.id);
    return agent;
  });

  return Object.freeze({ schemaVersion: 1 as const, agents: Object.freeze(agents) });
}

/**
 * Reads and validates a roster from disk. Local file access only; no network.
 *
 * A file that is not valid JSON is reported as a contract violation rather
 * than as a raw parser error, so nothing from the file contents reaches the
 * message.
 */
export async function loadAgentsConfig(
  filePath: string = DEFAULT_AGENTS_CONFIG_PATH
): Promise<AgentsConfig> {
  const contents = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    reject("file", "must contain valid JSON");
  }
  return parseAgentsConfig(parsed);
}

/** The enabled subset of a roster, in configuration order. */
export function enabledAgents(config: AgentsConfig): readonly AgentConfig[] {
  return Object.freeze(config.agents.filter((agent) => agent.enabled));
}

/** Total starting capital of the enabled agents, in USD. */
export function totalInitialBudgetUsd(config: AgentsConfig): number {
  return enabledAgents(config).reduce((total, agent) => total + agent.initialBudgetUsd, 0);
}
