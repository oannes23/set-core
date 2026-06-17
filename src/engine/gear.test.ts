/* GEAR (CRAWL §7 chunk ①): the equip aggregators (stat bonus + riders), the inverse-budget roller,
   and the flat post-contest rider application in resolveSet. */
import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { RARITY, RARITIES, sanitizeItem, isGear, type GearInstance } from './items'
import { gearStatBonus, gearRiders, gearMods, equippedList, rollGear } from './gear'
import { resolveSet } from './resolve'
import type { Card } from '../core/affine'

const inst = (over: Partial<GearInstance>): GearInstance => ({ uid: 'u', kind: 'gear', refId: 'axe', rarity: 'white', lootTier: 0, affixes: [], ...over })

test('gearRiders scopes the WEAPON base rider to its match-type; armor stays unscoped', () => {
  const blueAxe = inst({ refId: 'axe', rarity: 'blue' }) // axe (red) +1 atk/card × blue ×3 = 3, SCOPED to red
  const greenPlate = inst({ refId: 'plate', rarity: 'green' }) // plate (no match-type) +1 block/card × green ×2 = 2
  const r = gearRiders({ weapon: blueAxe, armor: greenPlate })
  expect(r.atkDamagePerCard).toBe(0) // the weapon's damage is now type-scoped, not flat
  expect(r.scopedAtkPerCard).toBe(3)
  expect(r.scopedColor).toBe(0) // red
  expect(r.blockPerDefendCard).toBe(2) // armor block applies on any Defend card (unscoped)
  expect(r.manaPerMatch).toBe(0)
})

test('the TYPE layer: a weapon rider fires only on its colour (red weapon → red sets, not green)', () => {
  const stats = { power: 10, endurance: 10, speed: 10 }
  const foe = { power: 10, endurance: 10, speed: 10 }
  const redAxe = gearRiders({ weapon: inst({ refId: 'axe', rarity: 'blue' }) }) // scoped red, +3 dmg/Attack card
  const redAttacks: [Card, Card, Card] = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]] // 3 all-red Attacks
  const greenAttacks: [Card, Card, Card] = [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]] // 3 all-green Attacks
  const dRed = resolveSet(redAttacks, stats, foe, mulberry32(1), redAxe).damage - resolveSet(redAttacks, stats, foe, mulberry32(1)).damage
  const dGreen = resolveSet(greenAttacks, stats, foe, mulberry32(1), redAxe).damage - resolveSet(greenAttacks, stats, foe, mulberry32(1)).damage
  expect(dRed).toBe(9) // +3 per Attack card × 3, ONLY on the matching colour
  expect(dGreen).toBe(0) // a green set → the red weapon's rider does NOT fire
})

test('grey gear contributes no rider (×0)', () => {
  expect(gearRiders({ weapon: inst({ refId: 'axe', rarity: 'grey' }) }).atkDamagePerCard).toBe(0)
})

test('gearStatBonus sums native stats + StatMod affixes', () => {
  const axe = inst({ refId: 'axe', rarity: 'blue', affixes: [{ id: 'a', label: 'FlatPower', components: [{ c: 'stat', stat: 'power', amount: 2 }] }] })
  const b = gearStatBonus({ weapon: axe }) // axe native +1 power, affix +2 power
  expect(b.power).toBe(3)
  expect(b.endurance).toBe(0)
  expect(equippedList({ weapon: axe }).length).toBe(1)
})

test('empty / undefined equipped is the zero contribution', () => {
  expect(gearRiders(undefined)).toEqual({ atkDamagePerCard: 0, blockPerDefendCard: 0, manaPerMatch: 0, scopedColor: null, scopedAtkPerCard: 0, scopedManaPerMatch: 0 })
  expect(gearStatBonus({})).toEqual({ power: 0, endurance: 0, speed: 0 })
})

test('rollGear: affix count is RANDOM within [1, maxAffixes] (inverse budget); grey rolls none', () => {
  const rng = mulberry32(7)
  for (const rarity of RARITIES) {
    for (let i = 0; i < 30; i++) {
      const g = rollGear('axe', rarity, 4, rng)
      expect(g.rarity).toBe(rarity)
      expect(g.affixes.length).toBeLessThanOrEqual(RARITY[rarity].maxAffixes)
      if (RARITY[rarity].maxAffixes > 0) expect(g.affixes.length).toBeGreaterThanOrEqual(1)
      else expect(g.affixes.length).toBe(0)
      for (const a of g.affixes) expect(a.components.length).toBeGreaterThan(0)
    }
  }
})

test('resolveSet applies riders FLAT and post-contest (NO_RIDERS = unchanged)', () => {
  const stats = { power: 10, endurance: 10, speed: 10 }
  const foe = { power: 10, endurance: 10, speed: 10 }
  const redAttacks: [Card, Card, Card] = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]] // 3 all-red Attack cards
  const base = resolveSet(redAttacks, stats, foe, mulberry32(1))
  const withR = resolveSet(redAttacks, stats, foe, mulberry32(1), { atkDamagePerCard: 2, blockPerDefendCard: 5, manaPerMatch: 3 })
  expect(withR.damage - base.damage).toBe(6) // +2 per Attack card × 3, flat
  expect(withR.block).toBe(base.block) // no Defend cards → block rider doesn't apply
  expect(withR.mana[0] - base.mana[0]).toBe(3) // mono-colour set → caster mana rider lands
})

test('Primed: a churned-and-matched card counts one quality tier higher (more output)', () => {
  const stats = { power: 10, endurance: 10, speed: 10 }
  const foe = { power: 10, endurance: 10, speed: 10 }
  const lightAttacks: [Card, Card, Card] = [[0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0]] // 3 light (tier-0) Attack cards
  const base = resolveSet(lightAttacks, stats, foe, mulberry32(1))
  const primed = resolveSet(lightAttacks, stats, foe, mulberry32(1), undefined, 0, [true, false, false])
  expect(primed.damage).toBeGreaterThan(base.damage) // the primed card bumps ① → ② → more damage
})

test('gearMods sums affix mod components; penetration raises the attack contest', () => {
  const wpn = inst({ refId: 'axe', rarity: 'blue', affixes: [{ id: 'p', label: 'Penetration', components: [{ c: 'mod', mod: 'penetration', amount: 4 }] }] })
  const arm = inst({ refId: 'plate', rarity: 'green', affixes: [{ id: 's', label: 'FlatDamageReduction', components: [{ c: 'mod', mod: 'soak', amount: 3 }] }] })
  const m = gearMods({ weapon: wpn, armor: arm })
  expect(m.penetration).toBe(4)
  expect(m.soak).toBe(3)
  // penetration shrinks the foe's effective Endurance → a higher attack rate (more damage)
  const stats = { power: 10, endurance: 10, speed: 10 }
  const foe = { power: 10, endurance: 18, speed: 10 } // a tanky foe
  const atks: [Card, Card, Card] = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]]
  const bare = resolveSet(atks, stats, foe, mulberry32(1))
  const pen = resolveSet(atks, stats, foe, mulberry32(1), undefined, 4)
  expect(pen.damage).toBeGreaterThan(bare.damage) // anti-armour: ignoring 4 Endurance hits harder
})

test('sanitizeItem round-trips a gear instance and clamps a bad rarity to grey', () => {
  const good = sanitizeItem({ uid: 'g1', kind: 'gear', refId: 'sword', rarity: 'purple', lootTier: 5, affixes: [{ id: 'x', label: 'FlatSpeed', components: [] }] })
  expect(good && isGear(good) && good.rarity).toBe('purple')
  const bad = sanitizeItem({ uid: 'g2', kind: 'gear', refId: 'sword', rarity: 'ultra', lootTier: -3, affixes: 'nope' })
  expect(bad && isGear(bad) && good).toBeTruthy()
  if (bad && isGear(bad)) {
    expect(bad.rarity).toBe('grey')
    expect(bad.lootTier).toBe(0)
    expect(bad.affixes).toEqual([])
  }
})
