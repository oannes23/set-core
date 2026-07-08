/* ui/delve-persist — persist the LIVE delve run under its OWN localStorage key so a PWA process kill
   or an accidental refresh mid-delve doesn't SILENTLY destroy the committed satchel consumables
   (debited out of the vault at delve start). Two constraints shape the recovery policy:
     • CombatState is not serialisable (Maps + shared refs — FABLE §8), so there is no mid-combat
       resume; the persisted object is the run economy (satchel/gold/gear), not the fight.
     • Banking an interrupted run's found gold/gear would be exploitable (close-the-app-to-keep-loot),
       so an interrupted run FORFEITS its spoils but RETURNS the surviving satchel consumables — the
       player already paid for those, and returning them can't be farmed.
   So on boot a stranded run is resolved as a graceful forfeit: return `bag` to Storage, drop the rest.
   Envelope/sanitize mirrors bank.ts + save.ts; storage I/O is best-effort (never throws). FABLE §6 U2. */

import { sanitizeItem, type GearInstance } from '../engine/items'
import type { DelveState, EncounterTier } from '../engine/delve'
import type { DelveRun } from './delve-run'

const KEY = 'setcore.delve.v1' // stable — versioning lives in the payload envelope, not the key
const SCHEMA_V = 1
const TIERS: EncounterTier[] = ['minion', 'elite', 'boss']

const posNum = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : dflt)

function sanitizeDelveState(x: unknown): DelveState | null {
  if (typeof x !== 'object' || x === null) return null
  const d = x as Partial<DelveState>
  if (typeof d.dungeonId !== 'string' || !d.dungeonId) return null
  return {
    dungeonId: d.dungeonId,
    bossRoll: typeof d.bossRoll === 'number' && Number.isFinite(d.bossRoll) ? d.bossRoll : 0,
    room: Math.max(1, Math.floor(posNum(d.room, 1))),
    sinceElite: Math.max(0, Math.floor(posNum(d.sinceElite))),
    bossFound: d.bossFound === true,
  }
}

/** Parse a stored run back into a clean DelveRun (or null on garbage / missing state). Never throws. */
export function sanitizeDelveRun(x: unknown): DelveRun | null {
  if (typeof x !== 'object' || x === null) return null
  const r = x as Partial<DelveRun>
  const d = sanitizeDelveState(r.d)
  if (!d) return null
  const bag = Array.isArray(r.bag) ? r.bag.filter((s): s is string => typeof s === 'string') : []
  const tier: EncounterTier = TIERS.includes(r.tier as EncounterTier) ? (r.tier as EncounterTier) : 'minion'
  const gearFound = Array.isArray(r.gearFound)
    ? r.gearFound.map(sanitizeItem).filter((i): i is GearInstance => i !== null && i.kind === 'gear')
    : []
  return { d, bag, tier, gold: Math.floor(posNum(r.gold)), gearFound, gearPity: posNum(r.gearPity) }
}

/** Load the stranded run (if any). The caller decides how to resolve it (forfeit-with-return). */
export function loadDelve(): DelveRun | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitizeDelveRun(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** Checkpoint the live run (best-effort). Call whenever the satchel/gold/gear materially changes. */
export function saveDelve(run: DelveRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_V, ...run }))
  } catch {
    /* quota / disabled storage — the run stays in memory; a kill just forfeits, as before */
  }
}

/** Drop the persisted run — call the instant a run ENDS (any road back to town, or after forfeit). */
export function clearDelve(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* best-effort */
  }
}
