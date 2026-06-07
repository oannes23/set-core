/* engine/resolve — turn a found set into combat effects (per-card shape × magnitude × colour).
   Ported verbatim from the prototype's resolveSet / matchDescriptor / weightedRoll. Damage is a
   weighted roll, so this takes an Rng (the only impurity). */

import type { Card } from '../core/affine'
import type { Rng } from '../core/rng'

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

/** Resolve a set: Attack→rolled damage (by magnitude tier), Defend→block, Move→clock-boost seconds.
 *  Mana routes by colour signature: all-same → 3 in that pool, all-different → 1 of each. */
export function resolveSet(cards: [Card, Card, Card], rng: Rng): Resolution {
  let dmgLight = 0
  let dmgMed = 0
  let dmgHeavy = 0
  let block = 0
  let boot = 0
  for (const c of cards) {
    const shape = c[1]
    const mag = c[3] + 1 // 1/2/3 = light/med/heavy
    if (shape === SHAPE_ATTACK) {
      const roll = weightedRoll(mag, rng)
      if (mag === 1) dmgLight += roll
      else if (mag === 2) dmgMed += roll
      else dmgHeavy += roll
    } else if (shape === SHAPE_DEFEND) {
      block += mag
    } else {
      boot += mag
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
