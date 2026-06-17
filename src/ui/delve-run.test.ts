/* The delve run-state economy (CRAWL §3/§6), DOM-free: loot accrual into the satchel/purse/gear, the
   bag cap, and the exit decisions (death tithe vs safe-exit banking). Deterministic (seeded rng). */

import { test, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { GAMEDATA } from '../data/game-data'
import { assembleFoe } from '../engine/foe'
import { rollGear } from '../engine/gear'
import { RUN_BAG_CAP, createDelve } from '../engine/delve'
import { GEAR } from '../data/gear'
import { makeItem } from '../engine/items'
import { sellValue } from '../engine/value'
import { DEFAULT_STORAGE_CAP, DEATH_TITHE, takeConsumablesByRef, type Account } from './bank'
import { applyRoomLoot, bankRunGear, resolveDelveExit, resolveLootKeep, type DelveRun } from './delve-run'

const W = GAMEDATA.dungeons.goblin_warren
const foe = (id: string) => assembleFoe(id, W, GAMEDATA, mulberry32(1))!
const acct = (over: Partial<Account> = {}): Account => ({ gold: 0, storage: [], storageCap: DEFAULT_STORAGE_CAP, seeded: true, upgrades: { merchant: 0, quality: 0 }, ...over })
const run = (over: Partial<DelveRun> = {}): DelveRun => ({ d: { ...createDelve('goblin_warren', mulberry32(1)), room: 1 }, bag: [], tier: 'minion', gold: 0, gearFound: [], gearPity: 0, ...over })
const gear = (n: number) => Array.from({ length: n }, (_, i) => rollGear(Object.keys(GEAR)[0], 'green', 8, mulberry32(i + 1)))

test('applyRoomLoot accrues gold + bag + carries the gear-pity sawtooth', () => {
  const r = run()
  const loot = applyRoomLoot(r, foe('goblin'), mulberry32(7))
  expect(loot.gold).toBeGreaterThan(0) // the guaranteed gold wage
  expect(r.gold).toBe(loot.gold) // accrued into the purse
  expect(r.gearPity).toBe(loot.gear.length ? 0 : r.gearPity) // pity resets on a gear drop, else carries
  expect(r.bag).toHaveLength(loot.added.length) // satchel got exactly the added consumables
  expect(loot.added.every((id) => GAMEDATA != null && id.length > 0)).toBe(true)
})

test('applyRoomLoot honors the satchel cap — overflow consumables go to `left`, never past the cap', () => {
  const r = run({ bag: Array.from({ length: RUN_BAG_CAP }, () => 'hp_minor') }) // satchel already full
  const loot = applyRoomLoot(r, foe('goblin'), mulberry32(3))
  expect(r.bag).toHaveLength(RUN_BAG_CAP) // never exceeds the cap
  expect(loot.added).toHaveLength(0) // nothing could be added
})

test('bankRunGear stows what fits and reports the overflow when Storage is near-full', () => {
  const account = acct({ storageCap: 5, storage: [] })
  const r = run({ gearFound: gear(8) }) // 8 pieces, only 5 slots
  const { account: after, banked, overflow } = bankRunGear(account, r)
  expect(banked).toBe(5)
  expect(overflow).toBe(3)
  expect(after.storage).toHaveLength(5)
})

test('resolveDelveExit("safe") banks carried gold + found gear into the vault', () => {
  const account = acct({ gold: 100 })
  const r = run({ gold: 40, gearFound: gear(2) })
  const { account: after, outcome } = resolveDelveExit(account, r, 'safe')
  expect(outcome.exit).toBe('safe')
  expect(outcome.goldBanked).toBe(40)
  expect(outcome.goldTotal).toBe(140)
  expect(after.gold).toBe(140)
  expect(outcome.gearBanked).toBe(2)
  expect(after.storage).toHaveLength(2)
  expect(outcome.goldLost).toBe(0)
})

test('resolveDelveExit("death") forfeits carried gold + gear and bites a 12% vault tithe', () => {
  const account = acct({ gold: 200 })
  const r = run({ gold: 40, gearFound: gear(2) })
  const { account: after, outcome } = resolveDelveExit(account, r, 'death')
  expect(outcome.exit).toBe('death')
  expect(outcome.goldLost).toBe(40) // the carried gold is lost where you fell
  expect(outcome.tithe).toBe(Math.floor(200 * DEATH_TITHE)) // 24
  expect(after.gold).toBe(200 - 24)
  expect(outcome.gearBanked).toBe(0) // nothing banks on death
  expect(after.storage).toHaveLength(0)
})

test('takeConsumablesByRef pulls one instance per refId, skipping what is not in stock', () => {
  const account = acct({ storage: [makeItem('consumable', 'hp_std'), makeItem('consumable', 'hp_std'), makeItem('consumable', 'speed_std')] })
  const { taken, account: after } = takeConsumablesByRef(account, ['hp_std', 'hp_std', 'speed_std', 'hp_std'])
  expect(taken).toEqual(['hp_std', 'hp_std', 'speed_std']) // only 2 hp_std + 1 speed in stock; the 4th hp_std is skipped
  expect(after.storage).toHaveLength(0) // all matched instances removed
})

test('resolveLootKeep banks run gold + sale gold, keeps chosen gear/consumables', () => {
  const account = acct({ gold: 100, storageCap: 20 })
  const keepGear = gear(2)
  const res = resolveLootKeep(account, 40, 17, keepGear, ['hp_std', 'hp_std'])
  expect(res.vault).toBe(100 + 40 + 17) // run gold + sale proceeds
  expect(res.gearKept).toBe(2)
  expect(res.consKept).toBe(2)
  expect(res.account.storage).toHaveLength(4) // 2 gear + 2 consumables minted
  expect(res.overflow).toBe(0)
})

test('resolveLootKeep auto-sells kept items that overflow a full Storage (never silently lost)', () => {
  const account = acct({ gold: 0, storageCap: 1 }) // only one free slot
  const keepGear = gear(3) // 3 kept, only 1 fits → 2 auto-sold
  const res = resolveLootKeep(account, 0, 0, keepGear, [])
  expect(res.gearKept).toBe(1)
  expect(res.overflow).toBe(2)
  expect(res.overflowGold).toBe(keepGear.slice(1).reduce((s, g) => s + sellValue(g), 0))
  expect(res.vault).toBe(res.overflowGold) // the overflow's sell-back is the only gold
})
