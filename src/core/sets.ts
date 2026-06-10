/* core/sets — set-finding and board analysis over a board of cards.
   `active` is the list of varying axis indices (dropped axes are pinned and excluded), so set
   difficulty (`k`) is measured only over axes that actually vary. Ported verbatim in behavior
   from the prototype's findSets / kOfSet / boardKInfo; the global CFG.active is now a parameter. */

import { type Card, keyOf, third } from './affine'

/** A board is a fixed array of slots; a null slot is empty (mid-reform). */
export type Board = (Card | null)[]

/** A found set, as the three board indices (i < j < k). */
export type SetTriple = [number, number, number]

/** All sets present on the board. Two cards determine the third; we look it up by key and only
 *  emit when its index is the largest, so each set is reported once. O(n²). */
export function findSets(board: Board): SetTriple[] {
  const idxByKey = new Map<number, number>()
  board.forEach((c, i) => {
    if (c) idxByKey.set(keyOf(c), i)
  })
  const out: SetTriple[] = []
  for (let i = 0; i < board.length; i++) {
    const ci = board[i]
    if (!ci) continue
    for (let j = i + 1; j < board.length; j++) {
      const cj = board[j]
      if (!cj) continue
      const k = idxByKey.get(keyOf(third(ci, cj)))
      if (k !== undefined && k > j) out.push([i, j, k])
    }
  }
  return out
}

export const countSets = (b: Board): number => findSets(b).length

/** Sets that avoid every `excluded` slot index — the lock-aware ("makeable") count: locked cards
 *  still form sets on paper, but a set through a lock can't be completed by the player. */
export function countSetsExcluding(b: Board, excluded?: ReadonlySet<number>): number {
  if (!excluded || excluded.size === 0) return countSets(b)
  let n = 0
  for (const [i, j, k] of findSets(b)) if (!excluded.has(i) && !excluded.has(j) && !excluded.has(k)) n++
  return n
}

/** k = how many ACTIVE axes are all-different across the three cards (1 = gimme … F = camouflaged). */
export function kOfSet(cards: [Card, Card, Card], active: number[]): number {
  let k = 0
  for (const i of active) {
    if (!(cards[0][i] === cards[1][i] && cards[1][i] === cards[2][i])) k++
  }
  return k
}

export interface KInfo {
  /** number of sets on the board */
  count: number
  /** the easiest (smallest) k present, or 0 if no sets */
  minK: number
  /** histogram of k → how many sets have that k */
  hist: Record<number, number>
}

/** Difficulty profile of a board: how many sets, the easiest k, and the spread. */
export function boardKInfo(board: Board, active: number[]): KInfo {
  const sets = findSets(board)
  const hist: Record<number, number> = {}
  let minK = 99
  for (const [i, j, l] of sets) {
    const k = kOfSet([board[i]!, board[j]!, board[l]!], active)
    hist[k] = (hist[k] || 0) + 1
    if (k < minK) minK = k
  }
  return { count: sets.length, minK: sets.length ? minK : 0, hist }
}
