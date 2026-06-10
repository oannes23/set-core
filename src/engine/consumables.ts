/* engine/consumables — one-use items: POTIONS (board/engine effects) + SCROLLS (a one-shot, free cast of
   an existing ability). Modeled like abilities — a registry of pure `use(state, rng, sink)` effects that
   compose ops + the transmute verb; the carried set is data (ids) on the character/combat state. Used via
   the `useConsumable` action so it stays replay-deterministic. */

import type { Rng } from '../core/rng'
import type { Card } from '../core/affine'
import type { CombatState } from './state'
import { CHARGE_CAP } from './state'
import type { EventSink } from './events'
import { transmute } from './triggers'
import { healPlayer, gainBlock, pushClock, addCharges, grantMana, dealAbilityDamage } from './ops'
import { COLOR_RED, COLOR_GREEN, COLOR_BLUE, BIAS_W, cardColor, cardMag, comboCounts, isLive, liveSlots, gridDims, rowSlots, colSlots } from './select'
import { ABILITIES } from './abilities'

export interface Consumable {
  id: string
  name: string
  kind: 'potion' | 'scroll'
  icon: string // emoji for the art
  color: number | null // tint: 0 red / 1 green / 2 blue, or null = neutral
  desc: string
  use(s: CombatState, rng: Rng, sink: EventSink): void
}

const COLOR_NAME = ['Fire', 'Nature', 'Frost']
const COLOR_ICON = ['🔥', '🌿', '❄️']
const MANA_KEY = ['red', 'green', 'blue']

export const CONSUMABLES: Record<string, Consumable> = {}
const reg = (c: Consumable): void => { CONSUMABLES[c.id] = c }

// --- tiered staples: minor / standard / major of each stat potion ---
const TIERS = [
  { key: 'minor', label: 'Minor ' },
  { key: 'std', label: '' },
  { key: 'major', label: 'Major ' },
]
TIERS.forEach((t, i) => {
  const hp = 10 * (i + 1) // 10 / 20 / 30
  reg({
    id: `hp_${t.key}`, name: `${t.label}Healing Potion`, kind: 'potion', icon: '💗', color: COLOR_GREEN,
    desc: `restore ${hp} HP`,
    use(s, _rng, sink) { healPlayer(s, hp, sink) },
  })
  const armor = 10 * (i + 1) // 10 / 20 / 30
  reg({
    id: `stoneskin_${t.key}`, name: `${t.label}Stoneskin Potion`, kind: 'potion', icon: '🪨', color: null,
    desc: `gain ${armor} Block`,
    use(s, rng, sink) { gainBlock(s, armor, rng, sink) },
  })
  const secs = 10 * (i + 1) // 10s / 20s / 30s
  reg({
    id: `speed_${t.key}`, name: `${t.label}Speed Potion`, kind: 'potion', icon: '⏱️', color: COLOR_BLUE,
    desc: `stall the enemy +${secs}s`,
    use(s, _rng, sink) { pushClock(s, secs, sink, true) }, // premium stall: bypass the Move clock cap
  })
  const mana = 5 * (i + 1) // 5 / 10 / 15 per colour
  for (let c = 0; c < 3; c++) {
    reg({
      id: `mana_${MANA_KEY[c]}_${t.key}`, name: `${t.label}${COLOR_NAME[c]} Mana Potion`, kind: 'potion', icon: COLOR_ICON[c], color: c,
      desc: `gain ${mana} ${COLOR_NAME[c]} mana`,
      use(s, _rng, sink) { grantMana(s, c, mana, sink) },
    })
  }
  const rainbow = 2 * (i + 1) // 2 / 4 / 6 of EVERY colour
  reg({
    id: `mana_rainbow_${t.key}`, name: `${t.label}Rainbow Mana Potion`, kind: 'potion', icon: '🌈', color: null,
    desc: `gain ${rainbow} of each mana`,
    use(s, _rng, sink) { for (let c = 0; c < 3; c++) grantMana(s, c, rainbow, sink) },
  })
})

// --- special potions (one-off effects, no tiers) ---
reg({
  id: 'invisibility', name: 'Invisibility Potion', kind: 'potion', icon: '👻', color: null,
  desc: 'fill your Tactics charges · freeze the enemy until your next Set',
  use(s, _rng, sink) { addCharges(s, CHARGE_CAP, sink); s.attackFrozen = true },
})
reg({
  id: 'strength', name: 'Strength Potion', kind: 'potion', icon: '💪', color: COLOR_RED,
  desc: 'triple the damage of your next attacking Set',
  use(s, _rng, _sink) { s.nextSetDamageMult = 3 },
})

/** Elemental cascade (Fire Breathing / Regeneration / Mind Reading): each round transmutes ONLY the
 *  targeted region (a row / two columns / the deadest cards) toward `color`, biased so it keeps that
 *  vibe — the rest of the board is left intact. The Damage/Heal/Block payoff scales with every card
 *  that's `color` after the flood, but does NOT consume those cards. 50% chance to repeat (compounding). */
function cascade(
  s: CombatState, rng: Rng, sink: EventSink, color: number,
  region: (s: CombatState) => number[],
  payoff: (s: CombatState, n: number, rng: Rng, sink: EventSink) => void,
): void {
  let guard = 0
  do {
    const colored = liveSlots(s, (card) => cardColor(card) === color)
    const flood = region(s).filter((i) => isLive(s, i) && cardColor(s.board[i] as Card) !== color)
    const n = colored.length + flood.length // every card that's `color` after the flood
    if (n > 0) payoff(s, n, rng, sink)
    if (flood.length) transmute(s, flood, { bias: { color, colorW: BIAS_W } }, sink) // only the region reshapes
  } while (rng() < 0.5 && guard++ < 8)
}

/** All slots in the row holding the fewest live cards of `color` (the cascade floods this row). */
function fewestColorRow(s: CombatState, color: number): number[] {
  const { rows } = gridDims(s)
  let best = 0
  let bestCount = Infinity
  for (let r = 0; r < rows; r++) {
    const cnt = rowSlots(s, r).filter((i) => isLive(s, i) && cardColor(s.board[i] as Card) === color).length
    if (cnt < bestCount) { bestCount = cnt; best = r }
  }
  return rowSlots(s, best)
}

/** All slots in the `k` columns holding the fewest live cards of `color`. */
function fewestColorCols(s: CombatState, color: number, k: number): number[] {
  const { cols } = gridDims(s)
  const ranked: { c: number; cnt: number }[] = []
  for (let c = 0; c < cols; c++) {
    ranked.push({ c, cnt: colSlots(s, c).filter((i) => isLive(s, i) && cardColor(s.board[i] as Card) === color).length })
  }
  ranked.sort((a, b) => a.cnt - b.cnt)
  return ranked.slice(0, k).flatMap((r) => colSlots(s, r.c))
}

/** The `k` "deadest" non-`color` cards: fewest match-mates, then lightest. */
function deadestNonColor(s: CombatState, color: number, k: number): number[] {
  const counts = comboCounts(s)
  return liveSlots(s, (card) => cardColor(card) !== color)
    .sort((a, b) => (counts[a] - counts[b]) || (cardMag(s.board[a] as Card) - cardMag(s.board[b] as Card)))
    .slice(0, k)
}

reg({
  id: 'fire_breathing', name: 'Fire Breathing Potion', kind: 'potion', icon: '🐉', color: COLOR_RED,
  desc: 'flood the least-red row, burn 1 per red card, clear them · 50% to repeat',
  use(s, rng, sink) { cascade(s, rng, sink, COLOR_RED, (st) => fewestColorRow(st, COLOR_RED), (st, n, _r, sk) => { dealAbilityDamage(st, n, sk) }) },
})
reg({
  id: 'regeneration', name: 'Regeneration Potion', kind: 'potion', icon: '🌱', color: COLOR_GREEN,
  desc: 'green the 2 least-green columns, heal 1 per green card, clear them · 50% to repeat',
  use(s, rng, sink) { cascade(s, rng, sink, COLOR_GREEN, (st) => fewestColorCols(st, COLOR_GREEN, 2), (st, n, _r, sk) => { healPlayer(st, n, sk) }) },
})
reg({
  id: 'mind_reading', name: 'Mind Reading Potion', kind: 'potion', icon: '🔮', color: COLOR_BLUE,
  desc: 'turn the 3 deadest cards blue, gain 1 Block per blue card, clear them · 50% to repeat',
  use(s, rng, sink) { cascade(s, rng, sink, COLOR_BLUE, (st) => deadestNonColor(st, COLOR_BLUE, 3), (st, n, r, sk) => { gainBlock(st, n, r, sk) }) },
})

// --- threat-layer / board-shaping utility potions ---
reg({
  id: 'hourglass', name: 'Hourglass Draught', kind: 'potion', icon: '⏳', color: COLOR_BLUE,
  desc: 'reset the enemy clock to full · suppress drift & DoTs for 6s',
  use(s, _rng, sink) {
    const before = s.nextAttackAt
    s.nextAttackAt = s.now + s.foe.cadence * 1000 // a clean, guaranteed full interval
    const applied = Math.round((s.nextAttackAt - before) / 1000)
    if (applied !== 0) sink.emit({ type: 'clockChanged', deltaSeconds: applied })
    s.tickSuppressedUntil = s.now + 6000
  },
})
reg({
  id: 'prismatic', name: 'Prismatic Vial', kind: 'potion', icon: '💎', color: null,
  desc: 'paint the rows red/green/blue · gain 1 mana of a colour per card painted into it',
  use(s, _rng, sink) {
    // the rainbow analogue of the cascade triad: instead of flooding ONE colour, it paints all three —
    // top row → red, middle → green, bottom → blue — and pays out mana per card set to each colour.
    const { rows } = gridDims(s)
    for (let r = 0; r < rows; r++) {
      const color = r % 3
      const slots = rowSlots(s, r).filter((i) => isLive(s, i)) // pre-locked cards resist — close, not perfect
      if (!slots.length) continue
      grantMana(s, color, slots.length, sink)
      transmute(s, slots, { bias: { color, colorW: BIAS_W } }, sink)
    }
  },
})
reg({
  id: 'saboteur', name: "Saboteur's Phial", kind: 'potion', icon: '🧪', color: null,
  desc: 'destroy the 3 lightest cards — they reform fresh',
  use(s, _rng, sink) {
    const picks = liveSlots(s).sort((a, b) => cardMag(s.board[a] as Card) - cardMag(s.board[b] as Card)).slice(0, 3)
    if (picks.length) transmute(s, picks, {}, sink)
  },
})

// --- scrolls: a one-shot, free cast of every ability (the scroll pool comes free with the roster) ---
const scrollColor = (cost: [number, number, number]): number | null => {
  const m = Math.max(cost[0], cost[1], cost[2])
  return m > 0 ? cost.indexOf(m) : null
}
for (const id in ABILITIES) {
  const a = ABILITIES[id]
  reg({
    id: `scroll_${id}`, name: `Scroll: ${a.name}`, kind: 'scroll', icon: a.icon, color: scrollColor(a.cost),
    desc: a.desc,
    use(s, rng, sink) { a.cast(s, rng, sink) }, // free — no mana cost (the scroll IS the cost)
  })
}

/** Spend the consumable in `slot`: remove it from the carried set, then run its effect. No-op if empty
 *  or combat is over. Returns whether it fired (the reducer does the post-use win check). */
export function useConsumable(s: CombatState, slot: number, rng: Rng, sink: EventSink): boolean {
  if (!s.running) return false
  const id = s.consumables[slot]
  const c = id ? CONSUMABLES[id] : undefined
  if (!c) return false
  s.consumables.splice(slot, 1)
  sink.emit({ type: 'consumableUsed', id: c.id, name: c.name })
  c.use(s, rng, sink)
  return true
}
