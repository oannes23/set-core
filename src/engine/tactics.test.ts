/* Tactics — the Maneuver LIVE-BURN, focused on the E5 shield/prime fix (FABLE §3):
   liveBurn must NOT spend a charge or mark a card Primed when its only target is rule-6-shielded
   (a selected card or its set-mate) — otherwise `transmute` silently skips the churn while the charge
   is gone and the untouched card wrongly counts a tier higher on a match. */

import { test, expect } from 'vitest'
import { liveBurn } from './tactics'
import type { CombatState, ManeuverBias } from './state'
import type { CombatEvent } from './events'
import type { Card } from '../core/affine'

const C = (a: number, b: number, c: number, d = 0): Card => [a, b, c, d]
// slots 0,1,2 form a SET (each coordinate all-different → sums to 0 mod 3); the whole board is that set.
const mkState = (selected: number[], bias: ManeuverBias, charges = 5): CombatState =>
  ({
    board: [C(0, 0, 0), C(1, 1, 1), C(2, 2, 2)],
    pending: new Map(), locked: new Map(), primed: {}, selected, now: 1000,
    tactic: 'maneuver', charges, maneuverBias: bias,
  } as unknown as CombatState)
const sink = () => { const events: CombatEvent[] = []; return { events, emit: (e: CombatEvent) => events.push(e) } }
const rng = () => 0.5

test('E5 — liveBurn HOLDS (no charge spent, nothing Primed) when its only target is shielded', () => {
  // bias colour=0 → matching = slot 0; the non-matching pool {1,2} is exactly the set-mates of selected
  // slot 0, so the whole pool is shielded → the burn must fizzle without cost.
  const s = mkState([0], { axis: 'color', value: 0 })
  const k = sink()
  const spent = liveBurn(s, rng, k)
  expect(spent).toBe(false)
  expect(s.charges).toBe(5) // NOT decremented
  expect(Object.keys(s.primed)).toHaveLength(0) // nothing spuriously Primed
  expect(k.events).toHaveLength(0)
})

test('E5 — liveBurn still spends + Primes a genuinely unshielded target', () => {
  // no selection → no shield; the non-matching pool {1,2} is burnable; the deadest (lowest combo·100+mag
  // → slot 1, mag 1 < slot 2 mag 2) is churned, Primed, and one charge is spent.
  const s = mkState([], { axis: 'color', value: 0 })
  const k = sink()
  const spent = liveBurn(s, rng, k)
  expect(spent).toBe(true)
  expect(s.charges).toBe(4) // one charge spent
  expect(s.board[1]).toBeNull() // slot 1 churned (cleared, pending a reform)
  expect(s.primed[1]).toBe(s.now) // and marked Primed
  expect(k.events.some((e) => e.type === 'tacticsBurned')).toBe(true)
})
