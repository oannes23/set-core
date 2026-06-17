/* registry.ts — the merge + referential-link layer (zero-dep, runtime-safe). */
import { test, expect } from 'vitest'
import { GAMEDATA } from './game-data'
import { buildRegistry, linkErrors, type ContentSource } from './registry'
import type { GameData } from './schema'

const clone = (d: GameData): GameData => JSON.parse(JSON.stringify(d))

test('real content links clean (no dangling references)', () => {
  expect(linkErrors(GAMEDATA)).toEqual([])
})

test('buildRegistry assembles a base source into the same GameData', () => {
  const built = buildRegistry([{ id: 'base', data: GAMEDATA }])
  expect(built).toEqual(GAMEDATA)
})

test('a later source overrides an earlier entry by id (mod-over-base)', () => {
  const base: ContentSource = { id: 'base', data: GAMEDATA }
  const someCreatureId = Object.keys(GAMEDATA.creatures)[0]
  const modded = clone(GAMEDATA)
  modded.creatures[someCreatureId].name = 'Modded Name'
  const built = buildRegistry([base, { id: 'mod', data: { creatures: { [someCreatureId]: modded.creatures[someCreatureId] } } }])
  expect(built.creatures[someCreatureId].name).toBe('Modded Name')
})

test('a dangling dungeon→boss reference is reported and throws', () => {
  const broken = clone(GAMEDATA)
  const did = Object.keys(broken.dungeons).find((id) => broken.dungeons[id].boss != null)!
  broken.dungeons[did].boss = 'no_such_foe'
  expect(linkErrors(broken).some((e) => e.includes("unknown boss 'no_such_foe'"))).toBe(true)
  expect(() => buildRegistry([{ id: 'base', data: broken }])).toThrow(/link failed/)
})

test('a dangling creature→trap reference is reported', () => {
  const broken = clone(GAMEDATA)
  const cid = Object.keys(broken.creatures).find((id) => (broken.creatures[id].traps ?? []).length > 0)!
  broken.creatures[cid].traps = ['no_such_trap']
  expect(linkErrors(broken).some((e) => e.includes("unknown trap 'no_such_trap'"))).toBe(true)
})
