/* The pure daily-setup derivation: same seed ⇒ same selections (fairness substrate); authored axes win
   and don't shift the others; everything stays inside the offered candidate lists. */
import { describe, it, expect } from 'vitest'
import { seedToInt, deriveDailySetup, dailyCandidatesFrom, DAILY_MAX_DIFFICULTY, type DailyCandidates } from './daily-select'
import { GAMEDATA } from '../data/game-data'
import { CLASSES } from '../data/classes'

const CAND: DailyCandidates = {
  classIds: ['pyromancer', 'chronomancer', 'cryomancer', 'geomancer'],
  dungeonIds: ['goblin_warren', 'sewers'],
}

describe('seedToInt', () => {
  it('is deterministic for a given string', () => {
    expect(seedToInt('abc123')).toBe(seedToInt('abc123'))
  })
  it('differs across seeds (no trivial collisions on close inputs)', () => {
    expect(seedToInt('abc123')).not.toBe(seedToInt('abc124'))
    expect(seedToInt('')).not.toBe(seedToInt('a'))
  })
  it('returns an unsigned 32-bit int', () => {
    const n = seedToInt('whatever-seed')
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('deriveDailySetup — determinism (the fairness guarantee)', () => {
  it('same seed ⇒ identical setup', () => {
    const a = deriveDailySetup('seed-of-the-day', {}, CAND)
    const b = deriveDailySetup('seed-of-the-day', {}, CAND)
    expect(a).toEqual(b)
  })
  it('different seeds generally differ across the selection space', () => {
    const setups = new Set(
      Array.from({ length: 24 }, (_, i) => {
        const s = deriveDailySetup(`day-${i}`, {}, CAND)
        return `${s.classId}|${s.dungeonId}`
      }),
    )
    // with 4 classes × 2 dungeons = 8 cells, 24 seeds should land on several distinct cells
    expect(setups.size).toBeGreaterThan(1)
  })
  it('always picks ids from within the candidate lists', () => {
    for (let i = 0; i < 50; i++) {
      const s = deriveDailySetup(`probe-${i}`, {}, CAND)
      expect(CAND.classIds).toContain(s.classId)
      expect(CAND.dungeonIds).toContain(s.dungeonId)
    }
  })
})

describe('deriveDailySetup — authored spec (path b)', () => {
  it('honors a fully-pinned spec verbatim (even a dungeon outside the candidate pool)', () => {
    const s = deriveDailySetup('x', { classId: 'geomancer', dungeonId: 'obsidian_citadel' }, CAND)
    expect(s.classId).toBe('geomancer')
    expect(s.dungeonId).toBe('obsidian_citadel')
  })
  it('pinning ONE axis does not shift the seed-derived other axis', () => {
    const free = deriveDailySetup('stable-seed', {}, CAND)
    const pinnedClass = deriveDailySetup('stable-seed', { classId: 'cryomancer' }, CAND)
    // class is now authored; dungeon must be unchanged (authored axes consume no draw)
    expect(pinnedClass.classId).toBe('cryomancer')
    expect(pinnedClass.dungeonId).toBe(free.dungeonId)
  })
})

describe('deriveDailySetup — N2 domain-separated sub-seeds', () => {
  it('foeSeed and boardSeed are distinct from each other and from seedInt', () => {
    const s = deriveDailySetup('day-42', {}, CAND)
    expect(s.foeSeed).not.toBe(s.seedInt)
    expect(s.boardSeed).not.toBe(s.seedInt)
    expect(s.foeSeed).not.toBe(s.boardSeed)
  })
  it('the sub-seeds are deterministic and match the :foe/:board derivation', () => {
    const s = deriveDailySetup('day-42', {}, CAND)
    expect(s.foeSeed).toBe(seedToInt('day-42:foe'))
    expect(s.boardSeed).toBe(seedToInt('day-42:board'))
  })
  it('the foe sub-seed does NOT track the dungeon pick (decorrelation — no unreachable foes)', () => {
    // Across seeds, group foeSeed parity by which dungeon was chosen; both dungeons must see BOTH parities.
    const byDungeon: Record<string, Set<number>> = {}
    for (let i = 0; i < 60; i++) {
      const s = deriveDailySetup(`corr-${i}`, {}, CAND)
      ;(byDungeon[s.dungeonId] ??= new Set()).add(s.foeSeed % 2)
    }
    for (const d of CAND.dungeonIds) expect(byDungeon[d]?.size).toBe(2) // both foe-parities occur under each dungeon
  })
})

describe('dailyCandidatesFrom (D2 — order pin)', () => {
  it('filters out coach dungeons and those above the difficulty cap, preserving key order', () => {
    const dungeons = { a: { difficulty: 0 }, coachy: { coach: true, difficulty: 0 }, b: { difficulty: 1 }, hard: { difficulty: 5 } }
    expect(dailyCandidatesFrom(dungeons, ['x', 'y'], 1)).toEqual({ classIds: ['x', 'y'], dungeonIds: ['a', 'b'] })
  })
  it('PINS the live daily candidate order (a reorder re-rolls every historical daily — see daily-select.ts)', () => {
    const cand = dailyCandidatesFrom(GAMEDATA.dungeons, CLASSES.map((c) => c.id), DAILY_MAX_DIFFICULTY)
    // If this snapshot changes, a content/class reorder shifted the daily derivation — bump the version token.
    expect(cand.dungeonIds).toEqual(['goblin_warren', 'sewers'])
    expect(cand.classIds).toEqual(CLASSES.map((c) => c.id))
    expect(cand.classIds.length).toBeGreaterThan(0)
  })
})

describe('deriveDailySetup — empty candidates', () => {
  it('throws when an unfixed axis has no candidates', () => {
    expect(() => deriveDailySetup('s', {}, { classIds: [], dungeonIds: ['goblin_warren'] })).toThrow()
    expect(() => deriveDailySetup('s', {}, { classIds: ['pyromancer'], dungeonIds: [] })).toThrow()
  })
  it('does NOT throw when the empty axis is authored', () => {
    expect(() => deriveDailySetup('s', { dungeonId: 'goblin_warren' }, { classIds: ['pyromancer'], dungeonIds: [] })).not.toThrow()
  })
})
