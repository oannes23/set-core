/* Abilities, passives, and tactics over the reducer — the parity gap closed in migration step 4.
   All deterministic (seeded rng), DOM-free: dispatch castAbility/useTactic and assert state+events. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { Card } from '../core/affine'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { createCombat, reduce } from './combat'
import { SHAPE_ATTACK, SHAPE_MOVE } from './resolve'
import { gainBlock } from './ops'
import { EventSink } from './events'
import { TACTICS_GOAL } from './state'
import type { CombatState } from './state'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const card = (col: number, sh: number, num: number): Card => [col, sh, 0, num]
const deps = (rng = mulberry32(1)) => ({ data: GAMEDATA, rng })

function combat(foeId: string, opts: { passives?: string[]; seed?: number } = {}): CombatState {
  const rng = mulberry32(opts.seed ?? 1)
  const f = assembleFoe(foeId, GAMEDATA.dungeons.training, GAMEDATA, rng)!
  const s = createCombat({ foe: f, gen: GEN, passives: opts.passives }, rng)
  s.enemyHP = 1000
  s.enemyMax = 1000
  s.mana = [10, 10, 10]
  return s
}

// ---- abilities ----
test('castAbility spends mana, damages a non-immune foe, and transmutes the board', () => {
  const s = combat('training_dummy')
  const r = reduce(s, { type: 'castAbility', abilityId: 'firebolt' }, deps(mulberry32(3)))
  expect(r.events.some((e) => e.type === 'abilityCast' && e.id === 'firebolt')).toBe(true)
  expect(r.state.mana).toEqual([6, 10, 10]) // firebolt costs [4,0,0]
  expect(r.events.some((e) => e.type === 'enemyDamaged')).toBe(true)
  expect(r.state.enemyHP).toBeLessThan(1000)
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
})

test('an unaffordable ability is a no-op (no mana spent, no events)', () => {
  const s = combat('training_dummy')
  s.mana = [0, 0, 0]
  const r = reduce(s, { type: 'castAbility', abilityId: 'firebolt' }, deps())
  expect(r.events).toHaveLength(0)
  expect(r.state.mana).toEqual([0, 0, 0])
  expect(r.state.enemyHP).toBe(1000)
})

test('ethereal rule: intrinsic ability damage is replaced by mana-spent drain', () => {
  const s = combat('unstable_ethereal_goblin')
  const r = reduce(s, { type: 'castAbility', abilityId: 'firebolt' }, deps(mulberry32(2)))
  // firebolt's 15-dmg roll is nullified; the foe loses exactly the 4 mana spent (magic), nothing more
  const dmg = r.events.filter((e) => e.type === 'enemyDamaged') as Array<{ amount: number; magic?: boolean }>
  expect(dmg).toHaveLength(1)
  expect(dmg[0]).toMatchObject({ amount: 4, magic: true })
  expect(r.state.enemyHP).toBe(996)
})

// ---- passives ----
test('Photosynthesis heals on an all-green match', () => {
  const s = combat('training_dummy', { passives: ['photosynthesis'] })
  s.playerHP = s.playerMax - 10
  s.board[0] = card(1, SHAPE_ATTACK, 0) // all green (colour 1), all attack — a valid set
  s.board[1] = card(1, SHAPE_ATTACK, 1)
  s.board[2] = card(1, SHAPE_ATTACK, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  expect(r.events.some((e) => e.type === 'passiveProc' && e.id === 'photosynthesis')).toBe(true)
  const healed = r.events.find((e) => e.type === 'playerHealed') as { amount: number } | undefined
  expect(healed?.amount).toBe(3)
})

test('Momentum biases the refill on an all-Move match, then clears', () => {
  const s = combat('training_dummy', { passives: ['momentum'] })
  s.board[0] = card(0, SHAPE_MOVE, 0) // all-Move, colours all-different — a valid set
  s.board[1] = card(1, SHAPE_MOVE, 1)
  s.board[2] = card(2, SHAPE_MOVE, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  expect(r.events.some((e) => e.type === 'passiveProc' && e.id === 'momentum')).toBe(true)
  expect(r.state.pendingRegenBias).toBeNull() // consumed by this match's refill
})

test('Overflow (Sentinel) spills block past the cap into the enemy', () => {
  const s = combat('training_dummy', { passives: ['overflow'] })
  s.block = s.playerMax // full — every point of Block's +10 overflows
  const r = reduce(s, { type: 'castAbility', abilityId: 'block' }, deps(mulberry32(4)))
  expect(r.events.some((e) => e.type === 'passiveProc' && e.id === 'overflow')).toBe(true)
  expect(r.state.enemyHP).toBeLessThan(1000)
})

// ---- tactics ----
test('an armed tactic transmutes the board and resets the meter', () => {
  const s = combat('training_dummy')
  s.tactics = TACTICS_GOAL
  s.tacticsArmed = true
  s.board = s.board.map((_, i) => card(i % 3, i % 3 === 0 ? SHAPE_ATTACK : 1, i % 3)) // mix of Attacks + Defends
  const r = reduce(s, { type: 'useTactic', key: 'attack' }, deps())
  expect(r.events.some((e) => e.type === 'tacticUsed' && e.key === 'attack')).toBe(true)
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
  expect(r.events.some((e) => e.type === 'tacticsReset')).toBe(true)
  expect(r.state.tactics).toBe(0)
  expect(r.state.tacticsArmed).toBe(false)
})

test('a tactic is a no-op unless the meter is armed', () => {
  const s = combat('training_dummy') // tactics 0, not armed
  const r = reduce(s, { type: 'useTactic', key: 'attack' }, deps())
  expect(r.events).toHaveLength(0)
})

test('the armed meter drains at the eased 0.5/sec rate (~20s window)', () => {
  const s = combat('training_dummy')
  s.tactics = TACTICS_GOAL
  s.tacticsArmed = true
  const r = reduce(s, { type: 'tick', dtMs: 4000 }, deps())
  expect(r.state.tactics).toBeCloseTo(TACTICS_GOAL - 0.5 * 4, 5) // 8 after 4s
})

test('tacticsDrainMult slows the drain (tutorial 60s window)', () => {
  const rng = mulberry32(1)
  const f = assembleFoe('training_dummy', GAMEDATA.dungeons.training, GAMEDATA, rng)!
  const s = createCombat({ foe: f, gen: GEN, tacticsDrainMult: 1 / 3 }, rng)
  s.tactics = TACTICS_GOAL
  s.tacticsArmed = true
  const r = reduce(s, { type: 'tick', dtMs: 6000 }, deps())
  expect(r.state.tactics).toBeCloseTo(TACTICS_GOAL - 0.5 * (1 / 3) * 6, 5) // 1/3 speed
})

test('the armed meter does NOT drain while the attack clock is frozen (Invisibility)', () => {
  const s = combat('training_dummy')
  s.tactics = TACTICS_GOAL
  s.tacticsArmed = true
  s.attackFrozen = true
  const r = reduce(s, { type: 'tick', dtMs: 8000 }, deps())
  expect(r.state.tactics).toBe(TACTICS_GOAL) // held
  expect(r.state.tacticsArmed).toBe(true)
})

test('the Move tactic floods the board toward Move', () => {
  const s = combat('training_dummy')
  s.tactics = TACTICS_GOAL
  s.tacticsArmed = true
  s.board = s.board.map((_, i) => card(i % 3, SHAPE_ATTACK, i % 3)) // all Attacks → all get transmuted toward Move
  const r = reduce(s, { type: 'useTactic', key: 'move' }, deps())
  expect(r.events.some((e) => e.type === 'tacticUsed' && e.key === 'move')).toBe(true)
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
  expect(r.state.tacticsArmed).toBe(false)
})

test('flee forfeits the encounter at any time (not gated by the meter)', () => {
  const s = combat('training_dummy') // tactics 0, not armed
  const r = reduce(s, { type: 'flee' }, deps())
  expect(r.events.some((e) => e.type === 'fled')).toBe(true)
  expect(r.state.running).toBe(false)
  expect(r.state.result).toBe('flee')
})

// ---- wound (shatter) + Defend overflow ----
test('a landed enemy hit shatters a board rune (a Wound)', () => {
  const s = combat('limbless_zombie') // damage 3, no variants, lumbering 20s — survives, deterministic
  s.block = 0
  const before = s.board.filter(Boolean).length
  const t = reduce(s, { type: 'tick', dtMs: 21000 }, deps()) // past the cadence → it attacks
  expect(t.events.some((e) => e.type === 'playerDamaged')).toBe(true)
  expect(t.events.some((e) => e.type === 'cardsShattered')).toBe(true)
  expect(t.state.board.filter(Boolean).length).toBe(before - 1) // one slot emptied (wounded)
  expect(t.state.pending.size).toBe(1) // it reforms after DMG_REGEN_MS
})

test('block never exceeds the cap — Defend overflow trickles into Tactics instead', () => {
  const s = combat('training_dummy')
  s.playerMax = 30
  s.block = 30 // full → the whole gain overflows
  s.tactics = 0
  for (let i = 0; i < 6; i++) gainBlock(s, 20, mulberry32(i + 1), new EventSink())
  expect(s.block).toBe(30) // capped — never creeps past the limit (this was the bug)
  expect(s.tactics).toBeGreaterThan(0) // the low-weighted overflow rolled into the Tactics meter
})

test('Sentinel (Overflow) stacks: overflow becomes BOTH a weighted attack and a Tactics trickle', () => {
  const s = combat('limbless_zombie', { passives: ['overflow'] })
  s.enemyHP = 100
  s.playerMax = 30
  s.block = 30 // full → the whole gain overflows
  s.tactics = 0
  for (let i = 0; i < 4; i++) gainBlock(s, 12, mulberry32(i + 3), new EventSink())
  expect(s.block).toBe(30) // block never exceeds the cap
  expect(s.tactics).toBeGreaterThan(0) // the Tactics rollover happened
  expect(s.enemyHP).toBeLessThan(100) // AND the Sentinel attack landed (both bonuses apply)
})

// ---- determinism with casts in the mix ----
test('determinism: same seed + ability/tactic actions → identical state', () => {
  const run = () => {
    const rng = mulberry32(77)
    const f = assembleFoe('goblin', GAMEDATA.dungeons.goblin_warren, GAMEDATA, rng)!
    let s = createCombat({ foe: f, gen: GEN, passives: ['tactician'] }, rng)
    s.mana = [9, 9, 9]
    s = reduce(s, { type: 'castAbility', abilityId: 'firebolt' }, { data: GAMEDATA, rng }).state
    s = reduce(s, { type: 'tick', dtMs: 1000 }, { data: GAMEDATA, rng }).state
    s = reduce(s, { type: 'castAbility', abilityId: 'cleave' }, { data: GAMEDATA, rng }).state
    return { hp: s.enemyHP, mana: s.mana, board: s.board.map((c) => (c ? c.join('') : 'x')).join('|') }
  }
  expect(run()).toEqual(run())
})
