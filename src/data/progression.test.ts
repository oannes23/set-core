/* content/progression.yaml + content/delve.yaml — schema conformance. (Behavior with these values is
   the oracle in ui/save tests + engine/delve.test.ts; this guards the YAML shape.) */
import { test, expect } from 'vitest'
import { makeValidator } from './validate'
import type { ProgressionFile } from '../engine/progression'
import type { DelveFile } from '../engine/delve'
import progData from './content/progression.yaml'
import delveData from './content/delve.yaml'
import progSchema from './content/schemas/progression.schema.json'
import delveSchema from './content/schemas/delve.schema.json'

test('progression.yaml passes schema validation', () => {
  const r = makeValidator<ProgressionFile>(progSchema)(progData)
  if (!r.ok) throw new Error('progression schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})

test('delve.yaml passes schema validation', () => {
  const r = makeValidator<DelveFile>(delveSchema)(delveData)
  if (!r.ok) throw new Error('delve schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})
