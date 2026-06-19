/* ui/career — a tiny ACCOUNT-WIDE lifetime counter (rounds played), kept in its OWN localStorage key
   (not the roster schema — no migration), best-effort. It drives the experience-based pacing of the
   splash cinematics: a brand-new player gets the full beat-by-beat ledger; a veteran with thousands of
   rounds has read it a thousand times and wants the outcome NOW, so the dwell compresses toward a floor.
   `paceForRounds` is pure + tested; the storage I/O is cached and swallows failures. */

const KEY = 'setcore.career.v1'
let cached = -1

/** Lifetime rounds the player has fought (across every character / run). Cached after first read. */
export function careerRounds(): number {
  if (cached < 0) {
    try { cached = Math.max(0, Math.floor(JSON.parse(localStorage.getItem(KEY) || '{}').rounds) || 0) } catch { cached = 0 }
  }
  return cached
}

/** Credit `n` fought rounds to the lifetime tally (best-effort persist). */
export function bumpCareerRounds(n = 1): void {
  cached = careerRounds() + n
  try { localStorage.setItem(KEY, JSON.stringify({ rounds: cached })) } catch { /* storage full / denied — non-fatal */ }
}

/** Test seam: reset the in-memory cache (callers in tests can stub localStorage first). */
export function _resetCareerCache(): void { cached = -1 }

const NOVICE = 40 // ≤ this many rounds → the full, unhurried ledger (the teaching window)
const VETERAN = 2500 // ≥ this → the floor pace (you've seen it all)
const FLOOR = 0.4 // veteran dwell = 40% of the novice window — snappy, still legible

/** Splash-cinematic pace multiplier by lifetime rounds: 1.0 (novice) → FLOOR (veteran), smoothstep
 *  between. Multiplies the animation timings AND the dwell — a smaller number = faster. */
export function paceForRounds(rounds: number): number {
  if (rounds <= NOVICE) return 1
  if (rounds >= VETERAN) return FLOOR
  const t = (rounds - NOVICE) / (VETERAN - NOVICE)
  const eased = t * t * (3 - 2 * t) // smoothstep — gentle in, gentle out
  return 1 - eased * (1 - FLOOR)
}
