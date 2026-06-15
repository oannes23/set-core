/* engine/gear — folds equipped GEAR into combat (CRAWL §7). Pure: aggregates the equipped kit into
   the stat bonus + the per-card riders + the affix triggers/abilities the combat layer consumes.

   Chunk ①: stat bonus + base riders are LIVE (applied in createCombat / resolveSet). Affix triggers
   and granted abilities are aggregated here and threaded onto the bus, but their CONTENT pool + the
   loot roller proper land with chunk ② — so `rollGear` below is a MINIMAL dev-grant generator
   (stat-affix pool only) for testing equip + riders end-to-end before real loot exists. */

import { GEAR } from '../data/gear'
import { rollAffixes } from '../data/affixes'
import { RARITY, NO_RIDERS, NO_MODS, freshUid, type EquipSlot, type GearInstance, type Riders, type GearMods, type StatKey, type Rarity, type AffixProc } from './items'
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

/** Base riders (×rarity riderMult) + scoped RIDER affixes, summed across the kit — applied FLAT after
 *  the contest (§7). Affix riders are pre-scaled at roll time (they don't re-multiply by rarity). */
export function gearRiders(eq: Equipped | undefined): Riders {
  const out: Riders = { ...NO_RIDERS }
  for (const g of equippedList(eq)) {
    const base = GEAR[g.refId]
    const mult = RARITY[g.rarity].riderMult
    if (base?.rider && mult > 0) {
      out.atkDamagePerCard += (base.rider.atkDamagePerCard ?? 0) * mult
      out.blockPerDefendCard += (base.rider.blockPerDefendCard ?? 0) * mult
      out.manaPerMatch += (base.rider.manaPerMatch ?? 0) * mult
    }
    for (const a of g.affixes) for (const c of a.components) if (c.c === 'rider') {
      out.atkDamagePerCard += c.riders.atkDamagePerCard ?? 0
      out.blockPerDefendCard += c.riders.blockPerDefendCard ?? 0
      out.manaPerMatch += c.riders.manaPerMatch ?? 0
    }
  }
  return out
}

/** Gear-exclusive scalar mods (dodge/penetration/soak/lifesteal), summed across the kit's affixes. */
export function gearMods(eq: Equipped | undefined): GearMods {
  const out: GearMods = { ...NO_MODS }
  for (const g of equippedList(eq)) for (const a of g.affixes) for (const c of a.components) if (c.c === 'mod') out[c.mod] += c.amount
  return out
}

/** Affix ON-MATCH procs across the kit — fed to CombatState.procs, fired like passives (the engine). */
export function gearProcs(eq: Equipped | undefined): AffixProc[] {
  const out: AffixProc[] = []
  for (const g of equippedList(eq)) for (const a of g.affixes) for (const c of a.components) if (c.c === 'proc') out.push(c.proc)
  return out
}

/** Affix-granted triggers (alt-verb / foe-shape; STAGED — registered on the bus when authored). */
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

// ---- the gear instance roller (affixes from the themed catalog — CRAWL §7 / sim §12) ----

/** Mint a gear instance: base rider from rarity + a slot/tier-gated, inverse-budget set of themed
 *  affixes drawn from the catalog (`data/affixes` — LIVE families only, so every affix functions). */
export function rollGear(refId: string, rarity: Rarity, lootTier: number, rng: Rng): GearInstance {
  const slot = GEAR[refId]?.slot ?? 'trinket1' // the base type's slot gates which affixes can roll
  const affixes = rollAffixes(slot, rarity, lootTier, rng)
  return { uid: freshUid(), kind: 'gear', refId, rarity, lootTier, affixes }
}
