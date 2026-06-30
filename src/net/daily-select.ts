/* net/daily-select — derive a daily challenge's SETUP from its seed, PURELY + deterministically. The
   daily ships as a tiny seed (+ optional authored spec); every player who shares the seed AND the
   ruleset/content versions must compute the IDENTICAL setup, so the leaderboard is fair. This module is
   that shared derivation: opaque seed string → a uint32 → the per-axis selections.

   Kept engine-free (no GAMEDATA, no rng module import beyond the tiny PRNG) so the decision is unit-tested
   out of the DOM. The caller (ui) supplies the candidate id lists (already filtered for daily-eligibility)
   and resolves the foe + assembles combat from `seedInt`.

   DRAW ORDER IS LOAD-BEARING: dungeon, then class. Reorder and every historical daily re-rolls — only ever
   append new draws at the end. Authored (`fixed`) axes are authoritative and consume NO draw (so pinning
   one axis never shifts the others). */

import { mulberry32, type Rng } from '../core/rng'
import type { DailyFixed } from './daily'

/** The daily-eligible content the caller offers, each in a STABLE order (the derivation indexes into
 *  these, so a reordering changes every daily — treat the order as part of the ruleset). */
export interface DailyCandidates {
  /** playable class ids (e.g. CLASSES.map(c => c.id)). */
  classIds: string[]
  /** real, difficulty-gated dungeon ids fair for the standardized daily hero. */
  dungeonIds: string[]
}

/** The derived, version-stable selections. `foeId` is left to the caller (it needs the dungeon's
 *  enemy_table); the caller resolves it from `seedInt` (or the authored `fixed.foeId`). */
export interface DailySetup {
  seedInt: number
  classId: string
  dungeonId: string
}

/** Hash an opaque daily seed string → a uint32 PRNG seed (FNV-1a, 32-bit). Stable across platforms —
 *  the same string always yields the same int, so the same daily yields the same board. */
export function seedToInt(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic index pick from a non-empty list. */
function pickIndex(len: number, rng: Rng): number {
  return Math.min(len - 1, Math.floor(rng() * len))
}

/** Derive the daily setup. Authored `fixed` axes win (and consume no draw); the rest derive from the
 *  seed in the fixed draw order (dungeon → class). Throws only if an unfixed axis has no candidates. */
export function deriveDailySetup(seed: string, fixed: DailyFixed, cand: DailyCandidates): DailySetup {
  const seedInt = seedToInt(seed)
  const rng = mulberry32(seedInt)

  let dungeonId = fixed.dungeonId
  if (dungeonId === undefined) {
    if (cand.dungeonIds.length === 0) throw new Error('daily: no eligible dungeons')
    dungeonId = cand.dungeonIds[pickIndex(cand.dungeonIds.length, rng)]
  }

  let classId = fixed.classId
  if (classId === undefined) {
    if (cand.classIds.length === 0) throw new Error('daily: no eligible classes')
    classId = cand.classIds[pickIndex(cand.classIds.length, rng)]
  }

  return { seedInt, classId, dungeonId }
}
