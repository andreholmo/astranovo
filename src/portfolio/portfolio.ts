/**
 * Wallets and portfolio: state *derived* from the ledger.
 *
 * Per D-008 the ledger is the accounting source of truth and a wallet is a
 * cache of it. `replayWallet` rebuilds a wallet from its initial budget plus
 * its events, and must produce exactly the same cash and positions as applying
 * those events one at a time did.
 *
 * Invariants, checked on every application rather than assumed:
 *
 * - cash never goes negative — there is no margin and no leverage;
 * - a position quantity never goes negative — there is no short selling;
 * - a position that reaches zero is removed, so two wallets holding nothing
 *   compare equal;
 * - every wallet is frozen, and applying an event returns a new wallet rather
 *   than mutating the old one.
 *
 * Wallets are isolated: nothing in this module can move value between agents.
 */

import type { AgentsConfig } from "../config/load-agents.js";
import type { AppendResult } from "../ledger/ledger.js";
import type { FillEvent, LedgerEvent } from "../ledger/events.js";
import { enabledAgents } from "../config/load-agents.js";
import { rejectContract } from "../domain/errors.js";
import {
  MAX_ATOMS,
  MAX_MICROS,
  addBounded,
  microsFromUsdNumber,
  subtractChecked,
  type Atoms,
  type Micros
} from "../money/fixed-point.js";

/** A holding of one asset. Quantity is always greater than zero. */
export interface Position {
  readonly asset: string;
  /** Decimal places of one whole unit, carried with the quantity. */
  readonly assetScale: number;
  readonly quantityAtoms: Atoms;
}

/** One agent's isolated wallet. */
export interface Wallet {
  readonly agentId: string;
  /** Budget the wallet started the run with, in micros. */
  readonly initialCashMicros: Micros;
  /** Cash available now, in micros. Never negative. */
  readonly cashMicros: Micros;
  /** Holdings, sorted by asset so two equal wallets serialise identically. */
  readonly positions: readonly Position[];
}

/** The wallets of every agent in a run. */
export interface Portfolio {
  readonly wallets: readonly Wallet[];
}

const WALLET = "Wallet";

function freezeWallet(wallet: Wallet): Wallet {
  return Object.freeze({ ...wallet, positions: Object.freeze([...wallet.positions]) });
}

/** Creates an empty wallet with the given starting budget. */
export function createWallet(agentId: string, initialCashMicros: Micros): Wallet {
  return freezeWallet({
    agentId,
    initialCashMicros,
    cashMicros: initialCashMicros,
    positions: []
  });
}

/**
 * Builds one isolated wallet per **enabled** agent, funded with its own
 * `initialBudgetUsd`. No value is shared or transferred between wallets.
 */
export function createInitialWallets(config: AgentsConfig): readonly Wallet[] {
  const wallets = enabledAgents(config).map((agent) =>
    createWallet(
      agent.id,
      microsFromUsdNumber(agent.initialBudgetUsd, "AgentConfig", "initialBudgetUsd")
    )
  );
  return Object.freeze(wallets);
}

/** A portfolio holding the given wallets. */
export function createPortfolio(wallets: readonly Wallet[]): Portfolio {
  return Object.freeze({ wallets: Object.freeze([...wallets]) });
}

/** One agent's wallet, or `undefined` when the agent is unknown. */
export function walletOf(portfolio: Portfolio, agentId: string): Wallet | undefined {
  return portfolio.wallets.find((wallet) => wallet.agentId === agentId);
}

/** The holding of one asset, or `undefined` when nothing is held. */
export function positionOf(wallet: Wallet, asset: string): Position | undefined {
  return wallet.positions.find((position) => position.asset === asset);
}

function withPosition(
  positions: readonly Position[],
  asset: string,
  assetScale: number,
  quantityAtoms: Atoms
): readonly Position[] {
  const others = positions.filter((position) => position.asset !== asset);
  const next =
    quantityAtoms === 0n
      ? others
      : [...others, Object.freeze({ asset, assetScale, quantityAtoms })];
  return Object.freeze([...next].sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0)));
}

function applyFill(wallet: Wallet, event: FillEvent): Wallet {
  const held = positionOf(wallet, event.asset);
  if (held !== undefined && held.assetScale !== event.assetScale) {
    rejectContract(WALLET, "assetScale", "must match the scale of the held position");
  }

  if (event.side === "BUY") {
    const cashMicros = subtractChecked(wallet.cashMicros, event.totalMicros, "cashMicros");
    const quantityAtoms = addBounded(
      held?.quantityAtoms ?? 0n,
      event.quantityAtoms,
      MAX_ATOMS,
      "quantityAtoms"
    );
    return freezeWallet({
      ...wallet,
      cashMicros,
      positions: withPosition(wallet.positions, event.asset, event.assetScale, quantityAtoms)
    });
  }

  if (held === undefined) {
    rejectContract(WALLET, "positions", "must hold the asset being sold");
  }
  const quantityAtoms = subtractChecked(held.quantityAtoms, event.quantityAtoms, "quantityAtoms");
  const cashMicros = addBounded(wallet.cashMicros, event.totalMicros, MAX_MICROS, "cashMicros");
  return freezeWallet({
    ...wallet,
    cashMicros,
    positions: withPosition(wallet.positions, event.asset, event.assetScale, quantityAtoms)
  });
}

/**
 * Applies one ledger event to a wallet and returns the resulting wallet.
 *
 * A `RejectionEvent` returns the very same wallet: a refused order changes
 * nothing, not even by reference.
 */
export function applyEvent(wallet: Wallet, event: LedgerEvent): Wallet {
  if (event.agentId !== wallet.agentId) {
    rejectContract(WALLET, "agentId", "must match the wallet being updated");
  }
  if (event.type === "REJECTION") return wallet;
  return applyFill(wallet, event);
}

/**
 * Applies an append result, honouring ledger idempotency: an event that was
 * already recorded (`appended === false`) is a replay and is **not** applied a
 * second time.
 */
export function applyAppendResult<T>(wallet: Wallet, result: AppendResult<T>): Wallet {
  return result.appended ? applyEvent(wallet, result.event) : wallet;
}

/**
 * Rebuilds a wallet from its starting budget and its events. Replaying the
 * same events always yields the same cash and the same positions.
 */
export function replayWallet(
  agentId: string,
  initialCashMicros: Micros,
  events: readonly LedgerEvent[]
): Wallet {
  let wallet = createWallet(agentId, initialCashMicros);
  for (const event of events) wallet = applyEvent(wallet, event);
  return wallet;
}

/** Rebuilds every wallet of a portfolio from its events. */
export function replayPortfolio(
  wallets: readonly Wallet[],
  eventsByAgent: (agentId: string) => readonly LedgerEvent[]
): Portfolio {
  return createPortfolio(
    wallets.map((wallet) =>
      replayWallet(wallet.agentId, wallet.initialCashMicros, eventsByAgent(wallet.agentId))
    )
  );
}
