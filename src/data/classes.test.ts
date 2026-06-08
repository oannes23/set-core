/* Guards the class loadouts: every ability/passive id a class references must resolve against the
   engine registries — the "dangling loadout id" bug the prototype only surfaces when you pick that
   class. Also pins the roster shape (8 classes, 3 abilities + ≥1 passive each, unique ids). */

import { test, expect } from 'vitest'
import { CLASSES, classById } from './classes'
import { ABILITIES, PASSIVES } from '../engine'

test('the roster is the 9 ported classes with unique ids', () => {
  expect(CLASSES).toHaveLength(9)
  expect(new Set(CLASSES.map((c) => c.id)).size).toBe(9)
})

test('every class ability id resolves against the engine ABILITIES registry', () => {
  for (const c of CLASSES) {
    expect(c.abilities).toHaveLength(3)
    for (const a of c.abilities) expect(ABILITIES[a], `${c.id} → ability ${a}`).toBeDefined()
  }
})

test('every class passive id resolves against the engine PASSIVES registry', () => {
  for (const c of CLASSES) {
    expect(c.passives.length).toBeGreaterThanOrEqual(1)
    for (const p of c.passives) expect(PASSIVES[p], `${c.id} → passive ${p}`).toBeDefined()
  }
})

test('every class has a green-mana sink (the rebalance invariant — green was a dead resource)', () => {
  for (const c of CLASSES) {
    const greenSink = c.abilities.some((a) => (ABILITIES[a]?.cost[1] ?? 0) > 0)
    expect(greenSink, `${c.id} has no ability that spends green mana`).toBe(true)
  }
})

test('classById resolves a known id and falls back to the first class', () => {
  expect(classById('rogue').name).toBe('Rogue')
  expect(classById('nope').id).toBe(CLASSES[0].id)
})
