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
import { RARITIES } from './items'
import type { GearInstance, Rarity, EquipSlot } from './items'
import lootData from '../data/content/loot.yaml'

export type LootKind = 'gold' | 'consumable' | 'gear' | 'spellbook'
export interface LootDrop { kind: LootKind; gold?: number; itemId?: string }

export interface LootTable {
  drops: [number, number] // [min, max] item/gold drops rolled from the categories
  guaranteedGold: number // a WAGE on top of the drops (× one standard gold roll); 0 = none
  qualityAdvantage: boolean // consumable tier rolled twice, keep better (elite/boss)
  weights: Record<LootKind, number> // category weights (gear/spellbook redistribute while disabled)
}
/** content/loot.yaml — all loot-roll tuning (FIRST-CUT, sim-gated). The rollers below read these; the
 *  values are content/balance, not logic, so they live in YAML (MODDING.md Phase 1). */
export interface LootConfig {
  goldK: number // gold ≈ foeValue × goldK (a goblin ~47 → ~6g) — the whole economy's faucet constant
  goldVar: number // ± fraction per gold roll
  depthRate: number // per-room lift to gold + loot quality (§3 depth scaling)
  gearPityStep: number // gear-less drop adds this to the gear weight; a gear hit resets it (sawtooth)
  marketPerSlot: number // town Market: pieces stocked per slot group
  rarePerTab: number // Merchant-House rare vendor: pieces stocked
  tables: Record<Tier, LootTable>
  rarityBands: Array<{ maxLevel: number; weights: Array<[Rarity, number]> }> // gear-rarity drop weights by CHARACTER/DUNGEON LEVEL band (BALANCE.md §5.4); elite/boss roll twice keep-better on top
  rareWeights: Array<[Rarity, number]> // rare vendor (epic/legendary only)
  marqueeWeights: Array<[Rarity, number]> // boss-clear guaranteed rare+ piece
  marketGroups: Array<{ label: string; slot: EquipSlot }> // slot groups the Market vendor stocks
}
export type LootFile = LootConfig

const CFG = lootData as LootConfig

// gold ≈ foeValue × GOLD_K, ±variance, × depth (tune AFTER the shop sink exists — instrument gold/run first).
export const GOLD_K = CFG.goldK
const GOLD_VAR = CFG.goldVar
export const DEPTH_RATE = CFG.depthRate

const TABLES: Record<Tier, LootTable> = CFG.tables
/** Live categories. Gear is LIVE (chunk ②); spellbook flips on at B4 — its weight redistributes till then. */
export const ENABLED: LootKind[] = ['gold', 'consumable', 'gear']

// --- gear sub-roller (CRAWL §7 / BALANCE.md §5.4): base type × rarity (by LEVEL band, +tier skew) × loot-tier ---
/** Gear-rarity drop weights by CHARACTER/DUNGEON LEVEL band — drops climb white→orange as you level. */
const RARITY_BANDS = CFG.rarityBands
const rankOf = (r: Rarity): number => RARITIES.indexOf(r)
const bandFor = (level: number) => RARITY_BANDS.find((b) => level <= b.maxLevel) ?? RARITY_BANDS[RARITY_BANDS.length - 1]
function pickRarity(tab: Array<[Rarity, number]>, rng: Rng): Rarity {
  const total = tab.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [rar, w] of tab) { r -= w; if (r < 0) return rar }
  return tab[tab.length - 1][0]
}
/** Rarity by level band; `advantage` (elite/boss foes) rolls twice keep-better, so a tougher foe at the
 *  same level skews up — the level band is the floor, the foe tier is the bonus. */
function rollGearRarity(level: number, advantage: boolean, rng: Rng): Rarity {
  const tab = bandFor(level).weights
  let rar = pickRarity(tab, rng)
  if (advantage) { const r2 = pickRarity(tab, rng); if (rankOf(r2) > rankOf(rar)) rar = r2 }
  return rar
}
/** Roll one gear drop: a uniform base type (affinity bias = B4 halls), LEVEL-banded rarity (elite/boss
 *  skew up), loot-tier = foe level-equiv + depth (→ affix magnitude). */
export function rollGearDrop(foe: FoeRuntime, depth: number, rng: Rng): GearInstance {
  const ids = Object.keys(GEAR)
  const refId = ids[Math.floor(rng() * ids.length)]
  const lootTier = foeLevelEquiv(foe) + depth
  const rarity = rollGearRarity(foeLevelEquiv(foe), (foe.tier ?? 'minion') !== 'minion', rng)
  return rollGear(refId, rarity, lootTier, rng)
}
/** Gear pity: each gear-LESS category drop adds this to the gear weight; a gear hit resets it (sawtooth). */
export const GEAR_PITY_STEP = CFG.gearPityStep

// --- the town MARKET vendor (B4 buy-side): a randomized gear stock, grouped by slot, generated with the
//     same roller as loot. Rarity tier rides the player's HIGHEST character level; loot-tier = that level. ---
export const MARKET_PER_SLOT = CFG.marketPerSlot
/** Slot groups the vendor stocks (offhand = relic; trinket1 covers both trinket slots). */
const MARKET_GROUPS: Array<{ label: string; slot: EquipSlot }> = CFG.marketGroups

/** Roll the vendor's stock for a character level: MARKET_PER_SLOT pieces per slot group, each a random
 *  base type of that slot × LEVEL-banded rarity × loot-tier, sorted by value (high→low). `lvlBoost` (the
 *  Town-loot-quality upgrade) lifts the effective level → a better rarity band + loot-tier. */
export function rollMarketStock(level: number, rng: Rng, lvlBoost = 0): Array<{ label: string; items: GearInstance[] }> {
  const eff = Math.max(1, level + lvlBoost)
  return MARKET_GROUPS.map((grp) => {
    const bases = Object.values(GEAR).filter((b) => b.slot === grp.slot)
    const items = Array.from({ length: MARKET_PER_SLOT }, () => {
      const base = bases[Math.floor(rng() * bases.length)]
      return rollGear(base.id, rollGearRarity(eff, false, rng), eff, rng)
    }).sort((a, b) => gearValue(b) - gearValue(a))
    return { label: grp.label, items }
  })
}

// --- the Merchant House RARE vendor: a 10-slot stock of EPIC (purple) / LEGENDARY (orange) gear. ---
export const RARE_PER_TAB = CFG.rarePerTab
const RARE_WEIGHTS: Array<[Rarity, number]> = CFG.rareWeights
/** Roll the rare vendor's stock: RARE_PER_TAB random pieces, epic/legendary only (loot-quality `lvlBoost`
 *  raises the loot-tier + skews toward legendary), sorted by value. (Spellbooks slot in here at Phase 5.) */
export function rollRareStock(level: number, rng: Rng, lvlBoost = 0): GearInstance[] {
  const eff = Math.max(1, level + lvlBoost)
  const ids = Object.keys(GEAR)
  const weights: Array<[Rarity, number]> = [['purple', Math.max(10, RARE_WEIGHTS[0][1] - lvlBoost * 3)], ['orange', RARE_WEIGHTS[1][1] + lvlBoost * 3]]
  const total = weights.reduce((s, [, w]) => s + w, 0)
  return Array.from({ length: RARE_PER_TAB }, () => {
    const refId = ids[Math.floor(rng() * ids.length)]
    let r = rng() * total
    let rarity: Rarity = 'purple'
    for (const [rar, w] of weights) { r -= w; if (r < 0) { rarity = rar; break } }
    return rollGear(refId, rarity, eff, rng)
  }).sort((a, b) => gearValue(b) - gearValue(a))
}

/** The dungeon-clear MARQUEE roll (CRAWL §3): one GUARANTEED rare+ gear piece on a boss kill — the
 *  dungeon's headline reward. (Spellbook-marquee lands at B4; for now the marquee is always gear.) */
const MARQUEE_WEIGHTS: Array<[Rarity, number]> = CFG.marqueeWeights
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
