/* net/record — assemble a replay-ready RunRecord, and mint the UUIDs the online layer keys on.
   PURE (no I/O, no network) so it's fully unit-tested; the caller (the Embassy/run glue) feeds it the
   live run facts. The engine already produces the replay substrate — a run is `seed + setup + an
   ordered CombatAction[]` (engine/session.ts) — so "the recorder" is just capturing that log and
   packaging it here; re-simulation server-side reproduces the run from `actions` + `seed` + versions. */

import { SCHEMA_VERSION, type Integrity, type RunContext, type RunOutcome, type RunRecord, type RunResult } from './contract'

/** A fresh UUID (crypto.randomUUID in browser + Node ≥19; a non-crypto fallback only if absent, so the
 *  app never crashes minting an id — these are unique-keys/fingerprints, not security tokens). */
export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // fallback: timestamp + randoms (collision-safe enough for a single client's outbox)
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The engine reports 'lose'; the wire wants 'loss'. The single mapping point. */
export function toWireResult(engineResult: 'win' | 'lose' | 'flee'): RunResult {
  return engineResult === 'lose' ? 'loss' : engineResult
}

export interface AssembleRunArgs {
  fingerprint: string
  rulesetVersion: string
  contentVersion: string
  /** honor-system mod flag (true ⇒ the Embassy is disabled client-side and this never uploads anyway). */
  modded?: boolean
  manifestHash?: string | null // reserved for the future content-hash gate
  context: RunContext
  outcome: RunOutcome
  actions: readonly unknown[] // the captured CombatAction[] log (stored opaque on the wire)
  instruments?: Record<string, unknown>
  /** override the eventId (tests/determinism); otherwise a fresh UUID is minted. */
  eventId?: string
}

/** Build one RunRecord ready for the outbox. Stamps schemaVersion + a fresh eventId (the idempotency
 *  key). Does NOT touch storage or the network. */
export function assembleRunRecord(args: AssembleRunArgs): RunRecord {
  const integrity: Integrity = { modded: args.modded ?? false, manifestHash: args.manifestHash ?? null }
  return {
    eventId: args.eventId ?? newId(),
    fingerprint: args.fingerprint,
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: args.rulesetVersion,
    contentVersion: args.contentVersion,
    integrity,
    context: args.context,
    outcome: args.outcome,
    actions: args.actions,
    instruments: args.instruments ?? {},
  }
}
