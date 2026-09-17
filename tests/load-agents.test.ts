import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { ContractValidationError } from "../src/domain/contracts.js";
import {
  DEFAULT_AGENTS_CONFIG_PATH,
  MAX_AGENTS,
  enabledAgents,
  loadAgentsConfig,
  parseAgentsConfig,
  totalInitialBudgetUsd
} from "../src/config/load-agents.js";

type Payload = Record<string, unknown>;

function agent(id: string, overrides: Payload = {}): Payload {
  return {
    id,
    name: id,
    strategy: id,
    enabled: true,
    initialBudgetUsd: 100,
    mode: "reference",
    ...overrides
  };
}

function roster(agents: Payload[]): Payload {
  return { schemaVersion: 1, agents };
}

function assertRejected(run: () => unknown, field: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError, "expected a ContractValidationError");
    assert.equal(error.field, field, `wrong field, got ${error.field}`);
    return true;
  });
}

const temporaryDirectories: string[] = [];

async function temporaryFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "astranovo-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents, "utf8");
  return path;
}

after(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("shipped roster", () => {
  it("loads exactly six agents", async () => {
    const config = await loadAgentsConfig();
    assert.equal(config.agents.length, 6);
  });

  it("gives every agent a US$100 starting budget", async () => {
    const config = await loadAgentsConfig();
    for (const entry of config.agents) {
      assert.equal(entry.initialBudgetUsd, 100, `${entry.id} must start with US$100`);
    }
    assert.equal(totalInitialBudgetUsd(config), 600);
  });

  it("enables all six demonstration profiles", async () => {
    const config = await loadAgentsConfig();
    assert.equal(enabledAgents(config).length, 6);
    assert.deepEqual(
      config.agents.map((entry) => entry.id),
      [
        "trend-following",
        "mean-reversion",
        "breakout",
        "momentum",
        "volatility-filtered",
        "conservative-baseline"
      ]
    );
  });

  it("loads deterministically", async () => {
    assert.deepEqual(await loadAgentsConfig(), await loadAgentsConfig());
  });

  it("is loaded from the repository path, not from an embedded copy", () => {
    assert.ok(
      DEFAULT_AGENTS_CONFIG_PATH.endsWith(join("config", "agents.json")),
      "default path must point at config/agents.json"
    );
  });
});

describe("roster size is configuration, not code", () => {
  it("accepts a seventh agent with no code change", async () => {
    const shipped = await loadAgentsConfig();
    const extended = parseAgentsConfig(
      roster([
        ...shipped.agents.map((entry) => ({ ...entry })),
        agent("liquidity-aware", { name: "Liquidity Aware", mode: "optimized" })
      ])
    );

    assert.equal(extended.agents.length, 7);
    assert.equal(extended.agents[6]?.id, "liquidity-aware");
    assert.equal(extended.agents[6]?.mode, "optimized");
  });

  it("accepts a single agent", () => {
    assert.equal(parseAgentsConfig(roster([agent("solo")])).agents.length, 1);
  });

  it("accepts a roster at the sanity limit", () => {
    const agents = Array.from({ length: MAX_AGENTS }, (_, index) => agent(`agent-${index}`));
    assert.equal(parseAgentsConfig(roster(agents)).agents.length, MAX_AGENTS);
  });

  it("rejects a roster above the sanity limit", () => {
    const agents = Array.from({ length: MAX_AGENTS + 1 }, (_, index) => agent(`agent-${index}`));
    assertRejected(() => parseAgentsConfig(roster(agents)), "agents");
  });

  it("supports mixed reference and optimized modes in one roster", () => {
    const config = parseAgentsConfig(
      roster([agent("a"), agent("b", { mode: "optimized" })])
    );
    assert.deepEqual(
      config.agents.map((entry) => entry.mode),
      ["reference", "optimized"]
    );
  });

  it("keeps disabled agents in the roster but out of the enabled set", () => {
    const config = parseAgentsConfig(roster([agent("a"), agent("b", { enabled: false })]));
    assert.equal(config.agents.length, 2);
    assert.deepEqual(
      enabledAgents(config).map((entry) => entry.id),
      ["a"]
    );
    assert.equal(totalInitialBudgetUsd(config), 100);
  });
});

describe("roster validation", () => {
  it("rejects an empty roster", () => {
    assertRejected(() => parseAgentsConfig(roster([])), "agents");
  });

  it("rejects duplicate agent ids", () => {
    assertRejected(
      () => parseAgentsConfig(roster([agent("trend-following"), agent("trend-following")])),
      "agents"
    );
  });

  it("rejects a non-object roster", () => {
    assertRejected(() => parseAgentsConfig(null), "value");
    assertRejected(() => parseAgentsConfig([agent("a")]), "value");
  });

  it("rejects a wrong schema version", () => {
    assertRejected(() => parseAgentsConfig({ schemaVersion: 2, agents: [agent("a")] }), "schemaVersion");
    assertRejected(() => parseAgentsConfig({ agents: [agent("a")] }), "schemaVersion");
  });

  it("rejects agents that are not an array", () => {
    assertRejected(() => parseAgentsConfig({ schemaVersion: 1, agents: {} }), "agents");
  });

  it("propagates the failing field of an invalid entry", () => {
    assertRejected(() => parseAgentsConfig(roster([agent("a", { initialBudgetUsd: 0 })])), "initialBudgetUsd");
    assertRejected(() => parseAgentsConfig(roster([agent("a", { mode: "hybrid" })])), "mode");
    assertRejected(() => parseAgentsConfig(roster([agent("a", { name: "" })])), "name");
    assertRejected(() => parseAgentsConfig(roster([agent("Bad-Id")])), "id");
  });

  it("does not mutate the input roster", () => {
    const input = roster([agent("a"), agent("b")]);
    const before = structuredClone(input);
    parseAgentsConfig(input);
    assert.deepEqual(input, before);
  });

  it("returns a frozen roster and frozen entries", () => {
    const config = parseAgentsConfig(roster([agent("a")]));
    assert.ok(Object.isFrozen(config), "roster must be frozen");
    assert.ok(Object.isFrozen(config.agents), "agents array must be frozen");
    assert.ok(Object.isFrozen(config.agents[0]), "each agent must be frozen");
  });
});

describe("loading from disk", () => {
  it("reports invalid JSON as a contract violation without echoing the file", async () => {
    const path = await temporaryFile("broken.json", "{ not json ");
    await assert.rejects(loadAgentsConfig(path), (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.message, "Invalid AgentsConfig: file must contain valid JSON");
      return true;
    });
  });

  it("validates a roster read from disk", async () => {
    const path = await temporaryFile("roster.json", JSON.stringify(roster([agent("solo")])));
    const config = await loadAgentsConfig(path);
    assert.equal(config.agents.length, 1);
    assert.equal(config.agents[0]?.id, "solo");
  });

  it("rejects a roster file with duplicate ids", async () => {
    const path = await temporaryFile(
      "duplicates.json",
      JSON.stringify(roster([agent("a"), agent("a")]))
    );
    await assert.rejects(loadAgentsConfig(path), (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.field, "agents");
      return true;
    });
  });

  it("fails when the file does not exist", async () => {
    await assert.rejects(loadAgentsConfig(join(tmpdir(), "astranovo-missing-roster.json")));
  });
});
