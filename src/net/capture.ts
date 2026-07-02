/* net/capture — turn a finished live run into a metrics RunRecord, PURELY. The UI extracts a flat bag
   of facts from its live view at run-end (no DOM, no engine objects) and hands it here; this maps that
   bag → the wire shape (context / outcome / instruments) via record.assembleRunRecord. Fully unit-tested.

   The replay substrate is the captured `actions` (the engine's CombatAction log — engine/session.ts) plus
   the run `seed`. Balance instruments are split two ways: ratios derived from the action log here (ability
   activations, tactics usage — PURE + reproducible) and the live dev/stat tallies the UI accumulated
   during play (reshape share, trap springs, damage — read off the view). `instruments` is an open object,
   so adding signal here never bumps schemaVersion.

   NOTE (scope): the `seed` drives board-gen + the in-combat tick RNG, so the board sequence is replayable
   given the same initial combat state. FULL server-side re-simulation additionally needs the foe snapshot
   + stat/gear context threaded through an extended session seam (deferred — TODO §A step 6); we capture
   the seed + action log NOW so that work doesn't require re-instrumenting historical runs. */

import type { CombatAction } from '../engine/combat'
import type { RunContext, RunOutcome, RunRecord } from './contract'
import { assembleRunRecord, toWireResult } from './record'

/** practice = a one-off fight (the `begin` path) · delve = a room in a run · daily = the daily challenge.
 *  The WIRE kind is only delve|daily, so practice folds to a delve-kind record disambiguated by
 *  `instruments.mode` (open object — no contract change). Flagged to the service team as a possible
 *  first-class `kind: 'practice'`. */
export type RunMode = 'practice' | 'delve' | 'daily'

export interface DevTally {
  reshapeYou: number
  reshapeFoe: number
  matches: number
  springs: number
  k1: number
  wards: number
  churns: number
}
export interface StatTally {
  dealt: number
  taken: number
  blocked: number
  healed: number
  sets: number
  traps: number
  xp: number
  gearDmg: number
  gearBlock: number
  gearMana: number
}

/** The flat bag the UI extracts from its live view at run-end (see ui/app.ts endScreen). */
export interface CapturedRun {
  // identity + versions
  fingerprint: string
  rulesetVersion: string
  contentVersion: string
  modded: boolean
  // setup / context
  seed: number
  classId: string
  foeId: string | null
  dungeonId: string | null
  mode: RunMode
  dailyDate?: string | null
  // outcome
  result: 'win' | 'lose' | 'flee'
  rounds: number
  elapsedMs: number
  depthReached: number
  // integrity telemetry (open object — no schema bump)
  wallClockMs: number // P5 — real elapsed wall time (engine `elapsedMs` excludes paused time)
  pausedMs: number // P5 — accumulated player-pause duration
  pauseCount: number // P5 — how many times the player paused (0 on the daily — pause is disabled there)
  devMode: boolean // P6 — was dev mode on? (dev grants real gear, so its runs must be distinguishable)
  // the replay substrate
  actions: readonly CombatAction[]
  // the live tallies the UI accumulated (V.dev + V.stats)
  dev: DevTally
  stats: StatTally
}

export interface ActionTally {
  abilityActivations: Record<string, number>
  tacticsUsage: { standGround: number; maneuver: number; biasChanges: number }
  consumablesUsed: number
  setsAttempted: number // completeSet actions the engine accepted
  fled: boolean
}

/** Tally the player-decision signal straight from the action log (pure + reproducible). */
export function tallyActions(actions: readonly CombatAction[]): ActionTally {
  const abilityActivations: Record<string, number> = {}
  let standGround = 0
  let maneuver = 0
  let biasChanges = 0
  let consumablesUsed = 0
  let setsAttempted = 0
  let fled = false
  for (const a of actions) {
    switch (a.type) {
      case 'castAbility':
        abilityActivations[a.abilityId] = (abilityActivations[a.abilityId] ?? 0) + 1
        break
      case 'setTactic':
        if (a.tactic === 'stand') standGround++
        else maneuver++
        break
      case 'setBias':
        biasChanges++
        break
      case 'useConsumable':
        consumablesUsed++
        break
      case 'completeSet':
        setsAttempted++
        break
      case 'flee':
        fled = true
        break
      // 'tick' carries no player decision
    }
  }
  return { abilityActivations, tacticsUsage: { standGround, maneuver, biasChanges }, consumablesUsed, setsAttempted, fled }
}

/** A ratio in [0,1], or null when the denominator is 0 (no fabricated 0% from an empty run). */
function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null
}

/** The balance instruments — derived ratios (vs TUNING.md targets) + the raw tallies, as an open object. */
export function buildInstruments(c: CapturedRun): Record<string, unknown> {
  const t = tallyActions(c.actions)
  const reshapeTotal = c.dev.reshapeYou + c.dev.reshapeFoe
  return {
    mode: c.mode,
    // dev-target ratios (TUNING.md §"Dev-instrument design targets")
    setsMatched: c.dev.matches,
    setsPerRound: c.rounds > 0 ? c.dev.matches / c.rounds : 0,
    reshareSharePlayer: ratio(c.dev.reshapeYou, reshapeTotal), // target 0.65–0.70
    trapSpringRate: ratio(c.dev.springs, c.dev.matches), // target ~0.30
    gimmeRate: ratio(c.dev.k1, c.dev.matches),
    wards: c.dev.wards,
    churns: c.dev.churns,
    // player-decision signal from the action log
    abilityActivations: t.abilityActivations,
    tacticsUsage: t.tacticsUsage,
    consumablesUsed: t.consumablesUsed,
    setsAttempted: t.setsAttempted,
    // integrity telemetry (P5 pause/wall-clock, P6 dev mode)
    wallClockMs: Math.round(c.wallClockMs),
    pausedMs: Math.round(c.pausedMs),
    pauseCount: c.pauseCount,
    devMode: c.devMode,
    // raw combat tallies
    damageDealt: c.stats.dealt,
    damageTaken: c.stats.taken,
    blocked: c.stats.blocked,
    healed: c.stats.healed,
    trapsSprung: c.stats.traps,
    xp: c.stats.xp,
    gear: { dmg: c.stats.gearDmg, block: c.stats.gearBlock, mana: c.stats.gearMana },
  }
}

/** Map a captured run → a wire RunRecord (context + outcome + instruments). Mints the eventId. */
export function buildRunRecord(c: CapturedRun): RunRecord {
  const context: RunContext = {
    kind: c.mode === 'daily' ? 'daily' : 'delve',
    dailyDate: c.dailyDate ?? null,
    classId: c.classId,
    foeId: c.foeId,
    seed: String(c.seed >>> 0),
    specRef:
      c.mode === 'daily' && c.dailyDate ? `daily/${c.dailyDate}` : c.dungeonId ? `${c.mode}/${c.dungeonId}` : c.mode,
  }
  const win = c.result === 'win'
  const outcome: RunOutcome = {
    result: toWireResult(c.result),
    terms: win ? c.dev.matches : null, // "sets matched to clear" — only meaningful on a clear
    realTimeMs: Math.round(c.elapsedMs),
    depthReached: c.depthReached,
  }
  return assembleRunRecord({
    fingerprint: c.fingerprint,
    rulesetVersion: c.rulesetVersion,
    contentVersion: c.contentVersion,
    modded: c.modded,
    context,
    outcome,
    actions: c.actions,
    instruments: buildInstruments(c),
  })
}
