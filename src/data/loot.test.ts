/* content/loot.yaml — schema conformance. (Roll BEHAVIOR with these values is the oracle in
   engine/loot.test.ts; this just guards the YAML's shape/vocabulary.) */
import { test, expect } from 'vitest'
import { makeValidator } from './validate'
import type { LootFile } from '../engine/loot'
import lootData from './content/loot.yaml'
import lootSchema from './content/schemas/loot.schema.json'

test('loot.yaml passes schema validation', () => {
  const r = makeValidator<LootFile>(lootSchema)(lootData)
  if (!r.ok) throw new Error('loot schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})
