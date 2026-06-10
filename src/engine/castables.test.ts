/* Abilities, passives, and Tactics v2 over the reducer.
   All deterministic (seeded rng), DOM-free: dispatch actions and assert state+events. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { Card } from '../core/affine'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { runTrigger, EMPTY_DESC } from './triggers'
import { createCombat, reduce } from './combat'
import { SHAPE_ATTACK, SHAPE_MOVE } from './resolve'
import { gainBlock, addCharges } from './ops'
import { EventSink } from './events'
import { CHARGE_CAP, CHURN_MS, SWAP_SPINUP_MS, MANA_CAP } from './state'
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

// ---- Tactics v2: the charge queue + Maneuver / Stand Ground ----
test('Maneuver churn: one charge spends per CHURN_MS, morphing the deadest card toward the bias', () => {
  const s = combat('training_dummy')
  s.charges = 3
  s.maneuverBias = { axis: 'shape', value: SHAPE_ATTACK }
  s.board = s.board.map((_, i) => card(i % 3, SHAPE_MOVE, i % 3)) // nothing conforms → plenty to churn
  const r1 = reduce(s, { type: 'tick', dtMs: 100 }, deps())
  expect(r1.events.filter((e) => e.type === 'cardsTransmuted')).toHaveLength(1) // ONE card, never a batch
  expect(r1.state.charges).toBe(2)
  const r2 = reduce(r1.state, { type: 'tick', dtMs: 100 }, deps())
  expect(r2.events.some((e) => e.type === 'cardsTransmuted')).toBe(false) // serial cadence: still cooling down
  expect(r2.state.charges).toBe(2)
  const r3 = reduce(r2.state, { type: 'tick', dtMs: CHURN_MS }, deps())
  expect(r3.events.filter((e) => e.type === 'cardsTransmuted')).toHaveLength(1)
  expect(r3.state.charges).toBe(1)
})

test('Maneuver holds charges with no bias set (queue and wait, no waste)', () => {
  const s = combat('training_dummy')
  s.charges = 2
  const r = reduce(s, { type: 'tick', dtMs: 2000 }, deps())
  expect(r.state.charges).toBe(2)
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(false)
})

test('setTactic swaps the verb, RESETS charges, and spins up (income lost meanwhile)', () => {
  const s = combat('training_dummy')
  s.charges = 4
  const r = reduce(s, { type: 'setTactic', tactic: 'stand' }, deps())
  expect(r.events.some((e) => e.type === 'tacticChanged' && e.tactic === 'stand')).toBe(true)
  expect(r.state.charges).toBe(0) // the commitment cost
  expect(r.state.tacticReadyAt).toBe(r.state.now + SWAP_SPINUP_MS)
  // income during the spin-up is lost
  const sink = new EventSink()
  addCharges(r.state, 3, sink)
  expect(r.state.charges).toBe(0)
  expect(sink.events).toHaveLength(0)
})

test('Adaptive Tactics (Warlord): charges persist through a swap, no spin-up', () => {
  const s = combat('training_dummy', { passives: ['adaptive'] })
  s.charges = 4
  const r = reduce(s, { type: 'setTactic', tactic: 'stand' }, deps())
  expect(r.state.charges).toBe(4)
  expect(r.state.tacticReadyAt).toBe(0)
})

test('Stand Ground intercepts a hostile transmute (1 charge), but a TRICK passes through', () => {
  const s = combat('training_dummy')
  s.tactic = 'stand'
  s.charges = 2
  const sink = new EventSink()
  // a hostile trap transmute → warded: board untouched, one charge eaten
  runTrigger(s, { name: 'Razor Wind', icon: 'x', on: 'match', do: [{ effect: 'transmute', count: 2, select: {} }] }, EMPTY_DESC, mulberry32(5), sink)
  expect(sink.events.some((e) => e.type === 'warded' && e.what === 'transmute')).toBe(true)
  expect(sink.events.some((e) => e.type === 'cardsTransmuted')).toBe(false)
  expect(s.charges).toBe(1)
  // a favorable trick transmute is NOT warded (don't eat your own gifts)
  const sink2 = new EventSink()
  runTrigger(s, { name: 'Gift', icon: 'x', kind: 'trick', on: 'match', do: [{ effect: 'transmute', count: 1, select: {} }] }, EMPTY_DESC, mulberry32(6), sink2)
  expect(sink2.events.some((e) => e.type === 'warded')).toBe(false)
  expect(sink2.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
  expect(s.charges).toBe(1) // untouched
})

test('Stand Ground intercepts the wound-shatter; the damage still lands', () => {
  const s = combat('limbless_zombie')
  s.tactic = 'stand'
  s.charges = 1
  s.block = 0
  const before = s.board.filter(Boolean).length
  const t = reduce(s, { type: 'tick', dtMs: 21000 }, deps()) // past cadence → it attacks
  expect(t.events.some((e) => e.type === 'playerDamaged')).toBe(true) // damage is Block's lane, not Ward's
  expect(t.events.some((e) => e.type === 'warded' && e.what === 'shatter')).toBe(true)
  expect(t.events.some((e) => e.type === 'cardsShattered')).toBe(false)
  expect(t.state.board.filter(Boolean).length).toBe(before) // the board held its shape
  expect(t.state.charges).toBe(0)
})

test('charge income: +1 per Move card matched, plus clock-overflow seconds', () => {
  const s = combat('training_dummy')
  s.nextAttackAt = s.now + 999_000 // clock pinned WAY past the cap → every boot second overflows
  s.board[0] = card(0, SHAPE_MOVE, 0) // all-Move (colours all-different): 3 Move cards, boot 1+2+3=6
  s.board[1] = card(1, SHAPE_MOVE, 1)
  s.board[2] = card(2, SHAPE_MOVE, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  // income = 3 (Move cards) + 6 (all boot wasted) = 9 → capped at CHARGE_CAP
  expect(r.state.charges).toBe(CHARGE_CAP)
})

test('mana caps at MANA_CAP — gains past it are pure loss', () => {
  const s = combat('training_dummy')
  s.mana = [MANA_CAP - 1, 0, 0]
  s.board[0] = card(0, SHAPE_MOVE, 0) // all-red, all-Move → 3 red mana
  s.board[1] = card(0, SHAPE_MOVE, 1)
  s.board[2] = card(0, SHAPE_MOVE, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  expect(r.state.mana[0]).toBe(MANA_CAP) // only 1 of the 3 banked
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

test('block never exceeds the cap — Defend overflow converts to charges (1 per 2)', () => {
  const s = combat('training_dummy')
  s.playerMax = 30
  s.block = 30 // full → the whole gain overflows
  s.charges = 0
  gainBlock(s, 20, mulberry32(1), new EventSink())
  expect(s.block).toBe(30) // capped — never creeps past the limit (this was the bug)
  expect(s.charges).toBe(CHARGE_CAP) // floor(20/2)=10 → capped at 5
})

test('Sentinel (Overflow) stacks: overflow becomes BOTH a weighted attack and charges', () => {
  const s = combat('limbless_zombie', { passives: ['overflow'] })
  s.enemyHP = 100
  s.playerMax = 30
  s.block = 30 // full → the whole gain overflows
  s.charges = 0
  for (let i = 0; i < 4; i++) gainBlock(s, 12, mulberry32(i + 3), new EventSink())
  expect(s.block).toBe(30) // block never exceeds the cap
  expect(s.charges).toBeGreaterThan(0) // the charge conversion happened
  expect(s.enemyHP).toBeLessThan(100) // AND the Sentinel attack landed (both bonuses apply)
})

// ---- determinism with casts in the mix ----
test('determinism: same seed + ability/tactic actions → identical state', () => {
  const run = () => {
    const rng = mulberry32(77)
    const f = assembleFoe('goblin', GAMEDATA.dungeons.goblin_warren, GAMEDATA, rng)!
    let s = createCombat({ foe: f, gen: GEN, passives: ['adaptive'] }, rng)
    s.mana = [9, 9, 9]
    s = reduce(s, { type: 'castAbility', abilityId: 'firebolt' }, { data: GAMEDATA, rng }).state
    s = reduce(s, { type: 'tick', dtMs: 1000 }, { data: GAMEDATA, rng }).state
    s = reduce(s, { type: 'castAbility', abilityId: 'cleave' }, { data: GAMEDATA, rng }).state
    return { hp: s.enemyHP, mana: s.mana, board: s.board.map((c) => (c ? c.join('') : 'x')).join('|') }
  }
  expect(run()).toEqual(run())
})
