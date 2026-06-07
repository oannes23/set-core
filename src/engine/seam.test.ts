/* The multiplayer-seam proof (TODO.md §A, step 6): the engine is the single mutation path, and a
   session (seed + setup + action log) replays deterministically — so a server can be authoritative. */

import { test, expect } from 'vitest'
import { findSets } from '../core/sets'
import { GAMEDATA } from '../data/game-data'
import { startSession, runSession, type Session, type SessionSetup } from './session'
import { reduce, type CombatAction } from './combat'
import type { CombatState } from './state'

// Compare two states by their observable content (Maps don't deep-equal directly).
function snap(s: CombatState) {
  return {
    playerHP: s.playerHP, enemyHP: s.enemyHP, block: s.block, mana: s.mana,
    tactics: Math.round(s.tactics * 1000), tacticsArmed: s.tacticsArmed,
    board: s.board.map((c) => (c ? c.join('') : 'x')).join('|'),
    locked: [...s.locked.entries()].sort((a, b) => a[0] - b[0]),
    pending: [...s.pending.keys()].sort((a, b) => a - b),
    now: s.now, nextAttackAt: s.nextAttackAt, seqIdx: s.seqIdx, foe: s.foe.id, running: s.running, result: s.result,
  }
}

const SETUP: SessionSetup = { seed: 777, dungeonId: 'goblin_warren', foeId: 'goblin' }

/** A "client": play interactively off the same seeded rng, recording every action. */
function playClient(setup: SessionSetup): { actions: CombatAction[]; final: CombatState } {
  const { state: s0, rng } = startSession(setup, GAMEDATA)
  const deps = { data: GAMEDATA, rng }
  let s = s0
  const actions: CombatAction[] = []
  for (let round = 0; round < 8; round++) {
    const sets = findSets(s.board)
    if (sets.length) {
      const a: CombatAction = { type: 'completeSet', slots: sets[0] }
      actions.push(a)
      s = reduce(s, a, deps).state
    }
    const t: CombatAction = { type: 'tick', dtMs: 1500 }
    actions.push(t)
    s = reduce(s, t, deps).state
  }
  return { actions, final: s }
}

test('a server replaying the action log reproduces the client state exactly', () => {
  const client = playClient(SETUP)
  const session: Session = { setup: SETUP, actions: client.actions }
  const server = runSession(session, GAMEDATA) // the "authority" sees only seed + log
  expect(snap(server.state)).toEqual(snap(client.final))
})

test('replay is deterministic (same session → identical state AND events)', () => {
  const client = playClient(SETUP)
  const session: Session = { setup: SETUP, actions: client.actions }
  const a = runSession(session, GAMEDATA)
  const b = runSession(session, GAMEDATA)
  expect(snap(a.state)).toEqual(snap(b.state))
  expect(a.events).toEqual(b.events)
})

test('reduce does not mutate the input state (clone semantics — safe to keep history)', () => {
  const { state, rng } = startSession(SETUP, GAMEDATA)
  const before = snap(state)
  const sets = findSets(state.board)
  reduce(state, { type: 'completeSet', slots: sets[0] }, { data: GAMEDATA, rng })
  reduce(state, { type: 'tick', dtMs: 5000 }, { data: GAMEDATA, rng })
  expect(snap(state)).toEqual(before) // original untouched
})
