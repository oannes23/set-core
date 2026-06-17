/* engine/loot — the LOOT ROLL (CRAWL §3 / TUNING.md, settled 2026-06-12). Category-first nested
   tables: each drop rolls a CATEGORY (gold · consumable · gear · spellbook) by per-tier weights,
   then a sub-table within it. Pure + rng-injected; replaces the delve's placeholder one-consumable
   roll.

   v1 SCOPE: gold + consumables are LIVE. Gear (B3) and spellbooks (B4) are scaffolded but DISABLED
   (ENABLED below) — their category weight redistributes to the live categories until their systems
   exist, so enabling them later is a one-line flip + a sub-roller, no shape change.

   GOLD derives from the foe's strength (the same `foeValue` XP uses — tougher foe pays more) via its
   OWN low coefficient, so the two currencies stay independently tunable. Depth scaling lifts gold
   (and consumable quality) per room — greed aligns with the dread meter. */

import type { Rng } from '../core/rng'
import type { FoeRuntime } from './state'
import type { Tier } from '../data/schema'
import { foeValue, foeLevelEquiv } from './foe'
import { CONSUMABLES } from './consumables'
import { GEAR } from '../data/gear'
import { rollGear } from './gear'
import { gearValue } from './value'
import type { GearInstance, Rarity } from './items'

export type LootKind = 'gold' | 'consumable' | 'gear' | 'spellbook'
export interface LootDrop { kind: LootKind; gold?: number; itemId?: string }

// gold ≈ foeValue × GOLD_K (a goblin ~47 → ~6g), ±variance, × depth. The whole economy's faucet
// is this one constant (tune AFTER the shop sink exists — instrument gold/run first).
export const GOLD_K = 0.12
const GOLD_VAR = 0.3 // ±30% per gold roll
export const DEPTH_RATE = 0.07 // +7%/room: loot quality & gold climb with depth (§3 depth scaling)

interface LootTable {
  drops: [number, number] // [min, max] item/gold drops rolled from the categories
  guaranteedGold: number // a WAGE on top of the drops (× one standard gold roll); 0 = none
  qualityAdvantage: boolean // consumable tier rolled twice, keep better (elite/boss)
  weights: Record<LootKind, number> // category weights (gear/spellbook redistribute while disabled)
}
const TABLES: Record<Tier, LootTable> = {
  minion: { drops: [1, 1], guaranteedGold: 0, qualityAdvantage: false, weights: { gold: 60, consumable: 30, gear: 10, spellbook: 0 } },
  elite: { drops: [2, 3], guaranteedGold: 2, qualityAdvantage: true, weights: { gold: 45, consumable: 35, gear: 20, spellbook: 0 } },
  boss: { drops: [5, 5], guaranteedGold: 4, qualityAdvantage: true, weights: { gold: 30, consumable: 40, gear: 20, spellbook: 10 } },
}
/** Live categories. Gear is LIVE (chunk ②); spellbook flips on at B4 — its weight redistributes till then. */
export const ENABLED: LootKind[] = ['gold', 'consumable', 'gear']

// --- gear sub-roller (CRAWL §7 / sim §12): base type × rarity (by tier) × loot-tier (affix magnitude) ---
/** Per-tier rarity drop weights — minions skew low, elites/bosses skew up (orange only at elite+). */
const RARITY_WEIGHTS: Record<Tier, Array<[Rarity, number]>> = {
  minion: [['white', 60], ['green', 28], ['blue', 10], ['purple', 2]],
  elite: [['white', 40], ['green', 33], ['blue', 20], ['purple', 6], ['orange', 1]],
  boss: [['white', 22], ['green', 33], ['blue', 28], ['purple', 13], ['orange', 4]],
}
function rollGearRarity(tier: Tier, rng: Rng): Rarity {
  const tab = RARITY_WEIGHTS[tier]
  const total = tab.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [rar, w] of tab) { r -= w; if (r < 0) return rar }
  return tab[tab.length - 1][0]
}
/** Roll one gear drop: a uniform base type (affinity bias = B4 halls), tier-weighted rarity, loot-tier =
 *  foe level-equiv + depth (→ affix magnitude). Affixes via the minimal stat-patch roller until the full
 *  affix CONTENT pool lands (the next ② slice). */
export function rollGearDrop(foe: FoeRuntime, depth: number, rng: Rng): GearInstance {
  const ids = Object.keys(GEAR)
  const refId = ids[Math.floor(rng() * ids.length)]
  const rarity = rollGearRarity(foe.tier ?? 'minion', rng)
  const lootTier = foeLevelEquiv(foe) + depth
  return rollGear(refId, rarity, lootTier, rng)
}
/** Gear pity: each gear-LESS category drop adds this to the gear weight; a gear hit resets it (sawtooth). */
export const GEAR_PITY_STEP = 8

// --- the town MARKET vendor (B4 buy-side): a randomized gear stock, grouped by slot, generated with the
//     same roller as loot. Rarity tier rides the player's HIGHEST character level; loot-tier = that level. ---
export const MARKET_PER_SLOT = 10
/** Slot groups the vendor stocks (offhand = relic; trinket1 covers both trinket slots). */
const MARKET_GROUPS: Array<{ label: string; slot: string }> = [
  { label: 'Weapons', slot: 'weapon' },
  { label: 'Armor', slot: 'armor' },
  { label: 'Offhand', slot: 'relic' },
  { label: 'Trinkets', slot: 'trinket1' },
]
/** Level → the rarity weight band (deeper characters unlock better vendor stock). */
const marketTier = (level: number): Tier => (level >= 12 ? 'boss' : level >= 5 ? 'elite' : 'minion')

/** Roll the vendor's stock for a character level: MARKET_PER_SLOT pieces per slot group, each a
 *  random base type of that slot × level-banded rarity × loot-tier = level, sorted by value (high→low). */
export function rollMarketStock(level: number, rng: Rng): Array<{ label: string; items: GearInstance[] }> {
  const tier = marketTier(Math.max(1, level))
  const lootTier = Math.max(1, level)
  return MARKET_GROUPS.map((grp) => {
    const bases = Object.values(GEAR).filter((b) => b.slot === grp.slot)
    const items = Array.from({ length: MARKET_PER_SLOT }, () => {
      const base = bases[Math.floor(rng() * bases.length)]
      return rollGear(base.id, rollGearRarity(tier, rng), lootTier, rng)
    }).sort((a, b) => gearValue(b) - gearValue(a))
    return { label: grp.label, items }
  })
}

/** The dungeon-clear MARQUEE roll (CRAWL §3): one GUARANTEED rare+ gear piece on a boss kill — the
 *  dungeon's headline reward. (Spellbook-marquee lands at B4; for now the marquee is always gear.) */
const MARQUEE_WEIGHTS: Array<[Rarity, number]> = [['blue', 50], ['purple', 35], ['orange', 15]]
export function rollMarqueeGear(foe: FoeRuntime, depth: number, rng: Rng): GearInstance {
  const ids = Object.keys(GEAR)
  const refId = ids[Math.floor(rng() * ids.length)]
  const total = MARQUEE_WEIGHTS.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  let rarity: Rarity = 'blue'
  for (const [rar, w] of MARQUEE_WEIGHTS) { r -= w; if (r < 0) { rarity = rar; break } }
  return rollGear(refId, rarity, foeLevelEquiv(foe) + depth, rng)
}

const depthMult = (depth: number): number => 1 + DEPTH_RATE * Math.max(0, depth - 1)

/** One standard gold roll for this foe at this depth (the unit the guarantee multiplies). */
export function rollGold(foe: FoeRuntime, depth: number, rng: Rng): number {
  const v = foeValue(foe) * GOLD_K * depthMult(depth) * (1 + (rng() * 2 - 1) * GOLD_VAR)
  return Math.max(1, Math.round(v))
}

/** Pick a category from a table's weights, restricted to ENABLED (disabled weight redistributes). */
function rollCategory(weights: Record<LootKind, number>, rng: Rng): LootKind {
  const live = ENABLED.filter((k) => weights[k] > 0)
  const total = live.reduce((s, k) => s + weights[k], 0)
  if (total <= 0) return 'gold' // degenerate guard
  let r = rng() * total
  for (const k of live) { r -= weights[k]; if (r < 0) return k }
  return live[live.length - 1]
}

// --- consumable sub-table: tiered potions (minor/std/major) + special potions + scrolls ---
const TIER_RE = /_(minor|std|major)$/
const tierIdx = (id: string): number => ['minor', 'std', 'major'].indexOf((id.match(TIER_RE)?.[1] ?? 'std'))
function consumablePools() {
  const ids = Object.keys(CONSUMABLES)
  const tiered: string[][] = [[], [], []] // [minor, std, major]
  const special: string[] = [] // untiered potions (fire_breathing, strength, …)
  const scrolls: string[] = []
  for (const id of ids) {
    const c = CONSUMABLES[id]
    if (c.kind === 'scroll') scrolls.push(id)
    else if (TIER_RE.test(id)) tiered[tierIdx(id)].push(id)
    else special.push(id)
  }
  return { tiered, special, scrolls }
}
const pick = <T,>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)]

/** Roll one consumable: 60% tiered potion (tier by depth, advantage = roll twice keep better) ·
 *  ~20% a special potion · ~20% a scroll. Spellbooks (the 5% slice) wait on B4. */
export function rollConsumable(depth: number, advantage: boolean, rng: Rng): string {
  const { tiered, special, scrolls } = consumablePools()
  const r = rng()
  if (r < 0.2 && scrolls.length) return pick(scrolls, rng)
  if (r < 0.4 && special.length) return pick(special, rng)
  // a tiered potion — tier biased up by depth, with advantage for elite/boss
  const depthBias = Math.min(2, Math.floor(depthMult(depth) - 1 + rng() * 1.2)) // 0..2, drifts up with depth
  let t = Math.min(2, Math.max(0, depthBias))
  if (advantage) t = Math.max(t, Math.min(2, Math.floor(rng() * 3)))
  for (let probe = 0; probe < 3; probe++) { // fall to a populated tier if the rolled one is empty
    const bucket = tiered[Math.min(2, t + probe)] ?? []
    if (bucket.length) return pick(bucket, rng)
  }
  return special.length ? pick(special, rng) : scrolls[0] ?? Object.keys(CONSUMABLES)[0]
}

export interface RoomLoot {
  gold: number // total gold this room (guaranteed wage + any gold drops)
  items: string[] // consumable ids (→ the run satchel)
  gear: GearInstance[] // gear instances (→ DELVE.gearFound, banked to Storage on a safe exit)
  trace: string[] // under-the-hood roll log (dev mode insight) — what each drop rolled & why
  gearPity: number // the carried-forward pity counter (sawtooth — thread back into the next call)
}

/** Roll a cleared room's loot for `foe` at delve `depth` (1-based). Category-first per the foe's
 *  tier table; gold → a number, consumables → ids (the satchel), gear → instances (banked on exit).
 *  `gearPity` carries the sawtooth across rooms (each gear-less drop boosts the gear weight, a hit
 *  resets it). Also emits a `trace` of the under-the-hood rolls (dev mode reveals it). */
export function rollRoomLoot(foe: FoeRuntime, depth: number, rng: Rng, gearPity = 0): RoomLoot {
  const tier = foe.tier ?? 'minion'
  const table = TABLES[tier]
  let gold = 0
  let pity = gearPity
  const items: string[] = []
  const gear: GearInstance[] = []
  const trace: string[] = []
  const wlive = ENABLED.filter((k) => table.weights[k] > 0).map((k) => `${k}:${table.weights[k]}`).join(' ')
  trace.push(`${tier} @depth ${depth} (×${depthMult(depth).toFixed(2)}) · weights ${wlive} · pity ${pity}`)
  if (table.guaranteedGold > 0) {
    const wage = rollGold(foe, depth, rng) * table.guaranteedGold // the wage
    gold += wage
    trace.push(`wage ×${table.guaranteedGold} → +${wage}g`)
  }
  const drops = table.drops[0] + (table.drops[1] > table.drops[0] && rng() < 0.5 ? 1 : 0)
  for (let i = 0; i < drops; i++) {
    // the pity sawtooth boosts the gear weight per gear-less drop (reset on a hit)
    const weights = { ...table.weights, gear: table.weights.gear + pity * GEAR_PITY_STEP }
    const cat = rollCategory(weights, rng)
    if (cat === 'gold') {
      const g = rollGold(foe, depth, rng)
      gold += g
      trace.push(`drop ${i + 1}: gold → +${g}g`)
    } else if (cat === 'consumable') {
      const id = rollConsumable(depth, table.qualityAdvantage, rng)
      items.push(id)
      trace.push(`drop ${i + 1}: consumable${table.qualityAdvantage ? ' (adv)' : ''} → ${id}`)
    } else if (cat === 'gear') {
      const g = rollGearDrop(foe, depth, rng)
      gear.push(g)
      trace.push(`drop ${i + 1}: GEAR → ${g.rarity} ${g.refId} (lt${g.lootTier}, ${g.affixes.length} affix)`)
    }
    if (cat === 'gear') pity = 0
    else pity++ // a gear-less drop ticks the sawtooth up
    // 'spellbook' can't be reached while disabled (ENABLED filter); its roller lands at B4
  }
  return { gold, items, gear, trace, gearPity: pity }
}
