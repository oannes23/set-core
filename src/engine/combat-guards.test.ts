/* Win-integrity guards on the combat reducer (FABLE §3):
   E1 — rollover proc damage (Barbed thorns on-wound) must claim the win the instant the foe hits 0 HP,
        or a dead "zombie" foe rolls a fresh telegraph and can still kill you (a loss to an empty HP bar).
   E4 — completeSet must reject non-distinct slots: isSet(c,c,c) is ALWAYS true, so [i,i,i] would bank a
        full set's value off ONE card at the server-authority / replay seam. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { findSets } from '../core/sets'
import type { GenConfig } from '../core/generate'
import { GAMEDATA } from '../data/game-data'
import { createCombat, reduce } from './combat'
import type { CombatState } from './state'

const GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }
// a plain foe with NO triggers/drift, so a tick exercises only the rollover exchange
const plainFoe = (hp: number, strikeEvery = 1): CombatState['foe'] =>
  ({ id: 'x', name: 'x', tier: 'minion', hp, stats: { power: 10, endurance: 10, speed: 10 }, strikeEvery, swings: 1, damage: 30, triggers: [], rules: {} } as unknown as CombatState['foe'])

test('E1 — a rollover on-wound proc that kills the foe ENDS the fight as a win (no zombie foe)', () => {
  const s = createCombat({ foe: plainFoe(500), gen: GEN }, mulberry32(1))
  // Stage the exact bug window: the desperate all-defend round (no banked swing to win in ①), a strike due
  // that wounds the player, the foe on 1 HP, and a Barbed-style thorns proc that deals lethal on-wound.
  s.enemyHP = 1
  s.playerHP = 100; s.playerMax = 100
  s.block = 0; s.dodgePool = 0; s.mods.soak = 0
  s.roundAttack = 0
  s.incoming = 30; s.incomingSwings = [30]; s.nextStrikeRound = s.round // strike lands THIS rollover
  s.procs = [{ event: 'wound', effect: { kind: 'damage', amount: 999 }, label: '🌵' }]
  s.roundEndsAt = s.now + 100
  const rng = (): number => 0.99 // never dodge, never crit — the strike lands deterministically
  const r = reduce(s, { type: 'tick', dtMs: 200 }, { data: GAMEDATA, rng })
  expect(r.state.enemyHP).toBe(0)
  expect(r.state.running).toBe(false)
  expect(r.state.result).toBe('win')
  expect(r.events.some((e) => e.type === 'won')).toBe(true)
  expect(r.events.some((e) => e.type === 'lost')).toBe(false) // never loses to a 0-HP foe
})

test('E1 — a foe still alive after the on-wound proc keeps fighting (the guard is not over-eager)', () => {
  const s = createCombat({ foe: plainFoe(500), gen: GEN }, mulberry32(2))
  s.enemyHP = 300
  s.playerHP = 100; s.playerMax = 100
  s.block = 0; s.dodgePool = 0; s.mods.soak = 0
  s.roundAttack = 0
  s.incoming = 30; s.incomingSwings = [30]; s.nextStrikeRound = s.round
  s.procs = [{ event: 'wound', effect: { kind: 'damage', amount: 5 }, label: '🌵' }] // chips, doesn't kill
  s.roundEndsAt = s.now + 100
  const r = reduce(s, { type: 'tick', dtMs: 200 }, { data: GAMEDATA, rng: () => 0.99 })
  expect(r.state.enemyHP).toBe(295)
  expect(r.state.running).toBe(true)
  expect(r.events.some((e) => e.type === 'won')).toBe(false)
})

test('E1 — a lowHP proc that kills the foe also ends the fight as a win (the modding-surface guard)', () => {
  const s = createCombat({ foe: plainFoe(500), gen: GEN }, mulberry32(7))
  // No incoming strike (isolate the lowHP path), player below the 30% floor so the on-lowHP proc fires,
  // foe on 1 HP, and a (hypothetical/modded) damage-dealing lowHP proc that zeroes it.
  s.enemyHP = 1
  s.playerHP = 25; s.playerMax = 100 // 25% < LOW_HP_FRAC (0.30) → lowHP procs fire
  s.block = 0; s.roundAttack = 0; s.incoming = null; s.incomingSwings = []
  s.procs = [{ event: 'lowHP', effect: { kind: 'damage', amount: 999 }, label: '🗡' }]
  s.roundEndsAt = s.now + 100
  const r = reduce(s, { type: 'tick', dtMs: 200 }, { data: GAMEDATA, rng: () => 0.99 })
  expect(r.state.enemyHP).toBe(0)
  expect(r.state.running).toBe(false)
  expect(r.state.result).toBe('win')
  expect(r.events.some((e) => e.type === 'won')).toBe(true)
})

test('E4 — completeSet([i,i,i]) is a no-op: no attack banked, foe untouched', () => {
  const s = createCombat({ foe: plainFoe(500), gen: GEN }, mulberry32(3))
  const enemyBefore = s.enemyHP
  const r = reduce(s, { type: 'completeSet', slots: [0, 0, 0] }, { data: GAMEDATA, rng: mulberry32(3) })
  expect(r.state.roundAttack).toBe(0) // nothing banked
  expect(r.state.enemyHP).toBe(enemyBefore) // foe untouched
  expect(r.events.some((e) => e.type === 'setResolved')).toBe(false)
})

test('E4 — a genuine DISTINCT set on the same board still banks (the guard only rejects duplicates)', () => {
  const s = createCombat({ foe: plainFoe(500), gen: GEN }, mulberry32(3))
  const set = findSets(s.board)[0] // three distinct slots forming a real set
  const r = reduce(s, { type: 'completeSet', slots: set }, { data: GAMEDATA, rng: mulberry32(3) })
  expect(r.state.roundAttack).toBeGreaterThan(0)
  expect(r.events.some((e) => e.type === 'setResolved')).toBe(true)
})
