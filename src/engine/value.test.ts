/* engine/value — item valuation + sell-back price (CRAWL §3). */
import { describe, it, expect } from 'vitest'
import { gearValue, consumableValue, itemValue, sellValue, sellValueOfConsumable, SELL_RATE } from './value'
import type { GearInstance, Rarity } from './items'

const bare = (rarity: Rarity, lootTier = 0, affixes = 0): GearInstance =>
  ({ uid: `u_${rarity}`, kind: 'gear', refId: 'axe', rarity, lootTier,
     affixes: Array.from({ length: affixes }, (_, i) => ({ id: `a${i}`, label: 'FlatPower', components: [] })) })

describe('gear value', () => {
  it('rises monotonically with rarity', () => {
    const order: Rarity[] = ['grey', 'white', 'green', 'blue', 'purple', 'orange']
    const vals = order.map((r) => gearValue(bare(r)))
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1])
  })
  it('rises with loot-tier and affix count', () => {
    expect(gearValue(bare('blue', 10))).toBeGreaterThan(gearValue(bare('blue', 0)))
    expect(gearValue(bare('blue', 5, 3))).toBeGreaterThan(gearValue(bare('blue', 5, 0)))
  })
})

describe('consumable value', () => {
  it('scales by tier (minor < std < major)', () => {
    expect(consumableValue('hp_minor')).toBeLessThan(consumableValue('hp_std'))
    expect(consumableValue('hp_std')).toBeLessThan(consumableValue('hp_major'))
  })
  it('a scroll is worth more than a standard potion', () => {
    expect(consumableValue('scroll_firebolt')).toBeGreaterThan(consumableValue('hp_std'))
  })
  it('unknown ref → 0', () => {
    expect(consumableValue('nope')).toBe(0)
  })
})

describe('sell-back', () => {
  it('is SELL_RATE of value, floored, min 1', () => {
    const g = bare('orange', 10, 5)
    expect(sellValue(g)).toBe(Math.max(1, Math.floor(gearValue(g) * SELL_RATE)))
    expect(sellValueOfConsumable('hp_std')).toBe(Math.max(1, Math.floor(consumableValue('hp_std') * SELL_RATE)))
  })
  it('itemValue routes gear vs consumable', () => {
    expect(itemValue(bare('green'))).toBe(gearValue(bare('green')))
    expect(itemValue({ uid: 'c1', kind: 'consumable', refId: 'hp_minor' })).toBe(consumableValue('hp_minor'))
  })
  it('a worthless ref sells for 0', () => {
    expect(sellValueOfConsumable('nope')).toBe(0)
  })
})
