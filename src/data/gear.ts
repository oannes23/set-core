/* data/gear — the GEAR BASE-TYPE catalog (CRAWL §7). A base type defines a slot's identity: its
   per-rarity-step RIDER (×RARITY[rarity].riderMult on a GearInstance), a small slot-aligned NATIVE
   stat (weapon→Power, armor→Endurance, trinket→Speed — so a full kit spreads P/E/S), school, and the
   §7 match-TYPE it rewards. Pure content (YAML-portable like the rest of data/); a GearInstance's
   `refId` indexes this catalog.

   The BASE riders (atk-damage / block / mana per match) + native stats apply in combat. The color/
   match-TYPE SCOPING is LIVE (2026-06-16): a weapon's base rider fires only when the matched set's
   colour matches its matchType (Axe→Fire/mono-red, Mace→Frost, Spear/Staff→Nature, Sword→Rainbow,
   Wand→Fire) — see engine/gear.gearRiders (scoped lane) + engine/resolve. Armor/relic block + caster
   relic/armor mana have no matchType → unscoped. */

import type { ColorTok } from './schema'
import type { EquipSlot, StatKey, Riders } from '../engine/items'

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

export const GEAR: Record<string, GearBaseType> = {
  // ---- Weapons (payoff). Martial → +damage/Attack card; caster → +mana/match. Native: Power. ----
  axe: { id: 'axe', name: 'Axe', icon: '🪓', slot: 'weapon', school: 'martial', rider: { atkDamagePerCard: 1 }, nativeStat: { stat: 'power', amount: 1 }, matchType: 'red' },
  mace: { id: 'mace', name: 'Mace', icon: '🔨', slot: 'weapon', school: 'martial', rider: { atkDamagePerCard: 1 }, nativeStat: { stat: 'power', amount: 1 }, matchType: 'blue' },
  spear: { id: 'spear', name: 'Spear', icon: '🔱', slot: 'weapon', school: 'martial', rider: { atkDamagePerCard: 1 }, nativeStat: { stat: 'power', amount: 1 }, matchType: 'green' },
  sword: { id: 'sword', name: 'Sword', icon: '⚔️', slot: 'weapon', school: 'martial', rider: { atkDamagePerCard: 1 }, nativeStat: { stat: 'power', amount: 1 }, matchType: 'rainbow' },
  wand: { id: 'wand', name: 'Wand', icon: '🪄', slot: 'weapon', school: 'caster', rider: { manaPerMatch: 1 }, nativeStat: { stat: 'power', amount: 1 }, matchType: 'red' },
  staff: { id: 'staff', name: 'Staff', icon: '🪈', slot: 'weapon', school: 'caster', rider: { manaPerMatch: 1 }, nativeStat: { stat: 'power', amount: 1 }, matchType: 'green' },
  // ---- Armor (defense). Martial weight → +Block/Defend card; caster colour → +mana, squishy. Native: Endurance. ----
  plate: { id: 'plate', name: 'Plate', icon: '🛡️', slot: 'armor', school: 'martial', rider: { blockPerDefendCard: 1 }, nativeStat: { stat: 'endurance', amount: 2 } },
  chainmail: { id: 'chainmail', name: 'Chainmail', icon: '⛓️', slot: 'armor', school: 'martial', rider: { blockPerDefendCard: 1 }, nativeStat: { stat: 'endurance', amount: 1 } },
  leather: { id: 'leather', name: 'Leather', icon: '🦺', slot: 'armor', school: 'martial', rider: { blockPerDefendCard: 1 }, nativeStat: { stat: 'speed', amount: 1 } },
  robe: { id: 'robe', name: 'Robe', icon: '🧥', slot: 'armor', school: 'caster', rider: { manaPerMatch: 1 }, nativeStat: { stat: 'endurance', amount: 1 } },
  // ---- Relic / offhand (augments). School-agnostic; mostly native stat + affixes (alt-verbs at ②). ----
  shield: { id: 'shield', name: 'Shield', icon: '🛡', slot: 'relic', rider: { blockPerDefendCard: 1 }, nativeStat: { stat: 'endurance', amount: 1 } },
  focus: { id: 'focus', name: 'Focus', icon: '🔮', slot: 'relic', school: 'caster', rider: { manaPerMatch: 1 }, nativeStat: { stat: 'power', amount: 1 } },
  // ---- Trinkets ×2 (flex economy). Pure-ish affix carriers; small native (Speed-leaning). ----
  ring: { id: 'ring', name: 'Ring', icon: '💍', slot: 'trinket1', nativeStat: { stat: 'speed', amount: 1 } },
  amulet: { id: 'amulet', name: 'Amulet', icon: '📿', slot: 'trinket1', nativeStat: { stat: 'endurance', amount: 1 } },
  boots: { id: 'boots', name: 'Boots', icon: '🥾', slot: 'trinket1', nativeStat: { stat: 'speed', amount: 2 } },
}

/** Trinkets fit either trinket slot — the catalog tags them `trinket1`, but `trinket2` accepts them too. */
export function fitsSlot(base: GearBaseType, slot: EquipSlot): boolean {
  if (base.slot === slot) return true
  return slot === 'trinket2' && base.slot === 'trinket1'
}

export function gearBase(refId: string): GearBaseType | undefined {
  return GEAR[refId]
}
