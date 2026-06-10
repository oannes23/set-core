/* engine/session — the multiplayer seam (TODO.md §A, step 6). We don't build netcode here; we build
   the SHAPE that lets a server slot in as the authority later.

   A run is fully described by: a seed + a setup descriptor + an ordered ACTION LOG. Because the
   engine is pure and the RNG is seeded, replaying that log reproduces the exact same state and events
   on any machine. So: the client dispatches actions locally for instant feedback AND streams the log;
   a server runs `runSession` over the same log and is the source of truth (anti-cheat / shared world).
   Nothing mutates state except `reduce`/`runReduce` — this module just folds the run layer. */

import { mulberry32, type Rng } from '../core/rng'
import type { GameData } from '../data/schema'
import type { CombatEvent } from './events'
import { assembleFoe, pickWeightedFoe } from './foe'
import { type CombatAction, COMBAT_GEN } from './combat'
import { type RunState, createRun, runReduce } from './run'

/** Everything needed to reconstruct the initial state deterministically (no live objects). */
export interface SessionSetup {
  seed: number
  dungeonId: string
  /** a specific creature id, or 'random' to roll from the dungeon table, or omit to use sequence[0] */
  foeId?: string | 'random'
  /** a gauntlet of creature ids fought in a row */
  sequence?: string[]
  playerMax?: number
}

export interface Session {
  setup: SessionSetup
  actions: CombatAction[]
}

/** Build the initial run state for a setup, consuming the seeded rng (foe roll + board gen). */
export function startSession(setup: SessionSetup, data: GameData): { run: RunState; rng: Rng } {
  const rng = mulberry32(setup.seed)
  const dungeon = data.dungeons[setup.dungeonId] ?? null
  const sequence = setup.sequence ?? null
  const foeId = setup.foeId === 'random' || setup.foeId == null ? (sequence ? sequence[0] : pickWeightedFoe(dungeon?.enemy_table ?? [], rng)) : setup.foeId
  const foe = assembleFoe(foeId, dungeon, data, rng)
  if (!foe) throw new Error(`unknown foe: ${foeId}`)
  const run = createRun({ foe, gen: COMBAT_GEN, sequence, dungeonId: setup.dungeonId, playerMax: setup.playerMax }, rng)
  return { run, rng }
}

/** Deterministically replay a whole session → final run state + the full event stream. A server runs
 *  this over a client's action log to be authoritative; a client running it locally gets the same. */
export function runSession(session: Session, data: GameData): { run: RunState; events: CombatEvent[] } {
  const { run: initial, rng } = startSession(session.setup, data)
  const deps = { data, rng }
  let run = initial
  const events: CombatEvent[] = []
  for (const action of session.actions) {
    const r = runReduce(run, action, deps)
    run = r.run
    events.push(...r.events)
  }
  return { run, events }
}
