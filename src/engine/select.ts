/* engine/select — pure board-targeting primitives shared by triggers, abilities, and tactics.
   The reusable substrate for board-altering effects (GAME-DESIGN §4: transmute(selector, bias)).
   No DOM, no Math.random — every randomized helper takes the injected Rng so the engine stays
   deterministic/replayable. Ported from the prototype's TARGETING TOOLKIT. */

import type { Card } from '../core/affine'
import { findSets } from '../core/sets'
import type { Rng } from '../core/rng'
import type { CombatState } from './state'

// colour / shape numeric tokens (axis values). Fire / Nature / Frost.
export const COLOR_RED = 0
export const COLOR_GREEN = 1
export const COLOR_BLUE = 2
export const BIAS_W = 8 // transmute regen: weight toward the favoured colour/shape/magnitude

export const cardColor = (c: Card): number => c[0]
export const cardShape = (c: Card): number => c[1]
export const cardMag = (c: Card): number => c[3]

/** A slot holds a settled, reachable card (not empty, not mid-reform, not locked). */
export function isLive(s: CombatState, i: number): boolean {
  return i >= 0 && i < s.board.length && s.board[i] != null && !s.pending.has(i) && !s.locked.has(i)
}

/** Live, settled, reachable slots — optionally filtered by a card predicate. */
export function liveSlots(s: CombatState, pred?: (c: Card) => boolean): number[] {
  const out: number[] = []
  s.board.forEach((c, i) => {
    if (c && isLive(s, i) && (!pred || pred(c))) out.push(i)
  })
  return out
}

/** WOUND slots — exchange damage scarred them; they reform only via the draw phase or heals. */
export function woundedSlots(s: CombatState): number[] {
  const out: number[] = []
  s.board.forEach((c, i) => {
    if (c == null && s.pending.get(i)?.wound) out.push(i)
  })
  return out
}

// ---- grid geometry (row / column slot maps; rows = ceil(N / cols)) ----

export function gridDims(s: CombatState): { cols: number; rows: number } {
  return { cols: s.cols, rows: Math.ceil(s.board.length / s.cols) }
}
export function rowSlots(s: CombatState, r: number): number[] {
  const { cols, rows } = gridDims(s)
  if (r < 0 || r >= rows) return []
  const o: number[] = []
  for (let c = 0; c < cols; c++) {
    const j = r * cols + c
    if (j < s.board.length) o.push(j)
  }
  return o
}
export function colSlots(s: CombatState, c: number): number[] {
  const { cols, rows } = gridDims(s)
  if (c < 0 || c >= cols) return []
  const o: number[] = []
  for (let r = 0; r < rows; r++) {
    const j = r * cols + c
    if (j < s.board.length) o.push(j)
  }
  return o
}

// ---- randomized picks (Rng-injected) ----

/** Up to n slots from a pool, uniformly at random, without replacement (capped by availability). */
export function pickRandom(pool: number[], n: number, rng: Rng): number[] {
  const a = pool.slice()
  const out: number[] = []
  while (out.length < n && a.length) {
    const k = Math.floor(rng() * a.length)
    out.push(a[k])
    a.splice(k, 1)
  }
  return out
}

export function randOf<T>(arr: T[], rng: Rng): T | null {
  return arr.length ? arr[Math.floor(rng() * arr.length)] : null
}

/** Weighted index pick: P(i) ∝ weights[i]; falls back to uniform if all weights are ≤ 0. */
export function weightedIndex(weights: number[], rng: Rng): number {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return Math.floor(rng() * weights.length)
  let r = rng() * sum
  let acc = 0
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]
    if (r < acc) return i
  }
  return weights.length - 1
}

// ---- "deadest card" auto-targeting (bolts) ----

/** How many on-board sets each slot participates in (a card's findability). */
export function comboCounts(s: CombatState): number[] {
  const counts = new Array(s.board.length).fill(0) as number[]
  for (const [i, j, k] of findSets(s.board)) {
    counts[i]++
    counts[j]++
    counts[k]++
  }
  return counts
}

/** Slots SHIELDED from automatic turnover (hard rule #6): every currently-SELECTED card + every card
 *  that shares a complete board-set with a selected card (its set-mates). Empty when nothing is
 *  selected (pre-selection turnover is unprotected — rare, acceptable). Only *restricts* targets, so
 *  it can never break the makeable floor; a turnover left with no legal target simply skips. */
export function protectedSlots(s: CombatState): Set<number> {
  const sel = s.selected ?? []
  const out = new Set<number>(sel)
  if (!sel.length) return out
  const selSet = new Set(sel)
  for (const t of findSets(s.board)) {
    if (t.some((i) => selSet.has(i))) for (const i of t) out.add(i) // every member of a set through a selected card
  }
  return out
}

/** All pool slots tied for the lowest cost(card, i) — the full tie set (the cast picks one). */
export function pickAllLowest(s: CombatState, pool: number[], costFn: (card: Card, i: number) => number): number[] {
  let best: number[] = []
  let bestCost = Infinity
  for (const i of pool) {
    const c = costFn(s.board[i] as Card, i)
    if (c < bestCost) {
      bestCost = c
      best = [i]
    } else if (c === bestCost) {
      best.push(i)
    }
  }
  return best
}

/** The "deadest" cards a bolt could aim at: fewest match-mates, then off its own colour, then lightest. */
export function deadestCandidates(s: CombatState, ownColor: number): number[] {
  const counts = comboCounts(s)
  return pickAllLowest(s, liveSlots(s), (card, i) => counts[i] * 100 + (cardColor(card) === ownColor ? 10 : 0) + cardMag(card))
}

// ---- preference-weighted picks (block / wildgrowth) ----

export type PrefFn = (card: Card, picked: Card[]) => number
export const prefLowMag: PrefFn = (card) => 3 - cardMag(card) // toward lighter
export const prefHighMag: PrefFn = (card) => cardMag(card) + 1 // toward heavier
export const prefColorDiverse: PrefFn = (card, picked) => (picked.some((p) => cardColor(p) === cardColor(card)) ? 1 : 3)
export function prefAll(...fns: PrefFn[]): PrefFn {
  return (card, picked) => fns.reduce((w, f) => w * f(card, picked), 1)
}

/** Up to n slots, greedily weighted by prefFn(card, alreadyPicked), without replacement. */
export function pickPreferred(s: CombatState, pool: number[], n: number, prefFn: PrefFn, rng: Rng): number[] {
  const a = pool.slice()
  const out: number[] = []
  while (out.length < n && a.length) {
    const picked = out.map((i) => s.board[i] as Card)
    const k = weightedIndex(
      a.map((i) => Math.max(1e-6, prefFn(s.board[i] as Card, picked))),
      rng,
    )
    out.push(a[k])
    a.splice(k, 1)
  }
  return out
}

// ---- spatial offsets (Fireball blast footprint) ----

/** Map a slot + a list of [dRow,dCol] offsets to valid board indices (edge-aware; never wraps). */
export function offsetSlots(s: CombatState, idx: number, deltas: ReadonlyArray<readonly [number, number]>): number[] {
  const cols = s.cols
  const n = s.board.length
  const row = Math.floor(idx / cols)
  const col = idx % cols
  const out: number[] = []
  for (const [dr, dc] of deltas) {
    const r = row + dr
    const c = col + dc
    if (r < 0 || c < 0 || c >= cols) continue
    const j = r * cols + c
    if (j >= 0 && j < n) out.push(j)
  }
  return out
}

/** Fireball blast: 13 tiles — center, the plus-arms out to distance 2, and the 4 immediate diagonals. */
export const FIREBALL_BLAST: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0], [1, 0], [0, -1], [0, 1], // orthogonal +1
  [-2, 0], [2, 0], [0, -2], [0, 2], // orthogonal +2
  [-1, -1], [-1, 1], [1, -1], [1, 1], // diagonals
]
