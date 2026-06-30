/* The pure daily-setup derivation: same seed ⇒ same selections (fairness substrate); authored axes win
   and don't shift the others; everything stays inside the offered candidate lists. */
import { describe, it, expect } from 'vitest'
import { seedToInt, deriveDailySetup, type DailyCandidates } from './daily-select'

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

describe('deriveDailySetup — empty candidates', () => {
  it('throws when an unfixed axis has no candidates', () => {
    expect(() => deriveDailySetup('s', {}, { classIds: [], dungeonIds: ['goblin_warren'] })).toThrow()
    expect(() => deriveDailySetup('s', {}, { classIds: ['pyromancer'], dungeonIds: [] })).toThrow()
  })
  it('does NOT throw when the empty axis is authored', () => {
    expect(() => deriveDailySetup('s', { dungeonId: 'goblin_warren' }, { classIds: ['pyromancer'], dungeonIds: [] })).not.toThrow()
  })
})
