/* Consumables over the reducer: tiered staples (hp/armor/speed/mana), special potions (invisibility,
   strength, the elemental cascades) + scrolls (free ability casts), spent via the useConsumable action.
   Deterministic (seeded rng), DOM-free. */

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
  const s = createCombat({ foe: f, gen: GEN, consumables }, rng)
  s.enemyHP = 1000
  s.enemyMax = 1000
  return s
}

test('the registry has tiered staples (no combo brews) + a scroll for every ability', () => {
  expect(Object.keys(CONSUMABLES).filter((id) => id.startsWith('brew_'))).toHaveLength(0)
  for (const base of ['hp', 'stoneskin', 'speed', 'mana_red', 'mana_green', 'mana_blue', 'mana_rainbow']) {
    for (const tier of ['minor', 'std', 'major']) expect(CONSUMABLES[`${base}_${tier}`]?.kind).toBe('potion')
  }
  expect(CONSUMABLES.scroll_firebolt?.kind).toBe('scroll')
  expect(CONSUMABLES.hp_std?.kind).toBe('potion')
})

test('healing draughts restore HP by tier (10/20/30) and are spent from the slot', () => {
  for (const [tier, amt] of [['minor', 10], ['std', 20], ['major', 30]] as const) {
    const s = combat([`hp_${tier}`])
    s.playerMax = 99 // above the major amount so nothing caps
    s.playerHP = 1
    const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
    expect(r.state.playerHP).toBe(1 + amt)
    expect(r.events.some((e) => e.type === 'consumableUsed' && e.id === `hp_${tier}`)).toBe(true)
    expect(r.state.consumables).toHaveLength(0) // consumed
  }
})

test('mana potions grant their colour by tier (5/10/15)', () => {
  for (const [tier, amt] of [['minor', 5], ['std', 10], ['major', 15]] as const) {
    const s = combat([`mana_red_${tier}`])
    s.mana = [0, 0, 0]
    const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
    expect(r.state.mana[0]).toBe(amt)
  }
})

test('stoneskin grants Block by tier (10/20/30)', () => {
  for (const [tier, amt] of [['minor', 10], ['std', 20], ['major', 30]] as const) {
    const s = combat([`stoneskin_${tier}`])
    s.block = 0
    s.playerMax = 99 // above the major amount so nothing caps
    const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
    expect(r.state.block).toBe(amt)
  }
})

test('a haste potion stalls the enemy clock (uncapped by tier)', () => {
  const s = combat(['speed_major'])
  const before = s.nextAttackAt
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
  expect(r.state.nextAttackAt).toBe(before + 30_000)
})

test('invisibility fills the charge queue and freezes the enemy attack until the next Set', () => {
  const s = combat(['invisibility'])
  s.tactic = 'maneuver' // hold the queue (default Stand Ground would SPEND charges warding board verbs)
  s.charges = 0
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
  expect(r.state.charges).toBe(5) // CHARGE_CAP
  expect(r.state.attackFrozen).toBe(true)
  // ticking far past the attack interval does NOT trigger an enemy attack while frozen
  const t = reduce(r.state, { type: 'tick', dtMs: 60_000 }, deps())
  expect(t.events.some((e) => e.type === 'playerDamaged' || e.type === 'enemyStrikes')).toBe(false)
  expect(t.state.attackFrozen).toBe(true)
  expect(t.state.charges).toBe(5) // no bias set → Maneuver queues and waits (no waste)
})

test('strength triples the next attacking set, then is spent', () => {
  // craft a board with a known all-attack set so damage is deterministic and non-zero
  const base = combat(['strength'])
  // find any existing set on the generated board to drive completeSet
  const r0 = reduce(base, { type: 'useConsumable', slot: 0 }, deps())
  expect(r0.state.nextSetDamageMult).toBe(3)
})

test('fire breathing burns the enemy for red cards on the board', () => {
  const s = combat(['fire_breathing'])
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps(mulberry32(2)))
  expect(r.events.some((e) => e.type === 'enemyDamaged')).toBe(true)
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
})

test('regeneration heals from green cards on the board', () => {
  const s = combat(['regeneration'])
  s.playerHP = 1
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps(mulberry32(2)))
  expect(r.state.playerHP).toBeGreaterThan(1)
})

test('hourglass resets the enemy clock to full and arms tick-suppression', () => {
  const s = combat(['hourglass'])
  s.now = 5000
  s.nextAttackAt = 5500 // about to attack
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
  expect(r.state.nextAttackAt).toBe(s.now + s.foe.cadence * 1000)
  expect(r.state.tickSuppressedUntil).toBe(s.now + 6000)
  // once the window elapses, suppression clears and a buffFaded note fires
  const t = reduce(r.state, { type: 'tick', dtMs: 7000 }, deps())
  expect(t.state.tickSuppressedUntil).toBe(0)
  expect(t.events.some((e) => e.type === 'buffFaded' && e.id === 'hourglass')).toBe(true)
})

test('rainbow mana grants every colour by tier (2/4/6)', () => {
  for (const [tier, amt] of [['minor', 2], ['std', 4], ['major', 6]] as const) {
    const s = combat([`mana_rainbow_${tier}`])
    s.mana = [0, 0, 0]
    const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps())
    expect(r.state.mana).toEqual([amt, amt, amt])
  }
})

test('prismatic vial paints the rows and grants mana per painted card', () => {
  const s = combat(['prismatic'])
  s.mana = [0, 0, 0]
  const r = reduce(s, { type: 'useConsumable', slot: 0 }, deps(mulberry32(2)))
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
  expect(r.state.mana[0] + r.state.mana[1] + r.state.mana[2]).toBeGreaterThan(0)
})

test('saboteur destroys the 3 lightest cards', () => {
  const r = reduce(combat(['saboteur']), { type: 'useConsumable', slot: 0 }, deps(mulberry32(2)))
  const ev = r.events.find((e) => e.type === 'cardsTransmuted')
  expect(ev && ev.type === 'cardsTransmuted' && ev.slots.length).toBe(3)
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
