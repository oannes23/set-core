/* engine/consumables — one-use items: POTIONS (board/engine effects) + SCROLLS (a one-shot, free cast of
   an existing ability). Modeled like abilities — a registry of pure `use(state, rng, sink)` effects that
   compose ops + the transmute verb; the carried set is data (ids) on the character/combat state. Used via
   the `useConsumable` action so it stays replay-deterministic. */

import type { Rng } from '../core/rng'
import type { CombatState } from './state'
import type { EventSink } from './events'
import { SHAPE_ATTACK, SHAPE_DEFEND, SHAPE_MOVE } from './resolve'
import { transmute } from './triggers'
import { healPlayer, gainBlock, pushClock, addTactics, grantMana } from './ops'
import { COLOR_GREEN, COLOR_BLUE, BIAS_W, cardColor, cardShape, liveSlots, pickRandom } from './select'
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
const SHAPE_NAME = ['Blade', 'Ward', 'Stride'] // attack / defend / move
const SHAPE_ICON = ['⚔️', '🛡️', '👣']
const SHAPE_CONST = [SHAPE_ATTACK, SHAPE_DEFEND, SHAPE_MOVE]

export const CONSUMABLES: Record<string, Consumable> = {}
const reg = (c: Consumable): void => { CONSUMABLES[c.id] = c }

// --- the staple heal ---
reg({
  id: 'heal_potion', name: 'Healing Draught', kind: 'potion', icon: '💗', color: COLOR_GREEN, desc: 'restore 15 HP',
  use(s, _rng, sink) { healPlayer(s, 15, sink) },
})

// --- 9 combo brews: warp a slice of the board toward a colour × shape pair (e.g. Fire Blades) ---
for (let c = 0; c < 3; c++) {
  for (let sh = 0; sh < 3; sh++) {
    reg({
      id: `brew_${c}_${sh}`,
      name: `${COLOR_NAME[c]} ${SHAPE_NAME[sh]} Brew`,
      kind: 'potion', icon: SHAPE_ICON[sh], color: c,
      desc: `warp up to 5 cards toward ${COLOR_NAME[c]} ${SHAPE_NAME[sh].toLowerCase()}s`,
      use(s, rng, sink) {
        const off = liveSlots(s, (card) => !(cardColor(card) === c && cardShape(card) === SHAPE_CONST[sh]))
        const picks = pickRandom(off, 5, rng)
        if (picks.length) transmute(s, picks, { bias: { color: c, colorW: BIAS_W, shape: SHAPE_CONST[sh], shapeW: BIAS_W } }, sink)
      },
    })
  }
}

// --- mana potions ---
for (let c = 0; c < 3; c++) {
  reg({
    id: `mana_${['red', 'green', 'blue'][c]}`, name: `${COLOR_NAME[c]} Mana Potion`, kind: 'potion', icon: COLOR_ICON[c], color: c,
    desc: `gain 5 ${COLOR_NAME[c]} mana`,
    use(s, _rng, sink) { grantMana(s, c, 5, sink) },
  })
}

// --- utility potions ---
reg({
  id: 'speed_potion', name: 'Potion of Haste', kind: 'potion', icon: '⏱️', color: COLOR_BLUE,
  desc: 'stall the enemy +10s · bank 3 Tactics',
  use(s, _rng, sink) { pushClock(s, 10, sink); addTactics(s, 3, sink) },
})
reg({
  id: 'stoneskin', name: 'Stoneskin Potion', kind: 'potion', icon: '🪨', color: null,
  desc: 'instantly raise Block to full',
  use(s, rng, sink) { gainBlock(s, s.playerMax, rng, sink) },
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
