/* The pure roster transforms behind the character-persistence layer (no localStorage I/O here). */

import { test, expect } from 'vitest'
import { upsert, remove, makeChar } from './save'

test('makeChar starts a hero at full HP', () => {
  expect(makeChar('Rook', 'sentinel', 'id1', 30)).toMatchObject({ id: 'id1', name: 'Rook', classId: 'sentinel', hp: 30, maxHp: 30 })
})

test('upsert adds then updates by id (no duplicates, order preserved)', () => {
  const a = makeChar('A', 'sentinel', 'id1')
  let r = upsert([], a)
  expect(r).toHaveLength(1)
  r = upsert(r, { ...a, hp: 5 }) // same id → in-place update
  expect(r).toHaveLength(1)
  expect(r[0].hp).toBe(5)
  r = upsert(r, makeChar('B', 'rogue', 'id2'))
  expect(r.map((c) => c.id)).toEqual(['id1', 'id2'])
})

test('remove drops a hero by id', () => {
  const r = [makeChar('A', 'sentinel', 'id1'), makeChar('B', 'rogue', 'id2')]
  expect(remove(r, 'id1').map((c) => c.id)).toEqual(['id2'])
})
