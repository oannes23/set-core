/* net/run-capture — the glue between a finished live run and the metrics outbox. The UI gathers the
   run-specific facts (seed, class/foe/dungeon, result, tallies, the action log) and calls recordRun;
   THIS module supplies the cross-cutting bits (the player fingerprint, the client versions, the live
   mod-flag), builds the wire record, and queues it — all best-effort and fully gated.

   GATE: a MODDED game records nothing (modded runs must never enter the official corpus — the record
   would carry integrity.modded and the server would reject it anyway, but we don't even queue it).
   Otherwise we ALWAYS queue locally, regardless of the enable/consent flag: the outbox is local, and
   the backlog is what gets uploaded on the first consented Embassy visit (the user's explicit design).
   Never throws — a capture failure must not disturb the end-of-run UI. */

import { initAccount } from './account'
import { buildRunRecord, type CapturedRun } from './capture'
import { getConfig } from './config'
import { enqueueRecord } from './outbox'
import { CLIENT_CONTENT_VERSION, CLIENT_RULESET_VERSION } from './version'

/** The run facts the UI supplies — everything in CapturedRun except the cross-cutting fields this
 *  module fills (fingerprint / versions / modded). */
export type RunFacts = Omit<CapturedRun, 'fingerprint' | 'rulesetVersion' | 'contentVersion' | 'modded'>

/** Queue a finished run for upload (best-effort, gated, never throws). Returns true if it was recorded. */
export function recordRun(facts: RunFacts): boolean {
  try {
    if (getConfig().modded) return false // mod-gate: never record a modded run
    const acc = initAccount() // mints the write-once fingerprint on first run
    const rec = buildRunRecord({
      ...facts,
      fingerprint: acc.fingerprint,
      rulesetVersion: CLIENT_RULESET_VERSION,
      contentVersion: CLIENT_CONTENT_VERSION,
      modded: false,
    })
    enqueueRecord(rec)
    return true
  } catch {
    return false // a metrics hiccup never disturbs the run
  }
}
