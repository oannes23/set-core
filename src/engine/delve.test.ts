/* The delve encounter schema (CRAWL §2): the triangular boss law as an inverse-CDF draw, the elite
   sawtooth, flee semantics (reroll + reset, throne room stays found), and the dread bands.
   Deterministic (seeded rng), DOM-free. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { GAMEDATA } from '../data/game-data'
import {
  createDelve, nextEncounter, fleeReroll, dreadBand, bossCumulative,
  ELITE_STEP, type DelveState,
} from './delve'

const WARREN = GAMEDATA.dungeons.goblin_warren

/** Walk rooms until the boss appears; returns the boss room + the encounter tier trail. */
function walkToBoss(seed: number): { bossRoom: number; tiers: string[] } {
  const rng = mulberry32(seed)
  let d = createDelve('goblin_warren', rng)
  const tiers: string[] = []
  for (let i = 0; i < 50; i++) {
    const e = nextEncounter(d, WARREN, rng)
    d = e.delve
    tiers.push(e.tier)
    if (e.tier === 'boss') return { bossRoom: d.room, tiers }
  }
  throw new Error('no boss within 50 rooms')
}

test('the triangular law: cum(n) = n(n+1)/2, capped at 100', () => {
  expect(bossCumulative(1)).toBe(1)
  expect(bossCumulative(4)).toBe(10)
  expect(bossCumulative(10)).toBe(55)
  expect(bossCumulative(13)).toBe(91)
  expect(bossCumulative(14)).toBe(100)
  expect(bossCumulative(20)).toBe(100)
})

test('the boss is guaranteed by room 14, on every seed', () => {
  for (let seed = 1; seed <= 200; seed++) {
    expect(walkToBoss(seed).bossRoom).toBeLessThanOrEqual(14)
  }
})

test('the inverse-CDF draw reproduces the spec distribution (median ≈ 10, mean ≈ 9.5)', () => {
  const rooms: number[] = []
  for (let seed = 1; seed <= 2000; seed++) rooms.push(walkToBoss(seed).bossRoom)
  rooms.sort((a, b) => a - b)
  const median = rooms[Math.floor(rooms.length / 2)]
  const mean = rooms.reduce((a, b) => a + b, 0) / rooms.length
  expect(median).toBeGreaterThanOrEqual(9)
  expect(median).toBeLessThanOrEqual(11)
  expect(mean).toBeGreaterThan(9)
  expect(mean).toBeLessThan(10)
  // rooms 8–12 hold about half the mass
  const mid = rooms.filter((r) => r >= 8 && r <= 12).length / rooms.length
  expect(mid).toBeGreaterThan(0.4)
  expect(mid).toBeLessThan(0.6)
})

test('same seed → the same delve, encounter for encounter (determinism)', () => {
  expect(walkToBoss(42)).toEqual(walkToBoss(42))
})

test('the boss replaces the room and the throne room stays found (flee → boss again)', () => {
  // force the throne room: a draw of 0 crosses cum(1)=1 immediately
  const rng = mulberry32(7)
  const d: DelveState = { dungeonId: 'goblin_warren', bossRoll: 0, room: 0, sinceElite: 0, bossFound: false }
  const first = nextEncounter(d, WARREN, rng)
  expect(first.tier).toBe('boss')
  expect(first.foeId).toBe('goblin_king')
  expect(first.delve.bossFound).toBe(true)
  // flee the throne room — pressing on is ALWAYS the boss, and the entered-counter still walks
  const fled = fleeReroll(first.delve)
  const again = nextEncounter(fled, WARREN, rng)
  expect(again.tier).toBe('boss')
  expect(again.delve.room).toBe(2)
})

test('the elite sawtooth climbs while minions roll and resets on an elite / on a flee', () => {
  const rng = mulberry32(3)
  let d = createDelve('goblin_warren', rng)
  d = { ...d, bossRoll: 99.9 } // hold the boss off — isolate the sawtooth
  let sawElite = false
  for (let i = 0; i < 30 && !sawElite; i++) {
    const before = d.sinceElite
    const e = nextEncounter(d, WARREN, rng)
    d = e.delve
    if (e.tier === 'elite') {
      expect(WARREN.elite_pool).toContain(e.foeId)
      expect(d.sinceElite).toBe(0) // the counter resets when an elite is fought
      sawElite = true
    } else {
      expect(d.sinceElite).toBe(before + 1) // …and climbs through minion rooms
    }
  }
  expect(sawElite).toBe(true) // 10/20/30…% must land within 30 rooms
  expect(fleeReroll({ ...d, sinceElite: 5 }).sinceElite).toBe(0)
})

test('elite chance follows the sawtooth exactly (statistical, first room after a reset)', () => {
  // sinceElite=0 → first room rolls at exactly ELITE_STEP
  let elites = 0
  const trials = 4000
  for (let seed = 1; seed <= trials; seed++) {
    const rng = mulberry32(seed * 31)
    const d: DelveState = { dungeonId: 'goblin_warren', bossRoll: 99.9, room: 0, sinceElite: 0, bossFound: false }
    if (nextEncounter(d, WARREN, rng).tier === 'elite') elites++
  }
  expect(elites / trials).toBeGreaterThan(ELITE_STEP - 0.02)
  expect(elites / trials).toBeLessThan(ELITE_STEP + 0.02)
})

test('minion rooms draw from the weighted enemy table', () => {
  const rng = mulberry32(11)
  const d: DelveState = { dungeonId: 'goblin_warren', bossRoll: 99.9, room: 0, sinceElite: 0, bossFound: false }
  const tableIds = WARREN.enemy_table.map((e) => e.foe)
  for (let i = 0; i < 40; i++) {
    const e = nextEncounter(d, WARREN, mulberry32(i + 100))
    if (e.tier === 'minion') expect(tableIds).toContain(e.foeId)
  }
})

test('the dread meter is monotone and honest against the cumulative', () => {
  const d = (room: number, bossFound = false): DelveState =>
    ({ dungeonId: 'x', bossRoll: 99.9, room, sinceElite: 0, bossFound })
  let prev = -1
  for (let room = 0; room <= 16; room++) {
    const band = dreadBand(d(room))
    expect(band.step).toBeGreaterThanOrEqual(prev) // never walks back
    prev = band.step
  }
  expect(dreadBand(d(0)).step).toBe(0) // cum(1)=1 — quiet
  expect(dreadBand(d(13)).step).toBe(3) // cum(14)=100 — he is near
  expect(dreadBand(d(3, true)).step).toBe(4) // the throne room found out-shouts the curve
})
