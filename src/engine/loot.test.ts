/* The loot roll (CRAWL §3): gold derived from foe strength (own coefficient), category-first
   tables, guaranteed elite/boss gold, depth scaling, consumable-only v1 (gear/spellbook off).
   Deterministic (seeded rng). */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe, foeValue } from './foe'
import { CONSUMABLES } from './consumables'
import { rollGold, rollRoomLoot, rollConsumable, GOLD_K, ENABLED } from './loot'
import { GEAR } from '../data/gear'
import { RARITY, RARITIES } from './items'

const W = GAMEDATA.dungeons.goblin_warren
const foe = (id: string) => assembleFoe(id, W, GAMEDATA, mulberry32(1))!

test('gold derives from foe strength × GOLD_K (the low band), with bounded variance', () => {
  const g = foe('goblin')
  const expected = foeValue(g) * GOLD_K // a goblin ≈ 47 × 0.12 ≈ 5–6g
  let lo = Infinity, hi = -Infinity, sum = 0, n = 4000
  for (let i = 0; i < n; i++) { const v = rollGold(g, 1, mulberry32(i + 1)); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v }
  expect(sum / n).toBeGreaterThan(expected * 0.9) // mean ≈ the standard amount
  expect(sum / n).toBeLessThan(expected * 1.1)
  expect(lo).toBeGreaterThanOrEqual(1) // never zero
  expect(hi).toBeLessThan(expected * 1.5) // ±30% bounded
})

test('depth scaling lifts gold the deeper you push', () => {
  const g = foe('goblin')
  const mean = (depth: number) => { let s = 0; for (let i = 0; i < 3000; i++) s += rollGold(g, depth, mulberry32(i + 1)); return s / 3000 }
  expect(mean(10)).toBeGreaterThan(mean(1) * 1.4) // +7%/room → room 10 ≈ +63%
})

test('gear is LIVE in the loot tables (chunk ②); items + gear validate', () => {
  expect(ENABLED).toContain('gear')
  let sawGear = false
  for (let i = 0; i < 300; i++) {
    const loot = rollRoomLoot(foe('goblin'), 3, mulberry32(i + 1))
    for (const id of loot.items) expect(CONSUMABLES[id], `item ${id} is a real consumable`).toBeDefined()
    for (const g of loot.gear) {
      expect(g.kind).toBe('gear')
      expect(GEAR[g.refId], `gear ${g.refId} is a real base type`).toBeDefined()
      expect(RARITIES, `rarity ${g.rarity}`).toContain(g.rarity)
      expect(g.affixes.length).toBeLessThanOrEqual(RARITY[g.rarity].maxAffixes)
      sawGear = true
    }
  }
  expect(sawGear).toBe(true) // gear actually drops now
})

test('the gear pity sawtooth: gear-less drops raise the gear weight, a hit resets it', () => {
  // thread the pity across many minion rooms; assert it never exceeds the streak and resets on a hit
  let pity = 0
  let hits = 0
  for (let i = 0; i < 400; i++) {
    const prev = pity
    const l = rollRoomLoot(foe('goblin'), 1, mulberry32(i + 1), pity)
    pity = l.gearPity
    if (l.gear.length) { hits++; expect(pity).toBe(0) } // a gear hit zeroes the counter
    else expect(pity).toBe(prev + 1) // a gear-less single-drop minion ticks +1
  }
  expect(hits).toBeGreaterThan(0) // the boosted weight does eventually pay out
})

test('a minion drops 1 thing; an elite/boss pay a guaranteed gold WAGE on top of more drops', () => {
  // minion: exactly one drop (gold / consumable / gear), no wage
  let minionGoldRooms = 0
  for (let i = 0; i < 400; i++) {
    const l = rollRoomLoot(foe('goblin'), 1, mulberry32(i + 1))
    const things = (l.gold > 0 ? 1 : 0) + l.items.length + l.gear.length
    expect(things).toBe(1) // one category roll, one outcome
    if (l.gold > 0) minionGoldRooms++
  }
  expect(minionGoldRooms / 400).toBeGreaterThan(0.5) // gold ~60% (minion gold:60 / cons:30 / gear:10)
  // boss: a big guaranteed wage means gold is ALWAYS present and large
  const boss = foe('goblin_king')
  for (let i = 0; i < 100; i++) {
    const l = rollRoomLoot(boss, 8, mulberry32(i + 100))
    expect(l.gold).toBeGreaterThan(rollGold(boss, 8, mulberry32(i + 100))) // ≥ the ×4 wage alone
  }
})

test('a full warren clear banks ~100–150g (the design band)', () => {
  // simulate a representative clear: ~9 minions (mixed), 2 elites, 1 boss, climbing depth
  let total = 0, runs = 500
  for (let r = 0; r < runs; r++) {
    const rng = mulberry32(r * 13 + 7)
    let depth = 0, gold = 0
    const minions = ['goblin', 'cave_bat', 'goblin_shaman', 'goblin_archer', 'goblin_sapper', 'warren_rat']
    for (let m = 0; m < 9; m++) { depth++; gold += rollRoomLoot(assembleFoe(minions[m % minions.length], W, GAMEDATA, rng)!, depth, rng).gold }
    for (const el of ['goblin_warlord', 'ember_shaman']) { depth++; gold += rollRoomLoot(assembleFoe(el, W, GAMEDATA, rng)!, depth, rng).gold }
    depth++; gold += rollRoomLoot(assembleFoe('goblin_king', W, GAMEDATA, rng)!, depth, rng).gold
    total += gold
  }
  const avg = total / runs
  expect(avg).toBeGreaterThan(90)
  expect(avg).toBeLessThan(220) // a comfortable band around the ~100–150 target (variance + depth)
})

test('rollConsumable always returns a real consumable id', () => {
  for (let i = 0; i < 300; i++) expect(CONSUMABLES[rollConsumable(i % 12, i % 2 === 0, mulberry32(i + 1))]).toBeDefined()
})
