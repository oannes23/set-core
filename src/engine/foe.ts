/* engine/foe — assemble a fielded foe from data: creature ⊕ rolled variant ⊕ dungeon template
   (TRAPS.md §7.1) → a FoeRuntime of resolved numbers + Trigger objects. Ported from assembleFoe. */

import type { Rng } from '../core/rng'
import type { GameData, Dungeon, Trigger, SpeedBand, Speed } from '../data/schema'
import { type FoeRuntime, DEFAULT_WINDUP_S } from './state'

const SPEED_ORDER: SpeedBand[] = ['lumbering', 'slow', 'steady', 'swift', 'frenzied']

export function speedSeconds(data: GameData, speed: Speed, shift: number): number {
  if (typeof speed === 'number') return speed // raw cadence seconds
  let i = SPEED_ORDER.indexOf(speed)
  if (i < 0) i = 2
  i = Math.max(0, Math.min(SPEED_ORDER.length - 1, i + shift))
  return data.speed[SPEED_ORDER[i]]
}

/** Weighted-random pick from a dungeon enemy table. */
export function pickWeightedFoe(table: { foe: string; weight: number }[], rng: Rng): string {
  const tot = table.reduce((s, e) => s + (e.weight || 1), 0)
  let r = rng() * tot
  for (const e of table) {
    r -= e.weight || 1
    if (r < 0) return e.foe
  }
  return table[table.length - 1].foe
}

/** Build a fielded foe. `dungeon` supplies drift / template / boss_mirror context (may be null). */
export function assembleFoe(creatureId: string, dungeon: Dungeon | null, data: GameData, rng: Rng): FoeRuntime | null {
  const base = data.creatures[creatureId]
  if (!base) return null
  let hp = base.hp
  let dmg = base.damage
  let bandShift = 0
  const triggers: Trigger[] = []
  let variantName: string | null = null
  let templateName: string | null = null

  for (const id of base.traps ?? []) {
    const t = data.traps[id]
    if (t) triggers.push(t)
  }

  if (base.variants && base.variants.length) {
    const vid = base.variants[Math.floor(rng() * base.variants.length)]
    const v = data.variants[vid]
    if (v) {
      variantName = v.name
      const sm = v.stat_mod ?? {}
      hp += sm.hp ?? 0
      dmg += sm.damage ?? 0
      bandShift += sm.speed_band ?? 0
      triggers.push({ name: v.name, icon: v.icon, desc: v.desc, ...v.trap })
    }
  }

  // the elite recipe (TRAPS.md §7): EVERY elite telegraphs the boss — the dungeon's boss_mirror
  // (a lesser echo of a boss signature trap) attaches on top of any authored traps, deduped when
  // the elite already authors that exact trap (e.g. the Warlord's own Lesser War Cry).
  if (base.tier === 'elite' && dungeon?.boss_mirror && !(base.traps ?? []).includes(dungeon.boss_mirror)) {
    const m = data.traps[dungeon.boss_mirror]
    if (m) triggers.unshift(m)
  }

  if (dungeon?.template) {
    const tpl = data.templates[dungeon.template]
    if (tpl) {
      templateName = tpl.name
      const sm = tpl.stat_mod ?? {}
      hp += sm.hp ?? 0
      dmg += sm.damage ?? 0
      bandShift += sm.speed_band ?? 0
      triggers.push({ name: tpl.name, icon: tpl.icon, desc: tpl.desc, ...tpl.trap })
    }
  }

  const name = (templateName ? templateName + ' ' : '') + (variantName ? variantName + ' ' : '') + base.name
  const drift = dungeon?.drift ? (data.drifts[dungeon.drift] ?? null) : null
  return {
    id: creatureId,
    name,
    tier: base.tier,
    hp: Math.max(1, hp | 0),
    damage: Math.max(0, dmg | 0),
    cadence: speedSeconds(data, base.speed, bandShift),
    windupMs: (base.windup ?? DEFAULT_WINDUP_S) * 1000,
    triggers,
    drift,
    rules: base.rules ?? {},
    desc: base.desc ?? null,
  }
}
