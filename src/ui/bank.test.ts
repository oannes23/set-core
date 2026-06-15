/* The shared account store — pure transforms (no localStorage I/O here). Gold (the weightless pool)
   + Storage (the unified item bag) + the one-time starter stash. */

import { test, expect } from 'vitest'
import {
  addGold, spendGold, applyTithe, DEATH_TITHE,
  sanitizeAccount, parseAccount, DEFAULT_STORAGE_CAP, STARTER_STASH,
  addToStorage, addManyToStorage, removeFromStorage, takeFromStorage, expandStorage,
  storageFull, storageRoom, seedStash, type Account,
} from './bank'
import { makeItem } from '../engine/items'

const acct = (over: Partial<Account> = {}): Account => ({ gold: 0, storage: [], storageCap: DEFAULT_STORAGE_CAP, seeded: true, ...over })

// ---- gold (spread-preserving: safe on a full account, no storage churn) ----
test('addGold accumulates; a negative add is ignored (use spendGold to remove)', () => {
  expect(addGold(acct({ gold: 10 }), 25).gold).toBe(35)
  expect(addGold(acct({ gold: 10 }), -999).gold).toBe(10) // delta floors at 0 — never negative
})

test('spendGold clamps at the balance and reports affordability; storage is untouched', () => {
  const a = acct({ gold: 50, storage: [makeItem('consumable', 'hp_std', 'u1')] })
  const ok = spendGold(a, 30)
  expect(ok).toMatchObject({ ok: true })
  expect(ok.bank.gold).toBe(20)
  expect(ok.bank.storage).toHaveLength(1) // gold transforms preserve the bag
  expect(spendGold(a, 80)).toMatchObject({ ok: false }) // can't afford → unchanged
})

test('applyTithe forfeits 12% of banked gold (floored)', () => {
  expect(applyTithe(acct({ gold: 1000 })).bank.gold).toBe(880)
  expect(applyTithe(acct({ gold: 1000 })).lost).toBe(120)
  expect(DEATH_TITHE).toBe(0.12)
  expect(applyTithe(acct({ gold: 3 })).lost).toBe(0) // tiny pools lose nothing to the floor
})

// ---- parse / sanitize (never throw; v1 gold-only payloads migrate forward) ----
test('parse/sanitize never throw; garbage clamps; a v1 gold-only payload migrates to v2', () => {
  expect(parseAccount(null)).toEqual(acct({ seeded: false }))
  expect(parseAccount('not json')).toEqual(acct({ seeded: false }))
  // v1 had only { v, gold } — it sanitizes into an empty-storage v2 account, unseeded
  expect(parseAccount(JSON.stringify({ v: 1, gold: 250 }))).toEqual(acct({ gold: 250, seeded: false }))
  expect(sanitizeAccount({ gold: -5 }).gold).toBe(0)
  expect(sanitizeAccount({ gold: 12.9 }).gold).toBe(12)
})

test('sanitize drops corrupt items and keeps valid ones', () => {
  const a = sanitizeAccount({ gold: 0, storageCap: 20, storage: [
    { uid: 'u1', kind: 'consumable', refId: 'hp_std' }, // good
    { uid: 'u2', kind: 'weapon', refId: 'x' }, // bad kind → dropped
    { kind: 'gear', refId: 'sword' }, // missing uid → regenerated, kept
    null, 7, // junk → dropped
  ] })
  expect(a.storage).toHaveLength(2)
  expect(a.storage[0].refId).toBe('hp_std')
  expect(a.storage[1].uid).toBeTruthy() // a fresh uid was minted
})

// ---- storage (the unified bag) ----
test('addToStorage respects the cap and signals when full (the swap-or-discard trigger)', () => {
  let a = acct({ storageCap: 2 })
  a = addToStorage(a, makeItem('consumable', 'hp_std', 'u1')).account
  const second = addToStorage(a, makeItem('gear', 'sword', 'u2'))
  expect(second.ok).toBe(true)
  a = second.account
  expect(storageFull(a)).toBe(true)
  const third = addToStorage(a, makeItem('consumable', 'hp_minor', 'u3'))
  expect(third.ok).toBe(false) // full → unchanged, caller prompts triage
  expect(third.account.storage).toHaveLength(2)
})

test('addManyToStorage fills what fits and returns the overflow', () => {
  const a = acct({ storageCap: 2 })
  const items = [makeItem('consumable', 'a', 'u1'), makeItem('consumable', 'b', 'u2'), makeItem('consumable', 'c', 'u3')]
  const r = addManyToStorage(a, items)
  expect(r.account.storage.map((i) => i.uid)).toEqual(['u1', 'u2'])
  expect(r.overflow.map((i) => i.uid)).toEqual(['u3'])
})

test('removeFromstorage and takeFromStorage pull items out (the loadout draw)', () => {
  const a = acct({ storage: [makeItem('consumable', 'a', 'u1'), makeItem('consumable', 'b', 'u2'), makeItem('gear', 'c', 'u3')] })
  expect(removeFromStorage(a, 'u2').storage.map((i) => i.uid)).toEqual(['u1', 'u3'])
  const t = takeFromStorage(a, ['u1', 'u3', 'nope'])
  expect(t.taken.map((i) => i.uid)).toEqual(['u1', 'u3']) // unknown uid skipped
  expect(t.account.storage.map((i) => i.uid)).toEqual(['u2']) // the rest stay
})

test('expandStorage grows the cap (the gold-bought upgrade)', () => {
  expect(expandStorage(acct({ storageCap: 20 }), 5).storageCap).toBe(25)
  expect(storageRoom(acct({ storageCap: 20, storage: [makeItem('consumable', 'a', 'u1')] }))).toBe(19)
})

// ---- the one-time starter stash ----
test('seedStash grants the stash once and is idempotent (no create/delete farming)', () => {
  const fresh = acct({ seeded: false })
  const seeded = seedStash(fresh)
  expect(seeded.seeded).toBe(true)
  expect(seeded.storage).toHaveLength(STARTER_STASH.length)
  expect(seeded.storage.every((i) => i.kind === 'consumable')).toBe(true)
  // re-seeding a seeded account is a no-op (the flag is the once-per-account guard)
  expect(seedStash(seeded)).toBe(seeded)
  expect(seedStash(seeded).storage).toHaveLength(STARTER_STASH.length)
})

test('seedStash respects capacity defensively', () => {
  expect(seedStash(acct({ seeded: false, storageCap: 2 })).storage).toHaveLength(2)
})
