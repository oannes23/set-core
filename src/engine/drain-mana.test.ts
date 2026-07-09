/* C3 (FABLE §4) — `drain_mana` with an OMITTED `color` silently drains index 0 (Fire/red). The two
   Serpent-Cult hexes (hex_drain on 4 creatures; hex_lesser as the boss_mirror on every serpent_cult elite)
   fire on an ALL-BLUE match but omitted their colour, so they drained the WRONG pool — the D6 dungeon's
   "hexes bleed your mana dry" identity was a near-no-op for kits that don't spend red, and a mis-hit for
   those that do. The content now sets `color: blue`; this pins that the hexes drain blue, not red. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { GenConfig } from '../core/generate'
import { createCombat } from './combat'
import { runTrigger, EMPTY_DESC } from './triggers'
import { GAMEDATA } from '../data/game-data'
import type { CombatState } from './state'
import type { CombatEvent } from './events'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const plainFoe = (): CombatState['foe'] =>
  ({ id: 'x', name: 'x', tier: 'minion', hp: 500, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 1, swings: 1, damage: 30, triggers: [], rules: {} } as unknown as CombatState['foe'])
const sink = () => { const events: CombatEvent[] = []; return { events, emit: (e: CombatEvent) => events.push(e) } }
const blueMatch = { ...EMPTY_DESC, sameColor: 2, colors: [2, 2, 2] as [number, number, number] } // red=0 green=1 blue=2

const drainByHex = (trapId: string): CombatState['mana'] => {
  const s = createCombat({ foe: plainFoe(), gen: GEN }, mulberry32(1))
  s.mana = [9, 9, 9] // red, green, blue all stocked
  runTrigger(s, GAMEDATA.traps[trapId], blueMatch, mulberry32(1), sink())
  return s.mana
}

test('C3 — hex_drain bleeds the matched BLUE pool, leaving Fire/red untouched', () => {
  const mana = drainByHex('hex_drain')
  expect(mana[0]).toBe(9) // Fire/red — the OLD bug drained this
  expect(mana[1]).toBe(9) // green untouched
  expect(mana[2]).toBe(9 - 4) // blue bled by hex_drain's amount:4
})

test('C3 — hex_lesser (the serpent_cult boss_mirror) likewise drains blue', () => {
  const mana = drainByHex('hex_lesser')
  expect(mana[0]).toBe(9) // Fire/red untouched
  expect(mana[2]).toBe(9 - 2) // blue bled by hex_lesser's amount:2
})
