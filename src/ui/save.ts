/* ui/save — the meta-persistence layer (the character roster), separate from the per-run replay seam
   (session.ts). A character is what persists between matches: identity (name/class) + state that will
   grow (HP first → inventory / gear / progression). localStorage-backed; UI-only (the one engine import
   is a constant). Pure roster transforms + the parse/migrate path are exported for testing; storage I/O
   is best-effort.

   PERSISTENCE CONTRACT: the storage KEY is stable; the PAYLOAD carries its own schema version in an
   envelope `{ v, chars }`. Every shape change bumps SCHEMA_V and adds one v→v+1 entry to MIGRATIONS —
   never a new key (which orphans saves) and never an ad-hoc inline normalize. Unknown/corrupt characters
   are dropped (not crashed on); numeric fields are clamped. The account-level bank store (gold/storage,
   TODO §town-economy) will be a SEPARATE key with this same envelope pattern. */

import { DEFAULT_PLAYER_MAX, BASE_STATS, type StatBlock } from '../engine/state'
import { sanitizeItem, isGear, EQUIP_SLOTS, type EquipSlot, type GearInstance } from '../engine/items'
import { PROG } from '../engine/progression'

/** A character's allocated stat points (cumulative across level-ups; +4/level, ≤3/stat — BALANCE.md §8). */
export interface StatAlloc { power: number; endurance: number; speed: number }

export interface SavedChar {
  id: string
  name: string
  classId: string
  hp: number
  maxHp: number // = maxHpForLevel(level); the single source of truth is `level`
  level: number // 1..LEVEL_CAP (21 = ★)
  xp: number // banked progress toward the NEXT level (always banks, even on death)
  alloc: StatAlloc // points distributed at level-ups; effective stats = BASE_STATS + alloc
  consumables: string[] // the remembered consumable loadout (refIds, ≤ CONSUMABLE_SLOTS) — picked FROM
  // Storage stock at the dungeon-select picker + re-validated against ownership each render; committed
  // OUT of Storage into the run satchel at delve start (Phase 2 economy). Not the live satchel — that's DelveRun.bag.
  equipped: Equipped // §7 gear: the 5 equip slots (chunk ① embeds the instance; B3② may switch to Storage uid-refs)
  // grows later: gold, abilities[], wounds[] (the injury layer)
}

/** The 5 equip slots → the equipped gear instance (embedded for chunk ①; empty slots omitted). */
export type Equipped = Partial<Record<EquipSlot, GearInstance>>

const KEY = 'setcore.roster.v1' // stable — versioning lives in the payload envelope, not the key
const SCHEMA_V = 4 // 1 = legacy bare array · 2 = { v, chars } envelope · 3 = + level/xp/alloc · 4 = + equipped gear
export const DEFAULT_MAX_HP = DEFAULT_PLAYER_MAX
export const CONSUMABLE_SLOTS = PROG.consumableSlots
export const STARTER_CONSUMABLES = PROG.starterConsumables // a class-agnostic opener

// --- PROGRESSION (content/progression.yaml; CRAWL §3 / TUNING.md, sim-derived 2026-06-12) ---
export const LEVEL_CAP = PROG.levelCap // numeric to cap−1; cap renders as ★
export const HP_PER_LEVEL = PROG.hpPerLevel // 100 → 200 at cap
/** XP needed to climb FROM `level` to level+1: polynomial 110·L^1.7 (geometric walls off — §3),
 *  display-rounded to 5s. L1→2 = 110, L2→3 = 355, L3→4 = 710. Base steepened 55→80→**110**
 *  (2026-06-14): at 55 a first warren clear gave ~2 levels (too fast post-L3); the 110 base targets
 *  **~56 level-matched dungeon clears to ★** (the 50–60 goal — sim §8) while still keeping that first
 *  clear ≈ 1 level. The base RISES because foe XP income rises with dungeon level (§8); L^1.7 keeps
 *  the requirement outpacing income. Onboarding (dummy→L2, gauntlet→L3) holds via the teaching foes'
 *  `xp` overrides, re-tuned to the new steps (game-data.ts). */
export function xpForLevel(level: number): number {
  const { base, exponent, roundTo } = PROG.xp
  return Math.round((base * Math.pow(level, exponent)) / roundTo) * roundTo
}
export const maxHpForLevel = (level: number): number => DEFAULT_MAX_HP + HP_PER_LEVEL * (level - 1)
/** Combat statline = the parity-line base + the points the player has allocated. */
export function effectiveStats(c: SavedChar): StatBlock {
  return { power: BASE_STATS.power + c.alloc.power, endurance: BASE_STATS.endurance + c.alloc.endurance, speed: BASE_STATS.speed + c.alloc.speed }
}
// --- the LOADOUT slot cadence (CRAWL §3): active slots 2→6 (open at L3/6/10/14), passive 1→3 (L8/16).
// Combat uses the first `activeSlotsAt(level)` of the class kit (capped by the kit) → your kit GROWS as you
// level. (Stored per-character loadout choice arrives when class kits exceed the slot caps — future content.)
const ACTIVE_UNLOCKS = PROG.activeUnlocks // levels the 3rd…6th active slots open (1st + 2nd are class starters)
const PASSIVE_UNLOCKS = PROG.passiveUnlocks // levels the 2nd / 3rd passive slots open (1st is the signature)
export const ACTIVE_SLOT_CAP = PROG.activeSlotCap
export const PASSIVE_SLOT_CAP = PROG.passiveSlotCap
export function activeSlotsAt(level: number): number {
  return Math.min(ACTIVE_SLOT_CAP, 2 + ACTIVE_UNLOCKS.filter((l) => level >= l).length)
}
export function passiveSlotsAt(level: number): number {
  return Math.min(PASSIVE_SLOT_CAP, 1 + PASSIVE_UNLOCKS.filter((l) => level >= l).length)
}
/** The level at which the (0-based) active slot index opens — for the "locked · Lv N" sheet display. */
export function activeUnlockLevel(i: number): number {
  return i < 2 ? 1 : (ACTIVE_UNLOCKS[i - 2] ?? LEVEL_CAP)
}

/** How many level-ups the banked XP currently affords (capped at LEVEL_CAP) — pure, non-mutating. */
export function pendingLevels(c: SavedChar): number {
  let lvl = c.level
  let xp = c.xp
  let gained = 0
  while (lvl < LEVEL_CAP && xp >= xpForLevel(lvl)) { xp -= xpForLevel(lvl); lvl++; gained++ }
  return gained
}
/** Bank kill-XP onto a hero (pure, non-mutating): adds `amount` to banked XP — EXCEPT at the level
 *  cap, where XP stops accruing (nothing left to buy). Returns a NEW char; the caller persists +
 *  tallies the run total. (The kill's XP is COMPUTED upstream by engine `computeXP`.) */
export function addXP(c: SavedChar, amount: number): SavedChar {
  if (amount <= 0 || c.level >= LEVEL_CAP) return c
  return { ...c, xp: c.xp + amount }
}
/** Apply ONE level-up with the player's chosen allocation (deltas summing to 4, **each ≤3** —
 *  freely distributed: 3/1/0 · 2/2/0 · 2/1/1, per CRAWL §3; tempered from +6 — BALANCE.md §8 dec.7,
 *  so gear overtakes innate late). The allocation rule is enforced UI-side (the level-up modal);
 *  this transform just adds the delta. Spends one level's XP, bumps level + maxHp (+HP_PER_LEVEL to
 *  current HP too, a small level heal). Returns a NEW char (pure). Caller gates on pendingLevels > 0. */
export function applyLevelUp(c: SavedChar, delta: StatAlloc): SavedChar {
  const level = Math.min(LEVEL_CAP, c.level + 1)
  const maxHp = maxHpForLevel(level)
  return {
    ...c,
    level,
    xp: Math.max(0, c.xp - xpForLevel(c.level)),
    alloc: { power: c.alloc.power + delta.power, endurance: c.alloc.endurance + delta.endurance, speed: c.alloc.speed + delta.speed },
    maxHp,
    hp: Math.min(maxHp, c.hp + HP_PER_LEVEL),
  }
}

interface Envelope { v: number; chars: unknown[] }

/** v(n) → v(n+1) payload migrations. One entry per schema bump; `migrate` folds them in order.
 *  (v1→v2 is the envelope-wrapping itself, handled in parseRoster.) */
const MIGRATIONS: Record<number, (e: Envelope) => Envelope> = {
  // v2→v3: seed the progression fields (level 1, no XP, no allocated points)
  2: (e) => ({ v: 3, chars: e.chars.map((c) => ({ ...(c as object), level: 1, xp: 0, alloc: { power: 0, endurance: 0, speed: 0 } })) }),
  // v3→v4: seed empty equip slots (existing heroes start with no gear)
  3: (e) => ({ v: 4, chars: e.chars.map((c) => ({ ...(c as object), equipped: {} })) }),
}

function migrate(env: Envelope): Envelope {
  let cur = env
  while (cur.v < SCHEMA_V && MIGRATIONS[cur.v]) cur = MIGRATIONS[cur.v](cur)
  return cur
}

function clampInt(x: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : dflt
  return Math.max(lo, Math.min(hi, n))
}

/** Validate + clamp one stored character; null = unsalvageable (dropped from the roster). */
export function sanitizeChar(x: unknown): SavedChar | null {
  if (typeof x !== 'object' || x === null) return null
  const c = x as Partial<SavedChar>
  if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || typeof c.classId !== 'string') return null
  const level = clampInt(c.level, 1, LEVEL_CAP, 1)
  const xp = Math.max(0, typeof c.xp === 'number' && Number.isFinite(c.xp) ? Math.round(c.xp) : 0)
  const a = (c.alloc ?? {}) as Partial<StatAlloc>
  const alloc: StatAlloc = { power: clampInt(a.power, 0, 999, 0), endurance: clampInt(a.endurance, 0, 999, 0), speed: clampInt(a.speed, 0, 999, 0) }
  // maxHp derives from level (the single source of truth) — except a pre-rebase HP-30 save, whose
  // hp is scaled into the HP-100 world before the level baseline applies.
  const maxHp = maxHpForLevel(level)
  let hp = clampInt(c.hp, 0, maxHp, maxHp)
  if (c.maxHp === 30) hp = Math.min(maxHp, Math.round((hp / 30) * DEFAULT_MAX_HP))
  const consumables = Array.isArray(c.consumables)
    ? c.consumables.filter((s): s is string => typeof s === 'string').slice(0, CONSUMABLE_SLOTS)
    : STARTER_CONSUMABLES.slice()
  return { id: c.id, name: c.name, classId: c.classId, hp, maxHp, level, xp, alloc, consumables, equipped: sanitizeEquipped(c.equipped) }
}

/** Validate the 5 equip slots: each value must sanitize to a GEAR item, else the slot is dropped. */
export function sanitizeEquipped(x: unknown): Equipped {
  const out: Equipped = {}
  if (typeof x !== 'object' || x === null) return out
  const rec = x as Record<string, unknown>
  for (const slot of EQUIP_SLOTS) {
    const it = sanitizeItem(rec[slot])
    if (it && isGear(it)) out[slot] = it
  }
  return out
}

/** Parse a raw stored payload into a clean roster: envelope-or-legacy detect → migrate → sanitize.
 *  Pure (exported for tests); never throws. */
export function parseRoster(raw: string | null): SavedChar[] {
  try {
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    // legacy v1 was a bare array — wrapping it IS the 1→2 migration
    const env: Envelope | null = Array.isArray(data)
      ? { v: 2, chars: data }
      : data && typeof data === 'object' && typeof (data as Envelope).v === 'number' && Array.isArray((data as Envelope).chars)
        ? (data as Envelope)
        : null
    if (!env) return []
    return migrate(env).chars.map(sanitizeChar).filter((c): c is SavedChar => c !== null)
  } catch {
    return []
  }
}

/** Load the saved roster (best-effort; never throws). */
export function loadRoster(): SavedChar[] {
  try {
    return parseRoster(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

/** Persist the roster (best-effort; a storage failure is non-fatal). Always writes the current envelope. */
export function saveRoster(roster: SavedChar[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_V, chars: roster }))
  } catch {
    /* storage unavailable (private mode / quota) — the in-memory roster still works this session */
  }
}

// ---- pure roster transforms (testable; no I/O) ----
export function upsert(roster: SavedChar[], c: SavedChar): SavedChar[] {
  const i = roster.findIndex((x) => x.id === c.id)
  if (i < 0) return [...roster, c]
  const next = roster.slice()
  next[i] = c
  return next
}
export function remove(roster: SavedChar[], id: string): SavedChar[] {
  return roster.filter((c) => c.id !== id)
}
export function makeChar(name: string, classId: string, id: string): SavedChar {
  return { id, name, classId, hp: DEFAULT_MAX_HP, maxHp: DEFAULT_MAX_HP, level: 1, xp: 0, alloc: { power: 0, endurance: 0, speed: 0 }, consumables: STARTER_CONSUMABLES.slice(), equipped: {} }
}

// ---- convenience wrappers (load → transform → save) ----
export function upsertChar(c: SavedChar): void { saveRoster(upsert(loadRoster(), c)) }
export function deleteChar(id: string): void { saveRoster(remove(loadRoster(), id)) }
/** A fresh id — UI-side, so plain Date/Math is fine (the engine's determinism lives elsewhere). */
// the monotonic `idSeq` GUARANTEES intra-session uniqueness (Date.now() is constant in a tight loop, so
// Math.random() alone birthday-collides); the random suffix keeps cross-tab/session collision unlikely.
let idSeq = 0
export function freshId(): string { return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}_${(idSeq++).toString(36)}` }
