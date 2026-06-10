/* engine/combat — the reducer. `reduce(state, action, deps) -> { state, events }`: pure, deterministic
   (RNG injected via deps), no DOM. This is the single mutation path (the step-6 seam): the UI dispatches
   actions and renders events; later a server can be the authority and clients replay the same actions. */

import type { Card } from '../core/affine'
import { isSet } from '../core/affine'
import type { Board } from '../core/sets'
import { findSets } from '../core/sets'
import { type GenConfig, genInitial } from '../core/generate'
import type { Rng } from '../core/rng'
import type { GameData } from '../data/schema'
import { type CombatState, type FoeRuntime, type Pending, TACTICS_DRAIN } from './state'
import { type CombatEvent, EventSink } from './events'
import { type Resolution, resolveSet, weightedRoll } from './resolve'
import { fireTriggers, runTrigger, enemyAttack, reformSlots, EMPTY_DESC } from './triggers'
import { gainBlock, addTactics, pushClock } from './ops'
import { firePassives } from './passives'
import { castAbility } from './abilities'
import { useTactic } from './tactics'
import { useConsumable } from './consumables'
import { assembleFoe } from './foe'

export type CombatAction =
  | { type: 'completeSet'; slots: [number, number, number] }
  | { type: 'tick'; dtMs: number }
  | { type: 'castAbility'; abilityId: string }
  | { type: 'useTactic'; key: string }
  | { type: 'useConsumable'; slot: number } // spend a carried potion/scroll
  | { type: 'flee' } // forfeit the encounter — available any time (not gated by the Tactics meter)

export interface Deps {
  data: GameData
  rng: Rng
}

const N_COLS: Record<number, number> = { 12: 4, 15: 5, 16: 4, 18: 6, 20: 5, 24: 6 }
export const colsForN = (n: number): number => N_COLS[n] ?? 5

/** The shipped combat board: 15 cards, shading (axis 2) dropped, easiest-k 1, 6 escape routes. */
export const COMBAT_GEN: GenConfig = { n: 15, active: [0, 1, 3], pin: [0, 0, 0, 0], camoDepth: 1, escapeRoutes: 6, floor: 1 }

export interface NewCombatOpts {
  foe: FoeRuntime
  gen: GenConfig
  playerMax?: number
  passives?: string[] // the chosen class's always-on passive ids
  consumables?: string[] // carried potions/scrolls for this run
  tacticsDrainMult?: number // slow the Tactics drain (e.g. 1/3 in the tutorial); default 1
  sequence?: string[] | null
  seqIdx?: number
  dungeonId?: string | null
}

/** Build a fresh combat state: a generated board + full vitals + the foe's clock primed. */
export function createCombat(opts: NewCombatOpts, rng: Rng): CombatState {
  const playerMax = opts.playerMax ?? 30
  const board: Board = genInitial(opts.gen, rng)
  return {
    playerHP: playerMax,
    playerMax,
    enemyHP: opts.foe.hp,
    enemyMax: opts.foe.hp,
    block: 0,
    mana: [0, 0, 0],
    tactics: 0,
    tacticsArmed: false,
    tacticsDrainMult: opts.tacticsDrainMult ?? 1,
    board,
    cols: colsForN(opts.gen.n),
    pending: new Map(),
    locked: new Map(),
    pendingRegenBias: null,
    passives: opts.passives ? opts.passives.slice() : [],
    consumables: opts.consumables ? opts.consumables.slice() : [],
    attackFrozen: false,
    nextSetDamageMult: 1,
    tickSuppressedUntil: 0,
    foe: opts.foe,
    now: 0,
    nextAttackAt: opts.foe.cadence * 1000,
    tickAccum: {},
    sequence: opts.sequence ?? null,
    seqIdx: opts.seqIdx ?? 0,
    running: true,
    result: null,
    gen: opts.gen,
    dungeonId: opts.dungeonId ?? null,
  }
}

// ---- combatant ops (block / tactics live in ops.ts, shared with abilities/passives/tactics) ----

function applyResolution(s: CombatState, res: Resolution, rng: Rng, sink: EventSink): void {
  // damage to enemy (immune foes — e.g. the ethereal goblin — take none from cards)
  if (res.damage > 0) {
    // a pending Strength buff (nextSetDamageMult) multiplies this attacking set, then is spent
    const mult = s.nextSetDamageMult
    const dmg = res.damage * mult
    if (mult !== 1) { s.nextSetDamageMult = 1; sink.emit({ type: 'buffFaded', id: 'strength', label: `Strength surges — that blow strikes ×${mult}` }) }
    if (s.foe.rules.immune_card_damage) {
      sink.emit({ type: 'enemyDamaged', amount: 0, immune: true })
    } else {
      s.enemyHP = Math.max(0, s.enemyHP - dmg)
      sink.emit({ type: 'enemyDamaged', amount: dmg })
    }
  }
  if (res.block > 0) gainBlock(s, res.block, rng, sink)
  // Move boots push the clock (capped at the foe's interval); overflow seconds feed Tactics
  let tactics = 0
  if (res.boot > 0) {
    const applied = pushClock(s, res.boot, sink)
    const overflow = res.boot - applied
    tactics = weightedRoll(res.boot, rng) + overflow
  }
  for (let i = 0; i < 3; i++) s.mana[i] += res.mana[i]
  sink.emit({ type: 'manaGained', mana: res.mana })
  if (tactics > 0) addTactics(s, tactics, sink)
}

/** Advance a gauntlet to the next foe (fresh board + vitals), or end the run with a win. */
function onWin(s: CombatState, deps: Deps, sink: EventSink): void {
  if (s.sequence && s.seqIdx < s.sequence.length - 1) {
    s.seqIdx++
    const dungeon = s.dungeonId ? (deps.data.dungeons[s.dungeonId] ?? null) : null
    const foe = assembleFoe(s.sequence[s.seqIdx], dungeon, deps.data, deps.rng)
    if (foe) {
      s.foe = foe
      s.enemyHP = foe.hp
      s.enemyMax = foe.hp
      // fresh start for the next lesson (forgiving)
      s.playerHP = s.playerMax
      s.block = 0
      s.mana = [0, 0, 0]
      s.tactics = 0
      s.tacticsArmed = false
      s.pending = new Map()
      s.locked = new Map()
      s.pendingRegenBias = null
      s.attackFrozen = false
      s.nextSetDamageMult = 1
      s.tickSuppressedUntil = 0
      s.tickAccum = {}
      s.board = genInitial(s.gen, deps.rng)
      s.now = 0
      s.nextAttackAt = foe.cadence * 1000
      sink.emit({ type: 'foeChanged', name: foe.name, rules: foe.rules })
      return
    }
  }
  s.running = false
  s.result = 'win'
  sink.emit({ type: 'won' })
}

function completeSet(s: CombatState, slots: [number, number, number], deps: Deps, sink: EventSink): void {
  if (!s.running) return // a settled fight accepts no more sets (replayed/stray actions are no-ops)
  const [a, b, c] = slots
  const ca = s.board[a]
  const cb = s.board[b]
  const cc = s.board[c]
  if (!ca || !cb || !cc) return
  if (s.locked.has(a) || s.locked.has(b) || s.locked.has(c)) return
  if (!isSet(ca, cb, cc)) return // invalid pick — no-op (the UI handles misread feedback)
  if (s.attackFrozen) { s.attackFrozen = false; sink.emit({ type: 'buffFaded', id: 'invisibility', label: 'Invisibility fades — the enemy sees you again' }) }
  const cards: [Card, Card, Card] = [ca, cb, cc]
  const res = resolveSet(cards, deps.rng)
  applyResolution(s, res, deps.rng, sink)
  sink.emit({ type: 'setResolved', damage: res.damage, block: res.block, boot: res.boot, tactics: 0, mana: res.mana, slots })
  // character-innate passives react to this match's signature (Momentum may steer the refill below)...
  firePassives(s, 'match', res.desc, deps.rng, sink)
  // ...and the FOE prices this match (traps + tricks fire on the same bus)
  if (s.running && s.enemyHP > 0) fireTriggers(s, 'match', res.desc, deps.rng, sink)
  if (!s.running) return
  if (s.enemyHP <= 0) {
    onWin(s, deps, sink)
    return
  }
  // clear the matched slots and refill (keeps ≥ FLOOR sets); a passive may bias this refill
  const bias = s.pendingRegenBias
  s.pendingRegenBias = null
  for (const i of slots) s.board[i] = null
  reformSlots(s, slots, bias ?? undefined, deps.rng)
}

function tick(s: CombatState, dtMs: number, deps: Deps, sink: EventSink): void {
  if (!s.running) return
  s.now += dtMs
  const dt = dtMs / 1000
  // a frozen attack clock (Invisibility) advances with `now` so it never elapses until the player acts
  if (s.attackFrozen) s.nextAttackAt += dtMs
  // a Hourglass tick-suppression window that has now elapsed fades (one-shot)
  if (s.tickSuppressedUntil > 0 && s.now >= s.tickSuppressedUntil) {
    s.tickSuppressedUntil = 0
    sink.emit({ type: 'buffFaded', id: 'hourglass', label: 'The hourglass empties — drift resumes' })
  }
  // tactics drain while armed — paused during Invisibility; the tutorial slows it via tacticsDrainMult
  if (s.tacticsArmed && !s.attackFrozen) {
    s.tactics = Math.max(0, s.tactics - TACTICS_DRAIN * s.tacticsDrainMult * dt)
    if (s.tactics <= 0) {
      s.tacticsArmed = false
      sink.emit({ type: 'tacticsReset' })
    }
  }
  // on:tick triggers (drift + dread-DoTs), each on its own accumulator — paused while suppressed (Hourglass)
  const tickers: { key: string; trig: typeof s.foe.triggers[number] }[] = []
  if (s.now >= s.tickSuppressedUntil) {
    s.foe.triggers.forEach((t, i) => {
      if (t.on === 'tick') tickers.push({ key: `t${i}`, trig: t })
    })
    if (s.foe.drift) tickers.push({ key: 'drift', trig: s.foe.drift })
  }
  for (const { key, trig } of tickers) {
    s.tickAccum[key] = (s.tickAccum[key] ?? 0) + dt
    const period = trig.every || 5
    let guard = 0
    while (s.tickAccum[key] >= period && s.running && guard++ < 4) {
      s.tickAccum[key] -= period
      runTrigger(s, trig, EMPTY_DESC, deps.rng, sink) // tick triggers fire with no match descriptor
    }
  }
  if (!s.running) return // a tick trigger ended the fight — no board upkeep after `lost`
  // unlock expired locks
  if (s.locked.size) {
    const freed: number[] = []
    for (const [slot, until] of s.locked) if (s.now >= until) freed.push(slot)
    for (const slot of freed) s.locked.delete(slot)
    if (freed.length) sink.emit({ type: 'cardsUnlocked', slots: freed })
  }
  // reform pending slots whose timer elapsed (grouped by bias for a single patch each)
  if (s.pending.size) {
    const due: { slot: number; bias?: Pending['bias'] }[] = []
    for (const [slot, p] of s.pending) if (s.now >= p.reformAt) due.push({ slot, bias: p.bias })
    if (due.length) {
      // group by bias identity (undefined vs each bias object); reform per group
      const groups = new Map<unknown, number[]>()
      for (const d of due) {
        const k = d.bias ?? 'none'
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(d.slot)
      }
      const reformed: number[] = []
      for (const [, gslots] of groups) {
        const bias = s.pending.get(gslots[0])?.bias
        reformSlots(s, gslots, bias, deps.rng)
        reformed.push(...gslots)
      }
      if (reformed.length) sink.emit({ type: 'cardsReformed', slots: reformed })
    }
  }
  // enemy attack when the clock elapses
  if (s.now >= s.nextAttackAt && s.running) {
    enemyAttack(s, deps.rng, sink)
    if (!s.running) return
  }
}

/** The single reduction step. Clones the input state so callers keep the prior state (replay/undo). */
export function reduce(state: CombatState, action: CombatAction, deps: Deps): { state: CombatState; events: CombatEvent[] } {
  const s = cloneState(state)
  const sink = new EventSink()
  switch (action.type) {
    case 'completeSet':
      completeSet(s, action.slots, deps, sink)
      break
    case 'tick':
      tick(s, action.dtMs, deps, sink)
      break
    case 'castAbility':
      if (castAbility(s, action.abilityId, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, deps, sink)
      break
    case 'useTactic':
      if (useTactic(s, action.key, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, deps, sink)
      break
    case 'useConsumable':
      if (useConsumable(s, action.slot, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, deps, sink)
      break
    case 'flee':
      if (s.running) { s.running = false; s.result = 'flee'; sink.emit({ type: 'fled' }) }
      break
  }
  return { state: s, events: sink.events }
}

export function cloneState(s: CombatState): CombatState {
  return {
    ...s,
    mana: [s.mana[0], s.mana[1], s.mana[2]],
    board: s.board.map((c) => (c ? ([c[0], c[1], c[2], c[3]] as Card) : null)),
    pending: new Map([...s.pending].map(([k, v]) => [k, { ...v }])),
    locked: new Map(s.locked),
    pendingRegenBias: s.pendingRegenBias ? { ...s.pendingRegenBias } : null,
    passives: s.passives.slice(),
    consumables: s.consumables.slice(),
    tickAccum: { ...s.tickAccum },
    foe: s.foe, // immutable per encounter
    gen: s.gen,
  }
}
