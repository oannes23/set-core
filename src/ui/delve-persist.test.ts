/* U2 (FABLE §6) — the live-delve recovery checkpoint. A PWA process kill / refresh mid-delve used to
   silently destroy the committed satchel consumables; now the run is persisted. These cover the PURE
   `sanitizeDelveRun` parse layer (garbage never throws → a stranded run can be safely recovered on
   boot); the localStorage I/O (save/load/clear) is best-effort and untested, matching bank.ts/save.ts. */

import { test, expect } from 'vitest'
import { sanitizeDelveRun } from './delve-persist'
import { makeItem, type GearInstance } from '../engine/items'
import type { DelveRun } from './delve-run'

const sampleRun = (): DelveRun => ({
  d: { dungeonId: 'goblin_warren', bossRoll: 42, room: 3, sinceElite: 1, bossFound: false },
  bag: ['potion_heal', 'scroll_bolt'],
  tier: 'elite',
  gold: 137,
  gearFound: [makeItem('gear', 'sword_iron') as GearInstance],
  gearPity: 2,
})

test('sanitizeDelveRun round-trips a clean run through JSON intact', () => {
  const run = sampleRun()
  const back = sanitizeDelveRun(JSON.parse(JSON.stringify({ v: 1, ...run })))
  expect(back).not.toBeNull()
  expect(back!.d).toEqual(run.d)
  expect(back!.bag).toEqual(run.bag)
  expect(back!.tier).toBe('elite')
  expect(back!.gold).toBe(137)
  expect(back!.gearPity).toBe(2)
  expect(back!.gearFound).toHaveLength(1)
  expect(back!.gearFound[0].kind).toBe('gear')
})

test('sanitizeDelveRun rejects garbage / a missing delve-state (never throws)', () => {
  expect(sanitizeDelveRun(null)).toBeNull()
  expect(sanitizeDelveRun('nope')).toBeNull()
  expect(sanitizeDelveRun({})).toBeNull() // no `d`
  expect(sanitizeDelveRun({ d: { room: 1 } })).toBeNull() // dungeonId missing
})

test('sanitizeDelveRun scrubs corrupt fields to safe defaults', () => {
  const dirty = {
    d: { dungeonId: 'x', bossRoll: NaN, room: -5, sinceElite: 'no', bossFound: 'yes' },
    bag: ['ok', 42, null, 'also_ok'],
    tier: 'bogus',
    gold: -99,
    gearFound: ['not an item', { kind: 'consumable', refId: 'p' }],
    gearPity: Infinity,
  }
  const r = sanitizeDelveRun(dirty)!
  expect(r).not.toBeNull()
  expect(r.d.room).toBe(1) // clamped up from a negative
  expect(r.d.bossRoll).toBe(0) // NaN → 0
  expect(r.d.sinceElite).toBe(0)
  expect(r.d.bossFound).toBe(false) // only literal true counts
  expect(r.bag).toEqual(['ok', 'also_ok']) // non-strings dropped
  expect(r.tier).toBe('minion') // unknown tier → the safe default
  expect(r.gold).toBe(0) // negative → 0
  expect(r.gearFound).toHaveLength(0) // a consumable is not gear; a string isn't an item
  expect(r.gearPity).toBe(0) // non-finite → 0
})
