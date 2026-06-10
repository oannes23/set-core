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

/** Tactics v2 — the selected tactic (the VERB charges are spent on; CRAWL §5.5). */
export type TacticKind = 'maneuver' | 'stand'
/** Maneuver's parameter: churn the deadest non-conforming card toward this axis/value. */
export interface ManeuverBias {
  axis: 'color' | 'shape' | 'mag'
  value: number // 0..2 on that axis
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
  mana: [number, number, number] // capped at MANA_CAP per color; gains past it are pure loss
  // Tactics v2 (CRAWL §5.5): a charge queue spent by the selected tactic
  tactic: TacticKind
  maneuverBias: ManeuverBias | null // Maneuver's parameter; null = charges queue and wait
  charges: number // queued (Maneuver) / banked (Stand Ground); ≤ CHARGE_CAP
  nextChurnAt: number // serial spend cadence — Maneuver churns one card per CHURN_MS
  tacticReadyAt: number // swap spin-up: income is LOST until `now` reaches this
  // board
  board: Board
  cols: number // grid width (for geometry selectors); rows = ceil(board.length / cols)
  pending: Map<number, Pending> // empty slots reforming
  locked: Map<number, number> // slot -> unlockAt (ms)
  pendingRegenBias: FavorBias | null // a passive (e.g. Momentum) may steer THIS match's refill
  // character
  passives: string[] // active passive ids (always-on triggers — fire on the bus)
  consumables: string[] // carried one-use items (potions/scrolls); spent via the useConsumable action
  // transient effect flags (set by items/abilities, consumed by the reducer) — reusable buff slots
  attackFrozen: boolean // enemy attack clock paused (e.g. Invisibility) until the player completes a Set
  nextSetDamageMult: number // multiplier on the next attacking Set's damage (e.g. Strength); 1 = none
  tickSuppressedUntil: number // on:tick effects (drift + dread DoTs) are paused while now < this (e.g. Hourglass)
  // foe
  foe: FoeRuntime
  // clock (all ms, on the `now` timeline)
  now: number
  nextAttackAt: number
  tickAccum: Record<string, number> // trigger key -> seconds accumulated toward its `every`
  // run / gauntlet
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

export const DEFAULT_PLAYER_MAX = 30 // createCombat's default playerMax; the save layer mirrors it
// Tactics v2 (CRAWL §5.5) — tuning defaults
export const CHARGE_CAP = 5 // the queue/bank cap; overflow income is wasted
export const CHURN_MS = 800 // Maneuver spends ONE charge per this interval (serial, never a batch)
export const SWAP_SPINUP_MS = 3000 // after a tactic swap, income is lost until the spin-up elapses
export const MANA_CAP = 15 // per color; gains past it are pure loss (gear may raise it later)
export const DMG_REGEN_MS = 10000 // a shattered (wounded) card reforms after this
export const START_GRACE_MS = 3000 // UI freezes the clock this long after Engage (read the board, no ticks advance)
