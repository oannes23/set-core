/* Guards the typed data's REFERENTIAL INTEGRITY — every id a creature/dungeon points at resolves (the
   "dangling foe/trap/variant id" bug the prototype only surfaces at runtime when you pick that foe).
   (The migration-era byte-parity check against prototype/game-data.js is retired: the migration is
   complete and the live `src/` content now intentionally evolves past the archived oracle — new foes,
   elites, retuned dungeons. The prototype is a frozen snapshot, not a living mirror.) */

import { test, expect } from 'vitest'
import { GAMEDATA } from './game-data'

const has = (rec: Record<string, unknown>, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(rec, id)

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
