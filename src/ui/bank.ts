/* ui/bank — the SHARED ACCOUNT STORE (CRAWL §3 town-economy plan): ONE account-level vault for the
   whole roster — a Gold pool + an item Storage — under its OWN localStorage key, so it survives any
   hero's death (the tithe bites the gold; the run's carried gold + kept items bank into it on a safe
   exit). This is the B2 economy core. Pure transforms are exported for tests; storage I/O is
   best-effort (mirrors save.ts).

   GOLD is a weightless counter, separate from the item Storage by design (decided 2026-06-13): it
   never takes a slot — items are the slot game, gold is the pool. STORAGE holds `Item[]` (consumables
   AND gear share slots, CRAWL §3); the 3-slot delve loadout and the 10-slot run satchel draw FROM it.

   PERSISTENCE: the KEY is stable; the payload carries its schema version. v1 was gold-only
   `{ v, gold }`; v2 adds `{ storage, storageCap, seeded }`. The starter stash seeds ONCE PER ACCOUNT
   (the `seeded` flag — not per new hero, else create/delete would farm it). */

import { type Item, makeItem, sanitizeItem } from '../engine/items'

export interface Account {
  gold: number
  storage: Item[]
  storageCap: number // 20 baseline; gold-expandable at the shop (B4)
  seeded: boolean // has the one-time account starter stash been granted?
}
/** Back-compat alias — older call sites referred to the gold-only `Bank`. */
export type Bank = Account

const KEY = 'setcore.bank.v1' // stable across schema bumps (versioning lives in the payload)
const SCHEMA_V = 2 // 1 = { v, gold } · 2 = + storage / storageCap / seeded
export const DEATH_TITHE = 0.12 // a run-ending death costs 12% of BANKED gold (the exit ladder, §6)
export const DEFAULT_STORAGE_CAP = 20

/** The one-time, account-level starter stash (consumable refIds) — granted once per account on first
 *  load (NOT per hero). A gentle opener so a brand-new account has something to load into a loadout. */
export const STARTER_STASH: string[] = ['hp_std', 'hp_std', 'speed_std', 'stoneskin_std', 'hp_minor', 'hp_minor']

const emptyAccount = (): Account => ({ gold: 0, storage: [], storageCap: DEFAULT_STORAGE_CAP, seeded: false })

// ---- sanitize / parse (never throw) ----
export function sanitizeAccount(x: unknown): Account {
  if (typeof x !== 'object' || x === null) return emptyAccount()
  const a = x as Partial<Account>
  const gold = typeof a.gold === 'number' && Number.isFinite(a.gold) && a.gold > 0 ? Math.floor(a.gold) : 0
  const storage = Array.isArray(a.storage) ? a.storage.map(sanitizeItem).filter((i): i is Item => i !== null) : []
  const storageCap = typeof a.storageCap === 'number' && Number.isFinite(a.storageCap) && a.storageCap > 0 ? Math.floor(a.storageCap) : DEFAULT_STORAGE_CAP
  return { gold, storage: storage.slice(0, Math.max(storageCap, storage.length)), storageCap, seeded: a.seeded === true }
}
/** Back-compat: the old name returned a gold-only shape. Kept as a thin alias over the account. */
export const sanitizeBank = (x: unknown): Account => sanitizeAccount(x)

export function parseAccount(raw: string | null): Account {
  try {
    if (!raw) return emptyAccount()
    return sanitizeAccount(JSON.parse(raw)) // v1 { gold } sanitizes into v2 with empty storage / seeded:false
  } catch {
    return emptyAccount()
  }
}
export const parseBank = parseAccount

// ---- gold transforms (pure; spread-preserving so they're safe on a full Account) ----
export const addGold = (b: Account, n: number): Account => ({ ...b, gold: Math.max(0, b.gold + Math.max(0, Math.round(n))) })
/** Spend up to `n` (clamped at the balance); returns the new account + whether it could afford it. */
export function spendGold(b: Account, n: number): { bank: Account; ok: boolean } {
  const cost = Math.max(0, Math.round(n))
  if (cost > b.gold) return { bank: b, ok: false }
  return { bank: { ...b, gold: b.gold - cost }, ok: true }
}
/** The death tithe: forfeit a fraction of BANKED gold. Returns the new account + the amount lost. */
export function applyTithe(b: Account, frac = DEATH_TITHE): { bank: Account; lost: number } {
  const lost = Math.floor(b.gold * frac)
  return { bank: { ...b, gold: b.gold - lost }, lost }
}

// ---- storage transforms (pure; the unified item bag) ----
export const storageCount = (a: Account): number => a.storage.length
export const storageFull = (a: Account): boolean => a.storage.length >= a.storageCap
export const storageRoom = (a: Account): number => Math.max(0, a.storageCap - a.storage.length)

/** Add one item to Storage if there's room. `ok:false` (account unchanged) when full → the caller
 *  raises the swap-or-discard prompt (the run-inventory-full flow, CRAWL §3 town economy). */
export function addToStorage(a: Account, item: Item): { account: Account; ok: boolean } {
  if (storageFull(a)) return { account: a, ok: false }
  return { account: { ...a, storage: [...a.storage, item] }, ok: true }
}
/** Bank a batch of items into Storage, keeping as many as fit; returns what didn't fit (the triage
 *  overflow the return screen surfaces). Order-preserving; never throws. */
export function addManyToStorage(a: Account, items: Item[]): { account: Account; overflow: Item[] } {
  let acc = a
  const overflow: Item[] = []
  for (const it of items) {
    const r = addToStorage(acc, it)
    if (r.ok) acc = r.account
    else overflow.push(it)
  }
  return { account: acc, overflow }
}
export function removeFromStorage(a: Account, uid: string): Account {
  return { ...a, storage: a.storage.filter((i) => i.uid !== uid) }
}
/** Replace a Storage item in place (matched by uid) — the smith writes a re-crafted gear instance back.
 *  No-op if the uid isn't present (slot count unchanged either way). Pure. */
export function updateStorageItem(a: Account, item: Item): Account {
  return { ...a, storage: a.storage.map((i) => (i.uid === item.uid ? item : i)) }
}
/** Pull consumable instances OUT of Storage by refId (the delve loadout commit — consumables are
 *  fungible, so we match by refId, not uid; one instance removed per requested refId). Returns the
 *  refIds actually taken (skipping any no longer in stock) + the depleted account. Pure. */
export function takeConsumablesByRef(a: Account, refIds: string[]): { taken: string[]; account: Account } {
  const remaining = [...a.storage]
  const taken: string[] = []
  for (const refId of refIds) {
    const idx = remaining.findIndex((i) => i.kind === 'consumable' && i.refId === refId)
    if (idx >= 0) { taken.push(refId); remaining.splice(idx, 1) }
  }
  return { taken, account: { ...a, storage: remaining } }
}
/** Pull items OUT of Storage by uid (e.g. loading a delve loadout — the survivors return on exit).
 *  Returns the taken items (in request order, skipping unknown uids) + the depleted account. */
export function takeFromStorage(a: Account, uids: string[]): { taken: Item[]; account: Account } {
  const taken: Item[] = []
  const set = new Set(uids)
  for (const uid of uids) {
    const it = a.storage.find((i) => i.uid === uid && taken.every((t) => t.uid !== i.uid))
    if (it) taken.push(it)
  }
  return { taken, account: { ...a, storage: a.storage.filter((i) => !set.has(i.uid)) } }
}
/** Expand Storage capacity (the gold-bought slot upgrade, B4 Vault). */
export const expandStorage = (a: Account, by: number): Account => ({ ...a, storageCap: a.storageCap + Math.max(0, Math.round(by)) })

/** Storage expands in BLOCKS of 10, up to 100; the price is the SQUARE of the new total (CRAWL §3,
 *  settled 2026-06-13): 20→30 = 900g · 30→40 = 1600g · … · 90→100 = 10,000g (~38k all-in — the steady
 *  long-game sink). cost(cap) = (cap + 10)². */
export const STORAGE_SLOT_STEP = 10
export const STORAGE_SLOT_MAX = 100
export const slotUpgradeCost = (cap: number): number => (cap + STORAGE_SLOT_STEP) ** 2

/** Grant the one-time account starter stash (idempotent via the `seeded` flag — create/delete a hero
 *  cannot re-farm it). Trims to capacity defensively. Pure. */
export function seedStash(a: Account): Account {
  if (a.seeded) return a
  const items = STARTER_STASH.slice(0, a.storageCap).map((refId) => makeItem('consumable', refId))
  return { ...a, storage: [...a.storage, ...items].slice(0, a.storageCap), seeded: true }
}

// ---- I/O wrappers (best-effort) ----
export function loadAccount(): Account {
  let a: Account
  try { a = parseAccount(localStorage.getItem(KEY)) } catch { a = emptyAccount() }
  if (!a.seeded) { a = seedStash(a); saveAccount(a) } // seed the stash on first-ever load (or v1 migration)
  return a
}
/** Back-compat for the gold-era call sites (app.ts reads `loadBank().gold`). */
export const loadBank = loadAccount

export function saveAccount(a: Account): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_V, ...a }))
  } catch {
    /* storage unavailable (private mode / quota) — the in-memory account still works this session */
  }
}
export const saveBank = saveAccount

/** Bank N gold (load → add → save) and return the new total. */
export function bankGold(n: number): number {
  const a = addGold(loadAccount(), n)
  saveAccount(a)
  return a.gold
}
/** Apply the death tithe to the banked pool (load → tithe → save) and return what was lost. */
export function bankTithe(frac = DEATH_TITHE): number {
  const { bank, lost } = applyTithe(loadAccount(), frac)
  saveAccount(bank)
  return lost
}
