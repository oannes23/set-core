/* E3 (FABLE §3) — Soak (Ironhide) is documented as flat, permanent, pre-Block mitigation. The exchange
   strike and the flee parting blow both subtract it, but `enemyAttack` (the `instant_attack` trap effect —
   diegetically the SAME foe swing) used to pass the raw roll straight through, so Soak 4 vs a roll of 10
   wrongly took 10. This pins that an instant attack now mitigates by soak, differentially (same roll). */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { GenConfig } from '../core/generate'
import { createCombat } from './combat'
import { enemyAttack } from './triggers'
import type { CombatState } from './state'
import type { CombatEvent } from './events'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const plainFoe = (): CombatState['foe'] =>
  ({ id: 'x', name: 'x', tier: 'minion', hp: 500, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 1, swings: 1, damage: 30, triggers: [], rules: {} } as unknown as CombatState['foe'])
const sink = () => { const events: CombatEvent[] = []; return { events, emit: (e: CombatEvent) => events.push(e) } }

const taken = (soak: number): number => {
  const s = createCombat({ foe: plainFoe(), gen: GEN }, mulberry32(1)) // identical board each time (same seed)
  s.block = 0; s.mods.soak = soak; s.playerHP = 100; s.playerMax = 100
  enemyAttack(s, mulberry32(9), sink()) // identical roll each time (same attack rng)
  return 100 - s.playerHP
}

test('E3 — an instant attack subtracts soak flat, pre-Block (same roll → exactly `soak` less damage)', () => {
  const raw = taken(0)
  expect(raw).toBeGreaterThan(4) // the seed rolls a bite big enough to see a soak of 4 without clamping
  expect(taken(4)).toBe(raw - 4) // soak 4 → exactly 4 less than the unsoaked bite
})

test('E3 — soak can fully absorb a small bite (never negative damage)', () => {
  const raw = taken(0)
  expect(taken(raw + 100)).toBe(0) // over-soak clamps to zero, not below
})
