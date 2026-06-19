/* Abilities, passives, and Tactics v2 over the reducer.
   All deterministic (seeded rng), DOM-free: dispatch actions and assert state+events. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { Card } from '../core/affine'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { runTrigger, inflictWounds, EMPTY_DESC } from './triggers'
import { createCombat, reduce } from './combat'
import { SHAPE_ATTACK, SHAPE_DEFEND, SHAPE_MOVE } from './resolve'
import { gainBlock, addCharges } from './ops'
import { EventSink } from './events'
import { MANA_CAP, ROUND_MS } from './state'
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
  // firebolt's damage roll is nullified; the foe loses the 4 mana spent × the rebased rate (10/3)
  const dmg = r.events.filter((e) => e.type === 'enemyDamaged') as Array<{ amount: number; magic?: boolean }>
  expect(dmg).toHaveLength(1)
  expect(dmg[0]).toMatchObject({ amount: 13, magic: true })
  expect(r.state.enemyHP).toBe(987)
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
  expect(healed?.amount).toBe(9)
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

// ---- Tactics v3 + the §5.7 LIVE-BURN amendment: the charge bank + the two LIVE stances ----
test('Maneuver LIVE-BURN: after the gather, charges burn ~1/sec, each churning a card toward the bias', () => {
  const s = combat('training_dummy')
  s.charges = 3
  s.maneuverBias = { axis: 'shape', value: SHAPE_ATTACK }
  s.board = s.board.map((_, i) => card(i % 3, SHAPE_MOVE, i % 3)) // nothing conforms → plenty to churn
  let r = reduce(s, { type: 'setTactic', tactic: 'maneuver' }, deps()) // enter live → starts the gather
  r = reduce(r.state, { type: 'tick', dtMs: 1500 }, deps()) // inside the gather (1800ms) — no burn yet
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(false)
  expect(r.state.charges).toBe(3)
  r = reduce(r.state, { type: 'tick', dtMs: 3500 }, deps()) // past the gather → ~3 burns
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
  expect(r.state.charges).toBe(0) // burned back to zero, one card at a time
  expect(r.events.filter((e) => e.type === 'tacticsBurned').length).toBe(3)
})

test('Maneuver holds charges with no bias set (no burn, no waste)', () => {
  const s = combat('training_dummy')
  s.tactic = 'maneuver'
  s.charges = 2
  const r = reduce(s, { type: 'tick', dtMs: ROUND_MS + 1000 }, deps())
  expect(r.state.charges).toBe(2)
  expect(r.events.some((e) => e.type === 'cardsTransmuted')).toBe(false)
})

test('setTactic is LIVE (§5.7): applies immediately, no charge reset; the gather delays the first burn', () => {
  const s = combat('training_dummy') // default tactic = stand
  s.charges = 4
  const r = reduce(s, { type: 'setTactic', tactic: 'maneuver' }, deps())
  expect(r.events.some((e) => e.type === 'tacticChanged')).toBe(true)
  expect(r.state.tactic).toBe('maneuver') // applied this instant — no queue
  expect(r.state.charges).toBe(4) // entering costs nothing (the gather is the commitment)
  const sink = new EventSink()
  addCharges(r.state, 3, sink)
  expect(r.state.charges).toBe(7) // income flows freely
})

test('Combined Arms (Warlord): a shape-rainbow set banks +1 bonus charge', () => {
  const s = combat('training_dummy', { passives: ['combined_arms'] })
  s.board[0] = card(0, SHAPE_ATTACK, 0) // colours/shapes/numbers all-different — a valid rainbow
  s.board[1] = card(1, SHAPE_DEFEND, 1)
  s.board[2] = card(2, SHAPE_MOVE, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  expect(r.state.charges).toBeCloseTo(2.4) // 1.4 (the heavy Move card at parity rate) + 1 (Combined Arms)
  expect(r.events.some((e) => e.type === 'passiveProc' && e.id === 'combined_arms')).toBe(true)
})

test('Stand Ground intercepts a hostile transmute (2 charges), but a TRICK passes through', () => {
  const s = combat('training_dummy')
  s.tactic = 'stand'
  s.charges = 3
  const sink = new EventSink()
  // a hostile trap transmute → warded: board untouched, two charges eaten (BOARD_WARD_COST)
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

test('Stand Ground wards a wound for 3 charges; the HP damage already landed (Block’s lane)', () => {
  const s = combat('training_dummy')
  s.tactic = 'stand'
  s.charges = 4
  const sink = new EventSink()
  const before = s.board.filter(Boolean).length
  // playerMax 100 → quantum 10: a 25-bite = 2 wounds. The ward eats ONE (3 charges); the
  // remaining 1 charge can't pay for the second — it scars through.
  inflictWounds(s, 25, mulberry32(5), sink)
  expect(sink.events.filter((e) => e.type === 'warded' && e.what === 'shatter')).toHaveLength(1)
  expect(sink.events.some((e) => e.type === 'cardsShattered')).toBe(true)
  expect(s.board.filter(Boolean).length).toBe(before - 1)
  expect(s.charges).toBe(1)
})

test('charge income: +1 per Move card matched, flat (clock income died with the clock)', () => {
  const s = combat('training_dummy')
  s.board[0] = card(0, SHAPE_MOVE, 0) // all-Move (colours all-different): 3 Move cards
  s.board[1] = card(1, SHAPE_MOVE, 1)
  s.board[2] = card(2, SHAPE_MOVE, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  expect(r.state.charges).toBeCloseTo(0.7 + 1 + 1.4) // parity rate 1 × quality, in charge points
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
test('an exchange hit past Block scars by the wound law — and one wound knits with the deal', () => {
  const s = combat('limbless_zombie')
  s.block = 0
  s.incoming = 35; s.incomingSwings = [35] // force this round's telegraph (single swing): bite 35 → floor(35/(100/10)) = 3 wounds
  s.dodgePool = 0 // no banked dodge; the Speed-floor draw (seed 1 → 0.627 ≥ 0.175) lands the hit deterministically
  const before = s.board.filter(Boolean).length
  const t = reduce(s, { type: 'tick', dtMs: 20_100 }, deps()) // the rollover exchange
  expect(t.events.some((e) => e.type === 'playerDamaged' && e.amount === 35)).toBe(true)
  expect(t.events.some((e) => e.type === 'cardsShattered')).toBe(true)
  expect(t.state.board.filter(Boolean).length).toBe(before - 2) // 3 scarred, 1 knit at the draw phase
  expect([...t.state.pending.values()].filter((p) => p.wound)).toHaveLength(2)
})

test('§2.3 a Move set banks Dodge, capped by the foe cadence', () => {
  const s = combat('limbless_zombie') // strikeEvery 1, swings 2 → dodge cadence cap 0.7
  // a rainbow all-Move set at slots 0–2 (colors 0/1/2 diff · shape all-Move · num 0/1/2 diff)
  s.board[0] = card(0, SHAPE_MOVE, 0); s.board[1] = card(1, SHAPE_MOVE, 1); s.board[2] = card(2, SHAPE_MOVE, 2)
  expect(s.dodgePool).toBe(0)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps())
  expect(r.state.dodgePool).toBeGreaterThan(0) // Move fed the pool
  expect(r.state.dodgePool).toBeLessThanOrEqual(0.7) // never past the cadence cap
  expect(r.events.some((e) => e.type === 'dodgeGained')).toBe(true)
})

test('block never exceeds the cap — and overflow is PURE LOSS (no charge trickle)', () => {
  const s = combat('training_dummy')
  s.playerMax = 30
  s.block = 30 // full → the whole gain overflows
  s.charges = 0
  const sink = new EventSink()
  gainBlock(s, 20, mulberry32(1), sink)
  expect(s.block).toBe(30) // capped — never creeps past the limit (this was the bug)
  expect(s.charges).toBe(0) // settled 2026-06-11: over-matching Defend is a visible skill cost
  expect(sink.events.some((e) => e.type === 'blockOverflow' && e.amount === 20)).toBe(true)
})

test('Sentinel (Overflow): the overcap spills into a weighted attack — the PAID exception', () => {
  const s = combat('limbless_zombie', { passives: ['overflow'] })
  s.enemyHP = 100
  s.playerMax = 30
  s.block = 30 // full → the whole gain overflows
  s.charges = 0
  for (let i = 0; i < 4; i++) gainBlock(s, 12, mulberry32(i + 3), new EventSink())
  expect(s.block).toBe(30) // block never exceeds the cap
  expect(s.charges).toBe(0) // no charge trickle for anyone — the faucet belongs to the Speed contest
  expect(s.enemyHP).toBeLessThan(100) // but the Sentinel attack landed (class identity, priced at a slot)
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
