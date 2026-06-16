/* engine/smith — the crafting bench (CRAWL §7 "The smith"). PURE transforms on a GearInstance plus a
   gold pricer. The economy's targeted backstop + its steady gold SINK (Enchant has standing demand
   because affix count rolls random → most drops arrive with empty slots).

   Four operations, all reusing the affix catalog + the RARITY budget (no new affix machinery):
   • Upgrade rarity  — grey→…→orange: raises the base rider (×riderMult, read live in gearRiders) and
                       opens affix slots. Existing affixes are PRESERVED (kept at their rolled magnitude).
   • Enchant         — set one CHOSEN affix into an open slot (targeted; the player picks from the
                       slot/rarity-eligible pool minus what's already on the piece). Deterministic magnitude.
   • Reroll affixes  — gamble the WHOLE affix set (count + draws re-randomize via rollAffixes).
   • Transfer affix  — move one rolled affix from a source piece onto a better base's open slot (premium;
                       keeps the affix's rolled magnitude). Two-item op.

   Tier-1 bench: every op is available ungated at flat first-cut prices. The smithy AMENITY (achievement/
   gold tiers that unlock + cheapen ops) rides B4/B5 — the base town is open day one (CRAWL §3).

   Pure + dependency-light: the UI loads the Account, finds the gear by uid, applies a transform, spends
   gold (bank.spendGold), and writes the gear back (bank.updateStorageItem). No DOM, no storage I/O here. */

import { RARITIES, RARITY, type GearInstance, type Affix, type Rarity } from './items'
import { GEAR } from '../data/gear'
import { eligibleAffixes, mintAffix, rollAffixes, type AffixDef } from '../data/affixes'
import type { Rng } from '../core/rng'

export type SmithOp = 'upgrade' | 'enchant' | 'reroll' | 'transfer'

// ---- pricing (FIRST-CUT, sim-gated — see TUNING "Gear + the coupled balance pass"; recalibrate the
//      whole gold faucet/sink together once the shop sink + GOLD_K settle) ----
export const SMITH_PRICES = {
  upgradeBase: 80, // cost to reach rarity R = upgradeBase · 2^(idx(R)−1) → 80/160/320/640/1280 (the raw-power sink)
  enchantBase: 100, // per current-rarity index → 100…500 (targeted, expensive — the steady sink)
  rerollBase: 45, // per current-rarity index → 90…225 (cheaper RNG gamble)
  transferBase: 160, // per DESTINATION-rarity index → 480…800 (premium two-item op)
}

const idx = (r: Rarity): number => RARITIES.indexOf(r) // grey 0 … orange 5

/** The gold cost of an op on a piece. `transfer` prices off the DESTINATION (`dst`) rarity. Returns 0
 *  for an impossible op (e.g. upgrading an orange) — callers gate on the `can*` predicates first. */
export function smithCost(op: SmithOp, gear: GearInstance, dst?: GearInstance): number {
  switch (op) {
    case 'upgrade': {
      const nr = nextRarity(gear.rarity)
      return nr ? Math.round(SMITH_PRICES.upgradeBase * 2 ** (idx(nr) - 1)) : 0
    }
    case 'enchant': return SMITH_PRICES.enchantBase * Math.max(1, idx(gear.rarity))
    case 'reroll': return SMITH_PRICES.rerollBase * Math.max(1, idx(gear.rarity))
    case 'transfer': return SMITH_PRICES.transferBase * Math.max(1, idx((dst ?? gear).rarity))
  }
}

// ---- capability predicates (the UI greys an op when its predicate is false) ----

/** The next rarity up, or null at the orange ceiling. */
export function nextRarity(r: Rarity): Rarity | null {
  const i = idx(r)
  return i >= 0 && i < RARITIES.length - 1 ? RARITIES[i + 1] : null
}
export const canUpgrade = (g: GearInstance): boolean => nextRarity(g.rarity) !== null

/** Empty affix slots on a piece (budget − filled). */
export const openSlots = (g: GearInstance): number => Math.max(0, RARITY[g.rarity].maxAffixes - g.affixes.length)

/** The affixes the player may Enchant onto a piece right now: slot/rarity-eligible, LIVE, minus the
 *  ones already on it (no duplicate sys). Empty when no open slot or nothing new fits. */
export function enchantOptions(g: GearInstance): AffixDef[] {
  if (openSlots(g) <= 0) return []
  const slot = GEAR[g.refId]?.slot
  if (!slot) return []
  const present = new Set(g.affixes.map((a) => a.label))
  return eligibleAffixes(slot, g.rarity).filter((d) => !present.has(d.sys))
}
export const canEnchant = (g: GearInstance): boolean => enchantOptions(g).length > 0

/** Reroll needs an affix budget AND a non-empty eligible pool (so the gamble can produce something). */
export function canReroll(g: GearInstance): boolean {
  if (RARITY[g.rarity].maxAffixes === 0) return false
  const slot = GEAR[g.refId]?.slot
  return !!slot && eligibleAffixes(slot, g.rarity).length > 0
}

/** Can `dst` receive `affix` (transfer target test): an open slot, no duplicate sys, and the affix is
 *  eligible on dst's slot + rarity tier (transfer onto a *better* base — never down-fits an off-slot affix). */
export function canReceiveAffix(dst: GearInstance, affix: Affix): boolean {
  if (openSlots(dst) <= 0) return false
  const slot = GEAR[dst.refId]?.slot
  if (!slot) return false
  if (dst.affixes.some((a) => a.label === affix.label)) return false
  return eligibleAffixes(slot, dst.rarity).some((d) => d.sys === affix.label)
}

// ---- transforms (PURE — return new instances; never mutate the inputs) ----

/** Upgrade a piece one rarity step. Affixes preserved (kept at rolled magnitude); the base rider scales
 *  live via the new rarity's riderMult, and a slot opens for Enchant. No-op at the orange ceiling. */
export function upgradeRarity(g: GearInstance): GearInstance {
  const nr = nextRarity(g.rarity)
  return nr ? { ...g, rarity: nr } : g
}

/** Enchant a CHOSEN affix (by its system key) into an open slot. Magnitude is the piece's own
 *  rarity/loot-tier unit — a crafted affix matches a dropped one. No-op if the choice isn't a valid option. */
export function enchant(g: GearInstance, sys: string): GearInstance {
  const opt = enchantOptions(g).find((d) => d.sys === sys)
  return opt ? { ...g, affixes: [...g.affixes, mintAffix(opt, g.rarity, g.lootTier)] } : g
}

/** Reroll the entire affix set (count + draws gamble fresh at the piece's rarity/loot-tier). */
export function rerollAffixes(g: GearInstance, rng: Rng): GearInstance {
  const slot = GEAR[g.refId]?.slot
  return slot ? { ...g, affixes: rollAffixes(slot, g.rarity, g.lootTier, rng) } : g
}

/** Move one affix (by instance id) from `src` onto `dst`'s open slot. Returns the new pair, or null if
 *  the affix is absent or dst can't receive it. The affix keeps its rolled magnitude (no re-roll). */
export function transferAffix(src: GearInstance, dst: GearInstance, affixId: string): { src: GearInstance; dst: GearInstance } | null {
  const affix = src.affixes.find((a) => a.id === affixId)
  if (!affix || !canReceiveAffix(dst, affix)) return null
  return {
    src: { ...src, affixes: src.affixes.filter((a) => a.id !== affixId) },
    dst: { ...dst, affixes: [...dst.affixes, affix] },
  }
}
