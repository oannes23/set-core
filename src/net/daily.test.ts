/* The pure daily-resolution contract (no I/O; registry injected as a predicate). */
import { describe, it, expect } from 'vitest'
import { resolveDaily, type ClientVersions, type ContentLookup } from './daily'
import type { DailyResponse } from './contract'

const CLIENT: ClientVersions = { rulesetVersion: 'r1', contentVersion: 'c1' }

// a registry that knows everything except the ids we name as missing
const KNOWN: ContentLookup = {
  hasClass: (id) => id !== 'unknown-class',
  hasFoe: (id) => id !== 'unknown-foe',
  hasDungeon: (id) => id !== 'unknown-dungeon',
}

const desc = (over: Partial<DailyResponse> = {}): DailyResponse => ({
  date: '2026-07-04',
  seed: 'abc',
  specRef: 'daily/2026-07-04',
  rulesetVersion: 'r1',
  contentVersion: 'c1',
  criteria: ['fewest-terms'],
  ...over,
})

describe('resolveDaily — version pin', () => {
  it('is unavailable on a ruleset mismatch', () => {
    expect(resolveDaily(desc({ rulesetVersion: 'r2' }), CLIENT, KNOWN)).toEqual({ status: 'unavailable', reason: 'version' })
  })
  it('is unavailable on a content mismatch', () => {
    expect(resolveDaily(desc({ contentVersion: 'c2' }), CLIENT, KNOWN)).toEqual({ status: 'unavailable', reason: 'version' })
  })
})

describe('resolveDaily — path a (no spec)', () => {
  it('is available + seed-derived when spec is absent', () => {
    const r = resolveDaily(desc(), CLIENT, KNOWN)
    expect(r).toEqual({ status: 'available', seed: 'abc', authored: false, fixed: {}, params: {} })
  })
  it('treats null spec the same as absent', () => {
    expect(resolveDaily(desc({ spec: null }), CLIENT, KNOWN).status).toBe('available')
  })
})

describe('resolveDaily — path b (authored spec)', () => {
  it('returns the validated fixed selections + params', () => {
    const r = resolveDaily(desc({ spec: { classId: 'pyromancer', foeId: 'emberlord', dungeonId: 'the-warren', params: { mutator: 'double-dread' } } }), CLIENT, KNOWN)
    expect(r).toEqual({
      status: 'available',
      seed: 'abc',
      authored: true,
      fixed: { classId: 'pyromancer', foeId: 'emberlord', dungeonId: 'the-warren' },
      params: { mutator: 'double-dread' },
    })
  })
  it('fixes only the authored axes; the rest fall back to seed', () => {
    const r = resolveDaily(desc({ spec: { foeId: 'emberlord' } }), CLIENT, KNOWN)
    expect(r).toMatchObject({ status: 'available', authored: true, fixed: { foeId: 'emberlord' } })
    if (r.status === 'available') expect(r.fixed.classId).toBeUndefined()
  })
  it('is unavailable (content) when an authored id is unknown locally', () => {
    expect(resolveDaily(desc({ spec: { foeId: 'unknown-foe' } }), CLIENT, KNOWN)).toEqual({ status: 'unavailable', reason: 'content', detail: 'foe:unknown-foe' })
  })
  it('ignores a null foeId in spec (not fixed → seed-derived)', () => {
    const r = resolveDaily(desc({ spec: { classId: 'pyromancer', foeId: null } }), CLIENT, KNOWN)
    expect(r).toMatchObject({ status: 'available', fixed: { classId: 'pyromancer' } })
    if (r.status === 'available') expect(r.fixed.foeId).toBeUndefined()
  })
})
