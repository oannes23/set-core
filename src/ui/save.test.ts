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

// ---- the parse/migrate path (the part that grows into the migration chain) ----
import { parseRoster, sanitizeChar, STARTER_CONSUMABLES, DEFAULT_MAX_HP } from './save'

test('parseRoster migrates a legacy bare-array (v1) payload and backfills consumables', () => {
  const legacy = JSON.stringify([{ id: 'id1', name: 'Rook', classId: 'sentinel', hp: 12, maxHp: 30 }])
  const r = parseRoster(legacy)
  expect(r).toHaveLength(1)
  expect(r[0]).toMatchObject({ id: 'id1', hp: 12, maxHp: 30, consumables: STARTER_CONSUMABLES })
})

test('parseRoster reads the v2 envelope and round-trips clean chars unchanged', () => {
  const env = JSON.stringify({ v: 2, chars: [{ id: 'a', name: 'A', classId: 'rogue', hp: 5, maxHp: 30, consumables: ['hp_std'] }] })
  expect(parseRoster(env)[0]).toEqual({ id: 'a', name: 'A', classId: 'rogue', hp: 5, maxHp: 30, consumables: ['hp_std'] })
})

test('parseRoster drops unsalvageable entries and clamps corrupt numerics', () => {
  const env = JSON.stringify({ v: 2, chars: [
    null,
    { name: 'no-id', classId: 'rogue' },
    { id: 'b', name: 'B', classId: 'rogue', hp: 999, maxHp: 30 }, // hp > maxHp → clamp
    { id: 'c', name: 'C', classId: 'rogue', hp: 'x', maxHp: 'y' }, // garbage numerics → defaults
  ] })
  const r = parseRoster(env)
  expect(r.map((c) => c.id)).toEqual(['b', 'c'])
  expect(r[0].hp).toBe(30)
  expect(r[1]).toMatchObject({ hp: DEFAULT_MAX_HP, maxHp: DEFAULT_MAX_HP })
})

test('parseRoster never throws: garbage JSON / wrong shapes → empty roster', () => {
  expect(parseRoster('not json')).toEqual([])
  expect(parseRoster(JSON.stringify({ hello: 1 }))).toEqual([])
  expect(parseRoster(JSON.stringify(42))).toEqual([])
  expect(parseRoster(null)).toEqual([])
})

test('sanitizeChar truncates an oversized loadout to the slot cap', () => {
  const c = sanitizeChar({ id: 'x', name: 'X', classId: 'rogue', hp: 1, maxHp: 30, consumables: ['a', 'b', 'c', 'd', 5] })
  expect(c!.consumables).toEqual(['a', 'b', 'c'])
})
