/* core/generate — board generation as a PURE function of an explicit spec + an injectable RNG.
   Ported from the prototype's genInitial / patch / patchFavor (the heavily-validated generator:
   100k+ clears, zero invariant violations). The prototype threaded config via globals (`state`,
   `CFG`, `regenBias`); here everything is an argument, so generation is deterministic and testable.

   Guarantees (asserted by generate.invariants.test.ts, the conformance gate):
     1. no duplicate cards on a board
     2. ≥ `floor` sets present (initial AND after every clear)
     3. dropped axes stay pinned → never affect set validity
     4. the findability knobs (camoDepth / escapeRoutes) steer toward their target */

import { type Card, keyOf, third } from './affine'
import { type Board, countSetsExcluding, boardKInfo } from './sets'
import { type Rng, r3 } from './rng'

export interface GenConfig {
  /** board size (number of slots) */
  n: number
  /** varying axis indices; dropped axes are excluded and stay pinned */
  active: number[]
  /** pinned values for every axis (active axes are overwritten per draw) */
  pin: Card
  /** findability target: the desired easiest-k (set difficulty) */
  camoDepth: number
  /** findability target: desired number of sets at that easiest-k */
  escapeRoutes: number
  /** minimum sets that must be present on the board */
  floor: number
}

/** Per-axis sampling weights: axis index → [w0,w1,w2]. A missing axis samples uniformly. */
export type AxisWeights = Record<number, [number, number, number]>

/** Prototype-style single-target favour bias (axis 0 = colour, 1 = shape, 3 = magnitude). */
export interface FavorBias {
  color?: number
  colorW?: number
  shape?: number
  shapeW?: number
  mag?: number
  magW?: number
}

function pickWeighted(w: [number, number, number], rng: Rng): number {
  const s = w[0] + w[1] + w[2]
  let r = rng() * s
  let acc = 0
  for (let i = 0; i < 3; i++) {
    acc += w[i]
    if (r < acc) return i
  }
  return 2
}

/** A weight vector leaning `weight`× toward `target`, others 1. */
function towardWeights(target: number, weight: number): [number, number, number] {
  const w: [number, number, number] = [1, 1, 1]
  w[target] = weight
  return w
}

/** Convert a single-target favour bias into per-axis weight vectors (for transmute/regen). */
export function favorWeights(bias: FavorBias): AxisWeights {
  const w: AxisWeights = {}
  if (bias.color != null) w[0] = towardWeights(bias.color, bias.colorW ?? 1)
  if (bias.shape != null) w[1] = towardWeights(bias.shape, bias.shapeW ?? 1)
  if (bias.mag != null) w[3] = towardWeights(bias.mag, bias.magW ?? 1)
  return w
}

/** Draw one card: active axes sampled (uniform, or weighted if `weights` given), others pinned. */
export function randCard(cfg: GenConfig, rng: Rng, weights?: AxisWeights): Card {
  const c = cfg.pin.slice() as Card
  for (const i of cfg.active) {
    const w = weights?.[i]
    c[i] = w ? pickWeighted(w, rng) : r3(rng)
  }
  return c
}

function distinctRandomBoard(cfg: GenConfig, rng: Rng, weights?: AxisWeights): Card[] {
  const seen = new Set<number>()
  const out: Card[] = []
  while (out.length < cfg.n) {
    const c = randCard(cfg, rng, weights)
    const k = keyOf(c)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(c)
    }
  }
  return out
}

/** Distance of a board from its findability target: hit camoDepth (easiest-k) first, then tune
 *  escapeRoutes (count at that k). Lower is better; 0 is on-target. Used to rank candidates. */
export function boardFindDist(board: Board, cfg: GenConfig): number {
  const { minK, hist, count } = boardKInfo(board, cfg.active)
  if (!count) return Infinity
  const kErr = Math.abs(minK - cfg.camoDepth)
  const rErr = Math.abs((hist[minK] ?? 0) - cfg.escapeRoutes)
  return kErr * 100 + rErr
}

/** A distinct board with at least `floor` sets (rejection-sampled). */
function genOnce(cfg: GenConfig, rng: Rng): Card[] {
  for (let t = 0; t < 5000; t++) {
    const b = distinctRandomBoard(cfg, rng)
    if (countSetsExcluding(b) >= cfg.floor) return b
  }
  return distinctRandomBoard(cfg, rng)
}

/** Deterministic sweep of the (small) card space for any card not in `seen` — the guard that keeps
 *  the fallback fill from spinning when rejection sampling is unlucky near saturation. */
function anyUnusedCard(cfg: GenConfig, seen: Set<number>): Card | null {
  const total = Math.pow(3, cfg.active.length)
  for (let m = 0; m < total; m++) {
    const c = cfg.pin.slice() as Card
    let x = m
    for (const i of cfg.active) {
      c[i] = x % 3
      x = (x / 3) | 0
    }
    if (!seen.has(keyOf(c))) return c
  }
  return null // card space saturated — caller leaves the slot as-is
}

/* I4 — below-floor canary. genInitial / patch / patchFavor each return their BEST candidate even
   when no candidate reached the floor (the `?? …` last resort). That's a deliberate "never hang"
   escape hatch, but in production a sub-floor board would be invisible. The canary counts every
   such return + (in dev) warns, so a real floor break surfaces instead of failing silently. It
   never changes the returned board — pure to the caller; the counter is a dev instrument. */
export let belowFloorCount = 0
export function resetBelowFloorCount(): void {
  belowFloorCount = 0
}
function floorCanary<T extends Board>(board: T, cfg: GenConfig, where: string, excluded?: ReadonlySet<number>): T {
  const sets = countSetsExcluding(board, excluded)
  if (sets < cfg.floor) {
    belowFloorCount++
    if (import.meta.env?.DEV) console.warn(`[generate] ${where} returned below floor: ${sets} < ${cfg.floor}`)
  }
  return board
}

/** The opening board: sample many candidates, keep the one closest to the findability target. */
export function genInitial(cfg: GenConfig, rng: Rng): Card[] {
  const samples = 140
  let best: Card[] | null = null
  let bestDist = Infinity
  for (let s = 0; s < samples; s++) {
    const b = genOnce(cfg, rng)
    const d = boardFindDist(b, cfg)
    if (d < bestDist) {
      bestDist = d
      best = b
    }
    if (bestDist === 0) break
  }
  return floorCanary(best ?? genOnce(cfg, rng), cfg, 'genInitial')
}

/** Refill the given empty `slots` with distinct cards keeping ≥ floor sets (one attempt).
 *  `excluded` slots (the engine's locks) don't count toward the floor — the floor is MAKEABLE sets. */
function patchOnce(board: Board, slots: number[], cfg: GenConfig, rng: Rng, weights?: AxisWeights, excluded?: ReadonlySet<number>): Board {
  const present = new Set<number>()
  board.forEach((c) => {
    if (c) present.add(keyOf(c))
  })
  for (let attempt = 0; attempt < 400; attempt++) {
    const nb = board.slice()
    const seen = new Set(present)
    let ok = true
    for (const s of slots) {
      let c: Card
      let g = 0
      do {
        c = randCard(cfg, rng, weights)
        g++
        if (g > 200) {
          ok = false
          break
        }
      } while (seen.has(keyOf(c)))
      if (!ok) break
      seen.add(keyOf(c))
      nb[s] = c
    }
    if (ok && countSetsExcluding(nb, excluded) >= cfg.floor) return nb
  }
  // fallback: fill distinct, then PLANT a completing third card if still below floor
  const nb = board.slice()
  const seen = new Set(present)
  for (const s of slots) {
    let c: Card | null
    let g = 0
    do {
      c = randCard(cfg, rng, weights)
      if (++g > 500) c = anyUnusedCard(cfg, seen) // unlucky rejection near saturation → deterministic sweep
    } while (c && seen.has(keyOf(c)))
    if (!c) continue // card space truly saturated — leave the slot for the next reform pass
    seen.add(keyOf(c))
    nb[s] = c
  }
  let guard = 0
  while (slots.length && countSetsExcluding(nb, excluded) < cfg.floor && guard < 60) {
    // plant third(a,b) from UNLOCKED cards only — a floor set through a lock isn't makeable
    const cards = nb.map((c, i) => [c, i] as [Card | null, number]).filter((x) => x[0] && !excluded?.has(x[1]))
    let planted = false
    for (let i = 0; i < cards.length && !planted; i++) {
      for (let j = i + 1; j < cards.length && !planted; j++) {
        const t = third(cards[i][0]!, cards[j][0]!)
        if (!seen.has(keyOf(t))) {
          const s = slots[guard % slots.length]
          if (nb[s]) seen.delete(keyOf(nb[s]!))
          nb[s] = t
          seen.add(keyOf(t))
          planted = true
        }
      }
    }
    if (!planted) break
    guard++
  }
  return nb
}

/** Refill `slots`, keeping the result closest to the findability target. `excluded` slots (engine
 *  locks) don't count toward the floor — the floor is sets MAKEABLE from unlocked cards. */
export function patch(board: Board, slots: number[], cfg: GenConfig, rng: Rng, weights?: AxisWeights, excluded?: ReadonlySet<number>): Board {
  const samples = 80
  let best: Board | null = null
  let bestDist = Infinity
  for (let s = 0; s < samples; s++) {
    const b = patchOnce(board, slots, cfg, rng, weights, excluded)
    const d = boardFindDist(b, cfg)
    if (d < bestDist) {
      bestDist = d
      best = b
    }
    if (bestDist === 0) break
  }
  return floorCanary(best ?? patchOnce(board, slots, cfg, rng, weights, excluded), cfg, 'patch', excluded)
}

/** Bias-objective refill (for ability-driven transmutes): MAXIMIZE how many freed slots land on
 *  the favoured value(s), tie-broken by findability. Still distinct + ≥ floor (via patchOnce). */
export function patchFavor(board: Board, slots: number[], cfg: GenConfig, rng: Rng, bias: FavorBias, excluded?: ReadonlySet<number>): Board {
  const weights = favorWeights(bias)
  const axes = (bias.color != null ? 1 : 0) + (bias.shape != null ? 1 : 0) + (bias.mag != null ? 1 : 0)
  const samples = 80
  const want = slots.length * axes
  let best: Board | null = null
  let bestScore = -1
  let bestDist = Infinity
  for (let s = 0; s < samples; s++) {
    const b = patchOnce(board, slots, cfg, rng, weights, excluded)
    let score = 0
    for (const sl of slots) {
      const c = b[sl]
      if (!c) continue
      if (bias.color != null && c[0] === bias.color) score++
      if (bias.shape != null && c[1] === bias.shape) score++
      if (bias.mag != null && c[3] === bias.mag) score++
    }
    const d = boardFindDist(b, cfg)
    if (score > bestScore || (score === bestScore && d < bestDist)) {
      bestScore = score
      bestDist = d
      best = b
    }
    if (bestScore >= want && bestDist === 0) break
  }
  return floorCanary(best ?? patchOnce(board, slots, cfg, rng, weights, excluded), cfg, 'patchFavor', excluded)
}
