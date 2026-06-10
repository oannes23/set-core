import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { Card } from '../core/affine'
import { findSets } from '../core/sets'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from './foe'
import { createCombat, reduce, colsForN } from './combat'
import { createRun, runReduce } from './run'
import { resolveSet, SHAPE_ATTACK, SHAPE_MOVE } from './resolve'
import { condMet, selectSlots, transmute, lockSlots, runTrigger, EMPTY_DESC } from './triggers'
import { pushClock } from './ops'
import { EventSink } from './events'
import type { CombatState } from './state'
import { clockCapMs } from './state'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const card = (col: number, sh: number, num: number): Card => [col, sh, 0, num]

function foe(id: string, rng = mulberry32(1)) {
  return assembleFoe(id, GAMEDATA.dungeons.training, GAMEDATA, rng)!
}

// ---- resolution math ----
test('resolveSet routes Defend→block, Move→boot, colour→mana', () => {
  const r = resolveSet([card(0, 1, 0), card(0, 1, 1), card(0, 1, 2)], mulberry32(1)) // all Defend, all red
  expect(r.block).toBe(1 + 2 + 3)
  expect(r.boot).toBe(0)
  expect(r.damage).toBe(0)
  expect(r.mana).toEqual([3, 0, 0]) // all-red → 3 Fire
  const r2 = resolveSet([card(0, 2, 0), card(1, 2, 0), card(2, 2, 0)], mulberry32(1)) // all Move, all-diff colour
  expect(r2.boot).toBe(3)
  expect(r2.mana).toEqual([1, 1, 1])
  const r3 = resolveSet([card(0, SHAPE_ATTACK, 2), card(1, SHAPE_ATTACK, 2), card(2, SHAPE_ATTACK, 2)], mulberry32(1))
  expect(r3.damage).toBeGreaterThan(0)
})

// ---- trigger conditions ----
test('condMet handles modes + compound AND', () => {
  const d = (sh: number, num: number) => EMPTY_DESC && { ...EMPTY_DESC, sameShape: sh, sameNumber: num, shapes: [sh, sh, sh] as [number, number, number] }
  expect(condMet({ axis: 'shape', mode: 'all_same', value: 'move' }, d(2, 0))).toBe(true)
  expect(condMet({ axis: 'shape', mode: 'all_same', value: 'attack' }, d(2, 0))).toBe(false)
  expect(condMet({ all: [{ axis: 'shape', mode: 'all_same', value: 'move' }, { axis: 'number', mode: 'all_same', value: 'one' }] }, d(2, 0))).toBe(true)
  expect(condMet({ all: [{ axis: 'shape', mode: 'all_same', value: 'move' }, { axis: 'number', mode: 'all_same', value: 'one' }] }, d(2, 1))).toBe(false)
})

// ---- selectors / board verbs ----
function bareState(board: (Card | null)[]): CombatState {
  return createCombatStub(board)
}
function createCombatStub(board: (Card | null)[]): CombatState {
  const f = foe('limbless_zombie')
  const s = createCombat({ foe: f, gen: GEN }, mulberry32(7))
  s.board = board
  s.cols = colsForN(board.length === 15 ? 15 : 12)
  s.pending = new Map()
  s.locked = new Map()
  return s
}

test('selectSlots: geometry ∩ value, and lock/transmute board verbs', () => {
  // 5x3 board; bottom row = 10..14. Moves at 10,12.
  const board: (Card | null)[] = Array.from({ length: 15 }, (_, i) => card(i % 3, i === 10 || i === 12 ? SHAPE_MOVE : SHAPE_ATTACK, i % 3))
  const s = bareState(board)
  const lockSel = { geometry: 'row' as const, which: 'bottom' as const, axis: 'shape' as const, mode: 'all_same' as const, value: 'move' as const }
  expect(selectSlots(s, lockSel, mulberry32(1))).toEqual([10, 12])
  // lock those, then a bottom-row transmute skips them
  const sink = new EventSink()
  lockSlots(s, [10, 12], 5000, sink)
  expect([...s.locked.keys()].sort((a, b) => a - b)).toEqual([10, 12])
  transmute(s, selectSlots(s, { geometry: 'row', which: 'bottom' }, mulberry32(1)), { gapMs: 5000 }, sink)
  expect([11, 13, 14].every((i) => s.board[i] === null && s.pending.has(i))).toBe(true)
  expect(s.board[10]).not.toBeNull() // locked Move survived
})

// ---- foe assembly ----
test('assembleFoe resolves stats, triggers, rules', () => {
  const z = foe('limbless_zombie')
  expect(z.hp).toBe(30)
  expect(z.cadence).toBe(20) // lumbering
  expect(z.damage).toBe(3)
  expect(z.triggers.map((t) => t.name)).toContain('Limbless')
  const g = foe('unstable_ethereal_goblin')
  expect(g.rules.immune_card_damage).toBe(true)
  expect(g.rules.ability_damage).toBe('mana_spent')
  const b = foe('dread_behemoth')
  expect(b.cadence).toBe(120) // numeric speed
  expect(b.triggers.find((t) => t.name === 'Outmaneuvered')?.kind).toBe('trick')
})

test('an elite that already authors the boss_mirror trap does not double-stack it', () => {
  const e = assembleFoe('goblin_warlord', GAMEDATA.dungeons.goblin_warren, GAMEDATA, mulberry32(3))!
  const names = e.triggers.filter((t) => t.name === 'Lesser War Cry')
  expect(names).toHaveLength(1) // authored == mirror → exactly one copy
  expect(e.triggers).toHaveLength(2) // telegraph + one rolled variant
})

test('the boss_mirror attaches ON TOP of an elite\'s other authored traps', () => {
  const e = assembleFoe('ember_shaman', GAMEDATA.dungeons.goblin_warren, GAMEDATA, mulberry32(3))!
  const names = e.triggers.map((t) => t.name)
  expect(names).toContain('Lesser War Cry') // the dungeon-fixed mirror — every elite telegraphs the boss
  expect(names).toContain('Ember Sweep') // its own authored trap, kept
})

test('an elite without authored traps still carries the dungeon boss_mirror', () => {
  const e = assembleFoe('goblin_brute', GAMEDATA.dungeons.goblin_warren, GAMEDATA, mulberry32(3))!
  expect(e.triggers.map((t) => t.name)).toContain('Lesser War Cry') // the boss_mirror telegraph
})

test('the boss actually fields the signature trap his elites telegraph', () => {
  const king = GAMEDATA.creatures.goblin_king
  expect(king.traps).toContain('war_cry') // the Lesser War Cry foretaste must be true
})

// ---- reducer: a real match + the enemy clock ----
test('completeSet damages the foe / banks mana; tick fires the enemy attack', () => {
  const rng = mulberry32(42)
  const f = foe('goblin', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  const sets = findSets(s.board)
  expect(sets.length).toBeGreaterThan(0)
  const r = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'setResolved')).toBe(true)
  expect(r.events.some((e) => e.type === 'manaGained')).toBe(true)
  expect(r.state.board.filter(Boolean).length).toBe(15) // refilled
  // advance the clock past the goblin's cadence (swift = 10s) → it attacks
  const t = reduce(r.state, { type: 'tick', dtMs: 11000 }, { data: GAMEDATA, rng })
  expect(t.events.some((e) => e.type === 'playerDamaged' || e.type === 'playerBlocked')).toBe(true)
})

test('the training dummy (0 damage) cannot hurt the player', () => {
  const rng = mulberry32(5)
  const f = foe('training_dummy', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  const t = reduce(s, { type: 'tick', dtMs: 31000 }, { data: GAMEDATA, rng }) // cadence 30s
  expect(t.state.playerHP).toBe(t.state.playerMax)
  expect(t.events.some((e) => e.type === 'playerBlocked')).toBe(true) // harmless swing
})

test('immune foe (ethereal goblin) takes no card damage', () => {
  const rng = mulberry32(9)
  const g = foe('unstable_ethereal_goblin', rng)
  const s = createCombat({ foe: g, gen: GEN }, rng)
  // hand it an all-Attack set in slots 0,1,2
  s.board[0] = card(0, SHAPE_ATTACK, 2)
  s.board[1] = card(1, SHAPE_ATTACK, 2)
  s.board[2] = card(2, SHAPE_ATTACK, 2)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'enemyDamaged' && e.immune)).toBe(true)
  expect(r.state.enemyHP).toBe(g.hp) // unscathed by swords
})

test('gauntlet (run layer): killing a foe mid-sequence advances to the next', () => {
  const rng = mulberry32(11)
  const f = foe('limbless_zombie', rng)
  const run = createRun({ foe: f, gen: GEN, sequence: ['limbless_zombie', 'dread_behemoth'], dungeonId: 'training' }, rng)
  run.combat.enemyHP = 1
  // make slots 0,1,2 a heavy all-Attack set (guaranteed lethal vs 1 HP)
  run.combat.board[0] = card(0, SHAPE_ATTACK, 2)
  run.combat.board[1] = card(1, SHAPE_ATTACK, 2)
  run.combat.board[2] = card(2, SHAPE_ATTACK, 2)
  const r = runReduce(run, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'foeChanged')).toBe(true)
  expect(r.run.seqIdx).toBe(1)
  expect(r.run.combat.foe.name).toContain('Behemoth')
  expect(r.run.running).toBe(true)
  expect(r.run.combat.playerHP).toBe(r.run.combat.playerMax) // fresh vitals between gauntlet foes
  expect(r.events.some((e) => e.type === 'won')).toBe(false)
})

test('gauntlet (run layer): winning the LAST foe ends the run with a win', () => {
  const rng = mulberry32(13)
  const f = foe('limbless_zombie', rng)
  const run = createRun({ foe: f, gen: GEN, sequence: ['limbless_zombie'], dungeonId: 'training' }, rng)
  run.combat.enemyHP = 1
  run.combat.board[0] = card(0, SHAPE_ATTACK, 2)
  run.combat.board[1] = card(1, SHAPE_ATTACK, 2)
  run.combat.board[2] = card(2, SHAPE_ATTACK, 2)
  const r = runReduce(run, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'won')).toBe(true)
  expect(r.run.running).toBe(false)
  expect(r.run.result).toBe('win')
})

test('determinism: same seed + actions → identical state', () => {
  const run = () => {
    const rng = mulberry32(123)
    const f = foe('goblin', rng)
    let s = createCombat({ foe: f, gen: GEN }, rng)
    for (let i = 0; i < 5; i++) {
      const sets = findSets(s.board)
      if (sets.length) s = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng }).state
      s = reduce(s, { type: 'tick', dtMs: 1000 }, { data: GAMEDATA, rng }).state
    }
    return { hp: s.enemyHP, php: s.playerHP, mana: s.mana, board: s.board.map((c) => (c ? c.join('') : 'x')).join('|') }
  }
  expect(run()).toEqual(run())
})

// ---- clock cap: the ceiling clamps the GAIN, never pulls the clock backward (FABLE E1) ----
test('pushClock: capped pushes never pull an above-cap clock backward', () => {
  const s = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  const sink = new EventSink()
  // an uncapped premium stall (Speed Potion) pushes well past the ceiling…
  pushClock(s, 30, sink, true)
  const stalled = s.nextAttackAt
  expect(stalled).toBeGreaterThan(s.now + clockCapMs(s))
  // …then a capped push (Frostbolt / a Move set) must apply 0, not crater the stall to the cap
  const applied = pushClock(s, 5, sink)
  expect(applied).toBe(0)
  expect(s.nextAttackAt).toBe(stalled)
})

test('pushClock: a capped push clamps the gain at the ceiling and reports seconds applied', () => {
  const s = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  const sink = new EventSink()
  s.now = 0
  s.nextAttackAt = 5000
  const applied = pushClock(s, 100, sink) // way past the cap
  expect(s.nextAttackAt).toBe(clockCapMs(s)) // exactly the ceiling
  expect(applied).toBe(Math.round((clockCapMs(s) - 5000) / 1000))
  expect(applied).toBeGreaterThanOrEqual(0) // never negative → Move overflow can never be inflated
})

test('Time Warp slams to the cap but never pulls an above-cap clock earlier', () => {
  const rng = mulberry32(9)
  const f = foe('goblin', rng)
  let s = createCombat({ foe: f, gen: GEN }, rng)
  s.mana = [2, 2, 2]
  s.nextAttackAt = s.now + clockCapMs(s) + 15000 // Speed-Potion territory
  const stalled = s.nextAttackAt
  const r = reduce(s, { type: 'castAbility', abilityId: 'timewarp' }, { data: GAMEDATA, rng })
  expect(r.state.nextAttackAt).toBe(stalled) // the bigger stall survives
  expect(r.events.some((e) => e.type === 'clockChanged')).toBe(false)
})

// ---- death guards: a mid-trigger kill stops cleanly (FABLE E2/E5) ----
test('a multi-effect trigger that kills on the first effect emits exactly one lost and stops', () => {
  const s = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  s.playerHP = 3
  s.block = 0
  const sink = new EventSink()
  runTrigger(s, { name: 'Twin Blast', icon: 'x', on: 'match', do: [{ effect: 'damage', amount: 10 }, { effect: 'damage', amount: 10 }] }, EMPTY_DESC, mulberry32(1), sink)
  expect(s.running).toBe(false)
  expect(sink.events.filter((e) => e.type === 'lost')).toHaveLength(1)
  expect(sink.events.filter((e) => e.type === 'playerDamaged')).toHaveLength(1) // second effect never ran
})

test('completeSet after the fight has settled is a no-op (replay safety)', () => {
  const rng = mulberry32(5)
  const f = foe('goblin', rng)
  let s = createCombat({ foe: f, gen: GEN }, rng)
  s.running = false
  s.result = 'lose'
  const sets = findSets(s.board)
  const r = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  expect(r.events).toHaveLength(0)
  expect(r.state.enemyHP).toBe(s.enemyHP)
  expect(r.state.board).toEqual(s.board)
})
