/* engine/gear — folds equipped GEAR into combat (CRAWL §7). Pure: aggregates the equipped kit into
   the stat bonus + the per-card riders + the affix triggers/abilities the combat layer consumes.

   Chunk ①: stat bonus + base riders are LIVE (applied in createCombat / resolveSet). Affix triggers
   and granted abilities are aggregated here and threaded onto the bus, but their CONTENT pool + the
   loot roller proper land with chunk ② — so `rollGear` below is a MINIMAL dev-grant generator
   (stat-affix pool only) for testing equip + riders end-to-end before real loot exists. */

import { GEAR } from '../data/gear'
import { RARITY, NO_RIDERS, freshUid, type EquipSlot, type GearInstance, type Riders, type StatKey, type Rarity, type Affix } from './items'
import type { Trigger } from '../data/schema'
import type { Rng } from '../core/rng'

export type Equipped = Partial<Record<EquipSlot, GearInstance>>

/** The equipped items as a list (skips empty slots). */
export function equippedList(eq: Equipped | undefined): GearInstance[] {
  if (!eq) return []
  return Object.values(eq).filter((g): g is GearInstance => !!g && g.kind === 'gear')
}

/** Native stats + StatMod affix components, summed across the kit — added to effectiveStats at combat. */
export function gearStatBonus(eq: Equipped | undefined): Record<StatKey, number> {
  const out: Record<StatKey, number> = { power: 0, endurance: 0, speed: 0 }
  for (const g of equippedList(eq)) {
    const base = GEAR[g.refId]
    if (base?.nativeStat) out[base.nativeStat.stat] += base.nativeStat.amount
    for (const a of g.affixes) for (const c of a.components) if (c.c === 'stat') out[c.stat] += c.amount
  }
  return out
}

/** Base riders (×rarity riderMult), summed across the kit — applied FLAT after the contest (§7). */
export function gearRiders(eq: Equipped | undefined): Riders {
  const out: Riders = { ...NO_RIDERS }
  for (const g of equippedList(eq)) {
    const base = GEAR[g.refId]
    const mult = RARITY[g.rarity].riderMult
    if (!base?.rider || mult === 0) continue
    out.atkDamagePerCard += (base.rider.atkDamagePerCard ?? 0) * mult
    out.blockPerDefendCard += (base.rider.blockPerDefendCard ?? 0) * mult
    out.manaPerMatch += (base.rider.manaPerMatch ?? 0) * mult
  }
  return out
}

/** Affix-granted triggers (registered on the bus alongside class passives; content rides ②). */
export function gearTriggers(eq: Equipped | undefined): Trigger[] {
  const out: Trigger[] = []
  for (const g of equippedList(eq)) for (const a of g.affixes) for (const c of a.components) if (c.c === 'trigger') out.push(c.trigger)
  return out
}

/** Affix-granted ability ids (added to the kit; content rides ②). */
export function gearAbilities(eq: Equipped | undefined): string[] {
  const out: string[] = []
  for (const g of equippedList(eq)) for (const a of g.affixes) for (const c of a.components) if (c.c === 'ability') out.push(c.abilityId)
  return out
}

// ---- minimal dev-grant generator (real source-themed loot roller = chunk ②) ----

const STAT_KEYS: StatKey[] = ['power', 'endurance', 'speed']
/** The affix `label` IS its system-descriptive name (FlatPower…) so the dev-mode name toggle resolves
 *  it via `displayName`. The thematic overlay maps these keys (CRAWL §7 / dev.ts AFFIX_THEME). */
const STAT_AFFIX_KEY: Record<StatKey, string> = { power: 'FlatPower', endurance: 'FlatEndurance', speed: 'FlatSpeed' }

/** Roll one stat-patch affix scaled by the rarity's per-affix power × the loot-tier magnitude. */
function rollStatAffix(lootTier: number, perAffixPower: number, rng: Rng): Affix {
  const stat = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)]
  const amount = Math.max(1, Math.round(perAffixPower * (1 + lootTier * 0.15)))
  const key = STAT_AFFIX_KEY[stat]
  return { id: `${key}_${freshUid()}`, label: key, components: [{ c: 'stat', stat, amount }] }
}

/** Mint a gear instance: base rider from rarity + a RANDOM count (1..max) of stat-patch affixes
 *  (the inverse budget — §7). Dev/testing only until the real roller (②) brings the full affix pool. */
export function rollGear(refId: string, rarity: Rarity, lootTier: number, rng: Rng): GearInstance {
  const budget = RARITY[rarity]
  const affixes: Affix[] = []
  if (budget.maxAffixes > 0) {
    const count = 1 + Math.floor(rng() * budget.maxAffixes) // random 1..max
    for (let i = 0; i < count; i++) affixes.push(rollStatAffix(lootTier, budget.perAffixPower, rng))
  }
  return { uid: freshUid(), kind: 'gear', refId, rarity, lootTier, affixes }
}
