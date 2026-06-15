/* The unified inventory Item — the instance model for consumables + gear (CRAWL §3). */

import { test, expect } from 'vitest'
import { makeItem, freshUid, sanitizeItem } from './items'

test('makeItem mints an instance with a uid distinct from the refId', () => {
  const a = makeItem('consumable', 'hp_std', 'u1')
  expect(a).toEqual({ uid: 'u1', kind: 'consumable', refId: 'hp_std' })
  const auto = makeItem('gear', 'sword')
  expect(auto.uid).toBeTruthy()
  expect(auto.uid).not.toBe('sword') // identity ≠ reference
})

test('two items of the same refId are DISTINCT instances (own slots)', () => {
  const a = makeItem('consumable', 'hp_std')
  const b = makeItem('consumable', 'hp_std')
  expect(a.uid).not.toBe(b.uid)
})

test('freshUid is unique across rapid calls', () => {
  const ids = new Set(Array.from({ length: 200 }, () => freshUid()))
  expect(ids.size).toBe(200)
})

test('sanitizeItem drops bad kinds / missing refId and regenerates a lost uid', () => {
  expect(sanitizeItem({ uid: 'u1', kind: 'consumable', refId: 'hp_std' })).toEqual({ uid: 'u1', kind: 'consumable', refId: 'hp_std' })
  expect(sanitizeItem({ uid: 'u1', kind: 'potion', refId: 'hp_std' })).toBeNull() // bad kind
  expect(sanitizeItem({ uid: 'u1', kind: 'consumable' })).toBeNull() // no refId
  expect(sanitizeItem(null)).toBeNull()
  const fixed = sanitizeItem({ kind: 'gear', refId: 'sword' }) // missing uid → kept, regenerated
  expect(fixed?.uid).toBeTruthy()
  expect(fixed?.refId).toBe('sword')
})
