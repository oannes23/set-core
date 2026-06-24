/* The pure run-capture mapping (no DOM, no engine objects). */
import { describe, it, expect } from 'vitest'
import { buildInstruments, buildRunRecord, tallyActions, type CapturedRun } from './capture'
import type { CombatAction } from '../engine/combat'

const actions: CombatAction[] = [
  { type: 'completeSet', slots: [0, 1, 2] },
  { type: 'castAbility', abilityId: 'ember' },
  { type: 'castAbility', abilityId: 'ember' },
  { type: 'castAbility', abilityId: 'frost' },
  { type: 'setTactic', tactic: 'stand' },
  { type: 'setTactic', tactic: 'maneuver' },
  { type: 'setTactic', tactic: 'stand' },
  { type: 'setBias', bias: null },
  { type: 'useConsumable', slot: 0 },
  { type: 'tick', dtMs: 16 },
  { type: 'completeSet', slots: [3, 4, 5] },
]

const captured = (over: Partial<CapturedRun> = {}): CapturedRun => ({
  fingerprint: 'fp',
  rulesetVersion: 'r1',
  contentVersion: 'c1',
  modded: false,
  seed: 12345,
  classId: 'pyromancer',
  foeId: 'emberlord',
  dungeonId: 'the-warren',
  mode: 'delve',
  result: 'win',
  rounds: 5,
  elapsedMs: 184210.7,
  depthReached: 6,
  actions,
  dev: { reshapeYou: 7, reshapeFoe: 3, matches: 10, springs: 3, k1: 2, wards: 1, churns: 4 },
  stats: { dealt: 200, taken: 50, blocked: 30, healed: 10, sets: 10, traps: 2, xp: 120, gearDmg: 40, gearBlock: 5, gearMana: 3 },
  ...over,
})

describe('tallyActions', () => {
  it('counts ability activations, tactics, consumables, set attempts; ignores ticks', () => {
    const t = tallyActions(actions)
    expect(t.abilityActivations).toEqual({ ember: 2, frost: 1 })
    expect(t.tacticsUsage).toEqual({ standGround: 2, maneuver: 1, biasChanges: 1 })
    expect(t.consumablesUsed).toBe(1)
    expect(t.setsAttempted).toBe(2)
    expect(t.fled).toBe(false)
  })
  it('flags a flee', () => {
    expect(tallyActions([{ type: 'flee' }]).fled).toBe(true)
  })
})

describe('buildInstruments', () => {
  it('derives the dev-target ratios + folds in the raw tallies', () => {
    const inst = buildInstruments(captured())
    expect(inst.setsMatched).toBe(10)
    expect(inst.setsPerRound).toBe(2)
    expect(inst.reshareSharePlayer).toBeCloseTo(0.7) // 7 / (7+3)
    expect(inst.trapSpringRate).toBeCloseTo(0.3) // 3 / 10
    expect(inst.tacticsUsage).toEqual({ standGround: 2, maneuver: 1, biasChanges: 1 })
    expect(inst.abilityActivations).toEqual({ ember: 2, frost: 1 })
    expect(inst.mode).toBe('delve')
    expect(inst.damageDealt).toBe(200)
  })
  it('returns null ratios (not 0%) when the denominator is empty', () => {
    const inst = buildInstruments(captured({ dev: { reshapeYou: 0, reshapeFoe: 0, matches: 0, springs: 0, k1: 0, wards: 0, churns: 0 } }))
    expect(inst.reshareSharePlayer).toBeNull()
    expect(inst.trapSpringRate).toBeNull()
  })
})

describe('buildRunRecord', () => {
  it('builds context + outcome, mapping seed→string and a win to terms = sets matched', () => {
    const rec = buildRunRecord(captured())
    expect(rec.context).toMatchObject({ kind: 'delve', classId: 'pyromancer', foeId: 'emberlord', seed: '12345', specRef: 'delve/the-warren' })
    expect(rec.outcome).toEqual({ result: 'win', terms: 10, realTimeMs: 184211, depthReached: 6 })
    expect(rec.eventId).toBeTruthy()
    expect(rec.fingerprint).toBe('fp')
  })
  it('maps engine lose→loss and nulls terms on a non-clear', () => {
    const rec = buildRunRecord(captured({ result: 'lose' }))
    expect(rec.outcome.result).toBe('loss')
    expect(rec.outcome.terms).toBeNull()
  })
  it('folds a practice run to a delve-kind record, disambiguated by instruments.mode', () => {
    const rec = buildRunRecord(captured({ mode: 'practice', dungeonId: 'training', depthReached: 1 }))
    expect(rec.context.kind).toBe('delve')
    expect(rec.context.specRef).toBe('practice/training')
    expect(rec.instruments.mode).toBe('practice')
  })
  it('uses the daily slice for a daily run', () => {
    const rec = buildRunRecord(captured({ mode: 'daily', dailyDate: '2026-07-04' }))
    expect(rec.context.kind).toBe('daily')
    expect(rec.context.dailyDate).toBe('2026-07-04')
    expect(rec.context.specRef).toBe('daily/2026-07-04')
  })
})
