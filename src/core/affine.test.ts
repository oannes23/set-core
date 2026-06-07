import { test, expect } from 'vitest'
import { type Card, third, isSet } from './affine'

/** All 81 cards in AG(4,3). */
function allCards(): Card[] {
  const out: Card[] = []
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++)
        for (let d = 0; d < 3; d++) out.push([a, b, c, d])
  return out
}

test('third(a,b) always completes a valid set (exhaustive over all pairs)', () => {
  const cards = allCards()
  for (const a of cards)
    for (const b of cards)
      expect(isSet(a, b, third(a, b))).toBe(true)
})

test('two cards uniquely determine the third', () => {
  const a: Card = [0, 1, 2, 0]
  const b: Card = [1, 1, 0, 2]
  const completers = allCards().filter((c) => isSet(a, b, c))
  expect(completers).toEqual([third(a, b)])
})

test('isSet rejects a non-set', () => {
  // numbers 0,1,1 sum to 2 (not 0 mod 3) → not a set
  expect(isSet([0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 1])).toBe(false)
})

test('a line is three distinct points (third differs from its parents)', () => {
  const a: Card = [2, 0, 1, 1]
  const b: Card = [0, 2, 1, 0]
  const t = third(a, b)
  expect(t).not.toEqual(a)
  expect(t).not.toEqual(b)
})
