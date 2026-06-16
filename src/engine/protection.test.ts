/* Hard rule #6 — selection-protected turnover: automatic turnover (churn/drift/trap/trick) never
   targets a selected card or its set-mate; a deliberate player cast (no source) is exempt. */

import { test, expect } from 'vitest'
import { protectedSlots, revalidateSelection } from './select'
import { transmute } from './triggers'
import type { CombatState } from './state'
import { type Card, keyOf } from '../core/affine'
import type { CombatEvent } from './events'

const C = (a: number, b: number, c: number, d = 0): Card => [a, b, c, d]
// slots 0,1,2 form a SET (each coordinate sums to 0 mod 3); slot 3 is in no set.
const mkState = (selected: number[]): CombatState =>
  ({ board: [C(0, 0, 0), C(1, 1, 1), C(2, 2, 2), C(0, 1, 2)], pending: new Map(), locked: new Map(), selected, now: 0 } as unknown as CombatState)
const sink = () => { const events: CombatEvent[] = []; return { events, emit: (e: CombatEvent) => events.push(e) } }

test('protectedSlots: nothing selected → empty (pre-selection turnover is unprotected)', () => {
  expect(protectedSlots(mkState([])).size).toBe(0)
})

test('protectedSlots: a selected card shields itself AND its set-mates', () => {
  expect([...protectedSlots(mkState([0]))].sort()).toEqual([0, 1, 2]) // slot 0 lives in the set {0,1,2}
})

test('sourced turnover SKIPS a protected set-mate; a player cast (no source) does not', () => {
  const s1 = mkState([0]), k1 = sink()
  transmute(s1, [1], { source: 'churn' }, k1) // slot 1 is a set-mate of selected slot 0
  expect(s1.board[1]).not.toBeNull() // shielded — untouched
  expect(k1.events.length).toBe(0)

  const s2 = mkState([0]), k2 = sink()
  transmute(s2, [1], {}, k2) // no source = deliberate player cast → exempt
  expect(s2.board[1]).toBeNull()
  expect(k2.events.some((e) => e.type === 'cardsTransmuted')).toBe(true)
})

test('sourced turnover still HITS an unprotected slot', () => {
  const s = mkState([0]), k = sink()
  transmute(s, [3], { source: 'drift' }, k) // slot 3 shares no set with slot 0
  expect(s.board[3]).toBeNull()
})

// ---- U6: revalidate a held selection after a reduction (the deliberate-cast residual of #6) ----
const keysOf = (sel: number[], board: CombatState['board']): Map<number, number | null> =>
  new Map(sel.map((i) => [i, board[i] ? keyOf(board[i]!) : null]))

test('revalidateSelection: an unchanged board keeps the whole selection', () => {
  const s = mkState([0, 1])
  expect(revalidateSelection([0, 1], keysOf([0, 1], s.board), s.board, s.locked)).toEqual([0, 1])
})

test('revalidateSelection (U6): a selected card rewritten IN PLACE is dropped', () => {
  const s = mkState([0, 1])
  const was = keysOf([0, 1], s.board)
  s.board[0] = C(1, 2, 0) // a deliberate cast morphed slot 0 → a different card (same slot, new key)
  expect(revalidateSelection([0, 1], was, s.board, s.locked)).toEqual([1]) // stale slot 0 dropped; 1 survives
})

test('revalidateSelection: emptied or locked selected slots are dropped', () => {
  const s = mkState([0, 1, 2])
  const was = keysOf([0, 1, 2], s.board)
  s.board[1] = null // a transmute that cleared it
  s.locked = new Map([[2, 999]]) // slot 2 locked
  expect(revalidateSelection([0, 1, 2], was, s.board, s.locked)).toEqual([0])
})
