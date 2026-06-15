/* Dread escalation (CRAWL §5.8) — the meter + its two lanes (sim §7/§10 numbers). */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { createCombat, reduce } from './combat'
import { dreadLevel, dreadFoeMult, dreadPlayerMult, dreadBleed, driftRateMult, ROUND_MS } from './state'
import type { CombatState } from './state'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }

const st = (over: Partial<CombatState>): CombatState =>
  ({ dreadOn: true, dreadFloor: 1, round: 1, playerMax: 100, ...over } as unknown as CombatState)

test('dread OFF (coach fight) → level 0, no mults, no bleed, drift ×1 even at high round', () => {
  const s = st({ dreadOn: false, round: 30 })
  expect(dreadLevel(s)).toBe(0)
  expect(dreadFoeMult(s)).toBe(1)
  expect(dreadPlayerMult(s)).toBe(1)
  expect(dreadBleed(s)).toBe(0)
  expect(driftRateMult(s)).toBe(1)
})

test('dreadLevel = floor + 0.5·round, clamped [1,10]', () => {
  expect(dreadLevel(st({ dreadFloor: 1, round: 1 }))).toBe(1.5)
  expect(dreadLevel(st({ dreadFloor: 5, round: 4 }))).toBe(7) // deep delve reaches the onset by round 4
  expect(dreadLevel(st({ dreadFloor: 1, round: 30 }))).toBe(10) // clamped at the cap
})

test('damage mults: 1 below the onset, ramping to foe ×2.0 / player ×1.5 at dread 10', () => {
  expect(dreadFoeMult(st({ round: 1 }))).toBe(1) // dread 1.5 < onset 7
  expect(dreadFoeMult(st({ round: 12 }))).toBe(1) // dread 7 = onset, ramp starts at 0
  expect(dreadFoeMult(st({ round: 15 }))).toBeCloseTo(1.5) // dread 8.5 → halfway
  expect(dreadFoeMult(st({ round: 30 }))).toBeCloseTo(2.0) // dread 10 (clamped) → max
  expect(dreadPlayerMult(st({ round: 30 }))).toBeCloseTo(1.5)
  expect(dreadPlayerMult(st({ round: 15 }))).toBeCloseTo(1.25)
})

test('the generic bleed: 0 below the onset, 6% of maxHP at dread 10', () => {
  expect(dreadBleed(st({ round: 1 }))).toBe(0)
  expect(dreadBleed(st({ round: 30, playerMax: 100 }))).toBeCloseTo(6)
  expect(dreadBleed(st({ round: 30, playerMax: 200 }))).toBeCloseTo(12) // scales with maxHP
})

test('drift accelerates past the knee, bounded (~2.5× at dread 10, within the ceiling)', () => {
  expect(driftRateMult(st({ round: 1 }))).toBeCloseTo(1.05) // dread 1.5
  expect(driftRateMult(st({ round: 8 }))).toBeCloseTo(1.4) // dread 5 (the knee)
  expect(driftRateMult(st({ round: 30 }))).toBeCloseTo(2.5) // dread 10
})

// behavioral: the bleed actually engages end-to-end. The training dummy never strikes (Power 0) and
// has no traps, so any HP loss in a non-coach fight is the unguardable dread bleed alone.
const drive = (s: CombatState, rounds: number, rng: () => number) => {
  let r = { state: s, events: [] as unknown[] }
  for (let i = 0; i < rounds; i++) r = reduce(r.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng }) as typeof r
  return r.state
}

test('§5.8 the dread bleed engages past the onset in a non-coach fight (the dummy never strikes)', () => {
  const dummy = assembleFoe('training_dummy', GAMEDATA.dungeons.training, GAMEDATA, mulberry32(7))!
  // dread ON, deep floor 5 → onset (dread 7) by round 4; no player action, so only the bleed touches HP
  const s = createCombat({ foe: dummy, gen: GEN, dreadFloor: 5, coach: false }, mulberry32(7))
  const end = drive(s, 8, mulberry32(99))
  expect(end.playerHP).toBeLessThan(s.playerMax) // the unguardable bleed chipped HP
})

test('§5.8 a COACH fight stays pressure-free — no bleed even at a deep floor over many rounds', () => {
  const dummy = assembleFoe('training_dummy', GAMEDATA.dungeons.training, GAMEDATA, mulberry32(7))!
  const s = createCombat({ foe: dummy, gen: GEN, dreadFloor: 5, coach: true }, mulberry32(7))
  const end = drive(s, 8, mulberry32(99))
  expect(end.playerHP).toBe(s.playerMax) // dread off → the dummy promise holds
})
