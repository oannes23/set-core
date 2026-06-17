/* Guards the class loadouts: every ability/passive id a class references must resolve against the
   engine registries — the "dangling loadout id" bug the prototype only surfaces when you pick that
   class. Also pins the roster shape (8 classes, 3 abilities + ≥1 passive each, unique ids). */

import { test, expect } from 'vitest'
import { CLASSES, classById } from './classes'
import { ABILITIES, PASSIVES } from '../engine'
import { makeValidator } from './validate'
import type { ClassesFile } from './schema'
import classesSchema from './content/schemas/classes.schema.json'

test('the YAML roster passes schema validation', () => {
  const r = makeValidator<ClassesFile>(classesSchema)(CLASSES)
  if (!r.ok) throw new Error('class schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})

test('YAML quoting survived the conversion (apostrophe blurb intact)', () => {
  expect(classById('cryomancer').blurb).toBe("Freeze the enemy's tempo and grind them out.")
})

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

test('every class has a mana sink for ALL THREE colours (no dead resource)', () => {
  const COL = ['red', 'green', 'blue']
  for (const c of CLASSES) {
    for (let i = 0; i < 3; i++) {
      const sink = c.abilities.some((a) => (ABILITIES[a]?.cost[i] ?? 0) > 0)
      expect(sink, `${c.id} has no ability that spends ${COL[i]} mana`).toBe(true)
    }
  }
})

test('classById resolves a known id and falls back to the first class', () => {
  expect(classById('rogue').name).toBe('Rogue')
  expect(classById('nope').id).toBe(CLASSES[0].id)
})
