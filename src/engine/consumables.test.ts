/* Consumables over the reducer: potions (heal/mana/stoneskin/combo brews) + scrolls (free ability casts),
   spent via the useConsumable action. Deterministic (seeded rng), DOM-free. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { createCombat, reduce } from './combat'
import { CONSUMABLES } from './consumables'
import type { CombatState } from './state'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const deps = (rng = mulberry32(1)) => ({ data: GAMEDATA, rng })
function combat(consumables: string[]): CombatState {
  const rng = mulberry32(1)
  const f = assembleFoe('goblin', GAMEDATA.dungeons.goblin_warren, GAMEDATA, rng)!
  const s = createCombat({ foe: f, gen: GEN, consumables, dungeonId: 'goblin_warren' }, rng)
  s.enemyHP = 1000
  s.enemyMax = 1000
  return s
}

test('the registry has 9 colour×shape brews + a scroll for every ability', () => {
  expect(Object.keys(CONSUMABLES).filter((id) => id.startsWith('brew_'))).toHaveLength(9)
  expect(CONSUMABLES.scroll_firebolt?.kind).toBe('scroll')
  expect(CONSUMABLES.heal_potion?.kind).toBe('potion')
})

test('a heal potion restores HP and is spent from the slot', () => {
  const s = combat(['heal_potion'])
  s.playerHP = 10
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
  expect(r.state.playerHP).toBeGreaterThan(10)
  expect(r.events.some((e) => e.type === 'consumableUsed' && e.id === 'heal_potion')).toBe(true)
  expect(r.state.consumables).toHaveLength(0) // consumed
})

test('a mana potion grants its colour', () => {
  const s = combat(['mana_red'])
  s.mana = [0, 0, 0]
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
  expect(r.state.mana[0]).toBe(5)
})

test('stoneskin raises Block to full', () => {
  const s = combat(['stoneskin'])
  s.block = 0
  s.playerMax = 30
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
  expect(r.state.block).toBe(30)
})

test('a combo brew warps the board toward its colour×shape', () => {
  const r = reduce(combat(['brew_0_0']), { type: 'useConsumable', slot: 0 }, deps(mulberry32(2)))
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
})

test('a scroll casts the ability for FREE (no mana spent)', () => {
  const s = combat(['scroll_firebolt'])
  s.mana = [0, 0, 0] // couldn't afford firebolt the normal way
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps(mulberry32(3)))
  expect(r.events.some((e) => e.type === 'enemyDamaged')).toBe(true) // its damage still landed
  expect(r.state.mana).toEqual([0, 0, 0]) // and it cost no mana
})

test('an empty slot is a no-op', () => {
  const r = reduce(combat([]), { type: 'useConsumable', slot: 0 }, deps())
  expect(r.events).toHaveLength(0)
})
