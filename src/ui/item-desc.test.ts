/* ui/item-desc — the extended item tooltip text (pure). */
import { describe, it, expect } from 'vitest'
import { gearTipTitle, gearTipBody, describeAffix, consumableTipTitle, consumableTipBody } from './item-desc'
import type { Affix, GearInstance } from '../engine/items'

const g = (over: Partial<GearInstance> = {}): GearInstance =>
  ({ uid: 'u', kind: 'gear', refId: 'spear', rarity: 'blue', lootTier: 8, affixes: [], ...over })

describe('gear tooltip', () => {
  it('title = rarity + base name', () => {
    expect(gearTipTitle(g())).toBe('Blue Spear')
  })
  it('body spells out the base rider scoped to its colour, native stat, and worth', () => {
    const body = gearTipBody(g())
    expect(body).toContain('Weapon')
    expect(body).toContain('damage per Attack card') // the type-layer rider (×rarity mult)
    expect(body).toMatch(/only on .*Nature sets/) // spear → green affinity scopes the rider
    expect(body).toContain('Power') // native stat
    expect(body).toContain('sells') // worth line
  })
  it('grey gear notes it has no rarity rider', () => {
    expect(gearTipBody(g({ rarity: 'grey' }))).toContain('no rarity rider')
  })
})

describe('affix descriptions', () => {
  const mk = (label: string, components: Affix['components']): Affix => ({ id: 'a', label, components })
  it('stat affix → +N Stat', () => {
    expect(describeAffix(mk('FlatPower', [{ c: 'stat', stat: 'power', amount: 3 }]))).toContain('+3 Power')
  })
  it('rider affix → per-card text', () => {
    expect(describeAffix(mk('AttackDamagePerCard', [{ c: 'rider', riders: { atkDamagePerCard: 2 } }]))).toContain('+2 damage / Attack card')
  })
  it('proc affix → condition → effect', () => {
    const d = describeAffix(mk('OnMatchBonusDamage', [{ c: 'proc', proc: { when: { axis: 'shape', mode: 'all_same', value: 'attack' }, effect: { kind: 'damage', amount: 4 } } }]))
    expect(d).toContain('all-Attack set')
    expect(d).toContain('+4 damage')
  })
  it('mod affix → readable mod', () => {
    expect(describeAffix(mk('DodgeChance', [{ c: 'mod', mod: 'dodge', amount: 0.1 }]))).toContain('10% dodge')
  })
})

describe('consumable tooltip', () => {
  it('title + effect + worth', () => {
    expect(consumableTipTitle('hp_std')).toBe('Healing Potion')
    const body = consumableTipBody('hp_std')
    expect(body).toContain('HP')
    expect(body).toMatch(/sells \d+g/)
  })
})
