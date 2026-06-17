/* The gear base-type catalog (content/gear.yaml) — schema conformance + a couple of conversion guards. */
import { test, expect } from 'vitest'
import { GEAR, gearBase, type GearFile } from './gear'
import { makeValidator } from './validate'
import gearSchema from './content/schemas/gear.schema.json'

test('the YAML gear catalog passes schema validation', () => {
  const r = makeValidator<GearFile>(gearSchema)(GEAR)
  if (!r.ok) throw new Error('gear schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})

test('every entry key matches its id field (no copy/paste drift)', () => {
  for (const [key, g] of Object.entries(GEAR)) expect(g.id, key).toBe(key)
})

test('a representative base type survived the conversion intact', () => {
  const axe = gearBase('axe')!
  expect(axe.slot).toBe('weapon')
  expect(axe.matchType).toBe('red')
  expect(axe.rider).toEqual({ atkDamagePerCard: 1 })
  expect(axe.nativeStat).toEqual({ stat: 'power', amount: 1 })
})
