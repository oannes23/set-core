/* Guards the typed data: (1) it stays byte-equivalent to the prototype oracle (game-data.js) so the
   two copies can't silently drift during migration, and (2) every id reference resolves — the class
   of "dangling foe/trap/drift id" bug the prototype only surfaces at runtime when you pick that foe. */

import { test, expect, beforeAll } from 'vitest'
import { GAMEDATA } from './game-data'
import type { GameData } from './schema'

let oracle: GameData
beforeAll(async () => {
  // prototype/game-data.js is a classic script that assigns window.GAMEDATA — stub window, then load
  // it for side effects. A variable specifier keeps TS from resolving the untyped .js (it's not a module).
  ;(globalThis as unknown as { window: { GAMEDATA?: GameData } }).window = {}
  const oraclePath = '../../prototype/game-data.js'
  await import(/* @vite-ignore */ oraclePath)
  oracle = (globalThis as unknown as { window: { GAMEDATA: GameData } }).window.GAMEDATA
})

const has = (rec: Record<string, unknown>, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(rec, id)

test('typed data matches the prototype oracle (game-data.js) exactly', () => {
  // `voice` is a deliberate post-migration addition (combat-log flavour, UI-only) with no oracle
  // counterpart — strip it so this guard still catches *unintended* drift but allows the new field.
  const g = structuredClone(GAMEDATA)
  for (const cr of Object.values(g.creatures)) delete (cr as { voice?: unknown }).voice
  expect(g).toEqual(oracle)
})

test('every creature trap / variant id resolves', () => {
  for (const [cid, c] of Object.entries(GAMEDATA.creatures)) {
    for (const t of c.traps ?? []) expect(has(GAMEDATA.traps, t), `${cid} → trap ${t}`).toBe(true)
    for (const v of c.variants ?? []) expect(has(GAMEDATA.variants, v), `${cid} → variant ${v}`).toBe(true)
  }
})

test('every dungeon reference (foe / drift / template / mirror / extends) resolves', () => {
  for (const [did, d] of Object.entries(GAMEDATA.dungeons)) {
    for (const e of d.enemy_table) expect(has(GAMEDATA.creatures, e.foe), `${did} table → ${e.foe}`).toBe(true)
    for (const f of d.sequence ?? []) expect(has(GAMEDATA.creatures, f), `${did} sequence → ${f}`).toBe(true)
    for (const el of d.elite_pool) expect(has(GAMEDATA.creatures, el), `${did} elite → ${el}`).toBe(true)
    if (d.boss) expect(has(GAMEDATA.creatures, d.boss), `${did} boss → ${d.boss}`).toBe(true)
    if (d.default_foe) expect(has(GAMEDATA.creatures, d.default_foe), `${did} default_foe → ${d.default_foe}`).toBe(true)
    if (d.drift) expect(has(GAMEDATA.drifts, d.drift), `${did} drift → ${d.drift}`).toBe(true)
    if (d.template) expect(has(GAMEDATA.templates, d.template), `${did} template → ${d.template}`).toBe(true)
    if (d.boss_mirror) expect(has(GAMEDATA.traps, d.boss_mirror), `${did} mirror → ${d.boss_mirror}`).toBe(true)
    if (d.extends) expect(has(GAMEDATA.dungeons, d.extends), `${did} extends → ${d.extends}`).toBe(true)
  }
})

test('encounter ids and named speed bands resolve', () => {
  for (const t of GAMEDATA.encounter.traps) expect(has(GAMEDATA.traps, t), `encounter trap ${t}`).toBe(true)
  expect(has(GAMEDATA.drifts, GAMEDATA.encounter.drift)).toBe(true)
  for (const [cid, c] of Object.entries(GAMEDATA.creatures)) {
    if (typeof c.speed === 'string') expect(has(GAMEDATA.speed, c.speed), `${cid} speed ${c.speed}`).toBe(true)
  }
})
