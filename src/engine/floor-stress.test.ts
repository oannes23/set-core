/* The FLOOR stress test (TODO numbers workshop / FABLE invariant risk): the makeable-set floor —
   ≥ gen.floor sets completable from live, UNLOCKED cards — must survive the worst case the threat
   layer can produce: a max-wound exchange (5 shatters) stacked with aggressive locks, in both
   orders. lockSlots is floor-aware by construction; the exposure is inflictWounds, which shatters
   RANDOM live slots with no floor check. This test measures that exposure across many seeds. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { countSetsExcluding } from '../core/sets'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { createCombat, COMBAT_GEN } from './combat'
import { inflictWounds, lockSlots } from './triggers'
import { EventSink } from './events'
import type { CombatState } from './state'

const SEEDS = 600

function fresh(seed: number): { s: CombatState; rng: ReturnType<typeof mulberry32> } {
  const rng = mulberry32(seed)
  const foe = assembleFoe('goblin_king', GAMEDATA.dungeons.goblin_warren, GAMEDATA, rng)!
  const s = createCombat({ foe, gen: COMBAT_GEN }, rng)
  return { s, rng }
}

/** Makeable sets from live, unlocked cards (wound/pending slots are already null on the board). */
function makeable(s: CombatState): number {
  return countSetsExcluding(s.board, new Set(s.locked.keys()))
}

function allLive(s: CombatState): number[] {
  return s.board.map((c, i) => (c ? i : -1)).filter((i) => i >= 0 && !s.locked.has(i) && !s.pending.has(i))
}

test('the makeable floor survives max wounds (5) followed by aggressive locks', () => {
  let violations = 0
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { s, rng } = fresh(seed)
    const sink = new EventSink()
    inflictWounds(s, s.playerMax, rng, sink) // 100 dmg → 10 quanta → capped at 5 shatters
    lockSlots(s, allLive(s), 5000, sink) // tries to lock EVERYTHING; floor-aware by construction
    if (makeable(s) < s.gen.floor) violations++
  }
  expect(violations).toBe(0) // lockSlots checks the post-wound board → this order is safe
})

test('the makeable floor survives locks followed by max wounds — the exposed order', () => {
  let violations = 0
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { s, rng } = fresh(seed)
    const sink = new EventSink()
    // a realistic hostile lock first (Petrify-class: 2–3 random cards), floor-aware at lock time…
    const live = allLive(s)
    lockSlots(s, live.slice(0, 3), 5000, sink)
    // …then the max-wound exchange lands on the locked board
    inflictWounds(s, s.playerMax, rng, sink)
    if (makeable(s) < s.gen.floor) violations++
  }
  expect(violations).toBe(0) // inflictWounds must be floor-aware for this to hold
})
