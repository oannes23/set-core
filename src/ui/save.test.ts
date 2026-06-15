/* The pure roster transforms behind the character-persistence layer (no localStorage I/O here). */

import { test, expect } from 'vitest'
import { upsert, remove, makeChar } from './save'

test('makeChar starts a hero at level 1, full HP, no allocated points', () => {
  expect(makeChar('Rook', 'sentinel', 'id1')).toMatchObject({
    id: 'id1', name: 'Rook', classId: 'sentinel', hp: 100, maxHp: 100, level: 1, xp: 0, alloc: { power: 0, endurance: 0, speed: 0 },
  })
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
  // a pre-rebase (HP-30) save migrates to the HP-100 world, hp scaled in proportion (12/30 → 40/100)
  expect(r[0]).toMatchObject({ id: 'id1', hp: 40, maxHp: 100, consumables: STARTER_CONSUMABLES })
})

test('parseRoster migrates a v2 envelope to v3 (seeds level/xp/alloc)', () => {
  const env = JSON.stringify({ v: 2, chars: [{ id: 'a', name: 'A', classId: 'rogue', hp: 50, maxHp: 100, consumables: ['hp_std'] }] })
  expect(parseRoster(env)[0]).toEqual({ id: 'a', name: 'A', classId: 'rogue', hp: 50, maxHp: 100, level: 1, xp: 0, alloc: { power: 0, endurance: 0, speed: 0 }, consumables: ['hp_std'] })
})

test('parseRoster drops unsalvageable entries and clamps corrupt numerics', () => {
  const env = JSON.stringify({ v: 2, chars: [
    null,
    { name: 'no-id', classId: 'rogue' },
    { id: 'b', name: 'B', classId: 'rogue', hp: 999, maxHp: 100 }, // hp > maxHp → clamp
    { id: 'c', name: 'C', classId: 'rogue', hp: 'x', maxHp: 'y' }, // garbage numerics → defaults
  ] })
  const r = parseRoster(env)
  expect(r.map((c) => c.id)).toEqual(['b', 'c'])
  expect(r[0].hp).toBe(100)
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

// ---- progression (CRAWL §3): the XP curve, level-up application, effective stats ----
import { xpForLevel, maxHpForLevel, effectiveStats, pendingLevels, applyLevelUp, LEVEL_CAP, activeSlotsAt, passiveSlotsAt, activeUnlockLevel } from './save'

test('the loadout slot cadence: active 2→6 (L3/6/10/14), passive 1→3 (L8/16)', () => {
  expect([1, 2, 3, 5, 6, 9, 10, 13, 14, 21].map(activeSlotsAt)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
  expect([1, 7, 8, 15, 16, 21].map(passiveSlotsAt)).toEqual([1, 1, 2, 2, 3, 3])
  expect([0, 1, 2, 3, 4, 5].map(activeUnlockLevel)).toEqual([1, 1, 3, 6, 10, 14]) // when each active slot opens
})

test('the XP curve anchors: 110·L^1.7 (steepened 2026-06-14 for ~56 clears to ★), climbs polynomially', () => {
  expect(xpForLevel(1)).toBe(110) // need(1→2); onboarding hits L2 via the dummy's xp override
  expect(xpForLevel(2)).toBe(355) // need(2→3); the gauntlet's overrides sum to this → L3
  expect(xpForLevel(3)).toBe(710) // a first warren clear ≈ 1 level here, not 2
  expect(xpForLevel(4)).toBeGreaterThan(xpForLevel(3)) // monotonic
  expect(maxHpForLevel(1)).toBe(100)
  expect(maxHpForLevel(21)).toBe(200) // +5/level → 200 at cap
})

test('effectiveStats = parity base + allocated points', () => {
  const c = { ...makeChar('A', 'rogue', 'id'), alloc: { power: 6, endurance: 3, speed: 1 } }
  expect(effectiveStats(c)).toEqual({ power: 16, endurance: 13, speed: 11 })
})

test('pendingLevels counts only what the banked XP affords, capped at the cap', () => {
  const base = makeChar('A', 'rogue', 'id')
  expect(pendingLevels({ ...base, xp: 109 })).toBe(0) // one short of L2
  expect(pendingLevels({ ...base, xp: 110 })).toBe(1) // exactly L2
  expect(pendingLevels({ ...base, xp: 110 + 355 })).toBe(2) // L2 then L3
  expect(pendingLevels({ ...base, level: LEVEL_CAP, xp: 99999 })).toBe(0) // capped — no more
})

test('applyLevelUp spends one level of XP, bumps level + maxHp, banks the allocation', () => {
  const c = { ...makeChar('A', 'rogue', 'id'), xp: 115 }
  const up = applyLevelUp(c, { power: 3, endurance: 2, speed: 1 })
  expect(up.level).toBe(2)
  expect(up.xp).toBe(5) // 115 − 110
  expect(up.maxHp).toBe(105)
  expect(up.hp).toBe(105) // +5 level heal (was full at 100)
  expect(up.alloc).toEqual({ power: 3, endurance: 2, speed: 1 })
  expect(effectiveStats(up)).toEqual({ power: 13, endurance: 12, speed: 11 })
})
