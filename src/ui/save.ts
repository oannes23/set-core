/* ui/save — the meta-persistence layer (the character roster), separate from the per-run replay seam
   (session.ts). A character is what persists between matches: identity (name/class) + state that will
   grow (HP first → inventory / gear / progression). localStorage-backed; UI-only, never touches the
   deterministic engine. Pure roster transforms are exported for testing; storage I/O is best-effort. */

export interface SavedChar {
  id: string
  name: string
  classId: string
  hp: number
  maxHp: number
  consumables: string[] // the 3-slot consumable loadout (re-equippable in the hub; refreshes each delve)
  // grows later: level/xp, gold, abilities[], gear{}
}

const KEY = 'setcore.roster.v1'
export const DEFAULT_MAX_HP = 30 // matches createCombat's default playerMax
export const CONSUMABLE_SLOTS = 3
export const STARTER_CONSUMABLES = ['heal_potion', 'speed_potion', 'stoneskin'] // a class-agnostic opener

/** Load the saved roster (best-effort; never throws). */
export function loadRoster(): SavedChar[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(arr)) return []
    // normalize: older saves predate the consumables field
    return (arr as SavedChar[]).map((c) => ({ ...c, consumables: Array.isArray(c.consumables) ? c.consumables : STARTER_CONSUMABLES.slice() }))
  } catch {
    return []
  }
}

/** Persist the roster (best-effort; a storage failure is non-fatal). */
export function saveRoster(roster: SavedChar[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(roster))
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
