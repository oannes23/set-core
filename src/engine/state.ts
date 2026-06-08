/* engine/state — the combat state the engine reduces over. Pure data: no DOM, no timers. Time is
   explicit (`now`, advanced by tick actions) so the whole thing is deterministic + replayable. */

import type { Board } from '../core/sets'
import type { GenConfig, FavorBias } from '../core/generate'
import type { Trigger, FoeRules, Tier } from '../data/schema'

/** A board slot emptied by a transmute/shatter, reforming at `reformAt` (optionally biased). */
export interface Pending {
  reformAt: number
  bias?: FavorBias
}

/** A fielded foe, resolved from data (creature ⊕ variant ⊕ template) into runtime numbers. */
export interface FoeRuntime {
  id: string
  name: string
  tier: Tier | null
  hp: number // max HP for this encounter
  damage: number
  cadence: number // seconds between attacks
  triggers: Trigger[] // resolved traps/tricks (each carries `kind`)
  drift: Trigger | null
  rules: FoeRules
  desc: string | null
}

export interface CombatState {
  // combatants
  playerHP: number
  playerMax: number
  enemyHP: number
  enemyMax: number
  block: number
  mana: [number, number, number]
  tactics: number
  tacticsArmed: boolean
  // board
  board: Board
  cols: number // grid width (for geometry selectors); rows = ceil(board.length / cols)
  pending: Map<number, Pending> // empty slots reforming
  locked: Map<number, number> // slot -> unlockAt (ms)
  pendingRegenBias: FavorBias | null // a passive (e.g. Momentum) may steer THIS match's refill
  // character
  passives: string[] // active passive ids (always-on triggers — fire on the bus)
  // foe
  foe: FoeRuntime
  // clock (all ms, on the `now` timeline)
  now: number
  nextAttackAt: number
  tickAccum: Record<string, number> // trigger key -> seconds accumulated toward its `every`
  // run / gauntlet
  sequence: string[] | null
  seqIdx: number
  dungeonId: string | null // for re-assembling the next gauntlet foe
  running: boolean
  result: 'win' | 'lose' | 'flee' | null
  // board generation config
  gen: GenConfig
}

/** Effective clock ceiling: Moves push the foe's next attack up to its full cadence (or 20s),
 *  whichever is higher — never crater a slow foe's clock. (Ported from clockCapSec.) */
export const CLOCK_CAP = 20
export function clockCapMs(s: CombatState): number {
  return Math.max(CLOCK_CAP, s.foe.cadence) * 1000
}

export const TACTICS_GOAL = 10
export const TACTICS_DRAIN = 1 // levels/sec while armed
export const DMG_REGEN_MS = 10000 // a shattered (wounded) card reforms after this
export const START_GRACE_MS = 3000 // extra time before the FIRST strike of each encounter — read the board
