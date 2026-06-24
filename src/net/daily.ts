/* net/daily — resolve a /daily descriptor into "play this" or "unavailable", PURELY. Encodes the
   daily-roll contract (SERVICE-REPLY-RESPONSE.md §1):
     • version pin — the descriptor's ruleset/content versions must equal the client's, else the daily
       is unavailable ("update to play today"). Versions are opaque tokens, equality-compared.
     • authored `spec` (path b) — if present, its ids are AUTHORITATIVE and each must validate against
       the LOCAL content registry; an unknown id ⇒ unavailable (same UX as a version mismatch), never a
       content fetch. Axes the author left out fall back to seed-derivation.
     • no `spec` (path a, the default) — every selection derives from `seed` (the caller runs that
       deterministic roll over local content; this module just greenlights it + hands back the seed).

   No I/O, no engine coupling: the registry is injected as a predicate so the decision stays unit-tested.
   The actual seed→board generation + the Embassy scene live at the call site (ui), not here. */

import type { DailyResponse } from './contract'

export interface ClientVersions {
  rulesetVersion: string
  contentVersion: string
}

/** Predicate over the client's LOCAL content registry — wired to data/registry at the call site. */
export interface ContentLookup {
  hasClass(id: string): boolean
  hasFoe(id: string): boolean
  hasDungeon(id: string): boolean
}

/** The author-fixed selections that validated locally. Only the axes the author pinned appear; any
 *  absent axis is the caller's to derive from `seed`. */
export interface DailyFixed {
  classId?: string
  foeId?: string
  dungeonId?: string
}

export type DailyResolution =
  | { status: 'unavailable'; reason: 'version' | 'content'; detail?: string }
  | { status: 'available'; seed: string; authored: boolean; fixed: DailyFixed; params: Record<string, unknown> }

function nonEmpty(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0
}

export function resolveDaily(desc: DailyResponse, client: ClientVersions, content: ContentLookup): DailyResolution {
  // 1) version pin — both must match (opaque-token equality).
  if (desc.rulesetVersion !== client.rulesetVersion || desc.contentVersion !== client.contentVersion) {
    return { status: 'unavailable', reason: 'version' }
  }

  const spec = desc.spec
  // 2) no authored spec ⇒ derive everything from seed (path a).
  if (!spec) return { status: 'available', seed: desc.seed, authored: false, fixed: {}, params: {} }

  // 3) authored spec ⇒ validate each PRESENT id against the local registry; unknown ⇒ unavailable.
  const fixed: DailyFixed = {}
  if (nonEmpty(spec.classId)) {
    if (!content.hasClass(spec.classId)) return { status: 'unavailable', reason: 'content', detail: `class:${spec.classId}` }
    fixed.classId = spec.classId
  }
  if (nonEmpty(spec.foeId)) {
    if (!content.hasFoe(spec.foeId)) return { status: 'unavailable', reason: 'content', detail: `foe:${spec.foeId}` }
    fixed.foeId = spec.foeId
  }
  if (nonEmpty(spec.dungeonId)) {
    if (!content.hasDungeon(spec.dungeonId)) return { status: 'unavailable', reason: 'content', detail: `dungeon:${spec.dungeonId}` }
    fixed.dungeonId = spec.dungeonId
  }
  return { status: 'available', seed: desc.seed, authored: true, fixed, params: spec.params ?? {} }
}
