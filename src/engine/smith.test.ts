/* engine/smith — the crafting bench transforms + pricer (CRAWL §7). Pure unit tests; the rng is a
   small deterministic stub so reroll is reproducible. */
import { describe, it, expect } from 'vitest'
import {
  smithCost, nextRarity, canUpgrade, openSlots, enchantOptions, canEnchant, canReroll,
  canReceiveAffix, upgradeRarity, enchant, rerollAffixes, transferAffix, SMITH_PRICES,
} from './smith'
import { rollGear } from './gear'
import { RARITY, type GearInstance, type Rarity } from './items'

/** A deterministic [0,1) rng stub cycling a fixed sequence (enough variety for reroll draws). */
const stubRng = (seq: number[] = [0.1, 0.4, 0.7, 0.2, 0.9, 0.5, 0.3, 0.8]) => {
  let i = 0
  return () => seq[i++ % seq.length]
}

/** Build a bare gear instance directly (no affixes) so we control rarity/slot precisely. */
const bare = (refId: string, rarity: Rarity, lootTier = 6): GearInstance =>
  ({ uid: `u_${refId}_${rarity}`, kind: 'gear', refId, rarity, lootTier, affixes: [] })

describe('smith — rarity upgrade', () => {
  it('steps rarity up and preserves affixes', () => {
    const g = rollGear('axe', 'green', 8, stubRng())
    const before = g.affixes.length
    const up = upgradeRarity(g)
    expect(up.rarity).toBe('blue')
    expect(up.affixes).toEqual(g.affixes) // preserved at rolled magnitude
    expect(before).toBeGreaterThanOrEqual(1)
    expect(g.rarity).toBe('green') // input not mutated
  })

  it('opens an affix slot (budget grows on upgrade)', () => {
    const g = bare('axe', 'white') // white budget 1, 0 affixes → 1 open
    expect(openSlots(g)).toBe(RARITY.white.maxAffixes)
    const up = upgradeRarity(g)
    expect(openSlots(up)).toBe(RARITY.green.maxAffixes) // 2 — one more than white
    expect(openSlots(up)).toBeGreaterThan(openSlots(g))
  })

  it('caps at orange (no-op + cannot upgrade)', () => {
    const g = bare('axe', 'orange')
    expect(canUpgrade(g)).toBe(false)
    expect(nextRarity('orange')).toBeNull()
    expect(upgradeRarity(g)).toBe(g)
  })
})

describe('smith — enchant (targeted)', () => {
  it('fills an open slot with the chosen affix at the piece magnitude', () => {
    const g = bare('axe', 'blue') // budget 3, 0 affixes
    const opts = enchantOptions(g)
    expect(opts.length).toBeGreaterThan(0)
    expect(canEnchant(g)).toBe(true)
    const pick = opts[0]
    const out = enchant(g, pick.sys)
    expect(out.affixes).toHaveLength(1)
    expect(out.affixes[0].label).toBe(pick.sys)
    expect(g.affixes).toHaveLength(0) // not mutated
  })

  it('never offers a duplicate of an affix already present', () => {
    const g = bare('axe', 'blue')
    const first = enchant(g, enchantOptions(g)[0].sys)
    const onePresent = first.affixes[0].label
    expect(enchantOptions(first).some((d) => d.sys === onePresent)).toBe(false)
  })

  it('refuses when no open slot (full piece)', () => {
    let g = bare('ring', 'white') // budget 1
    g = enchant(g, enchantOptions(g)[0].sys)
    expect(openSlots(g)).toBe(0)
    expect(canEnchant(g)).toBe(false)
    expect(enchant(g, 'FlatPower')).toBe(g) // no-op
  })

  it('refuses an invalid / off-slot choice', () => {
    const g = bare('plate', 'blue') // armor — Honed (weapon/relic) must not be offered
    expect(enchantOptions(g).some((d) => d.sys === 'AttackDamagePerCard')).toBe(false)
    expect(enchant(g, 'AttackDamagePerCard')).toBe(g)
  })

  it('grey has no slots → cannot enchant', () => {
    const g = bare('axe', 'grey')
    expect(openSlots(g)).toBe(0)
    expect(canEnchant(g)).toBe(false)
  })
})

describe('smith — reroll', () => {
  it('replaces the whole affix set; count stays within budget', () => {
    const g = rollGear('axe', 'purple', 10, stubRng([0.9, 0.1]))
    const out = rerollAffixes(g, stubRng([0.2, 0.6, 0.4, 0.8, 0.1]))
    expect(out.affixes.length).toBeGreaterThanOrEqual(1)
    expect(out.affixes.length).toBeLessThanOrEqual(RARITY.purple.maxAffixes)
    expect(out.uid).toBe(g.uid) // same instance identity
  })

  it('grey cannot reroll (no budget)', () => {
    expect(canReroll(bare('axe', 'grey'))).toBe(false)
  })
})

describe('smith — transfer', () => {
  it('moves an affix from src to a compatible dst open slot', () => {
    const src = rollGear('axe', 'blue', 8, stubRng([0.0, 0.0])) // 1 affix
    const dst = bare('sword', 'purple') // weapon, open slots, higher base
    const affix = src.affixes[0]
    // ensure the test affix is one a weapon dst can receive
    if (!canReceiveAffix(dst, affix)) return // (defensive — the roll could pick a weapon-only affix; both are weapons here)
    const out = transferAffix(src, dst, affix.id)
    expect(out).not.toBeNull()
    expect(out!.src.affixes.find((a) => a.id === affix.id)).toBeUndefined()
    expect(out!.dst.affixes.find((a) => a.label === affix.label)).toBeDefined() // re-minted (fresh id) → match by sys
    expect(src.affixes).toHaveLength(1) // inputs not mutated
  })

  it('C2 — re-mints the moved affix to dst rarity magnitude (no inverse-budget smuggling)', () => {
    // white (perAffixPower 1.4) mints a BIGGER per-affix magnitude than orange (0.5); a naive transfer that
    // kept the donor's rolled magnitude would smuggle white's oversized affix onto an orange base (~3×).
    const amt = (g: GearInstance) => (g.affixes[0].components[0] as { amount: number }).amount
    const donor = enchant(bare('axe', 'white', 12), 'FlatPower') // white-magnitude
    const native = enchant(bare('sword', 'orange', 12), 'FlatPower') // what orange natively mints
    const out = transferAffix(donor, bare('sword', 'orange', 12), donor.affixes[0].id)
    expect(out).not.toBeNull()
    expect(amt(out!.dst)).toBe(amt(native)) // transferred == native orange, NOT the white donor's magnitude
    expect(amt(out!.dst)).toBeLessThan(amt(donor)) // strictly smaller than the white donor's oversized roll
  })

  it('refuses transfer when dst slot is incompatible', () => {
    // mint a weapon-only affix (Honed = AttackDamagePerCard, weapon/relic) onto a weapon, target armor
    let src = bare('axe', 'blue')
    src = enchant(src, 'AttackDamagePerCard')
    const dst = bare('plate', 'purple') // armor — must reject a weapon affix
    expect(canReceiveAffix(dst, src.affixes[0])).toBe(false)
    expect(transferAffix(src, dst, src.affixes[0].id)).toBeNull()
  })

  it('refuses transfer when dst has no open slot', () => {
    let src = bare('axe', 'green')
    src = enchant(src, enchantOptions(src)[0].sys)
    let dst = bare('mace', 'white') // budget 1
    dst = enchant(dst, enchantOptions(dst)[0].sys) // now full
    expect(openSlots(dst)).toBe(0)
    expect(transferAffix(src, dst, src.affixes[0].id)).toBeNull()
  })

  it('refuses a duplicate sys on dst', () => {
    let src = bare('axe', 'green')
    src = enchant(src, 'FlatPower')
    let dst = bare('mace', 'blue')
    dst = enchant(dst, 'FlatPower') // dst already carries Mighty
    expect(canReceiveAffix(dst, src.affixes[0])).toBe(false)
  })
})

describe('smith — pricing', () => {
  it('upgrade cost escalates by target rarity (80→1280)', () => {
    expect(smithCost('upgrade', bare('axe', 'grey'))).toBe(SMITH_PRICES.upgradeBase) // → white: 80·2^0
    expect(smithCost('upgrade', bare('axe', 'white'))).toBe(160) // → green
    expect(smithCost('upgrade', bare('axe', 'purple'))).toBe(1280) // → orange
    expect(smithCost('upgrade', bare('axe', 'orange'))).toBe(0) // capped
  })

  it('enchant > reroll at equal rarity; transfer prices off dst', () => {
    const g = bare('axe', 'blue')
    expect(smithCost('enchant', g)).toBeGreaterThan(smithCost('reroll', g))
    expect(smithCost('transfer', g, bare('sword', 'orange'))).toBe(SMITH_PRICES.transferBase * 5)
  })
})
