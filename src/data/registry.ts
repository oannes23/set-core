/* data/registry — assemble + referentially LINK content sources into a typed GameData.
   ------------------------------------------------------------------------------------
   PURE TS, ZERO DEPENDENCIES, runtime-safe. This is the seam the eventual runtime user-mod
   loader slots into: `buildRegistry` merges an ordered list of sources (base content first,
   then mods) and verifies every cross-reference resolves. SHAPE/vocabulary validation is a
   separate, heavier concern handled build/test-only by `validate.ts` (ajv) — keep ajv out of
   this file so it never reaches the runtime bundle. See MODDING.md §2. */

import type { GameData } from './schema'

/** One layer of content. `data` is a (possibly partial) GameData — a base ships all collections;
 *  a mod may carry only the ones it adds/overrides. */
export interface ContentSource {
  id: string
  data: Partial<GameData>
}

const RECORD_KEYS = ['traps', 'drifts', 'creatures', 'variants', 'templates', 'dungeons'] as const

/** Merge sources in order: within each record-collection, a later source's id overrides an earlier
 *  one (mod-over-base). `encounter` (a singleton, not a record) is taken from the last source that
 *  declares it. The merge is shallow-by-id — a mod replaces a whole entry, it does not deep-patch. */
function mergeSources(sources: ContentSource[]): GameData {
  const out: GameData = {
    traps: {}, drifts: {}, creatures: {}, variants: {}, templates: {}, dungeons: {},
    encounter: { traps: [], drift: '' },
  }
  for (const src of sources) {
    for (const k of RECORD_KEYS) {
      const rec = src.data[k]
      if (rec) Object.assign(out[k], rec)
    }
    if (src.data.encounter) out.encounter = src.data.encounter
  }
  return out
}

const has = (rec: Record<string, unknown>, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(rec, id)

/** Every cross-reference id that fails to resolve, as located messages. Mirrors (and is the runtime
 *  promotion of) the assertions in game-data.test.ts. Referential only — shape/range checks are ajv's. */
export function linkErrors(d: GameData): string[] {
  const errs: string[] = []
  for (const [cid, c] of Object.entries(d.creatures)) {
    for (const t of c.traps ?? []) if (!has(d.traps, t)) errs.push(`creature ${cid} → unknown trap '${t}'`)
    for (const v of c.variants ?? []) if (!has(d.variants, v)) errs.push(`creature ${cid} → unknown variant '${v}'`)
  }
  for (const [did, dg] of Object.entries(d.dungeons)) {
    for (const e of dg.enemy_table) if (!has(d.creatures, e.foe)) errs.push(`dungeon ${did} enemy_table → unknown foe '${e.foe}'`)
    for (const f of dg.sequence ?? []) if (!has(d.creatures, f)) errs.push(`dungeon ${did} sequence → unknown foe '${f}'`)
    for (const el of dg.elite_pool) if (!has(d.creatures, el)) errs.push(`dungeon ${did} elite_pool → unknown foe '${el}'`)
    if (dg.boss && !has(d.creatures, dg.boss)) errs.push(`dungeon ${did} → unknown boss '${dg.boss}'`)
    if (dg.default_foe && !has(d.creatures, dg.default_foe)) errs.push(`dungeon ${did} → unknown default_foe '${dg.default_foe}'`)
    if (dg.drift && !has(d.drifts, dg.drift)) errs.push(`dungeon ${did} → unknown drift '${dg.drift}'`)
    if (dg.template && !has(d.templates, dg.template)) errs.push(`dungeon ${did} → unknown template '${dg.template}'`)
    if (dg.boss_mirror && !has(d.traps, dg.boss_mirror)) errs.push(`dungeon ${did} → unknown boss_mirror '${dg.boss_mirror}'`)
    if (dg.extends && !has(d.dungeons, dg.extends)) errs.push(`dungeon ${did} → unknown extends '${dg.extends}'`)
  }
  for (const t of d.encounter.traps) if (!has(d.traps, t)) errs.push(`encounter → unknown trap '${t}'`)
  if (d.encounter.drift && !has(d.drifts, d.encounter.drift)) errs.push(`encounter → unknown drift '${d.encounter.drift}'`)
  return errs
}

/** Merge the sources and verify referential integrity. Throws on any dangling reference (built-in
 *  content is a programmer error; the eventual user-mod path will switch to skip-and-warn per-source).
 *  Returns the linked GameData ready for the engine. */
export function buildRegistry(sources: ContentSource[]): GameData {
  const data = mergeSources(sources)
  const errs = linkErrors(data)
  if (errs.length) {
    throw new Error(`content link failed (${errs.length}):\n  ${errs.join('\n  ')}`)
  }
  return data
}
