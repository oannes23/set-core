/* engine/run — the RUN layer: composes combats into a run, owning the progression that used to live
   inside combat's onWin (FABLE A5). Today a "run" is the gauntlet (a fixed foe sequence with full
   vitals between foes — the Training dungeon); set.crawl's B2 run loop (room chain, between-rooms
   fork, HP-only attrition, loot) grows HERE, not in the combat reducer. Pure like `reduce`: same
   deps, same determinism (the run layer consumes the same seeded rng stream the old onWin did). */

import type { Rng } from '../core/rng'
import type { GenConfig } from '../core/generate'
import type { CombatState, FoeRuntime, StatBlock } from './state'
import type { Riders, AffixProc } from './items'
import type { CombatEvent } from './events'
import { assembleFoe } from './foe'
import { type CombatAction, type Deps, createCombat, reduce } from './combat'

export interface RunState {
  dungeonId: string | null
  /** today's gauntlet (fixed foe ids); B2 replaces this with the rolled room chain */
  sequence: string[] | null
  seqIdx: number
  combat: CombatState
  /** run-level liveness/result — ends when a combat ends with no next foe */
  running: boolean
  result: 'win' | 'lose' | 'flee' | null
}

export interface NewRunOpts {
  foe: FoeRuntime
  gen: GenConfig
  playerMax?: number
  stats?: StatBlock
  riders?: Riders // §7 gear riders (carried into every combat of the run)
  procs?: AffixProc[] // §7 gear affix on-match procs (carried into every combat of the run)
  passives?: string[]
  consumables?: string[]
  sequence?: string[] | null
  dungeonId?: string | null
  dreadFloor?: number // §5.8 dread depth floor (from the delve band; 1 = not in a delve)
  coach?: boolean // teaching/coach run → dread off
}

/** Start a run: the first combat, plus the run-level progression context. */
export function createRun(opts: NewRunOpts, rng: Rng): RunState {
  const combat = createCombat(
    { foe: opts.foe, gen: opts.gen, playerMax: opts.playerMax, stats: opts.stats, riders: opts.riders, procs: opts.procs, passives: opts.passives, consumables: opts.consumables, dreadFloor: opts.dreadFloor, coach: opts.coach },
    rng,
  )
  return { dungeonId: opts.dungeonId ?? null, sequence: opts.sequence ?? null, seqIdx: 0, combat, running: true, result: null }
}

/** The run-level reduction step: forward the action to the combat reducer, then apply run
 *  progression. A mid-gauntlet win advances to the next foe (fresh board + full vitals — B2 swaps
 *  this for HP-only attrition) and reads as `foeChanged`, not `won`, exactly like the old onWin. */
export function runReduce(run: RunState, action: CombatAction, deps: Deps): { run: RunState; events: CombatEvent[] } {
  const { state, events } = reduce(run.combat, action, deps)
  if (state.result === 'win' && run.sequence && run.seqIdx < run.sequence.length - 1) {
    const idx = run.seqIdx + 1
    const dungeon = run.dungeonId ? (deps.data.dungeons[run.dungeonId] ?? null) : null
    const foe = assembleFoe(run.sequence[idx], dungeon, deps.data, deps.rng)
    if (foe) {
      const combat = createCombat(
        { foe, gen: state.gen, playerMax: state.playerMax, stats: state.stats, riders: state.riders, procs: state.procs, passives: state.passives, consumables: state.consumables, dreadFloor: state.dreadFloor, coach: !state.dreadOn },
        deps.rng,
      )
      const swapped = events.map((e): CombatEvent => (e.type === 'won' ? { type: 'foeChanged', name: foe.name, rules: foe.rules } : e))
      return { run: { ...run, combat, seqIdx: idx }, events: swapped }
    }
  }
  const done = state.result != null
  return { run: { ...run, combat: state, running: run.running && !done, result: run.result ?? state.result }, events }
}
