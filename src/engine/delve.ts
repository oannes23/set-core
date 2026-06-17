/* engine/delve — the RANDOM ENCOUNTER SCHEMA for a dungeon delve (CRAWL-DESIGN §2, settled
   2026-06-09). Pure data + rng-injected rolls, no DOM: the UI walks rooms by calling
   `nextEncounter` and the run-loop scenes render what comes back.

   The three laws, in one place:
   • BOSS — the triangular law as an inverse-CDF draw: ONE `R ∈ [0,100)` is drawn at delve start;
     the boss appears at the first room where `cum(n) = n(n+1)/2 > R`. Exact (P(boss at n) = n%
     for rooms 1–13, the rest at 14), median 10, guaranteed by 14. Room n counts encounters
     ENTERED — cleared or fled — so flee-farming still walks toward the throne room, and the
     throne room once found STAYS found (pressing on after fleeing the boss is always the boss).
   • ELITE — checked only when the boss didn't take the room, recurring sawtooth:
     chance = ELITE_STEP × (rooms since the last elite, counting this one), reset on an elite.
     10% → 20% → 30% …, mean gap ~3–4 rooms.
   • MINION — the dungeon's weighted enemy_table.

   Loot lives in `loot.ts` (the real category-first roller, `rollRoomLoot`); this module only owns
   the encounter schema. */

import type { Rng } from '../core/rng'
import type { Dungeon } from '../data/schema'
import { pickWeightedFoe } from './foe'
import delveData from '../data/content/delve.yaml'

export type EncounterTier = 'minion' | 'elite' | 'boss'

/** content/delve.yaml — the encounter-schema tunables (the boss triangular LAW itself stays code). */
export interface DelveConfig {
  eliteStep: number // sawtooth: +this elite chance per room since the last elite
  runBagCap: number // the run's consumable satchel cap
  throneLabel: string // dread label once the boss room is found (step 4)
  dreadBands: Array<{ atLeast: number; step: 0 | 1 | 2 | 3; label: string }> // high→low cumulative-boss% bands
}
export type DelveFile = DelveConfig
const CFG = delveData as DelveConfig

export interface DelveState {
  dungeonId: string
  /** the one inverse-CDF boss draw, fixed at delve start (R ∈ [0,100)) */
  bossRoll: number
  /** encounters ENTERED so far (cleared or fled) — the triangular law's n */
  room: number
  /** rooms since the last elite, counting from 0 (the sawtooth; flee resets it to base) */
  sinceElite: number
  /** the throne room, once found, stays found */
  bossFound: boolean
}

/** Elite sawtooth step — chance per room since the last elite (the tuning dial, CRAWL §2). */
export const ELITE_STEP = CFG.eliteStep
/** The run's consumable satchel cap (the run inventory, TODO §town-economy). */
export const RUN_BAG_CAP = CFG.runBagCap

/** The triangular boss law: cumulative %-chance the boss has appeared by room n (capped 100). */
export const bossCumulative = (n: number): number => Math.min(100, (n * (n + 1)) / 2)

export function createDelve(dungeonId: string, rng: Rng): DelveState {
  return { dungeonId, bossRoll: rng() * 100, room: 0, sinceElite: 0, bossFound: false }
}

export interface Encounter {
  delve: DelveState
  foeId: string
  tier: EncounterTier
}

/** Enter the next room: advance the entered-counter, then roll boss → elite → minion.
 *  Returns the advanced delve state + what waits inside. Pure (input state untouched). */
export function nextEncounter(d: DelveState, dungeon: Dungeon, rng: Rng): Encounter {
  const room = d.room + 1
  // boss: found before (fled the throne room), or the cumulative just crossed the one draw
  if (dungeon.boss && (d.bossFound || bossCumulative(room) > d.bossRoll)) {
    return { delve: { ...d, room, bossFound: true }, foeId: dungeon.boss, tier: 'boss' }
  }
  // elite sawtooth — only when the boss didn't take the room
  const eliteChance = ELITE_STEP * (d.sinceElite + 1)
  if (dungeon.elite_pool.length && rng() < eliteChance) {
    const foeId = dungeon.elite_pool[Math.floor(rng() * dungeon.elite_pool.length)]
    return { delve: { ...d, room, sinceElite: 0 }, foeId, tier: 'elite' }
  }
  const foeId = pickWeightedFoe(dungeon.enemy_table, rng)
  return { delve: { ...d, room, sinceElite: d.sinceElite + 1 }, foeId, tier: 'minion' }
}

/** Flee fell back to the fork: the next encounter rerolls and the elite sawtooth resets to base
 *  (timid minion-farming is intended play — §6). The room already counted on entry; bossFound holds. */
export function fleeReroll(d: DelveState): DelveState {
  return { ...d, sinceElite: 0 }
}

/** The DREAD METER (CRAWL §2): the true cumulative surfaced as monotone thematic bands —
 *  fiction on the surface, the exact curve underneath. Keyed to the chance the boss has
 *  appeared by the NEXT room (what "press on" actually buys). */
export interface DreadBand { step: 0 | 1 | 2 | 3 | 4; label: string }
export function dreadBand(d: DelveState): DreadBand {
  if (d.bossFound) return { step: 4, label: CFG.throneLabel }
  const cum = bossCumulative(d.room + 1)
  const band = CFG.dreadBands.find((b) => cum >= b.atLeast) ?? CFG.dreadBands[CFG.dreadBands.length - 1]
  return { step: band.step, label: band.label }
}
