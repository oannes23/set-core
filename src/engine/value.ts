/* engine/value — item GOLD VALUATION + the sell-back price (CRAWL §3 town economy). The one place that
   answers "what is this worth": the end-of-run loot scene's keep/sell choice and the Storage sell button
   both read it. FIRST-CUT numbers, sim-gated together with GOLD_K + the smith prices (the faucet/sink
   pass once the shop exists). Pure; the satchel holds bare consumable refIds, so a refId helper is given
   alongside the Item one. */

import { type Item, type GearInstance, isGear, type Rarity } from './items'
import { CONSUMABLES } from './consumables'
import { ECON } from './economy'

export const SELL_RATE = ECON.sellRate // sell-back fraction (CRAWL §3; a town amenity raises it later)

// --- gear: a geometric rarity ladder, lifted by loot-tier + affix richness ---
const GEAR_BASE: Record<Rarity, number> = ECON.gear.base
const GEAR_TIER_K = ECON.gear.tierK // per loot-tier
const GEAR_AFFIX_K = ECON.gear.affixK // per rolled affix

export function gearValue(g: GearInstance): number {
  const base = GEAR_BASE[g.rarity] ?? 0
  return Math.round(base * (1 + Math.max(0, g.lootTier) * GEAR_TIER_K) * (1 + g.affixes.length * GEAR_AFFIX_K))
}

// --- consumables: a base by kind × a tier multiplier read off the id suffix ---
const POTION_BASE = ECON.consumable.potionBase
const SCROLL_BASE = ECON.consumable.scrollBase
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

export const BUY_MARKUP = ECON.buyMarkup // shop buy markup (the Merchant House pulls it → 100%)
const toBuy = (value: number, markup: number): number => (value <= 0 ? 0 : Math.max(1, Math.round(value * markup)))
/** The shop BUY price of an inventory item (value × markup; markup defaults to the base 150%). */
export const buyPrice = (item: Item, markup: number = BUY_MARKUP): number => toBuy(itemValue(item), markup)
/** The shop BUY price of a bare consumable refId. */
export const buyPriceOfConsumable = (refId: string, markup: number = BUY_MARKUP): number => toBuy(consumableValue(refId), markup)

// ---- the Merchant House tracks (B4) — pure-gold tiers; first-cut, sim-gated ----
/** Buy markup by Merchant-standing tier (150% → 100% over 5 tiers). */
export const MERCHANT_MARKUPS = ECON.merchant.markups
/** Gold to REACH each Merchant-standing tier (index = tier; 0 is free/base). */
export const MERCHANT_TIER_COST = ECON.merchant.tierCost
/** Gold to REACH each Town-loot-quality tier; each tier ≈ +QUALITY_LVL_PER_TIER levels of vendor rarity band. */
export const QUALITY_TIER_COST = ECON.quality.tierCost
export const QUALITY_LVL_PER_TIER = ECON.quality.lvlPerTier
export const RARE_MARKUP = ECON.rareMarkup // the rare vendor's premium (× value) — high quality, high price

export const markupForTier = (tier: number): number => MERCHANT_MARKUPS[Math.min(Math.max(0, tier), MERCHANT_MARKUPS.length - 1)]
export const qualityLvlBoost = (tier: number): number => Math.max(0, tier) * QUALITY_LVL_PER_TIER
