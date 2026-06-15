/* engine/items — the unified INVENTORY ITEM (CRAWL §3 town-economy plan). ONE instance model for
   BOTH consumables and gear: the account Storage (cap 20) and the run satchel (cap 10) each hold
   `Item[]`. An item is a thin INSTANCE pointer — a `uid` (instance identity, so two stacks of the
   same potion are distinct slots), a `kind`, and the `refId` into the data tables (`CONSUMABLES`
   today; `GEAR` at B3). Gear roll/affix instance data (rarity, rolled affixes) joins this model at
   B3 as optional fields — adding them is non-breaking because consumers key off `kind`.

   Pure + dependency-free (no DOM, no data import): the loot roll mints items, Storage/satchel hold
   them, the UI renders them by looking `refId` up in the relevant table. Lives in `engine` (the
   shared pure layer) so both the engine (loot, delve satchel) and the UI (bank Storage) can import it. */

import type { Trigger, Condition } from '../data/schema' // type-only — stays runtime-dependency-free

export type ItemKind = 'consumable' | 'gear'

/** One inventory instance. `refId` → CONSUMABLES[refId] (consumable) or GEAR[refId] (gear base type). */
export interface Item {
  uid: string // unique per instance (NOT the refId — duplicates are distinct slots)
  kind: ItemKind
  refId: string
}

// ---- GEAR (CRAWL §7 clean-slate; affix layer = the Arena raid) ----

export type Rarity = 'grey' | 'white' | 'green' | 'blue' | 'purple' | 'orange'
export const RARITIES: Rarity[] = ['grey', 'white', 'green', 'blue', 'purple', 'orange']

/** Rarity → base-rider multiplier + the INVERSE affix budget (fewer affixes hit harder; §7).
 *  First-cut numbers, GATED by the coupled sim pass (chunk ②) — the shape is what's settled. */
export interface RarityTier { riderMult: number; maxAffixes: number; perAffixPower: number }
export const RARITY: Record<Rarity, RarityTier> = {
  grey: { riderMult: 0, maxAffixes: 0, perAffixPower: 0 },
  white: { riderMult: 1, maxAffixes: 1, perAffixPower: 1.4 },
  green: { riderMult: 2, maxAffixes: 2, perAffixPower: 1.0 },
  blue: { riderMult: 3, maxAffixes: 3, perAffixPower: 0.7 },
  purple: { riderMult: 4, maxAffixes: 4, perAffixPower: 0.6 },
  orange: { riderMult: 5, maxAffixes: 5, perAffixPower: 0.5 },
}

export type StatKey = 'power' | 'endurance' | 'speed'

/** An affix = a labelled bundle of EXISTING component types (the unified model — §7). No new
 *  machinery: `trigger` reuses the trap/bus shape, `ability` the ability registry, `stat` a flat ±. */
/** A player-favourable ON-MATCH proc: a condition on the matched set → a player effect (the affix-proc
 *  engine fires these like class passives, via condMet + ops). Effects map 1:1 to ops.ts functions. */
export type ProcEffect =
  | { kind: 'damage'; amount: number } // direct foe damage
  | { kind: 'mana'; amount: number; color?: number } // color omitted → the matched mono colour
  | { kind: 'block'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'charges'; amount: number }
  | { kind: 'delay'; seconds: number } // extend the round (buy time)
export interface AffixProc { when?: Condition; effect: ProcEffect; label?: string }

export type AffixComponent =
  | { c: 'stat'; stat: StatKey; amount: number } // incl. negative (cursed) + off-stat patches
  | { c: 'rider'; riders: Partial<Riders> } // scoped per-card riders (fold via gearRiders — already live)
  | { c: 'proc'; proc: AffixProc } // on-match player proc (the affix-proc engine — LIVE)
  | { c: 'trigger'; trigger: Trigger } // alt-verb / foe-shape trigger — STAGED
  | { c: 'ability'; abilityId: string } // purple+ granted ability — STAGED
/** An affix instance: `label` is the SYSTEM-descriptive key (dev mode shows it; normal play maps it
 *  to the thematic name via the affix catalog). `components` realize the mechanic (the unified model). */
export interface Affix { id: string; label: string; components: AffixComponent[] }

export type EquipSlot = 'weapon' | 'armor' | 'relic' | 'trinket1' | 'trinket2'
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'relic', 'trinket1', 'trinket2']

/** A gear inventory instance. `refId` → the GEAR base-type catalog (slot/school/rider/native stat). */
export interface GearInstance extends Item {
  kind: 'gear'
  rarity: Rarity
  lootTier: number // foe lvl + dungeon lvl → affix MAGNITUDE scalar (chunk ②)
  affixes: Affix[] // length ≤ RARITY[rarity].maxAffixes; the shortfall = empty slots (smith Enchant)
}

export function isGear(it: Item): it is GearInstance {
  return it.kind === 'gear'
}

/** The flat per-card RIDERS gear adds to a matched set — applied AFTER the rate() contest (§7), so
 *  bounded. Chunk ①: the school-agnostic BASE riders (the color/match-TYPE scoping rides chunk ②). */
export interface Riders { atkDamagePerCard: number; blockPerDefendCard: number; manaPerMatch: number }
export const NO_RIDERS: Riders = { atkDamagePerCard: 0, blockPerDefendCard: 0, manaPerMatch: 0 }

/** A fresh instance id. UI/persistence-side, so plain Date/Math is fine (engine determinism lives
 *  in the seeded combat rng, not here). Mirrors save.ts `freshId`. */
export function freshUid(): string {
  return `i_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function makeItem(kind: ItemKind, refId: string, uid: string = freshUid()): Item {
  return { uid, kind, refId }
}

/** Validate one stored item; null = unsalvageable (dropped on load). A missing uid is regenerated
 *  rather than dropped — a real item with a lost id is still a real item. Gear carries its instance
 *  roll (rarity/lootTier/affixes); unknown rarity clamps to grey, affixes light-validated. */
export function sanitizeItem(x: unknown): Item | null {
  if (typeof x !== 'object' || x === null) return null
  const it = x as { uid?: unknown; kind?: unknown; refId?: unknown; rarity?: unknown; lootTier?: unknown; affixes?: unknown }
  if (it.kind !== 'consumable' && it.kind !== 'gear') return null
  if (typeof it.refId !== 'string' || !it.refId) return null
  const uid = typeof it.uid === 'string' && it.uid ? it.uid : freshUid()
  if (it.kind === 'gear') {
    const rarity: Rarity = RARITIES.includes(it.rarity as Rarity) ? (it.rarity as Rarity) : 'grey'
    const lootTier = typeof it.lootTier === 'number' && Number.isFinite(it.lootTier) ? Math.max(0, Math.round(it.lootTier)) : 0
    const affixes = Array.isArray(it.affixes) ? it.affixes.filter(isAffix).slice(0, RARITY[rarity].maxAffixes) : []
    const g: GearInstance = { uid, kind: 'gear', refId: it.refId, rarity, lootTier, affixes }
    return g
  }
  return { uid, kind: 'consumable', refId: it.refId }
}

/** Light affix shape-check (structural, not deep content validation). */
function isAffix(x: unknown): x is Affix {
  if (typeof x !== 'object' || x === null) return false
  const a = x as Partial<Affix>
  return typeof a.id === 'string' && typeof a.label === 'string' && Array.isArray(a.components)
}
