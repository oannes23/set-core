/* net/embassy-status — the PURE view-state behind the Embassy scene (ui/app.ts renders it; this decides
   what state the Embassy is in, given the account + config + outbox depth). Keeps the branching logic
   testable out of the DOM. Three gates:
     • modded   — the mod-gate: the Embassy is closed, no online anything (records nothing either).
     • no-server — disabled OR no server URL: local-only (runs still record to the outbox; nothing syncs).
     • open      — enabled + a server URL + unmodded: the registry/records/sync paths are live.
   Status (anonymous / registered / declined) comes straight off the account. */

import type { EmbassyAccount } from './account'
import { isAvailable, type EmbassyConfig } from './config'

export type EmbassyGate = 'modded' | 'no-server' | 'open'

export interface EmbassyView {
  gate: EmbassyGate
  status: 'anonymous' | 'registered' | 'declined'
  handle: string | null
  /** a short, human-glanceable tag of the fingerprint (NOT the full id) — for "this device" display. */
  fingerprintShort: string
  /** the recovery code is still held locally (surfaced once at registration, until acknowledged). */
  hasRecoveryToShow: boolean
  /** runs queued locally, waiting to upload on a connected visit. */
  pendingUploads: number
}

/** A short uppercase tag from the fingerprint's tail (display only; never the key). */
export function fingerprintShort(fp: string): string {
  const clean = fp.replace(/-/g, '')
  return clean ? clean.slice(-6).toUpperCase() : '—'
}

export function embassyGate(cfg: EmbassyConfig): EmbassyGate {
  if (cfg.modded) return 'modded'
  return isAvailable(cfg) ? 'open' : 'no-server'
}

export function embassyView(acc: EmbassyAccount, cfg: EmbassyConfig, pendingUploads: number): EmbassyView {
  return {
    gate: embassyGate(cfg),
    status: acc.status,
    handle: acc.handle,
    fingerprintShort: fingerprintShort(acc.fingerprint),
    hasRecoveryToShow: !!acc.recoveryCode,
    pendingUploads: Math.max(0, pendingUploads),
  }
}

/** Can the player register here right now? Only when the server is reachable and they haven't already. */
export function canRegister(view: EmbassyView): boolean {
  return view.gate === 'open' && view.status !== 'registered'
}

/** Can we fetch/show this player's bests? Registered + a live server. */
export function canViewRecords(view: EmbassyView): boolean {
  return view.gate === 'open' && view.status === 'registered'
}
