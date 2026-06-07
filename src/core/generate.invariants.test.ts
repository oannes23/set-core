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
