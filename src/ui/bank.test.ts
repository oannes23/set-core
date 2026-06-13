/* The shared account bank — pure transforms (no localStorage I/O here). */

import { test, expect } from 'vitest'
import { addGold, spendGold, applyTithe, sanitizeBank, parseBank, DEATH_TITHE } from './bank'

test('addGold accumulates; a negative add is ignored (use spendGold to remove)', () => {
  expect(addGold({ gold: 10 }, 25).gold).toBe(35)
  expect(addGold({ gold: 10 }, -999).gold).toBe(10) // the delta floors at 0 — no-op, never negative
})

test('spendGold clamps at the balance and reports affordability', () => {
  expect(spendGold({ gold: 50 }, 30)).toEqual({ bank: { gold: 20 }, ok: true })
  expect(spendGold({ gold: 50 }, 80)).toEqual({ bank: { gold: 50 }, ok: false }) // can't afford → unchanged
})

test('applyTithe forfeits 12% of banked gold (floored)', () => {
  expect(applyTithe({ gold: 1000 })).toEqual({ bank: { gold: 880 }, lost: 120 })
  expect(DEATH_TITHE).toBe(0.12)
  expect(applyTithe({ gold: 3 }).lost).toBe(0) // tiny pools lose nothing to the floor
})

test('parse/sanitize never throw and clamp garbage to 0', () => {
  expect(parseBank(null)).toEqual({ gold: 0 })
  expect(parseBank('not json')).toEqual({ gold: 0 })
  expect(parseBank(JSON.stringify({ v: 1, gold: 250 }))).toEqual({ gold: 250 })
  expect(sanitizeBank({ gold: -5 })).toEqual({ gold: 0 })
  expect(sanitizeBank({ gold: 12.9 })).toEqual({ gold: 12 })
})
