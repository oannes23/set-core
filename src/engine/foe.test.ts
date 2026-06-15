/* Level-equivalence + the outlevel XP penalty (CRAWL §3, sim §8). */

import { test, expect } from 'vitest'
import { foeLevelEquiv, outlevelXpMult, computeXP, OUTLEVEL_FLOOR, expectedRider, gearFactor } from './foe'
import type { FoeRuntime } from './state'

const mkFoe = (over: Partial<FoeRuntime> = {}): FoeRuntime =>
  ({ stats: { power: 14, endurance: 14, speed: 14 }, hp: 60, tier: 'minion', triggers: [], ...over } as unknown as FoeRuntime)

test('the foe-difficulty raise: gearFactor ×1.0 through L6, climbs ~1 rarity tier / 3.4 levels (§11)', () => {
  expect(expectedRider(3)).toBe(0) // grey baseline — early content is unaffected by the raise
  expect(expectedRider(6)).toBe(0)
  expect(expectedRider(7)).toBe(1) // white
  expect(expectedRider(19)).toBe(4) // purple
  expect(gearFactor(3)).toBeCloseTo(1.0, 5) // ≤L6 → no raise (warren/teaching foes untouched)
  expect(gearFactor(7)).toBeCloseTo(1.12, 2) // (25+3)/25
  expect(gearFactor(11)).toBeCloseTo(1.24, 2)
  expect(gearFactor(19)).toBeCloseTo(1.48, 2)
})

test('foeLevelEquiv self-rates from the statline (inverts the parity line 10+2(L−1))', () => {
  expect(foeLevelEquiv(mkFoe({ stats: { power: 14, endurance: 14, speed: 14 } }))).toBe(3) // parity(3)=14
  expect(foeLevelEquiv(mkFoe({ stats: { power: 30, endurance: 30, speed: 30 } }))).toBe(11) // parity(11)=30
  expect(foeLevelEquiv(mkFoe({ stats: { power: 10, endurance: 10, speed: 10 } }))).toBe(1) // floor at the base
})

test('outlevelXpMult: full within the 2-level grace, then −15%/level to the floor; above-level = full', () => {
  expect(outlevelXpMult(10, 10)).toBe(1) // at level
  expect(outlevelXpMult(12, 10)).toBe(1) // gap 2 = the grace edge
  expect(outlevelXpMult(14, 10)).toBeCloseTo(0.7) // gap 4 → 1 − 0.15·2
  expect(outlevelXpMult(20, 10)).toBe(OUTLEVEL_FLOOR) // huge gap → floored
  expect(outlevelXpMult(5, 10)).toBe(1) // player below the foe → ×1 (no above-level bonus)
})

test('computeXP applies the penalty only with a playerLevel; teaching overrides bypass it', () => {
  const foe = mkFoe({ stats: { power: 14, endurance: 14, speed: 14 }, hp: 60 }) // L3-equivalent
  const raw = computeXP(foe)
  expect(computeXP(foe, 3)).toBe(raw) // at level → full
  expect(computeXP(foe, 13)).toBeLessThan(raw) // outleveled → reduced
  expect(computeXP(mkFoe({ xpOverride: 55 }), 20)).toBe(55) // a teaching override is never penalized
})
