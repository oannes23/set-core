/* engine/resolve — turn a found set into combat effects. RESOLUTION v2 ("Model B" — sets STEER,
   stats CARRY, CRAWL §5.5): each card in a set is one action of the character's build — an Attack
   card swings with Power, a Defend guards with Endurance, a Move steps with Speed — and the card's
   MAGNITUDE is the action's QUALITY (① glancing ×0.7 · ② solid ×1.0 · ③ heavy ×1.4), not its size.
   Deterministic on purpose (the deliberate-grind direction): a set always delivers exactly what it
   reads. At the base statline (2/2/2) per-card values are 1/2/3 — exact parity with the old system.
   `weightedRoll` remains for ENEMY attacks and ability rolls. */

import type { Card } from '../core/affine'
import type { Rng } from '../core/rng'
import type { StatBlock } from './state'

/** Magnitude → action quality: glancing / solid / heavy. */
export const QUALITY = [0.7, 1, 1.4] as const

export const SHAPE_ATTACK = 0
export const SHAPE_DEFEND = 1
export const SHAPE_MOVE = 2

/** Triangular-weighted roll: value v in [1,max] drawn with P(v) ∝ v (favours max, weak hits possible). */
export function weightedRoll(max: number, rng: Rng): number {
  max = Math.max(1, Math.round(max))
  const total = (max * (max + 1)) / 2
  let r = Math.floor(rng() * total) + 1
  let v = 0
  let acc = 0
  while (acc < r) {
    v++
    acc += v
  }
  return v
}

/** Per-axis same/diff profile of a match: the all-same value on each axis (or null), plus raw values.
 *  Trigger/passive conditions read this (e.g. sameShape === SHAPE_MOVE). */
export interface MatchDescriptor {
  sameColor: number | null
  sameShape: number | null
  sameNumber: number | null
  colors: [number, number, number]
  shapes: [number, number, number]
  numbers: [number, number, number]
}

export function matchDescriptor(cards: [Card, Card, Card]): MatchDescriptor {
  const col: [number, number, number] = [cards[0][0], cards[1][0], cards[2][0]]
  const sh: [number, number, number] = [cards[0][1], cards[1][1], cards[2][1]]
  const nu: [number, number, number] = [cards[0][3], cards[1][3], cards[2][3]]
  const same = (a: [number, number, number]) => (a[0] === a[1] && a[1] === a[2] ? a[0] : null)
  return { sameColor: same(col), sameShape: same(sh), sameNumber: same(nu), colors: col, shapes: sh, numbers: nu }
}

export interface Resolution {
  damage: number
  dmgLight: number
  dmgMed: number
  dmgHeavy: number
  block: number
  boot: number
  mana: [number, number, number]
  allSameColor: boolean
  desc: MatchDescriptor
}

/** Resolve a set (Model B): each card fires its shape's stat at its magnitude's quality —
 *  Attack → round(Power × q) damage · Defend → round(Endurance × q) Block · Move → round(Speed × q)
 *  clock-boost seconds. Mana routes by colour signature: all-same → 3 in that pool, all-diff → 1 each. */
export function resolveSet(cards: [Card, Card, Card], stats: StatBlock, _rng: Rng): Resolution {
  let dmgLight = 0
  let dmgMed = 0
  let dmgHeavy = 0
  let block = 0
  let boot = 0
  for (const c of cards) {
    const shape = c[1]
    const q = QUALITY[c[3]] // card magnitude = the action's quality tier
    if (shape === SHAPE_ATTACK) {
      const hit = Math.round(stats.power * q)
      if (c[3] === 0) dmgLight += hit
      else if (c[3] === 1) dmgMed += hit
      else dmgHeavy += hit
    } else if (shape === SHAPE_DEFEND) {
      block += Math.round(stats.endurance * q)
    } else {
      boot += Math.round(stats.speed * q)
    }
  }
  const damage = dmgLight + dmgMed + dmgHeavy
  const cv: [number, number, number] = [cards[0][0], cards[1][0], cards[2][0]]
  const allSameColor = cv[0] === cv[1] && cv[1] === cv[2]
  const mana: [number, number, number] = [0, 0, 0]
  if (allSameColor) mana[cv[0]] = 3
  else {
    mana[0] = 1
    mana[1] = 1
    mana[2] = 1
  }
  return { damage, dmgLight, dmgMed, dmgHeavy, block, boot, mana, allSameColor, desc: matchDescriptor(cards) }
}
