/* engine/foe — assemble a fielded foe from data: creature ⊕ rolled variant ⊕ dungeon template
   (TRAPS.md §7.1) → a FoeRuntime of resolved numbers + Trigger objects. Ported from assembleFoe. */

import type { Rng } from '../core/rng'
import type { GameData, Dungeon, Trigger, SpeedBand, Speed } from '../data/schema'
import type { FoeRuntime } from './state'

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
  const cadence = speedSeconds(data, base.speed, bandShift)

  // ---- RESOLUTION v3 FIRST-CUT STAT DERIVATION (⚠ sim-fodder — the data rebase will author
  // P/E/S directly; until then the legacy hp/damage/speed-band numbers convert here, one place).
  // Speed stat: the old band, read as the agency contest (lumbering 6 … frenzied 14).
  const speedStat = dmg <= 0 ? 10 : cadence >= 20 ? 6 : cadence >= 16 ? 8 : cadence >= 13 ? 10 : cadence >= 10 ? 12 : 14
  // Power: TIER-ANCHORED (the old DPS numbers were balanced for a different block/clock model and
  // do not transfer — minions sit below the parity-25 budget, elites above, bosses on top), with a
  // small offset for the foe's authored per-hit heft so heavy hitters keep their identity.
  const tierP = base.tier === 'boss' ? 13 : base.tier === 'elite' ? 11 : 8
  const heft = Math.max(-3, Math.min(3, Math.round((dmg / 30 - 0.4) * 5)))
  const power = dmg <= 0 ? 0 : Math.min(20, Math.max(1, tierP + heft))
  // Endurance: parity baseline + a tier bump (elites/bosses blunt your per-card damage).
  const endurance = 10 + (base.tier === 'boss' ? 4 : base.tier === 'elite' ? 2 : 0)

  // ---- THE TEMPO LAW (CRAWL §5.6): Speed−Power picks the PACKAGING; Power fixes the budget.
  // diff ≥ +4 → 3 chip swings/round · −1..+3 → 2 swings (equals → two hits) · −4..−2 → one clean
  // hit · −7..−5 → every 2nd round at double budget · ≤ −8 → every 3rd round at triple.
  const diff = speedStat - power
  const strikeEvery = dmg <= 0 ? 1 : diff <= -8 ? 3 : diff <= -5 ? 2 : 1
  const swings = dmg <= 0 ? 1 : strikeEvery > 1 ? 1 : diff >= 4 ? 3 : diff >= -1 ? 2 : 1
  // Damage conservation: per-swing roll budget keeps round-rate = Power × DMG_BUDGET_K.
  const perSwing = dmg <= 0 ? 0 : Math.max(1, Math.round((power * DMG_BUDGET_K * strikeEvery) / swings))

  return {
    id: creatureId,
    name,
    tier: base.tier,
    hp: Math.max(1, Math.round((hp * LEGACY_HP_SCALE) / 5) * 5), // HP-100 world (kill budgets re-derive in the sim)
    damage: perSwing,
    stats: { power, endurance, speed: speedStat },
    cadence,
    strikeEvery,
    swings,
    triggers,
    drift,
    rules: base.rules ?? {},
    desc: base.desc ?? null,
  }
}

/** Round damage budget per point of foe Power (parity Power 10 → ~25/round, the even-exchange
 *  quantum a magnitude-6 Defend set neutralizes). First-cut constant — TUNING.md. */
export const DMG_BUDGET_K = 2.5
/** Legacy data → HP-100 world scale (the data rebase retires this). */
export const LEGACY_HP_SCALE = 10 / 3
