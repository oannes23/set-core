/* engine/value — item GOLD VALUATION + the sell-back price (CRAWL §3 town economy). The one place that
   answers "what is this worth": the end-of-run loot scene's keep/sell choice and the Storage sell button
   both read it. FIRST-CUT numbers, sim-gated together with GOLD_K + the smith prices (the faucet/sink
   pass once the shop exists). Pure; the satchel holds bare consumable refIds, so a refId helper is given
   alongside the Item one. */

import { type Item, type GearInstance, isGear, type Rarity } from './items'
import { CONSUMABLES } from './consumables'

export const SELL_RATE = 0.2 // sell-back = 20% of value (CRAWL §3; a town amenity raises it later)

// --- gear: a geometric rarity ladder, lifted by loot-tier + affix richness ---
const GEAR_BASE: Record<Rarity, number> = { grey: 8, white: 20, green: 50, blue: 120, purple: 300, orange: 700 }
const GEAR_TIER_K = 0.03 // +3% per loot-tier
const GEAR_AFFIX_K = 0.15 // +15% per rolled affix

export function gearValue(g: GearInstance): number {
  const base = GEAR_BASE[g.rarity] ?? 0
  return Math.round(base * (1 + Math.max(0, g.lootTier) * GEAR_TIER_K) * (1 + g.affixes.length * GEAR_AFFIX_K))
}

// --- consumables: a base by kind × a tier multiplier read off the id suffix ---
const POTION_BASE = 12
const SCROLL_BASE = 20
function tierMult(refId: string): number {
  if (refId.endsWith('_minor')) return 1
  if (refId.endsWith('_major')) return 3
  return 2 // _std / special (no suffix) / scroll
}
/** The gold value of a consumable refId (0 if unknown). */
export function consumableValue(refId: string): number {
  const c = CONSUMABLES[refId]
  if (!c) return 0
  return (c.kind === 'scroll' ? SCROLL_BASE : POTION_BASE) * tierMult(refId)
}

/** The gold VALUE of any inventory item (gear or consumable); 0 for an unknown ref. */
export function itemValue(item: Item): number {
  return isGear(item) ? gearValue(item) : consumableValue(item.refId)
}

const toSell = (value: number): number => (value <= 0 ? 0 : Math.max(1, Math.floor(value * SELL_RATE)))

/** The sell-back price of an inventory item (floor of value × SELL_RATE; ≥1 for anything of value). */
export const sellValue = (item: Item): number => toSell(itemValue(item))
/** The sell-back price of a bare consumable refId (the satchel holds refIds, not Items). */
export const sellValueOfConsumable = (refId: string): number => toSell(consumableValue(refId))

export const BUY_MARKUP = 1.5 // shop buy = 150% of value (B4 first-cut; base upgrades pull it toward 100% later)
const toBuy = (value: number): number => (value <= 0 ? 0 : Math.max(1, Math.round(value * BUY_MARKUP)))
/** The shop BUY price of an inventory item (value × BUY_MARKUP). */
export const buyPrice = (item: Item): number => toBuy(itemValue(item))
/** The shop BUY price of a bare consumable refId. */
export const buyPriceOfConsumable = (refId: string): number => toBuy(consumableValue(refId))
