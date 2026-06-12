/* The multiplayer-seam proof (TODO.md §A, step 6): the engine is the single mutation path, and a
   session (seed + setup + action log) replays deterministically — so a server can be authoritative. */

import { test, expect } from 'vitest'
import { findSets } from '../core/sets'
import { GAMEDATA } from '../data/game-data'
import { startSession, runSession, type Session, type SessionSetup } from './session'
import { type CombatAction } from './combat'
import { runReduce, type RunState } from './run'
import type { CombatState } from './state'

// Compare two states by their observable content (Maps don't deep-equal directly).
function snap(s: CombatState) {
  return {
    playerHP: s.playerHP, enemyHP: s.enemyHP, block: s.block, mana: s.mana,
    charges: s.charges, tactic: s.tactic, bias: s.maneuverBias ? `${s.maneuverBias.axis}${s.maneuverBias.value}` : null,
    board: s.board.map((c) => (c ? c.join('') : 'x')).join('|'),
    locked: [...s.locked.entries()].sort((a, b) => a[0] - b[0]),
    pending: [...s.pending.keys()].sort((a, b) => a - b),
    now: s.now, round: s.round, roundEndsAt: s.roundEndsAt, incoming: s.incoming, foe: s.foe.id, running: s.running, result: s.result,
  }
}

const SETUP: SessionSetup = { seed: 777, dungeonId: 'goblin_warren', foeId: 'goblin' }

/** A "client": play interactively off the same seeded rng, recording every action. */
function playClient(setup: SessionSetup): { actions: CombatAction[]; final: RunState } {
  const { run: r0, rng } = startSession(setup, GAMEDATA)
  const deps = { data: GAMEDATA, rng }
  let r = r0
  const actions: CombatAction[] = []
  for (let round = 0; round < 8; round++) {
    const sets = findSets(r.combat.board)
    if (sets.length) {
      const a: CombatAction = { type: 'completeSet', slots: sets[0] }
      actions.push(a)
      r = runReduce(r, a, deps).run
    }
    const t: CombatAction = { type: 'tick', dtMs: 1500 }
    actions.push(t)
    r = runReduce(r, t, deps).run
  }
  return { actions, final: r }
}

test('a server replaying the action log reproduces the client state exactly', () => {
  const client = playClient(SETUP)
  const session: Session = { setup: SETUP, actions: client.actions }
  const server = runSession(session, GAMEDATA) // the "authority" sees only seed + log
  expect(snap(server.run.combat)).toEqual(snap(client.final.combat))
})

test('replay is deterministic (same session → identical state AND events)', () => {
  const client = playClient(SETUP)
  const session: Session = { setup: SETUP, actions: client.actions }
  const a = runSession(session, GAMEDATA)
  const b = runSession(session, GAMEDATA)
  expect(snap(a.run.combat)).toEqual(snap(b.run.combat))
  expect(a.events).toEqual(b.events)
})

test('runReduce does not mutate the input state (clone semantics — safe to keep history)', () => {
  const { run, rng } = startSession(SETUP, GAMEDATA)
  const before = snap(run.combat)
  const sets = findSets(run.combat.board)
  runReduce(run, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  runReduce(run, { type: 'tick', dtMs: 5000 }, { data: GAMEDATA, rng })
  expect(snap(run.combat)).toEqual(before) // original untouched
})
