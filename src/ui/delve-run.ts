/* ui/delve-run — the DELVE RUN-STATE economy, DOM-free and testable. Lifts the run orchestration
   out of app.ts's `delveFork`/`rollDelveLoot`/`bankGearFound`: the satchel/gold/gear accrual and the
   exit decisions (death tithe, safe cash-out / boss clear). The economy MATH lives in engine + bank
   (`rollRoomLoot`, `applyTithe`, `addManyToStorage`, `addGold`); this is the orchestration against the
   run object + the account. Pure of DOM — app.ts renders the outcomes it returns. Lives in ui/ (not
   engine) because it ties engine rolls to the ui/bank Account; that keeps the layering ui→engine. */

import type { Rng } from '../core/rng'
import type { FoeRuntime } from '../engine/state'
import type { GearInstance } from '../engine/items'
import type { DelveState, EncounterTier } from '../engine/delve'
import { RUN_BAG_CAP } from '../engine/delve'
import { rollRoomLoot } from '../engine/loot'
import { CONSUMABLES } from '../engine/consumables'
import { type Account, applyTithe, addManyToStorage, addGold } from './bank'

/** The live delve run-state (UI-held, but a plain serialisable object: the run satchel + the spoils). */
export interface DelveRun {
  d: DelveState
  bag: string[] // the run satchel (consumables; drunk = gone)
  tier: EncounterTier // the current room's tier (a boss clear is the run's best exit)
  gold: number // gold carried this run (banks on a safe exit, lost on death)
  gearFound: GearInstance[] // gear gathered this run (banks to Storage on a safe exit, lost on death)
  gearPity: number // the gear-pity sawtooth, carried room to room
}

/** What a cleared room dropped, captured so the roll happens ONCE — the ledger reveal and the fork's
 *  static list both read this. `added`/`left` = consumables that fit the satchel / overflowed the cap. */
export interface DelveLoot {
  gold: number
  gear: GearInstance[]
  added: string[]
  left: string[]
  trace: string[]
}

/** Roll a cleared room's loot (CRAWL §3) and accrue it into the run: gold → purse, gear → gearFound,
 *  consumables → the satchel (cap RUN_BAG_CAP, overflow reported as `left`). Mutates + returns the drop. */
export function applyRoomLoot(run: DelveRun, foe: FoeRuntime, rng: Rng, cap = RUN_BAG_CAP): DelveLoot {
  const loot = rollRoomLoot(foe, run.d.room, rng, run.gearPity)
  run.gold += loot.gold
  run.gearPity = loot.gearPity // carry the sawtooth into the next room
  for (const g of loot.gear) run.gearFound.push(g) // accrues; banks on a safe exit (lost on death)
  const added: string[] = [], left: string[] = []
  for (const id of loot.items) {
    if (!CONSUMABLES[id]) continue
    if (run.bag.length >= cap) { left.push(id); continue }
    run.bag.push(id); added.push(id)
  }
  return { gold: loot.gold, gear: loot.gear, added, left, trace: loot.trace }
}

/** Bank the run's found gear into account Storage; returns the updated account + how many fit/overflowed
 *  (Storage is capped — overflow is dropped for now; the return-triage screen, deferred B2, will choose). */
export function bankRunGear(account: Account, run: DelveRun): { account: Account; banked: number; overflow: number } {
  if (!run.gearFound.length) return { account, banked: 0, overflow: 0 }
  const before = run.gearFound.length
  const { account: acc, overflow } = addManyToStorage(account, run.gearFound)
  return { account: acc, banked: before - overflow.length, overflow: overflow.length }
}

export type DelveExit = 'death' | 'safe'
export interface ExitOutcome {
  exit: DelveExit
  goldBanked: number // gold added to the vault (safe exit)
  goldTotal: number // the vault total after banking
  goldLost: number // carried gold forfeit (death)
  tithe: number // banked gold lost to the recovery tithe (death)
  gearBanked: number
  gearOverflow: number
}

/** The exit decision (CRAWL §6), pure: given the run + the current account, return the new account +
 *  a description of what happened. Death → the recovery tithe bites the vault, and the carried gold +
 *  found gear are forfeit. Safe exit (cash-out OR boss clear) → bank the carried gold + the found gear.
 *  The caller saves the returned account and renders the outcome (gold/gear read off the run here, so
 *  the run can be discarded afterward). */
export function resolveDelveExit(account: Account, run: DelveRun, exit: DelveExit): { account: Account; outcome: ExitOutcome } {
  if (exit === 'death') {
    const { bank, lost } = applyTithe(account)
    return { account: bank, outcome: { exit, goldBanked: 0, goldTotal: bank.gold, goldLost: run.gold, tithe: lost, gearBanked: 0, gearOverflow: 0 } }
  }
  const banked = run.gold
  const withGold = addGold(account, banked)
  const gear = bankRunGear(withGold, run)
  return {
    account: gear.account,
    outcome: { exit, goldBanked: banked, goldTotal: gear.account.gold, goldLost: 0, tithe: 0, gearBanked: gear.banked, gearOverflow: gear.overflow },
  }
}
