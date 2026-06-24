/* The pure run-record assembly + id minting (no I/O, no network). */
import { describe, it, expect } from 'vitest'
import { assembleRunRecord, newId, toWireResult, type AssembleRunArgs } from './record'
import { SCHEMA_VERSION } from './contract'

const base: AssembleRunArgs = {
  fingerprint: 'fp-1',
  rulesetVersion: 'r1',
  contentVersion: 'c1',
  context: { kind: 'delve', dailyDate: null, classId: 'pyromancer', foeId: 'emberlord', seed: '42', specRef: 'x' },
  outcome: { result: 'win', terms: 31, realTimeMs: 184210, depthReached: 6 },
  actions: [{ type: 'completeSet', slots: [0, 1, 2] }],
}

describe('newId', () => {
  it('mints unique, non-empty ids', () => {
    const a = newId()
    const b = newId()
    expect(a).toBeTruthy()
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)
  })
})

describe('toWireResult', () => {
  it("maps the engine's 'lose' to the wire 'loss', passing others through", () => {
    expect(toWireResult('lose')).toBe('loss')
    expect(toWireResult('win')).toBe('win')
    expect(toWireResult('flee')).toBe('flee')
  })
})

describe('assembleRunRecord', () => {
  it('stamps schemaVersion + a fresh eventId and carries the facts through', () => {
    const rec = assembleRunRecord(base)
    expect(rec.schemaVersion).toBe(SCHEMA_VERSION)
    expect(rec.eventId).toBeTruthy()
    expect(rec.fingerprint).toBe('fp-1')
    expect(rec.context.classId).toBe('pyromancer')
    expect(rec.outcome.terms).toBe(31)
    expect(rec.actions).toHaveLength(1)
  })

  it('defaults integrity to unmodded + no manifest hash, and instruments to {}', () => {
    const rec = assembleRunRecord(base)
    expect(rec.integrity).toEqual({ modded: false, manifestHash: null })
    expect(rec.instruments).toEqual({})
  })

  it('honors an explicit eventId (determinism) + modded/instruments overrides', () => {
    const rec = assembleRunRecord({ ...base, eventId: 'fixed', modded: true, instruments: { setsMatched: 9 } })
    expect(rec.eventId).toBe('fixed')
    expect(rec.integrity.modded).toBe(true)
    expect(rec.instruments).toEqual({ setsMatched: 9 })
  })
})
