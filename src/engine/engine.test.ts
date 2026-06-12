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
import { condMet, selectSlots, transmute, lockSlots, runTrigger, inflictWounds, EMPTY_DESC } from './triggers'
import { extendRound, healPlayer } from './ops'
import { woundedSlots } from './select'
import { EventSink } from './events'
import type { CombatState } from './state'
import { ROUND_MS, ROUND_EXTEND_CAP_S } from './state'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
const card = (col: number, sh: number, num: number): Card => [col, sh, 0, num]

function foe(id: string, rng = mulberry32(1)) {
  return assembleFoe(id, GAMEDATA.dungeons.training, GAMEDATA, rng)!
}

// ---- resolution math (v3 contests: per card = rate(yourStat, theirOpposed) × quality) ----
const STATS = { power: 10, endurance: 10, speed: 10 }
const FOE_PAR = { power: 10, endurance: 10, speed: 10 }
test('resolveSet (v3): each lane is an opposed-stat rate × quality', () => {
  const r = resolveSet([card(0, 1, 0), card(0, 1, 1), card(0, 1, 2)], STATS, FOE_PAR, mulberry32(1)) // all Defend, all red
  expect(r.block).toBe(6 + 8 + 11) // parity rate 8 × q(0.7/1/1.4), rounded per card → a mag-6 set ≈ 25
  expect(r.damage).toBe(0)
  expect(r.mana).toEqual([3, 0, 0]) // all-red → 3 Fire
  const r2 = resolveSet([card(0, 2, 0), card(1, 2, 0), card(2, 2, 0)], STATS, FOE_PAR, mulberry32(1)) // all Move ①, all-diff colour
  expect(r2.charges).toBeCloseTo(3 * 0.7) // Move lane: parity rate 1 × q, in charge points
  expect(r2.block).toBe(0)
  expect(r2.mana).toEqual([1, 1, 1])
  const r3 = resolveSet([card(0, SHAPE_ATTACK, 2), card(1, SHAPE_ATTACK, 2), card(2, SHAPE_ATTACK, 2)], STATS, FOE_PAR, mulberry32(1))
  expect(r3.damage).toBe(33) // DETERMINISTIC: three heavy swings at parity rate 8 → 11×3
  const r4 = resolveSet([card(0, SHAPE_ATTACK, 2), card(1, SHAPE_ATTACK, 2), card(2, SHAPE_ATTACK, 2)], { ...STATS, power: 14 }, FOE_PAR, mulberry32(1))
  expect(r4.damage).toBe(48) // the CONTEST: +4 Power edge → rate 11.2 → round(15.68)=16 per heavy swing
})

// ---- ROUNDS v3: the telegraph reveals at the deal; the exchange lands exactly ----
test('rounds: the TEMPO LAW — a giant strikes every 3rd round, telegraphed at its deal, exactly', () => {
  const rng = mulberry32(21)
  const f = foe('dread_behemoth', rng) // P 14 vs S 6 → diff −8 → every 3rd round, triple budget
  expect(f.strikeEvery).toBe(3)
  expect(f.swings).toBe(1)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  expect(s.incoming).toBeNull() // free rounds while the mountain rises
  const r1 = reduce(s, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r1.state.round).toBe(2)
  expect(r1.events.some((e) => e.type === 'roundEnded')).toBe(true)
  expect(r1.state.incoming).toBeNull()
  // the deal of round 3 (its strike round) REVEALS the telegraph
  const r2 = reduce(r1.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r2.state.round).toBe(3)
  const tele = r2.events.find((e) => e.type === 'windup') as { amount: number } | undefined
  expect(tele).toBeTruthy()
  expect(r2.state.incoming).toBe(tele!.amount)
  // round 3 elapses — the strike lands EXACTLY the telegraphed amount (block 0; likely lethal — the point)
  const r3 = reduce(r2.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  const hit = r3.events.find((e) => e.type === 'playerDamaged') as { amount: number } | undefined
  expect(hit?.amount).toBe(tele!.amount)
})

test('rounds: the tempo law packages a shambler as 2 modest swings every round', () => {
  const z = foe('limbless_zombie') // P 7 (tier 8 − heft 1) vs S 6 → diff −1 → 2 swings/round
  expect(z.strikeEvery).toBe(1)
  expect(z.swings).toBe(2)
  const s = createCombat({ foe: z, gen: GEN }, mulberry32(2))
  expect(s.incoming).not.toBeNull() // telegraphed (the swings summed) from the first deal
})

test('rounds: banked Attack lands at the exchange, player swing FIRST (the kill-race)', () => {
  const rng = mulberry32(42)
  const f = foe('goblin', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  s.enemyHP = 5
  s.board[0] = card(0, SHAPE_ATTACK, 2)
  s.board[1] = card(1, SHAPE_ATTACK, 2)
  s.board[2] = card(2, SHAPE_ATTACK, 2)
  let r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  expect(r.state.enemyHP).toBe(5) // nothing lands mid-round…
  expect(r.state.roundAttack).toBe(33) // …it BANKS toward the exchange (parity rate 8, heavy ×3)
  expect(r.events.some((e) => e.type === 'attackBanked')).toBe(true)
  r = reduce(r.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'won')).toBe(true)
  expect(r.events.some((e) => e.type === 'playerDamaged')).toBe(false) // lethal cancels their swing
})

test('wounds: floor(bite/(maxHP/10)) per exchange; heals repair ceil(heal/quantum); one knits per deal', () => {
  const s = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  s.incoming = null // quiet the foe — this test watches the wound laws, not its exchange
  s.nextStrikeRound = 99
  const sink = new EventSink()
  // playerMax 100 → quantum 10: a 35-bite scars floor(35/10) = 3 runes
  inflictWounds(s, 35, mulberry32(3), sink)
  expect(woundedSlots(s)).toHaveLength(3)
  // chip damage under the quantum never scars
  inflictWounds(s, 7, mulberry32(3), sink)
  expect(woundedSlots(s)).toHaveLength(3)
  // wounds never time-reform mid-round…
  const rng = mulberry32(3)
  let r = reduce(s, { type: 'tick', dtMs: 15000 }, { data: GAMEDATA, rng })
  expect(woundedSlots(r.state)).toHaveLength(3)
  // …but ONE knits with the deal
  r = reduce(r.state, { type: 'tick', dtMs: ROUND_MS }, { data: GAMEDATA, rng })
  expect(woundedSlots(r.state)).toHaveLength(2)
  // and a heal repairs ceil(11/10) = 2 by law
  healPlayer(r.state, 11, mulberry32(4), sink)
  expect(woundedSlots(r.state)).toHaveLength(0)
})

test('stance picks QUEUE and lock at the draw phase; Maneuver dumps at the NEXT rollover', () => {
  const rng = mulberry32(8)
  const f = foe('training_dummy', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  s.charges = 6
  let r = reduce(s, { type: 'setTactic', tactic: 'maneuver' }, { data: GAMEDATA, rng })
  r = reduce(r.state, { type: 'setBias', bias: { axis: 'color', value: 0 } }, { data: GAMEDATA, rng })
  expect(r.state.tactic).toBe('stand') // still locked this round
  expect(r.state.queuedTactic).toBe('maneuver')
  // the deal locks the stance — Stand Ground held through THIS rollover, so the bank CARRIED
  r = reduce(r.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r.state.tactic).toBe('maneuver')
  expect(r.state.maneuverBias).toEqual({ axis: 'color', value: 0 })
  expect(r.state.charges).toBe(6)
  // the NEXT rollover dumps the whole bank into the tide
  r = reduce(r.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r.state.charges).toBe(0)
  const dump = r.events.find((e) => e.type === 'tacticsDumped') as { spent: number; churned: number } | undefined
  expect(dump?.spent).toBe(6)
  expect(dump && dump.churned > 0).toBe(true)
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
  expect(z.hp).toBe(100) // legacy 30, rebased to the HP-100 world
  expect(z.cadence).toBe(24) // lumbering (authored data — feeds the first-cut derivations)
  expect(z.stats).toEqual({ power: 7, endurance: 10, speed: 6 }) // tier 8 − heft 1 · parity · lumbering
  expect(z.strikeEvery).toBe(1)
  expect(z.swings).toBe(2) // diff −1 → two modest swings
  expect(z.triggers.map((t) => t.name)).toContain('Limbless')
  const g = foe('unstable_ethereal_goblin')
  expect(g.rules.immune_card_damage).toBe(true)
  expect(g.rules.ability_damage).toBe('mana_spent')
  const b = foe('dread_behemoth')
  expect(b.cadence).toBe(120) // numeric speed
  expect(b.stats).toEqual({ power: 14, endurance: 12, speed: 6 }) // elite 11 + heft 3 · elite bump
  expect(b.strikeEvery).toBe(3) // the tempo law: diff −8 → a giant — every 3rd round, triple budget
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

// ---- reducer: a real match + the round exchange ----
test('completeSet banks toward the exchange / banks mana; the rollover lands the strikes', () => {
  const rng = mulberry32(42)
  const f = foe('goblin', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  expect(s.incoming).not.toBeNull() // a quick foe strikes round 1 — telegraphed from the first deal
  const sets = findSets(s.board)
  expect(sets.length).toBeGreaterThan(0)
  const r = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'setResolved')).toBe(true)
  expect(r.events.some((e) => e.type === 'manaGained')).toBe(true)
  expect(r.state.board.filter(Boolean).length).toBe(15) // refilled instantly mid-round
  // the round elapses → the exchange: its strike lands (or breaks on block)
  const t = reduce(r.state, { type: 'tick', dtMs: 21000 }, { data: GAMEDATA, rng })
  expect(t.events.some((e) => e.type === 'playerDamaged' || e.type === 'playerBlocked')).toBe(true)
})

test('the training dummy (0 damage) never telegraphs and cannot hurt the player', () => {
  const rng = mulberry32(5)
  const f = foe('training_dummy', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  expect(s.incoming).toBeNull()
  const t = reduce(s, { type: 'tick', dtMs: 21000 }, { data: GAMEDATA, rng })
  expect(t.state.playerHP).toBe(t.state.playerMax)
  expect(t.state.round).toBe(2) // the rounds turn regardless
  expect(t.events.some((e) => e.type === 'playerDamaged')).toBe(false)
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
  let r = runReduce(run, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  expect(r.run.combat.enemyHP).toBe(1) // banked, not landed — the exchange delivers it
  r = runReduce(r.run, { type: 'tick', dtMs: 21000 }, { data: GAMEDATA, rng })
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
  let r = runReduce(run, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  r = runReduce(r.run, { type: 'tick', dtMs: 21000 }, { data: GAMEDATA, rng })
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

// ---- the INTERIM stall re-anchor: round extension, capped per round ----
test('extendRound: stall verbs stretch the round up to the cap; uncapped potions bypass', () => {
  const s = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  const sink = new EventSink()
  const ends0 = s.roundEndsAt
  expect(extendRound(s, 6, sink)).toBe(6)
  expect(extendRound(s, 6, sink)).toBe(ROUND_EXTEND_CAP_S - 6) // clamped to the per-round cap
  expect(extendRound(s, 6, sink)).toBe(0) // the cap is spent
  expect(s.roundEndsAt).toBe(ends0 + ROUND_EXTEND_CAP_S * 1000)
  expect(extendRound(s, 30, sink, true)).toBe(30) // premium stall (Speed Potion) bypasses
})

test('Time Warp stretches the round to its full extension cap, once per round', () => {
  const rng = mulberry32(9)
  const f = foe('goblin', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  s.mana = [4, 4, 4]
  const ends0 = s.roundEndsAt
  let r = reduce(s, { type: 'castAbility', abilityId: 'timewarp' }, { data: GAMEDATA, rng })
  expect(r.state.roundEndsAt).toBe(ends0 + ROUND_EXTEND_CAP_S * 1000)
  r = reduce(r.state, { type: 'castAbility', abilityId: 'timewarp' }, { data: GAMEDATA, rng })
  expect(r.state.roundEndsAt).toBe(ends0 + ROUND_EXTEND_CAP_S * 1000) // cap spent — no further stretch
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

// ---- the Bulwark-loop fixes: magnitude pricing (playtest 2026-06-10) ----
test('highest_mag selection takes the TOP of the sort, not a random sample', () => {
  const board: (Card | null)[] = Array.from({ length: 15 }, (_, i) => card(i % 3, SHAPE_ATTACK, i === 7 ? 2 : 0)) // one heavy 3 at slot 7
  const s = createCombatStub(board)
  const sink = new EventSink()
  runTrigger(s, { name: 'Covet', icon: 'x', on: 'match', do: [{ effect: 'transmute', count: 1, select: { pick: 'highest_mag' } }] }, EMPTY_DESC, mulberry32(2), sink)
  expect(s.board[7]).toBeNull() // the heaviest rune, specifically, was plucked
})

test('scale:set_mag severity — a modest rainbow pays 2s, a greedy 3/3/3 pays 5s (off the round)', () => {
  const mk = (numbers: [number, number, number]) => ({ ...EMPTY_DESC, sameColor: null, numbers })
  const trig = { name: 'Confusion', icon: 'x', on: 'match' as const, do: [{ effect: 'advance_timer' as const, scale: 'set_mag' as const }] }
  const a = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  const beforeA = a.roundEndsAt
  runTrigger(a, trig, mk([0, 1, 2]), mulberry32(1), new EventSink()) // 1+2+3 = 6 → 2s
  expect(beforeA - a.roundEndsAt).toBe(2000)
  const b = createCombatStub(Array.from({ length: 15 }, (_, i) => card(i % 3, i % 3, (i >> 2) % 3)))
  const beforeB = b.roundEndsAt
  runTrigger(b, trig, mk([2, 2, 2]), mulberry32(1), new EventSink()) // 3+3+3 = 9 → 5s
  expect(beforeB - b.roundEndsAt).toBe(5000)
})

test('shape floods no longer bias magnitude (the Bulwark loop is dead)', () => {
  // data-shape assertion: no multi-card shape flood carries a mag bias anymore
  const rng = mulberry32(31)
  const f = foe('training_dummy', rng)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  s.mana = [9, 9, 9]
  // a board of all mag-1 Attacks: Bulwark floods them to Defends — magnitudes must stay NATURAL (not all-3)
  s.board = Array.from({ length: 15 }, (_, i) => card(i % 3, SHAPE_ATTACK, 0))
  let r = reduce(s, { type: 'castAbility', abilityId: 'bulwark' }, { data: GAMEDATA, rng })
  r = reduce(r.state, { type: 'tick', dtMs: 100 }, { data: GAMEDATA, rng }) // reforms land
  const mags = r.state.board.filter(Boolean).map((c) => c![3])
  const threes = mags.filter((m) => m === 2).length
  expect(threes).toBeLessThan(10) // an 8× mag bias would land ~12+ threes; natural is ~5
})
