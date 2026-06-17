/* data/gear — the GEAR BASE-TYPE catalog (CRAWL §7). A base type defines a slot's identity: its
   per-rarity-step RIDER (×RARITY[rarity].riderMult on a GearInstance), a small slot-aligned NATIVE
   stat (weapon→Power, armor→Endurance, trinket→Speed — so a full kit spreads P/E/S), school, and the
   §7 match-TYPE it rewards. Pure content (YAML-portable like the rest of data/); a GearInstance's
   `refId` indexes this catalog.

   The BASE riders (atk-damage / block / mana per match) + native stats apply in combat. The color/
   match-TYPE SCOPING is LIVE (2026-06-16): a weapon's base rider fires only when the matched set's
   colour matches its matchType (Axe→Fire/mono-red, Mace→Frost, Spear/Staff→Nature, Sword→Rainbow,
   Wand→Fire) — see engine/gear.gearRiders (scoped lane) + engine/resolve. Armor/relic block + caster
   relic/armor mana have no matchType → unscoped.

   Content now lives in content/gear.yaml (MODDING.md Phase 1); this module loads it + keeps the
   types and the slot/lookup helpers. */

import type { ColorTok } from './schema'
import type { EquipSlot, StatKey, Riders } from '../engine/items'
import gearData from './content/gear.yaml'

export type School = 'martial' | 'caster'
/** The §7 match-type a weapon rewards (which Attack-set colour outcome). Stored for ② scoping. */
export type MatchType = ColorTok | 'rainbow'

export interface GearBaseType {
  id: string
  name: string
  icon: string
  slot: EquipSlot
  school?: School // weapons/caster-armor have a school; relics/trinkets are school-agnostic
  /** Per-rarity-STEP rider (scaled by RARITY[rarity].riderMult). The gear power channel (§7). */
  rider?: Partial<Riders>
  /** Small slot-aligned flat stat (the 5-slot raw-stat budget — ~+25% stat share before affixes). */
  nativeStat?: { stat: StatKey; amount: number }
  matchType?: MatchType // §7 colour-type rewarded — LIVE: scopes the weapon's base rider (engine/resolve)
}

/** content/gear.yaml — the base-type catalog, keyed by id (the moddability source of truth). */
export type GearFile = Record<string, GearBaseType>

export const GEAR: GearFile = gearData as GearFile

/** Trinkets fit either trinket slot — the catalog tags them `trinket1`, but `trinket2` accepts them too. */
export function fitsSlot(base: GearBaseType, slot: EquipSlot): boolean {
  if (base.slot === slot) return true
  return slot === 'trinket2' && base.slot === 'trinket1'
}

export function gearBase(refId: string): GearBaseType | undefined {
  return GEAR[refId]
}
