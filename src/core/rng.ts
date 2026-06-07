/* core/rng — an injectable random source. The prototype called Math.random() directly inside
   the generator; threading an Rng instead makes generation pure + deterministic (seedable tests
   today, and the basis for server-authoritative / replayable generation later). */

/** A random source: returns a float in [0, 1). */
export type Rng = () => number

/** The system RNG — used by the app at runtime. */
export const systemRng: Rng = Math.random

/** mulberry32 — a tiny, fast, seedable PRNG for deterministic tests/replay. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform integer in [0, 3) — the per-axis draw for a 3-valued feature. */
export const r3 = (rng: Rng): number => Math.floor(rng() * 3)
