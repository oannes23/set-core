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

/** A character's allocated stat points (cumulative across level-ups; +3/+2/+1 per level). */
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
  consumables: string[] // the 3-slot consumable loadout (interim — becomes run-state in B2, see TODO)
  // grows later: gold, abilities[], gear{}
}

const KEY = 'setcore.roster.v1' // stable — versioning lives in the payload envelope, not the key
const SCHEMA_V = 3 // 1 = legacy bare array · 2 = { v, chars } envelope · 3 = + level/xp/alloc
export const DEFAULT_MAX_HP = DEFAULT_PLAYER_MAX
export const CONSUMABLE_SLOTS = 3
export const STARTER_CONSUMABLES = ['hp_std', 'speed_std', 'stoneskin_std'] // a class-agnostic opener

// --- PROGRESSION (CRAWL §3 / TUNING.md, sim-derived 2026-06-12) ---
export const LEVEL_CAP = 21 // numeric to 20; 21 renders as ★
export const HP_PER_LEVEL = 5 // 100 → 200 at cap
/** XP needed to climb FROM `level` to level+1: polynomial 110·L^1.7 (geometric walls off — §3),
 *  display-rounded to 5s. L1→2 = 110, L2→3 = 355, L3→4 = 710. Base steepened 55→80→**110**
 *  (2026-06-14): at 55 a first warren clear gave ~2 levels (too fast post-L3); the 110 base targets
 *  **~56 level-matched dungeon clears to ★** (the 50–60 goal — sim §8) while still keeping that first
 *  clear ≈ 1 level. The base RISES because foe XP income rises with dungeon level (§8); L^1.7 keeps
 *  the requirement outpacing income. Onboarding (dummy→L2, gauntlet→L3) holds via the teaching foes'
 *  `xp` overrides, re-tuned to the new steps (game-data.ts). */
export function xpForLevel(level: number): number {
  return Math.round((110 * Math.pow(level, 1.7)) / 5) * 5
}
export const maxHpForLevel = (level: number): number => DEFAULT_MAX_HP + HP_PER_LEVEL * (level - 1)
/** Combat statline = the parity-line base + the points the player has allocated. */
export function effectiveStats(c: SavedChar): StatBlock {
  return { power: BASE_STATS.power + c.alloc.power, endurance: BASE_STATS.endurance + c.alloc.endurance, speed: BASE_STATS.speed + c.alloc.speed }
}
// --- the LOADOUT slot cadence (CRAWL §3): active slots 2→6 (open at L3/6/10/14), passive 1→3 (L8/16).
// Combat uses the first `activeSlotsAt(level)` of the class kit (capped by the kit) → your kit GROWS as you
// level. (Stored per-character loadout choice arrives when class kits exceed the slot caps — future content.)
const ACTIVE_UNLOCKS = [3, 6, 10, 14] // levels the 3rd…6th active slots open (1st + 2nd are class starters)
const PASSIVE_UNLOCKS = [8, 16] // levels the 2nd / 3rd passive slots open (1st is the signature)
export const ACTIVE_SLOT_CAP = 6
export const PASSIVE_SLOT_CAP = 3
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
/** Apply ONE level-up with the player's chosen allocation (deltas summing to 6, **each ≤3** —
 *  freely distributed: 3/3/0 · 2/2/2 · 3/2/1, per CRAWL §3, revised 2026-06-14; the rigid
 *  +3/+2/+1 permutation is retired). The allocation rule is enforced UI-side (the level-up modal);
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
  return { id: c.id, name: c.name, classId: c.classId, hp, maxHp, level, xp, alloc, consumables }
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
  return { id, name, classId, hp: DEFAULT_MAX_HP, maxHp: DEFAULT_MAX_HP, level: 1, xp: 0, alloc: { power: 0, endurance: 0, speed: 0 }, consumables: STARTER_CONSUMABLES.slice() }
}

// ---- convenience wrappers (load → transform → save) ----
export function upsertChar(c: SavedChar): void { saveRoster(upsert(loadRoster(), c)) }
export function deleteChar(id: string): void { saveRoster(remove(loadRoster(), id)) }
/** A fresh id — UI-side, so plain Date/Math is fine (the engine's determinism lives elsewhere). */
export function freshId(): string { return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}` }
