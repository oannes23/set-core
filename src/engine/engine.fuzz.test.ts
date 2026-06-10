/* T2 — the ENGINE-LOOP invariant fuzz (FABLE §12). The conformance gate exercises the generator in
   isolation; this drives the WHOLE reducer loop — matches, casts, tactics, traps, locks, wounds,
   drift — through seeded random play, asserting the hard invariants on every step:
     1. no duplicate live cards
     2. dropped axis stays pinned
     3. floor when the board is settled (no pending reforms) — and lock-aware: ≥ floor sets
        MAKEABLE from unlocked cards (TRAPS.md §6.1)
   Deterministic per seed, so any failure is reproducible. */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { keyOf } from '../core/affine'
import { findSets, countSetsExcluding } from '../core/sets'
import { GAMEDATA } from '../data/game-data'
import { ABILITIES } from './abilities'
import { TACTICS } from './tactics'
import type { CombatState } from './state'
import type { CombatAction } from './combat'
import { runReduce } from './run'
import { startSession, type SessionSetup } from './session'

function checkInvariants(s: CombatState, label: string, viol: string[]): void {
  const live = s.board.filter((c) => c != null)
  // 1. no duplicates
  const keys = new Set(live.map((c) => keyOf(c!)))
  if (keys.size !== live.length) viol.push(`${label}: duplicate card`)
  // 2. pinned axis (shipped gen drops axis 2)
  for (const c of live) if (c![2] !== 0) viol.push(`${label}: axis 2 not pinned`)
  // 3. lock-aware floor on settled boards (pending slots are mid-reform — transient dips allowed)
  if (s.running && s.pending.size === 0) {
    const locked = s.locked.size ? new Set(s.locked.keys()) : undefined
    if (countSetsExcluding(s.board, locked) < s.gen.floor) viol.push(`${label}: below makeable floor (locks=${s.locked.size})`)
  }
}

const ABILITY_IDS = Object.keys(ABILITIES)
const TACTIC_KEYS = Object.keys(TACTICS)

/** Random-play one session to completion (or maxSteps), asserting invariants every step. */
function fuzzSession(setup: SessionSetup, maxSteps: number, viol: string[]): void {
  const { run: r0, rng } = startSession(setup, GAMEDATA)
  const deps = { data: GAMEDATA, rng }
  // give the random player a working mana economy so casts actually fire
  let run = r0
  run.combat.mana = [9, 9, 9]
  for (let step = 0; step < maxSteps && run.running; step++) {
    const s = run.combat
    const roll = rng()
    let action: CombatAction
    if (roll < 0.45) {
      const sets = findSets(s.board).filter(([a, b, c]) => !s.locked.has(a) && !s.locked.has(b) && !s.locked.has(c))
      action = sets.length ? { type: 'completeSet', slots: sets[Math.floor(rng() * sets.length)] } : { type: 'tick', dtMs: 400 }
    } else if (roll < 0.55) {
      action = { type: 'castAbility', abilityId: ABILITY_IDS[Math.floor(rng() * ABILITY_IDS.length)] }
    } else if (roll < 0.62 && s.tacticsArmed) {
      action = { type: 'useTactic', key: TACTIC_KEYS[Math.floor(rng() * TACTIC_KEYS.length)] }
    } else {
      action = { type: 'tick', dtMs: 400 } // drift / dread / locks expire / wounds reform / attacks land
    }
    const r = runReduce(run, action, deps)
    run = r.run
    checkInvariants(run.combat, `${setup.dungeonId}/${String(setup.foeId ?? 'seq')} seed${setup.seed} step${step} ${action.type}`, viol)
    if (viol.length > 10) return // enough to diagnose
  }
}

test('engine-loop fuzz: invariants hold through random play across foes, traps, locks, and drift', () => {
  const viol: string[] = []
  // the trap/lock-heavy roster: petrify-style locks (all-Move), drift, wounds, the gauntlet
  const setups: SessionSetup[] = []
  for (let seed = 1; seed <= 6; seed++) {
    setups.push({ seed: seed * 7919, dungeonId: 'goblin_warren', foeId: 'random' })
    setups.push({ seed: seed * 104729, dungeonId: 'goblin_warren', foeId: 'goblin_king' }) // 4 traps incl. dread + transmutes
    setups.push({ seed: seed * 1299709, dungeonId: 'training', sequence: ['limbless_zombie', 'dread_behemoth', 'unstable_ethereal_goblin'] })
  }
  for (const setup of setups) fuzzSession(setup, 220, viol)
  expect(viol.slice(0, 10)).toEqual([])
}, 60_000)
