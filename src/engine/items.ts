/* engine/items — the unified INVENTORY ITEM (CRAWL §3 town-economy plan). ONE instance model for
   BOTH consumables and gear: the account Storage (cap 20) and the run satchel (cap 10) each hold
   `Item[]`. An item is a thin INSTANCE pointer — a `uid` (instance identity, so two stacks of the
   same potion are distinct slots), a `kind`, and the `refId` into the data tables (`CONSUMABLES`
   today; `GEAR` at B3). Gear roll/affix instance data (rarity, rolled affixes) joins this model at
   B3 as optional fields — adding them is non-breaking because consumers key off `kind`.

   Pure + dependency-free (no DOM, no data import): the loot roll mints items, Storage/satchel hold
   them, the UI renders them by looking `refId` up in the relevant table. Lives in `engine` (the
   shared pure layer) so both the engine (loot, delve satchel) and the UI (bank Storage) can import it. */

export type ItemKind = 'consumable' | 'gear'

/** One inventory instance. `refId` → CONSUMABLES[refId] (or GEAR[refId] at B3). */
export interface Item {
  uid: string // unique per instance (NOT the refId — duplicates are distinct slots)
  kind: ItemKind
  refId: string
}

/** A fresh instance id. UI/persistence-side, so plain Date/Math is fine (engine determinism lives
 *  in the seeded combat rng, not here). Mirrors save.ts `freshId`. */
export function freshUid(): string {
  return `i_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function makeItem(kind: ItemKind, refId: string, uid: string = freshUid()): Item {
  return { uid, kind, refId }
}

/** Validate one stored item; null = unsalvageable (dropped on load). A missing uid is regenerated
 *  rather than dropped — a real item with a lost id is still a real item. */
export function sanitizeItem(x: unknown): Item | null {
  if (typeof x !== 'object' || x === null) return null
  const it = x as Partial<Item>
  if (it.kind !== 'consumable' && it.kind !== 'gear') return null
  if (typeof it.refId !== 'string' || !it.refId) return null
  const uid = typeof it.uid === 'string' && it.uid ? it.uid : freshUid()
  return { uid, kind: it.kind, refId: it.refId }
}
