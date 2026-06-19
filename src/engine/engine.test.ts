import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import type { Card } from '../core/affine'
import { findSets } from '../core/sets'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe, foeLevelEquiv, gearFactor } from './foe'
import { createCombat, reduce, colsForN, playerCritChance, playerCritMult } from './combat'
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

test('the foe-difficulty raise: createCombat scales HP + telegraph by gearFactor (high L), inert at low L', () => {
  const mk = (avg: number) => ({ id: 'x', name: 'x', tier: 'boss', hp: 200, stats: { power: avg, endurance: avg, speed: avg }, strikeEvery: 3, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>)
  const hi = mk(30) // → foeLevelEquiv 11 → factor 1.24
  const lo = mk(10) // → foeLevelEquiv 1 → factor 1.0 (early content untouched)
  const sHi = createCombat({ foe: hi, gen: GEN }, mulberry32(3))
  const sLo = createCombat({ foe: lo, gen: GEN }, mulberry32(3))
  expect(sHi.enemyHP).toBe(Math.round(200 * gearFactor(foeLevelEquiv(hi)))) // 248
  expect(sHi.enemyHP).toBeGreaterThan(200)
  expect(sLo.enemyHP).toBe(200) // ×1.0 — no raise below L7
  expect(sHi.foe.damage).toBeGreaterThan(0) // telegraph also raised (finalized in createCombat)
})

test('CRIT curve (§13): a skill-earned S-curve — earned not flat, competent ~5%, peak ~24%, soft-capped', () => {
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 100, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 9, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  const s = createCombat({ foe: f, gen: GEN }, mulberry32(4))
  expect(playerCritChance(s)).toBeLessThan(0.03) // no combo activity → crit is EARNED, not a flat base
  expect(playerCritMult(s)).toBeCloseTo(1.5, 5)
  s.combo.highest = 2.6; s.combo.combos = 1.8 // competent activity (sim §13) ≈ 5%
  expect(playerCritChance(s)).toBeCloseTo(0.047, 2)
  s.combo.highest = 10; s.combo.combos = 11.3 // peak activity ≈ 24%, strictly under the 25% soft cap
  expect(playerCritChance(s)).toBeGreaterThan(0.23)
  expect(playerCritChance(s)).toBeLessThan(0.25)
  s.combo.highest = 100 // a monster streak STILL can't break the soft cap (the asymptote — never reliable)
  expect(playerCritChance(s)).toBeLessThanOrEqual(0.25)
  // timer extension NORMALIZES combos (stall-stretch can't farm crit), but NOT the highest chain
  s.combo.highest = 5; s.combo.combos = 10; s.roundExtendedS = 0
  const unstretched = playerCritChance(s)
  s.roundExtendedS = 20 // the round was doubled → combos count for half
  expect(playerCritChance(s)).toBeLessThan(unstretched)
  s.mods = { ...s.mods, critMult: 0.3 } // Vorpal raises the multiplier
  expect(playerCritMult(s)).toBeCloseTo(1.8, 5)
})

test('CRIT fires at the exchange and multiplies the swing (player-only); capped, never reliable', () => {
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 1e9, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 9, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  let crits = 0, swings = 0
  for (let i = 0; i < 400; i++) {
    const rng = mulberry32(i + 1)
    const s = createCombat({ foe: f, gen: GEN }, rng)
    const r = reduce(s, { type: 'completeSet', slots: findSets(s.board)[0] }, { data: GAMEDATA, rng })
    const banked = r.state.roundAttack
    if (banked <= 0) continue
    r.state.combo.highest = 12; r.state.combo.combos = 12 // peak-ish activity → ~24% crit chance
    const t = reduce(r.state, { type: 'tick', dtMs: 21000 }, { data: GAMEDATA, rng })
    const hit = t.events.find((e): e is Extract<typeof e, { type: 'enemyDamaged' }> => e.type === 'enemyDamaged')
    if (!hit) continue
    swings++
    if (hit.crit) { crits++; expect(hit.amount).toBe(Math.round(banked * 1.5)) } // a crit = ×1.5 the banked swing
    else expect(hit.amount).toBe(banked) // a non-crit = exactly the banked swing
  }
  expect(crits).toBeGreaterThan(0) // crits DO fire at peak activity
  expect(crits / swings).toBeLessThan(0.3) // …but stay under the cap (delight, not DPS)
})

test('COMBOS: tempo keeps the streak alive, identity (colour OR shape) escalates it faster; grace lapse resets', () => {
  const rng = mulberry32(2)
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 100000, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 9, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  const deps = { data: GAMEDATA, rng }
  const C = card
  const s = createCombat({ foe: f, gen: GEN }, rng) // now = 0
  s.board = [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), ...s.board.slice(3)] // a red-Attack set
  let r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, deps)
  expect(r.state.combo.level).toBe(1) // first match — no prior, no grace
  r.state.board = [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), ...r.state.board.slice(3)] // red-Attack again
  r = reduce(r.state, { type: 'completeSet', slots: [0, 1, 2] }, deps) // in grace + shares colour+shape → STYLED
  expect(r.state.combo.level).toBeCloseTo(2, 5) // styled extend (+1.0)
  expect(r.state.combo.combos).toBe(1)
  r.state.board = [C(2, 1, 0), C(2, 1, 1), C(2, 1, 2), ...r.state.board.slice(3)] // blue-Defend: diff colour AND shape
  r = reduce(r.state, { type: 'completeSet', slots: [0, 1, 2] }, deps) // in grace but NOT styled → tempo (+0.6)
  expect(r.state.combo.level).toBeCloseTo(2.6, 5)
  r = reduce(r.state, { type: 'tick', dtMs: 4000 }, deps) // let the 3s grace lapse
  r.state.board = [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), ...r.state.board.slice(3)]
  r = reduce(r.state, { type: 'completeSet', slots: [0, 1, 2] }, deps)
  expect(r.state.combo.level).toBe(1) // grace lapsed → fresh streak
})

test('the exchange cutscene: swingMath narrates matches + weapon = the banked swing', () => {
  const rng = mulberry32(3)
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 1e9, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 9, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  const s = createCombat({ foe: f, gen: GEN, riders: { atkDamagePerCard: 2, blockPerDefendCard: 0, manaPerMatch: 0 } }, rng)
  s.board = [card(0, 0, 0), card(0, 0, 1), card(0, 0, 2), ...s.board.slice(3)] // a red-Attack set (3 attack cards)
  const r = reduce(s, { type: 'completeSet', slots: [0, 1, 2] }, { data: GAMEDATA, rng })
  const banked = r.state.roundAttack
  const t = reduce(r.state, { type: 'tick', dtMs: 21000 }, { data: GAMEDATA, rng })
  const sm = t.events.find((e): e is Extract<typeof e, { type: 'swingMath' }> => e.type === 'swingMath')
  expect(sm).toBeTruthy()
  if (sm) {
    expect(sm.weapon).toBe(6) // +2/card × 3 attack cards (the gear rider)
    expect(sm.attacks).toBe(1)
    expect(sm.matches + sm.weapon).toBe(banked) // base contest + rider = the banked swing (dmult 1, no dread early)
    if (!sm.crit) expect(sm.total).toBe(banked) // no crit → the total IS the breakdown sum
  }
})

test('the affix-proc engine: an on-match proc fires player-favourably (condMet → ops)', () => {
  const rng = mulberry32(7)
  // a trigger-free foe so the only thing touching enemyHP on a match is the proc itself
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 100, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 2, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  const s = createCombat({ foe: f, gen: GEN, procs: [{ effect: { kind: 'damage', amount: 7 } }] }, rng) // no `when` → every match
  const before = s.enemyHP
  const sets = findSets(s.board)
  const r = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  expect(before - r.state.enemyHP).toBe(7) // the proc's direct damage landed (the set banks to the exchange separately)
  expect(r.events.some((e) => e.type === 'passiveProc' && e.id === 'affix')).toBe(true)
})

test('proc events carry the affix label (procSource) for UI attribution', () => {
  const rng = mulberry32(7)
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 100, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 2, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  const s = createCombat({ foe: f, gen: GEN, procs: [{ effect: { kind: 'damage', amount: 7 }, label: '🔥+7' }] }, rng)
  const sets = findSets(s.board)
  const r = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  const dmg = r.events.find((e) => e.type === 'enemyDamaged') as Extract<import('./events').CombatEvent, { type: 'enemyDamaged' }> | undefined
  expect(dmg?.procSource).toBe('🔥+7') // the proc's damage event is tagged with its affix label
})

test('the reactive proc family: an on-KILL heal fires when the foe dies (player-side event)', () => {
  const rng = mulberry32(9)
  const f = { id: 'x', name: 'x', tier: 'minion', hp: 100, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery: 2, swings: 1, triggers: [], rules: {} } as unknown as ReturnType<typeof foe>
  const s = createCombat({ foe: f, gen: GEN, procs: [{ effect: { kind: 'damage', amount: 99 } }, { event: 'kill', effect: { kind: 'heal', amount: 20 } }] }, rng)
  s.enemyHP = 5 // the match proc (99) overkills → the foe dies on this match
  s.playerHP = 50 // room to see the on-kill heal
  const sets = findSets(s.board)
  const r = reduce(s, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  expect(r.state.result).toBe('win')
  expect(r.state.playerHP).toBe(70) // the on-kill Carnage heal (+20) fired in onWin
})

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
  expect(r4.damage).toBe(36) // the CONTEST (re-denominated K 0.2): +4 Power edge → rate 8.8 → round(12.32)=12 per heavy swing
})

// ---- ROUNDS v3: the telegraph reveals at the deal; the exchange lands exactly ----
test('rounds: the TEMPO LAW — a giant strikes every 3rd round, telegraphed at its deal, exactly', () => {
  const rng = mulberry32(21)
  const f = foe('dread_behemoth', rng) // authored P14/E10/S5 → S−P −9 → every 3rd round, triple budget
  expect(f.strikeEvery).toBe(3)
  expect(f.swings).toBe(1)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  // §5.7 EARLY REVEAL: the telegraph shows from round 1 (the windup) and is HELD, but the strike
  // does NOT land until round 3. Pin a guaranteed-landing telegraph (a 1-swing giant can otherwise
  // fully whiff on the deal-time dodge — that path is covered by the dodge test).
  const tele = s.foe.damage
  s.incoming = tele
  s.incomingSwings = [tele] // pin the raw single swing (strike-time dodge reads this now, §2.3)
  s.incomingDodged = 0
  expect(s.incoming).not.toBeNull() // revealed from round 1
  const r1 = reduce(s, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r1.state.round).toBe(2)
  expect(r1.state.incoming).toBe(tele) // HELD through the windup — no strike yet
  expect(r1.events.some((e) => e.type === 'playerDamaged')).toBe(false)
  const r2 = reduce(r1.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r2.state.round).toBe(3)
  expect(r2.state.incoming).toBe(tele) // still held — round 2 was the second windup round
  // round 3 elapses — the strike RESOLVES exactly at round 3 (the tempo timing). It either lands for
  // `tele` or is slipped by the Speed-floor dodge — the point here is the WINDUP HOLD + strike-at-round-3.
  const r3 = reduce(r2.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r3.events.some((e) => e.type === 'blockMath')).toBe(true) // the strike resolved this round
  const hit = r3.events.find((e) => e.type === 'playerDamaged') as { amount: number } | undefined
  if (hit) expect(hit.amount).toBe(tele) // if it landed (not dodged), it lands EXACTLY the telegraphed amount
})

test('rounds: the tempo law packages a shambler as 2 modest swings every round', () => {
  const z = foe('limbless_zombie') // authored P5/E8/S5 → S−P 0 → 2 swings/round
  expect(z.strikeEvery).toBe(1)
  expect(z.swings).toBe(2)
  const s = createCombat({ foe: z, gen: GEN }, mulberry32(2))
  expect(s.incoming).not.toBeNull() // telegraphed (the swings summed) from the first deal
})

test('cutscene contract: a rollover with a strike emits swingMath + blockMath + roundSummary + windup', () => {
  const rng = mulberry32(7)
  const z = foe('limbless_zombie') // strikeEvery 1, swings 2 → a strike lands every rollover
  const s = createCombat({ foe: z, gen: GEN, riders: { atkDamagePerCard: 2, blockPerDefendCard: 2, manaPerMatch: 0 } }, rng)
  // bank some Attack + Defend so the swing/block breakdowns carry rider parts
  const r0 = reduce(s, { type: 'completeSet', slots: findSets(s.board)[0] }, { data: GAMEDATA, rng })
  const r = reduce(r0.state, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  const sm = r.events.find((e) => e.type === 'swingMath') as Extract<import('./events').CombatEvent, { type: 'swingMath' }> | undefined
  const bm = r.events.find((e) => e.type === 'blockMath') as Extract<import('./events').CombatEvent, { type: 'blockMath' }> | undefined
  const rs = r.events.find((e) => e.type === 'roundSummary') as Extract<import('./events').CombatEvent, { type: 'roundSummary' }> | undefined
  const w = r.events.find((e) => e.type === 'windup') as Extract<import('./events').CombatEvent, { type: 'windup' }> | undefined
  expect(rs).toBeDefined() // the offense-quality summary (primed/combo) — emitted EVERY rollover
  expect(rs!.primed).toBeGreaterThanOrEqual(0)
  expect(bm).toBeDefined() // the strike landed (strikeEvery 1) → the block→net beat the cutscene narrates
  expect(bm!.telegraph).toBeGreaterThan(0)
  expect(bm!.soaked).toBeGreaterThanOrEqual(0)
  expect(bm!.bite).toBe(Math.max(0, (bm!.telegraph - bm!.soaked) - bm!.block)) // net = (telegraph − soak) − guard, floored at 0
  if (sm) { expect(sm.matches).toBeGreaterThanOrEqual(0); expect(sm.total).toBeGreaterThan(0) } // present iff Attack was banked
  expect(w).toBeDefined() // the NEXT telegraph forms → windup drives the construction beat
  expect(w!.swings).toBe(2); expect(w!.dodged).toBeGreaterThanOrEqual(0); expect(w!.dodged).toBeLessThanOrEqual(2)
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
  expect(r.state.roundAttack).toBe(30) // …it BANKS toward the exchange (vs goblin E14: rate 7.2, heavy ×3 → 10×3)
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

test('§5.7 stances are LIVE: Maneuver gathers then burns ~1 charge/sec; bail to Stand keeps the bank', () => {
  const rng = mulberry32(8)
  const f = foe('training_dummy', rng) // 0 damage — isolate the tide from any exchange
  const s = createCombat({ foe: f, gen: GEN }, rng)
  s.charges = 6
  const deps = { data: GAMEDATA, rng }
  // enter Maneuver LIVE (no queue) + dial a bias
  let r = reduce(s, { type: 'setTactic', tactic: 'maneuver' }, deps)
  expect(r.state.tactic).toBe('maneuver') // applied immediately
  r = reduce(r.state, { type: 'setBias', bias: { axis: 'color', value: 0 } }, deps)
  // the GATHER: a tick inside the gather window burns nothing
  r = reduce(r.state, { type: 'tick', dtMs: 1500 }, deps) // < MANEUVER_GATHER_MS (1800)
  expect(r.state.charges).toBe(6)
  // past the gather: ~1 charge/sec — three seconds → three burns
  r = reduce(r.state, { type: 'tick', dtMs: 500 }, deps) // crosses the gather
  r = reduce(r.state, { type: 'tick', dtMs: 3000 }, deps)
  expect(r.state.charges).toBe(3)
  expect(r.events.filter((e) => e.type === 'tacticsBurned').length).toBeGreaterThanOrEqual(3)
  // BAIL to Stand Ground is instant and KEEPS the remainder
  r = reduce(r.state, { type: 'setTactic', tactic: 'stand' }, deps)
  expect(r.state.tactic).toBe('stand')
  const held = r.state.charges
  r = reduce(r.state, { type: 'tick', dtMs: 5000 }, deps) // Stand Ground never burns
  expect(r.state.charges).toBe(held)
})

test('§2.3 dodge: a stacked Dodge pool slips a giant haymaker WHOLE (strikeDodged, no damage)', () => {
  const rng = mulberry32(8)
  const f = foe('dread_behemoth', rng) // giant: strikeEvery 3, 1 swing → dodge cap 100% (the haymaker IS dodgeable)
  const s = createCombat({ foe: f, gen: GEN }, rng)
  s.dodgePool = 1.0 // banked to certainty over the windup (the Move investment that the §2.3 model rewards)
  s.incoming = 40; s.incomingSwings = [40] // the pending haymaker
  s.nextStrikeRound = s.round // the strike lands this rollover
  const r = reduce(s, { type: 'tick', dtMs: ROUND_MS + 100 }, { data: GAMEDATA, rng })
  expect(r.events.some((e) => e.type === 'strikeDodged')).toBe(true) // eff = min(cap 1.0, floor + pool 1.0) = 1.0 → slipped whole
  expect(r.events.some((e) => e.type === 'playerDamaged')).toBe(false)
})

test('block NO-CARRY (BALANCE §2.1): a slow foe reveals early but banked Block does NOT survive the windup', () => {
  // the shaman is heavy (S−P −7 → every 2nd round) and its variants don't shift P/S, so strikeEvery
  // is a stable 2 (unlike the butcher, whose Cruel variant can add Power and tip it into giant).
  const wf = assembleFoe('goblin_shaman', GAMEDATA.dungeons.goblin_warren, GAMEDATA, mulberry32(8))!
  const s = createCombat({ foe: wf, gen: GEN }, mulberry32(8))
  expect(wf.strikeEvery).toBe(2)
  expect(s.incoming).not.toBeNull() // EARLY REVEAL: telegraph shows from round 1 (the windup)
  s.block = 12
  const deps = { data: GAMEDATA, rng: mulberry32(8) }
  // round 1 is a WINDUP round (strike lands round 2) — Block built now is WASTED (no carry): the
  // haymaker that can't be blocked in one round is the Dodge pool's job, not Block's (the §2.3 split).
  const r1 = reduce(s, { type: 'tick', dtMs: ROUND_MS + 100 }, deps)
  expect(r1.state.round).toBe(2)
  expect(r1.state.block).toBe(0) // reset at the rollover — NOT carried toward the strike
  expect(r1.events.some((e) => e.type === 'playerDamaged' || e.type === 'playerBlocked')).toBe(false) // no strike yet
  // round 2 is the strike — block stays reset across this rollover too
  const r2 = reduce(r1.state, { type: 'tick', dtMs: ROUND_MS + 100 }, deps)
  expect(r2.state.block).toBe(0)
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
test('assembleFoe resolves the AUTHORED statline, tempo, triggers, rules (the data rebase)', () => {
  const z = foe('limbless_zombie')
  expect(z.hp).toBe(85) // authored HP, re-anchored to Typical play (BALANCE.md §5.2: minion tier ×~1.67 → ~100)
  expect(z.stats).toEqual({ power: 5, endurance: 8, speed: 5 }) // authored directly
  expect(z.strikeEvery).toBe(1)
  expect(z.swings).toBe(2) // S−P 0 → two modest swings
  expect(z.triggers.map((t) => t.name)).toContain('Limbless')
  const g = foe('unstable_ethereal_goblin')
  expect(g.rules.immune_card_damage).toBe(true)
  expect(g.rules.ability_damage).toBe('mana_spent')
  const b = foe('dread_behemoth')
  expect(b.stats).toEqual({ power: 14, endurance: 10, speed: 5 }) // authored — the giant
  expect(b.strikeEvery).toBe(3) // the tempo law: S−P −9 → every 3rd round, triple budget
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

// ---- the flee PARTING BLOW (§5.7 / exit ladder) ----
const fleeCombat = (over: { damage?: number; foeSpeed?: number; playerSpeed?: number; dodge?: number; hp?: number } = {}): CombatState => {
  const s = createCombat({ foe: foe('goblin'), gen: GEN }, mulberry32(1))
  s.foe = { ...s.foe, damage: over.damage ?? 20, stats: { ...s.foe.stats, speed: over.foeSpeed ?? 10 } }
  s.stats = { ...s.stats, speed: over.playerSpeed ?? 1 } // low speed → minimal dodge
  s.mods = { ...s.mods, dodge: over.dodge ?? 0, soak: 0 }
  s.block = 0
  if (over.hp != null) s.playerHP = over.hp
  return s
}

test('flee: a harmless foe (no damage) gives a clean getaway — no parting blow', () => {
  const s = fleeCombat({ damage: 0 })
  const hp0 = s.playerHP
  const r = reduce(s, { type: 'flee' }, { data: GAMEDATA, rng: mulberry32(7) })
  expect(r.state.running).toBe(false)
  expect(r.state.result).toBe('flee')
  expect(r.state.playerHP).toBe(hp0) // untouched
  expect(r.events.some((e) => e.type === 'playerDamaged')).toBe(false)
  expect(r.events.some((e) => e.type === 'fled')).toBe(true)
})

// the parting blow always carries a DODGE_MIN floor chance — find a seed that LANDS (no dodge) so the
// hit/block/lethal mechanics test deterministically (the dodge path has its own test below).
const landSeed = (s: CombatState): number => {
  for (let seed = 1; seed < 300; seed++) {
    if (!reduce(s, { type: 'flee' }, { data: GAMEDATA, rng: mulberry32(seed) }).events.some((e) => e.type === 'strikeDodged')) return seed
  }
  throw new Error('no landing seed')
}

test('flee: a damaging foe lands one parting swing; survived → a clean flee (fled, result flee)', () => {
  const s = fleeCombat({ damage: 20, dodge: 0 })
  const hp0 = s.playerHP
  const r = reduce(s, { type: 'flee' }, { data: GAMEDATA, rng: mulberry32(landSeed(s)) })
  expect(r.state.running).toBe(false)
  expect(r.state.result).toBe('flee')
  expect(r.state.playerHP).toBeLessThan(hp0) // the swing landed
  expect(r.events.some((e) => e.type === 'playerDamaged')).toBe(true)
  expect(r.events.some((e) => e.type === 'fled')).toBe(true)
})

test('flee: banked Block soaks the parting blow', () => {
  const s = fleeCombat({ damage: 20, dodge: 0 })
  const seed = landSeed(s) // a seed that doesn't dodge — so Block is what saves us
  s.block = 999 // fully guarded
  const hp0 = s.playerHP
  const r = reduce(s, { type: 'flee' }, { data: GAMEDATA, rng: mulberry32(seed) })
  expect(r.state.playerHP).toBe(hp0) // absorbed
  expect(r.events.some((e) => e.type === 'playerBlocked')).toBe(true)
  expect(r.state.result).toBe('flee')
})

test('flee: a lethal parting blow is a DEATH while fleeing (lost, result lose, no fled)', () => {
  const s = fleeCombat({ damage: 50, dodge: 0, hp: 3 })
  const r = reduce(s, { type: 'flee' }, { data: GAMEDATA, rng: mulberry32(landSeed(s)) })
  expect(r.state.running).toBe(false)
  expect(r.state.result).toBe('lose')
  expect(r.state.playerHP).toBe(0)
  expect(r.events.some((e) => e.type === 'lost')).toBe(true)
  expect(r.events.some((e) => e.type === 'fled')).toBe(false) // no clean getaway
})

test('flee: a high Dodge can evade the parting blow whole (strikeDodged, no damage)', () => {
  const s = fleeCombat({ damage: 20, dodge: 1, playerSpeed: 30 }) // pDodge clamps to DODGE_MAX
  const hp0 = s.playerHP
  // find a seed that rolls under the dodge ceiling (deterministic per seed)
  let dodged = false
  for (let seed = 1; seed < 60 && !dodged; seed++) {
    const r = reduce(s, { type: 'flee' }, { data: GAMEDATA, rng: mulberry32(seed) })
    if (r.events.some((e) => e.type === 'strikeDodged')) {
      dodged = true
      expect(r.state.playerHP).toBe(hp0) // evaded whole — no HP lost
      expect(r.events.some((e) => e.type === 'playerDamaged')).toBe(false)
      expect(r.state.result).toBe('flee')
    }
  }
  expect(dodged).toBe(true) // SOME seed dodges at the ceiling chance
})
