import { test, expect } from 'vitest'
import { paceForRounds } from './career'

test('paceForRounds: novices get the full window', () => {
  expect(paceForRounds(0)).toBe(1)
  expect(paceForRounds(40)).toBe(1)
})

test('paceForRounds: veterans hit the floor', () => {
  expect(paceForRounds(2500)).toBe(0.4)
  expect(paceForRounds(99999)).toBe(0.4)
})

test('paceForRounds: monotone decreasing through the ramp', () => {
  const a = paceForRounds(200), b = paceForRounds(800), c = paceForRounds(1600)
  expect(a).toBeLessThan(1)
  expect(b).toBeLessThan(a)
  expect(c).toBeLessThan(b)
  expect(c).toBeGreaterThan(0.4)
})

test('paceForRounds: smoothstep midpoint near the average of endpoints', () => {
  const mid = paceForRounds((40 + 2500) / 2) // t = 0.5 → eased 0.5 → 1 - 0.5*0.6 = 0.7
  expect(mid).toBeCloseTo(0.7, 5)
})
