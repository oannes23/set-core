/* The CONFORMANCE GATE (TODO.md §A, step 2). Ports prototype/sim-invariants.mjs to run against the
   NEW core across the dial space, asserting the four hard invariants. "Nothing else moves until the
   core passes under the new harness." Deterministic (seeded RNG) so a failure is reproducible. */

import { test, expect } from 'vitest'
import { mulberry32 } from './rng'
import { type Card, keyOf } from './affine'
import { type Board, findSets, countSets, boardKInfo } from './sets'
import { type GenConfig, genInitial, patch } from './generate'

const PIN: Card = [0, 0, 0, 0]

function makeCfg(F: number, dropIdx: number, n: number, camoDepth: number, escapeRoutes: number): GenConfig {
  const active = F === 4 ? [0, 1, 2, 3] : [0, 1, 2, 3].filter((i) => i !== dropIdx)
  return { n, active, pin: PIN, camoDepth, escapeRoutes, floor: 1 }
}

/** Push any invariant breaks for this board into `viol`. */
function checkBoard(board: Board, cfg: GenConfig, label: string, viol: string[]): void {
  const live = board.filter((c): c is Card => c != null)
  if (live.length !== board.length) viol.push(`${label}: empty slot`)
  const keys = new Set(live.map(keyOf))
  if (keys.size !== live.length) viol.push(`${label}: duplicate card`) // inv 1
  if (countSets(board) < cfg.floor) viol.push(`${label}: below floor (${countSets(board)})`) // inv 2
  const dropped = [0, 1, 2, 3].filter((i) => !cfg.active.includes(i)) // inv 3
  for (const c of live) for (const di of dropped) if (c[di] !== PIN[di]) viol.push(`${label}: axis ${di} not pinned`)
}

test('generator holds all hard invariants across the dial space', () => {
  const Fs = [3, 4]
  const Ns = [8, 10, 12, 14, 16]
  const CLEARS_PER_CFG = 25
  const viol: string[] = []
  let seed = 0
  let configs = 0
  let checks = 0

  for (const F of Fs) {
    const drops = F === 3 ? [0, 1, 2, 3] : [2] // F=4 varies all axes; dropIdx is irrelevant
    for (const drop of drops) {
      for (const N of Ns) {
        const depths = Array.from({ length: F }, (_, i) => i + 1)
        for (const depth of depths) {
          for (const routes of [1, 3, 6]) {
            const cfg = makeCfg(F, drop, N, depth, routes)
            const rng = mulberry32((++seed * 2654435761) >>> 0)
            configs++
            let board: Board = genInitial(cfg, rng)
            checkBoard(board, cfg, `init F${F} d${drop} N${N} k${depth} r${routes}`, viol)
            checks++
            for (let c = 0; c < CLEARS_PER_CFG; c++) {
              const sets = findSets(board)
              if (!sets.length) {
                viol.push(`no set to clear F${F} N${N}`)
                break
              }
              const pick = sets[Math.floor(rng() * sets.length)]
              for (const s of pick) board[s] = null
              board = patch(board, [...pick], cfg, rng)
              checkBoard(board, cfg, `patch F${F} d${drop} N${N} k${depth} r${routes} #${c}`, viol)
              checks++
            }
          }
        }
      }
    }
  }

  // Surface a useful message if it ever breaks, but the gate is: ZERO violations.
  expect(viol.slice(0, 10), `${configs} configs, ${checks} board checks`).toEqual([])
}, 60_000)

test('the locked combat config (f=3 / n=15 / k1) generates valid boards and steers to easiest-k = 1', () => {
  // The shipped board: shading dropped (axis 2), N=15, camoDepth 1, escapeRoutes 6 (set-combat.html).
  const cfg = makeCfg(3, 2, 15, 1, 6)
  const rng = mulberry32(123456789)
  const viol: string[] = []
  let onTarget = 0
  const trials = 60
  let board: Board = genInitial(cfg, rng)
  for (let t = 0; t < trials; t++) {
    checkBoard(board, cfg, `combat #${t}`, viol)
    if (boardKInfo(board, cfg.active).minK === 1) onTarget++
    const sets = findSets(board)
    const pick = sets[Math.floor(rng() * sets.length)]
    for (const s of pick) board[s] = null
    board = patch(board, [...pick], cfg, rng)
  }
  expect(viol).toEqual([])
  // findability should land the easiest set on k=1 the large majority of the time at this config
  expect(onTarget / trials).toBeGreaterThan(0.8)
})

// ---- T1: the WEIGHTED regen path (patchFavor) — the path every in-game transmute actually uses ----
import { patchFavor, type FavorBias } from './generate'
import { countSetsExcluding } from './sets'

test('patchFavor holds the invariants under heavy bias AND steers the aggregate', () => {
  // BIAS_W in the engine is 8 — stress at and above it, single- and multi-axis
  const biases: FavorBias[] = [
    { color: 0, colorW: 8 },
    { shape: 2, shapeW: 8 },
    { mag: 1, magW: 8 },
    { color: 0, colorW: 16, shape: 2, shapeW: 16 }, // intensity-2-style compound
  ]
  const cfg = makeCfg(3, 2, 15, 1, 6)
  const viol: string[] = []
  let favored = 0
  let refills = 0
  const rng = mulberry32(424242)
  for (const bias of biases) {
    let board: Board = genInitial(cfg, rng)
    for (let c = 0; c < 25; c++) {
      const sets = findSets(board)
      const pick = sets[Math.floor(rng() * sets.length)]
      for (const s of pick) board[s] = null
      board = patchFavor(board, [...pick], cfg, rng, bias)
      checkBoard(board, cfg, `favor ${JSON.stringify(bias)} #${c}`, viol)
      // distribution: count refilled cards that landed on the favoured value(s)
      for (const s of pick) {
        const card = board[s]!
        refills++
        if (bias.color != null && card[0] === bias.color) favored++
        else if (bias.color == null && bias.shape != null && card[1] === bias.shape) favored++
        else if (bias.color == null && bias.shape == null && bias.mag != null && card[3] === bias.mag) favored++
      }
    }
  }
  expect(viol.slice(0, 10)).toEqual([])
  // invariant 5's "control aggregate stats": an 8× bias must land WELL above the uniform 1/3 rate
  expect(favored / refills).toBeGreaterThan(0.55)
}, 30_000)

// ---- I1: the lock-aware floor — a reform with locked slots must restore a MAKEABLE set ----
test('patch with excluded (locked) slots keeps ≥ floor sets that avoid every locked slot', () => {
  const cfg = makeCfg(3, 2, 15, 1, 6)
  const rng = mulberry32(987654321)
  const viol: string[] = []
  for (let trial = 0; trial < 40; trial++) {
    let board: Board = genInitial(cfg, rng)
    // lock the three slots of one present set (the worst case: the paper floor runs through locks)
    const sets = findSets(board)
    const locked = new Set<number>(sets[Math.floor(rng() * sets.length)])
    // transmute three random unlocked slots and reform lock-aware
    const free = board.map((_, i) => i).filter((i) => !locked.has(i))
    const slots: number[] = []
    while (slots.length < 3) {
      const i = free[Math.floor(rng() * free.length)]
      if (!slots.includes(i)) slots.push(i)
    }
    for (const s of slots) board[s] = null
    board = patch(board, slots, cfg, rng, undefined, locked)
    checkBoard(board, cfg, `lockfloor #${trial}`, viol)
    if (countSetsExcluding(board, locked) < cfg.floor) viol.push(`lockfloor #${trial}: no makeable set outside locks`)
  }
  expect(viol.slice(0, 10)).toEqual([])
}, 30_000)
