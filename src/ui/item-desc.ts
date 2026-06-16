/* ui/item-desc — the EXTENDED item description for hover tooltips: exactly what a piece does in-game,
   layer by layer. For GEAR: the base type (slot/school/native stat), the per-rarity BASE rider (the
   type layer — weapon damage / armor block / caster mana, with its real firing condition), the
   match-type affinity, and every rolled AFFIX spelled out (stat / rider / gear-mod / proc with its
   condition + magnitude). For CONSUMABLES: the effect + kind + worth. Pure strings (HTML via <br>);
   the caller wraps them as data-tip attributes. Mirrors live combat behaviour (engine/resolve):
   weapon damage riders fire per Attack card (the per-colour SCOPING is deferred — see matchType note),
   the caster mana rider fires only on a mono-colour set. */

import { GEAR } from '../data/gear'
import { affixBySys } from '../data/affixes'
import { RARITY, type Affix, type AffixProc, type GearMods, type GearInstance, type StatKey } from '../engine/items'
import { CONSUMABLES } from '../engine/consumables'
import { itemValue, sellValue, consumableValue, sellValueOfConsumable } from '../engine/value'
import { displayName } from './dev'

const STAT_LABEL: Record<StatKey, string> = { power: 'Power', endurance: 'Endurance', speed: 'Speed' }
const RARITY_NAME: Record<string, string> = { grey: 'Grey', white: 'White', green: 'Green', blue: 'Blue', purple: 'Purple', orange: 'Orange' }
const SLOT_NAME: Record<string, string> = { weapon: 'Weapon', armor: 'Armor', relic: 'Relic', trinket1: 'Trinket', trinket2: 'Trinket' }
const AFFINITY: Record<string, string> = { red: '🔥 Fire', green: '🌿 Nature', blue: '❄️ Frost', rainbow: '🌈 Rainbow' }

const pct = (x: number): string => `${Math.round(x * 100)}%`

/** A gear-exclusive mod (dodge/pen/soak/lifesteal/crit) in words. */
function describeMod(mod: keyof GearMods, amount: number): string {
  switch (mod) {
    case 'dodge': return `+${pct(amount)} dodge chance`
    case 'penetration': return `+${amount} armour penetration`
    case 'soak': return `+${amount} damage soak`
    case 'lifesteal': return `+${pct(amount)} lifesteal`
    case 'critChance': return `+${pct(amount)} crit chance`
    case 'critMult': return `+${amount.toFixed(2)}× crit damage`
  }
}

/** A match/event condition for a proc, in words (covers the conditions the affix catalog actually uses). */
function describeProcWhen(p: AffixProc): string {
  if (p.event === 'wound') return 'on taking a wound'
  if (p.event === 'kill') return 'on a kill'
  if (p.event === 'lowHP') return 'while below 30% HP'
  const w = p.when
  if (!w || !('axis' in w)) return 'on a match' // CompoundCondition (when.all) — affix procs don't use these
  if (w.axis === 'shape' && w.mode === 'all_same') return `on an all-${w.value === 'attack' ? 'Attack' : w.value === 'defend' ? 'Defend' : 'Move'} set`
  if (w.axis === 'color' && w.mode === 'all_different') return 'on a rainbow set'
  if (w.axis === 'color' && w.mode === 'all_same') return w.value != null ? `on an all-${AFFINITY[String(w.value)]?.split(' ')[1] ?? w.value} set` : 'on a mono-colour set'
  return 'on a match'
}

function describeProcEffect(p: AffixProc): string {
  const e = p.effect
  switch (e.kind) {
    case 'damage': return `+${e.amount} damage`
    case 'mana': return `+${e.amount} mana`
    case 'block': return `+${e.amount} Block`
    case 'heal': return `heal ${e.amount} HP`
    case 'charges': return `+${e.amount} Tactics charge`
    case 'delay': return `delay the foe ${e.seconds}s`
  }
}

/** One affix as "<Name> — <exact effect>". Stat/rider/mod give precise magnitudes; procs give
 *  condition → effect; anything else falls back to the catalog's mechanic note. */
export function describeAffix(a: Affix): string {
  const name = displayName(a.label)
  const bits: string[] = []
  for (const c of a.components) {
    if (c.c === 'stat') bits.push(`+${c.amount} ${STAT_LABEL[c.stat]}`)
    else if (c.c === 'rider') {
      if (c.riders.atkDamagePerCard) bits.push(`+${c.riders.atkDamagePerCard} damage / Attack card`)
      if (c.riders.blockPerDefendCard) bits.push(`+${c.riders.blockPerDefendCard} Block / Defend card`)
      if (c.riders.manaPerMatch) bits.push(`+${c.riders.manaPerMatch} mana / mono-colour set`)
    } else if (c.c === 'mod') bits.push(describeMod(c.mod, c.amount))
    else if (c.c === 'proc') bits.push(`${describeProcWhen(c.proc)} → ${describeProcEffect(c.proc)}`)
  }
  if (!bits.length) { const note = affixBySys(a.label)?.note; if (note) bits.push(note) } // trigger/granted: fall back to the note
  return `${name} — ${bits.join(', ')}`
}

export const gearTipTitle = (g: GearInstance): string => {
  const base = GEAR[g.refId]
  return `${RARITY_NAME[g.rarity] ?? g.rarity} ${base?.name ?? g.refId}`
}

/** The full gear breakdown body (HTML, <br>-separated lines). */
export function gearTipBody(g: GearInstance): string {
  const base = GEAR[g.refId]
  if (!base) return 'Unknown item.'
  const lines: string[] = []
  lines.push(`${SLOT_NAME[base.slot] ?? base.slot}${base.school ? ` · ${base.school}` : ''} · loot-tier ${g.lootTier}`)
  if (base.nativeStat) lines.push(`+${base.nativeStat.amount} ${STAT_LABEL[base.nativeStat.stat]} <span class="tt-dim">(native)</span>`)

  const mult = RARITY[g.rarity].riderMult
  if (base.rider && mult > 0) {
    const r = base.rider
    if (r.atkDamagePerCard) lines.push(`+${r.atkDamagePerCard * mult} damage per Attack card <span class="tt-dim">(×3 in an all-Attack set)</span>`)
    if (r.blockPerDefendCard) lines.push(`+${r.blockPerDefendCard * mult} Block per Defend card`)
    if (r.manaPerMatch) lines.push(`+${r.manaPerMatch * mult} mana per mono-colour set`)
  } else if (mult === 0) {
    lines.push(`<span class="tt-dim">Grey — no rarity rider (upgrade at the Smithy)</span>`)
  }
  if (base.matchType) lines.push(`Affinity: ${AFFINITY[base.matchType] ?? base.matchType} <span class="tt-dim">(element identity)</span>`)

  if (g.affixes.length) {
    lines.push(`<span class="tt-sub">Affixes</span>`)
    for (const a of g.affixes) lines.push(`• ${describeAffix(a)}`)
  } else if (RARITY[g.rarity].maxAffixes > 0) {
    lines.push(`<span class="tt-dim">No affixes — ${RARITY[g.rarity].maxAffixes} open slot(s) (Enchant at the Smithy)</span>`)
  }
  lines.push(`<span class="tt-dim">Worth ${itemValue(g)}g · sells ${sellValue(g)}g</span>`)
  return lines.join('<br>')
}

export const consumableTipTitle = (refId: string): string => CONSUMABLES[refId]?.name ?? refId
/** The consumable breakdown body: its effect + kind + worth. */
export function consumableTipBody(refId: string): string {
  const c = CONSUMABLES[refId]
  if (!c) return 'Unknown item.'
  const kind = c.kind === 'scroll' ? 'Scroll (one free cast)' : 'Potion'
  return `${c.desc}<br><span class="tt-dim">${kind} · worth ${consumableValue(refId)}g · sells ${sellValueOfConsumable(refId)}g</span>`
}
