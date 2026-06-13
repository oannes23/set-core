/* engine/foe — assemble a fielded foe from data: creature ⊕ rolled variant ⊕ dungeon template
   (TRAPS.md §7.1) → a FoeRuntime of resolved numbers + Trigger objects.

   THE DATA REBASE (2026-06-12): creatures now AUTHOR their P/E/S statline directly (against the
   parity line `10 + 2(L−1)`, CRAWL §3) — the legacy hp/damage/speed-band → stats bridge is gone.
   assembleFoe just resolves the authored stats + variant/template stat deltas, packages the
   attack via the TEMPO LAW (the foe's own S−P, unchanged — sim-confirmed) or a per-foe override,
   and attaches traps/drift. The per-SWING damage budget is the TELEGRAPH CONTEST (resolve.ts) and
   is finalized in createCombat against the live player's Endurance; here it's seeded at parity. */

import type { Rng } from '../core/rng'
import type { GameData, Dungeon, Trigger, Tier } from '../data/schema'
import type { FoeRuntime, StatBlock } from './state'
import { telegraphPerSwing } from './resolve'

/** The TEMPO LAW (CRAWL §5.6 — unchanged by the rebase): the foe's own S−P picks the packaging.
 *  ≥+4 → 3 chip swings · −1..+3 → 2 swings · −4..−2 → 1 clean hit · −7..−5 → every 2nd round ×2
 *  · ≤−8 → every 3rd round ×3. (The per-round damage budget is conserved by the per-swing roll.) */
export function tempoFromStats(stats: StatBlock): { strikeEvery: number; swings: number } {
  const diff = stats.speed - stats.power
  const strikeEvery = diff <= -8 ? 3 : diff <= -5 ? 2 : 1
  const swings = strikeEvery > 1 ? 1 : diff >= 4 ? 3 : diff >= -1 ? 2 : 1
  return { strikeEvery, swings }
}

/** XP for a kill — COMPUTED from the statline (CRAWL §3 / TUNING.md; retires the authored `xp`
 *  field): `(hp/10 + P + E + S) × (1 + 0.15·trapCount) × tierMult`, tiers ×1/×2/×4 (above the
 *  stat ladder so risk beats grinding). Tricks don't count as traps. Consumed by the loot/levels
 *  build (B2/B4); defined here with the statline it derives from. */
export const XP_TIER_MULT: Record<Tier, number> = { minion: 1, elite: 2, boss: 4 }
/** A foe's STRENGTH VALUE — the statline core that both XP and gold (loot.ts) derive from, so a
 *  tougher foe always pays more with no extra authoring. Pre-tier, pre-trap: `hp/10 + P + E + S`. */
export function foeValue(foe: FoeRuntime): number {
  return foe.hp / 10 + foe.stats.power + foe.stats.endurance + foe.stats.speed
}
export function computeXP(foe: FoeRuntime): number {
  if (foe.xpOverride != null) return foe.xpOverride // teaching foes author it (the dummy's Power 0 breaks the formula)
  const traps = foe.triggers.filter((t) => t.kind !== 'trick').length
  return Math.round(foeValue(foe) * (1 + 0.15 * traps) * XP_TIER_MULT[foe.tier ?? 'minion'])
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
  // authored statline + accumulated variant/template deltas (the old hp/damage/band mods → P/E/S/hp)
  const stats: StatBlock = { ...base.stats }
  let hp = base.hp
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
      stats.power += sm.power ?? 0
      stats.endurance += sm.endurance ?? 0
      stats.speed += sm.speed ?? 0
      hp += sm.hp ?? 0
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
      stats.power += sm.power ?? 0
      stats.endurance += sm.endurance ?? 0
      stats.speed += sm.speed ?? 0
      hp += sm.hp ?? 0
      triggers.push({ name: tpl.name, icon: tpl.icon, desc: tpl.desc, ...tpl.trap })
    }
  }

  const name = (templateName ? templateName + ' ' : '') + (variantName ? variantName + ' ' : '') + base.name
  const drift = dungeon?.drift ? (data.drifts[dungeon.drift] ?? null) : null
  const { strikeEvery, swings } = base.tempo ?? tempoFromStats(stats)

  const foe: FoeRuntime = {
    id: creatureId,
    name,
    tier: base.tier,
    hp: Math.max(1, hp),
    damage: 0, // seeded just below at PARITY; createCombat finalizes vs the live player Endurance
    stats,
    strikeEvery,
    swings,
    triggers,
    drift,
    rules: base.rules ?? {},
    desc: base.desc ?? null,
    xpOverride: base.xp,
  }
  // parity seed: player E = foe Power → contestRate = RATE_BASE → the 25×tier baseline budget.
  // A usable per-swing number for any consumer before a player is attached; createCombat overrides.
  foe.damage = telegraphPerSwing(foe, stats.power)
  return foe
}
