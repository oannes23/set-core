/* content/economy.yaml — schema conformance. (Pricing BEHAVIOR with these values is the oracle in
   engine/value.test.ts + smith.test.ts + ui/bank.test.ts; this guards the YAML's shape.) */
import { test, expect } from 'vitest'
import { makeValidator } from './validate'
import type { EconomyFile } from '../engine/economy'
import econData from './content/economy.yaml'
import economySchema from './content/schemas/economy.schema.json'

test('economy.yaml passes schema validation', () => {
  const r = makeValidator<EconomyFile>(economySchema)(econData)
  if (!r.ok) throw new Error('economy schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})
