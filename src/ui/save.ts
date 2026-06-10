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

import { DEFAULT_PLAYER_MAX } from '../engine/state'

export interface SavedChar {
  id: string
  name: string
  classId: string
  hp: number
  maxHp: number
  consumables: string[] // the 3-slot consumable loadout (interim — becomes run-state in B2, see TODO)
  // grows later: level/xp, gold, abilities[], gear{}
}

const KEY = 'setcore.roster.v1' // stable — versioning lives in the payload envelope, not the key
const SCHEMA_V = 2 // 1 = legacy bare SavedChar[] · 2 = { v, chars } envelope
export const DEFAULT_MAX_HP = DEFAULT_PLAYER_MAX
export const CONSUMABLE_SLOTS = 3
export const STARTER_CONSUMABLES = ['hp_std', 'speed_std', 'stoneskin_std'] // a class-agnostic opener

interface Envelope { v: number; chars: unknown[] }

/** v(n) → v(n+1) payload migrations. One entry per schema bump; `migrate` folds them in order.
 *  (v1→v2 is the envelope-wrapping itself, handled in parseRoster.) */
const MIGRATIONS: Record<number, (e: Envelope) => Envelope> = {
  // example for the next bump:
  // 2: (e) => ({ v: 3, chars: e.chars.map((c) => ({ ...(c as object), gold: 0 })) }),
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
  const maxHp = clampInt(c.maxHp, 1, 999, DEFAULT_MAX_HP)
  const hp = clampInt(c.hp, 0, maxHp, maxHp)
  const consumables = Array.isArray(c.consumables)
    ? c.consumables.filter((s): s is string => typeof s === 'string').slice(0, CONSUMABLE_SLOTS)
    : STARTER_CONSUMABLES.slice()
  return { id: c.id, name: c.name, classId: c.classId, hp, maxHp, consumables }
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
export function makeChar(name: string, classId: string, id: string, maxHp = DEFAULT_MAX_HP): SavedChar {
  return { id, name, classId, hp: maxHp, maxHp, consumables: STARTER_CONSUMABLES.slice() }
}

// ---- convenience wrappers (load → transform → save) ----
export function upsertChar(c: SavedChar): void { saveRoster(upsert(loadRoster(), c)) }
export function deleteChar(id: string): void { saveRoster(remove(loadRoster(), id)) }
/** A fresh id — UI-side, so plain Date/Math is fine (the engine's determinism lives elsewhere). */
export function freshId(): string { return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}` }
