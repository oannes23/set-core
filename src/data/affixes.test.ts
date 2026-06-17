/* The themed affix catalog (CRAWL §7) + the slot/tier-gated, inverse-budget roller (sim §12). */
import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { AFFIXES, AFFIX_THEME, rollAffixes, buildAffixComponents, type AffixFile } from './affixes'
import { RARITY, RARITIES } from '../engine/items'
import { gearRiders } from '../engine/gear'
import { makeValidator } from './validate'
import affixesSchema from './content/schemas/affixes.schema.json'

test('the YAML affix catalog passes schema validation', () => {
  const r = makeValidator<AffixFile>(affixesSchema)(AFFIXES)
  if (!r.ok) throw new Error('affix schema errors:\n' + r.errors.join('\n'))
  expect(r.ok).toBe(true)
})

test('catalog integrity: every def is well-formed; LIVE defs carry a make spec; names map + differ from keys', () => {
  const seen = new Set<string>()
  for (const d of AFFIXES) {
    expect(d.sys, 'sys').toBeTruthy()
    expect(d.name, `name ${d.sys}`).toBeTruthy()
    expect(d.name, `name≠sys ${d.sys}`).not.toBe(d.sys)
    expect(seen.has(d.sys), `unique sys ${d.sys}`).toBe(false)
    seen.add(d.sys)
    expect(RARITIES, `minRarity ${d.sys}`).toContain(d.minRarity)
    if (d.live) expect(typeof d.make, `live ${d.sys} has a make spec`).toBe('object')
    expect(AFFIX_THEME[d.sys], `theme map ${d.sys}`).toBe(d.name)
  }
})

test('the magnitude DSL reproduces the old build() math (integer scale, fraction cap, proc label)', () => {
  // integer: scaled(m,k) = max(1, round(m·k)). FlatPower k=2 at m=2.5 → round(5)=5.
  expect(buildAffixComponents({ c: 'stat', stat: 'power', k: 2 }, 2.5)).toEqual([{ c: 'stat', stat: 'power', amount: 5 }])
  // floor at 1 even for tiny magnitudes.
  expect(buildAffixComponents({ c: 'rider', rider: 'atkDamagePerCard' }, 0.1)).toEqual([{ c: 'rider', riders: { atkDamagePerCard: 1 } }])
  // fraction: min(cap, perUnit·m). Evasive 0.03·4=0.12 (< cap 0.2).
  expect(buildAffixComponents({ c: 'mod', mod: 'dodge', perUnit: 0.03, cap: 0.2 }, 4)).toEqual([{ c: 'mod', mod: 'dodge', amount: 0.12 }])
  // fraction cap bites: Keen 0.02·10=0.2 → capped 0.1.
  expect(buildAffixComponents({ c: 'mod', mod: 'critChance', perUnit: 0.02, cap: 0.1 }, 10)).toEqual([{ c: 'mod', mod: 'critChance', amount: 0.1 }])
  // proc: amount scaled by k, {a} filled in the label; on-match carries `when`, no `event`.
  expect(buildAffixComponents({ c: 'proc', when: { axis: 'shape', mode: 'all_same', value: 'attack' }, effect: { kind: 'damage' }, label: '⚔+{a}' }, 3))
    .toEqual([{ c: 'proc', proc: { when: { axis: 'shape', mode: 'all_same', value: 'attack' }, effect: { kind: 'damage', amount: 3 }, label: '⚔+3' } }])
  // literal proc (no magnitude): Guardian's charges:1, literal label, carries `event`.
  expect(buildAffixComponents({ c: 'proc', event: 'wound', effect: { kind: 'charges', amount: 1 }, label: '🛡+1' }, 9))
    .toEqual([{ c: 'proc', proc: { event: 'wound', effect: { kind: 'charges', amount: 1 }, label: '🛡+1' } }])
})

test('rollAffixes mints only LIVE affixes, slot- and tier-gated, within the inverse budget', () => {
  const liveSys = new Set(AFFIXES.filter((d) => d.live).map((d) => d.sys))
  for (const rarity of RARITIES) {
    for (let i = 0; i < 60; i++) {
      const aff = rollAffixes('weapon', rarity, 10, mulberry32(i + 1))
      expect(aff.length).toBeLessThanOrEqual(RARITY[rarity].maxAffixes)
      const labels = aff.map((a) => a.label)
      expect(new Set(labels).size, 'distinct').toBe(labels.length) // no dup affixes on one item
      for (const a of aff) {
        expect(liveSys.has(a.label), `${a.label} is live`).toBe(true)
        expect(a.label, 'weapon never gets armor-only Warding').not.toBe('BlockPerDefendCard')
      }
    }
  }
})

test('tier-gate: white rolls only the white-min (stat) family; riders unlock at green', () => {
  for (let i = 0; i < 60; i++) {
    for (const a of rollAffixes('weapon', 'white', 10, mulberry32(i + 1))) {
      expect(['FlatPower', 'FlatEndurance', 'FlatSpeed'], `white affix ${a.label}`).toContain(a.label)
    }
  }
})

test('grey gear rolls no affixes', () => {
  expect(rollAffixes('weapon', 'grey', 10, mulberry32(1))).toEqual([])
})

test('a rolled RIDER affix folds into gearRiders (the rider family is FUNCTIONAL)', () => {
  // a green+ weapon can roll Honed (+atk/card); find a seed that does, then assert it lands
  let found = false
  for (let i = 0; i < 200 && !found; i++) {
    const aff = rollAffixes('weapon', 'orange', 12, mulberry32(i + 1))
    const honed = aff.find((a) => a.label === 'AttackDamagePerCard')
    if (!honed) continue
    found = true
    const g = { uid: 'g', kind: 'gear' as const, refId: 'axe', rarity: 'grey' as const, lootTier: 0, affixes: [honed] }
    // rarity grey → base rider ×0, so any atk rider here is PURELY from the affix
    expect(gearRiders({ weapon: g }).atkDamagePerCard).toBeGreaterThan(0)
  }
  expect(found, 'Honed rolled at least once across the seeds').toBe(true)
})
