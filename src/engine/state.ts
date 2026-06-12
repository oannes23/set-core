/* engine/state — the combat state the engine reduces over. Pure data: no DOM, no timers. Time is
   explicit (`now`, advanced by tick actions) so the whole thing is deterministic + replayable.

   ROUNDS v3 (CRAWL §5.6): combat runs in 20-second ROUNDS. Verbs ACCUMULATE during the round
   (Attack → roundAttack, Defend → block, Move → charges) and cash out at the rollover exchange:
   player swing first (lethal cancels — the kill-race), enemy swing minus block, Maneuver dump,
   the deal, next telegraph. Spells/mana, traps/tricks, drift, and Stand Ground wards stay LIVE
   mid-round. The round is THE pacing constant — time numbers denominate in rounds, not seconds. */

import type { Board } from '../core/sets'
import type { GenConfig, FavorBias } from '../core/generate'
import type { Trigger, FoeRules, Tier } from '../data/schema'

/** A board slot emptied by a transmute/shatter, reforming at `reformAt` (optionally biased).
 *  `wound: true` = a Wound (exchange damage scar): it never time-reforms — one knits per draw
 *  phase, heals repair them by law (ops.healPlayer), all reform at combat end. */
export interface Pending {
  reformAt: number
  bias?: FavorBias
  wound?: boolean
}

/** Resolution v3 ("sets steer, stats carry, stats CONTEST") — BOTH combatants carry this block.
 *  Every per-card value is an opposed-stat rate (resolve.ts): your Power vs their Endurance is
 *  your damage, their Power vs your Endurance is the telegraph, Speed vs Speed is the charge
 *  economy (Speed's settled job — agency, not tempo). Baseline 10/10/10 (the decimal rebase);
 *  gear/levels/tiers move the differences. */
export interface StatBlock {
  power: number
  endurance: number
  speed: number
}

/** Tactics (v3): the selected stance (the VERB charges are spent on; CRAWL §5.6). */
export type TacticKind = 'maneuver' | 'stand'
/** Maneuver's parameter: at the rollover dump, redraw the deadest non-conforming cards toward this.
 *  v3 cut: magnitude bias is GONE from the player wheel (heavy boards = gear/Hone only). The axis
 *  stays in the type for enemy/gear effects; the UI wheel exposes only color + shape. */
export interface ManeuverBias {
  axis: 'color' | 'shape' | 'mag'
  value: number // 0..2 on that axis
}

/** A fielded foe, resolved from data (creature ⊕ variant ⊕ template) into runtime numbers.
 *  v3: foes carry a full P/E/S StatBlock (the contest's other side), and their attack behavior
 *  DERIVES from it via the TEMPO LAW (foe.ts): Speed−Power difference picks the packaging —
 *  swarm chips / clean hits / every-other-round giants — while the per-round damage budget stays
 *  Power-determined (damage conservation). `damage` = the per-SWING roll budget, post-packaging. */
export interface FoeRuntime {
  id: string
  name: string
  tier: Tier | null
  hp: number // max HP for this encounter (the kill-budget lever — authored, not a contest stat)
  damage: number // per-swing roll budget (derived: Power budget × strikeEvery / swings)
  stats: StatBlock // the foe's side of every contest (derived first-cut from legacy data — foe.ts)
  cadence: number // legacy authored seconds-between-attacks (data); feeds the first-cut derivations
  strikeEvery: number // rounds between exchanges (1 = strikes every round, 2 = every other…)
  swings: number // hits per exchange (telegraph shows the sum)
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
  block: number // Defend's round accumulator: mitigates THIS round's telegraph, resets at the exchange
  stats: StatBlock // Resolution v2: sets steer, these carry (Power/Endurance/Speed)
  mana: [number, number, number] // capped at MANA_CAP per color; gains past it are pure loss
  // Tactics v3 (CRAWL §5.6): a charge bank spent by the selected stance
  tactic: TacticKind
  maneuverBias: ManeuverBias | null // Maneuver's parameter; null = charges bank and wait
  charges: number // banked; ≤ CHARGE_CAP. Stand Ground spends live (wards) + carries over;
  // Maneuver hoards, dumps ALL at the rollover, zeroes.
  queuedTactic: TacticKind | null // the wheel's NEXT-round pick (locks at the draw phase); null = no change
  queuedBias: { bias: ManeuverBias | null } | null // queued bias change (wrapper ≠ "clear bias")
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
  attackFrozen: boolean // the ROUND timer paused (e.g. Invisibility) until the player completes a Set
  nextSetDamageMult: number // multiplier on the next attacking Set's damage (e.g. Strength); 1 = none
  tickSuppressedUntil: number // on:tick effects (drift + dread DoTs) are paused while now < this (e.g. Hourglass)
  // foe
  foe: FoeRuntime
  // the round clock (all ms, on the `now` timeline)
  now: number
  round: number // current round index (1-based)
  roundEndsAt: number // when the rollover exchange fires
  roundExtendedS: number // seconds of stall-spell extension already applied this round (capped)
  roundAttack: number // Attack's round accumulator: lands as the player's exchange swing
  nextStrikeRound: number // the round index of the foe's next exchange swing
  /** the TELEGRAPH: this round's pre-rolled exchange total, revealed at the deal
   *  (swings summed). null = the foe does not strike this round. */
  incoming: number | null
  tickAccum: Record<string, number> // trigger key -> seconds accumulated toward its `every`
  // run / gauntlet
  running: boolean
  result: 'win' | 'lose' | 'flee' | null
  // board generation config
  gen: GenConfig
}

// ROUNDS v3 (CRAWL §5.6) — the temporal grammar. The round is THE pacing constant.
export const ROUND_MS = 20000 // round length; everything else tunes relative to it
/** INTERIM stall re-anchor (pending the v3 translation pass): clock-push verbs now EXTEND the
 *  current round, capped at this many bonus seconds per round (uncapped potions bypass). */
export const ROUND_EXTEND_CAP_S = 10

export const DEFAULT_PLAYER_MAX = 100 // the decimal rebase: HP 100 so the /10 wound laws read clean
// Tactics v3 (CRAWL §5.6) — tuning defaults
export const CHARGE_CAP = 15 // exact both ways: a max 5-wound haymaker (5×3) or a whole-board (15) dump
export const WOUND_WARD_COST = 3 // Stand Ground's live cost to fizzle ONE incoming wound (board verbs cost 1)
export const MANA_CAP = 15 // per color; gains past it are pure loss (gear may raise it later)
// Wounds (CRAWL §5.6) — computed, never authored. Both laws share one quantum: a tenth of max HP.
export const WOUND_CAP_PER_EXCHANGE = 5
export const woundQuantum = (s: CombatState): number => s.playerMax / 10
// Resolution v3 — the decimal rebase: stats 10 give the contests room to breathe
export const BASE_STATS: StatBlock = { power: 10, endurance: 10, speed: 10 }
export const START_GRACE_MS = 3000 // UI freezes the round this long after Engage (read the board, no ticks advance)
