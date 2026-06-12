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
import { type CombatState, type FoeRuntime, type Pending, type TacticKind, type ManeuverBias, type StatBlock, MANA_CAP, DEFAULT_PLAYER_MAX, BASE_STATS, ROUND_MS } from './state'
import { type CombatEvent, EventSink } from './events'
import { type Resolution, resolveSet, weightedRoll, SHAPE_MOVE } from './resolve'
import { fireTriggers, runTrigger, inflictWounds, hurtPlayer, reformSlots, EMPTY_DESC } from './triggers'
import { gainBlock, addCharges } from './ops'
import { firePassives } from './passives'
import { castAbility } from './abilities'
import { setTactic, setBias, lockQueuedStance, rolloverDump } from './tactics'
import { useConsumable } from './consumables'

export type CombatAction =
  | { type: 'completeSet'; slots: [number, number, number] }
  | { type: 'tick'; dtMs: number }
  | { type: 'castAbility'; abilityId: string }
  | { type: 'setTactic'; tactic: TacticKind } // QUEUE a stance for next round (locks at the draw phase)
  | { type: 'setBias'; bias: ManeuverBias | null } // QUEUE Maneuver's dial (part of the locked stance)
  | { type: 'useConsumable'; slot: number } // spend a carried potion/scroll
  | { type: 'flee' } // forfeit the encounter — available any time (not gated by Tactics)

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
  stats?: StatBlock // Resolution v2: Power/Endurance/Speed (default BASE_STATS = old-system parity)
  passives?: string[] // the chosen class's always-on passive ids
  consumables?: string[] // carried potions/scrolls for this run
}

/** Roll a foe's exchange total: `swings` weighted rolls, summed into ONE telegraph number. */
function rollStrike(foe: FoeRuntime, rng: Rng): number {
  if (foe.damage <= 0) return 0
  let total = 0
  for (let i = 0; i < foe.swings; i++) total += weightedRoll(foe.damage, rng)
  return total
}

/** Build a fresh combat state: a generated board + full vitals + round 1 primed (the telegraph
 *  for a round-1 striker is rolled here — revealed at the deal, per the v3 grammar). */
export function createCombat(opts: NewCombatOpts, rng: Rng): CombatState {
  const playerMax = opts.playerMax ?? DEFAULT_PLAYER_MAX
  const board: Board = genInitial(opts.gen, rng)
  const nextStrikeRound = opts.foe.strikeEvery
  return {
    playerHP: playerMax,
    playerMax,
    enemyHP: opts.foe.hp,
    enemyMax: opts.foe.hp,
    block: 0,
    stats: { ...(opts.stats ?? BASE_STATS) },
    mana: [0, 0, 0],
    tactic: 'stand', // the defensive default — you OPT INTO Maneuver's greed at the first draw phase
    maneuverBias: null,
    charges: 0,
    queuedTactic: null,
    queuedBias: null,
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
    round: 1,
    roundEndsAt: ROUND_MS,
    roundExtendedS: 0,
    roundAttack: 0,
    nextStrikeRound,
    incoming: opts.foe.damage > 0 && nextStrikeRound === 1 ? rollStrike(opts.foe, rng) : null,
    tickAccum: {},
    running: true,
    result: null,
    gen: opts.gen,
  }
}

// ---- combatant ops (block / tactics live in ops.ts, shared with abilities/passives/tactics) ----

function applyResolution(s: CombatState, res: Resolution, rng: Rng, sink: EventSink): void {
  // ROUNDS v3: Attack BANKS toward the exchange swing — nothing lands until the rollover
  // (immune foes — e.g. the ethereal goblin — bank nothing from cards)
  if (res.damage > 0) {
    // a pending Strength buff (nextSetDamageMult) multiplies this attacking set, then is spent
    const mult = s.nextSetDamageMult
    const dmg = res.damage * mult
    if (mult !== 1) { s.nextSetDamageMult = 1; sink.emit({ type: 'buffFaded', id: 'strength', label: `Strength surges — that blow strikes ×${mult}` }) }
    if (s.foe.rules.immune_card_damage) {
      sink.emit({ type: 'enemyDamaged', amount: 0, immune: true })
    } else {
      s.roundAttack += dmg
      sink.emit({ type: 'attackBanked', amount: dmg, total: s.roundAttack })
    }
  }
  if (res.block > 0) gainBlock(s, res.block, rng, sink)
  // Charge income (CRAWL §5.6): +1 per Move CARD in the set; Combined Arms (Warlord) adds +1 on
  // any shape-rainbow set. (Excess-timer income died with the clock.)
  let charges = res.desc.shapes.filter((sh) => sh === SHAPE_MOVE).length
  if (s.passives.includes('combined_arms') && res.desc.sameShape === null) {
    charges += 1
    sink.emit({ type: 'passiveProc', id: 'combined_arms', label: '+1 ⚙' })
  }
  // mana banks per color up to the cap; gains past it are pure loss (deliberate — no excess income)
  const gained: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    gained[i] = Math.min(MANA_CAP - s.mana[i], res.mana[i])
    s.mana[i] += Math.max(0, gained[i])
  }
  sink.emit({ type: 'manaGained', mana: gained })
  if (charges > 0) addCharges(s, charges, sink)
}

/** End this combat with a win. Run-level progression (the gauntlet's next foe; B2's room chain)
 *  lives in the RUN layer (run.ts), which composes combats — not in the combat reducer. */
function onWin(s: CombatState, sink: EventSink): void {
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
  const res = resolveSet(cards, s.stats, deps.rng)
  applyResolution(s, res, deps.rng, sink)
  sink.emit({ type: 'setResolved', damage: res.damage, block: res.block, mana: res.mana, slots })
  // character-innate passives react to this match's signature (Momentum may steer the refill below)...
  firePassives(s, 'match', res.desc, deps.rng, sink)
  // ...and the FOE prices this match (traps + tricks fire on the same bus)
  if (s.running && s.enemyHP > 0) fireTriggers(s, 'match', res.desc, deps.rng, sink)
  if (!s.running) return
  if (s.enemyHP <= 0) {
    // a passive/trick (not the banked swing) finished the foe mid-round — the battle ends on the spot
    onWin(s, sink)
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
  // a frozen round timer (Invisibility) advances with `now` so it never elapses until the player acts
  if (s.attackFrozen) s.roundEndsAt += dtMs
  // a Hourglass tick-suppression window that has now elapsed fades (one-shot)
  if (s.tickSuppressedUntil > 0 && s.now >= s.tickSuppressedUntil) {
    s.tickSuppressedUntil = 0
    sink.emit({ type: 'buffFaded', id: 'hourglass', label: 'The hourglass empties — drift resumes' })
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
  // reform pending slots whose timer elapsed (grouped by bias for a single patch each).
  // WOUNDS never time-reform (one knits per draw phase; heals repair by law; all at combat end).
  if (s.pending.size) {
    const due: { slot: number; bias?: Pending['bias'] }[] = []
    for (const [slot, p] of s.pending) if (!p.wound && s.now >= p.reformAt) due.push({ slot, bias: p.bias })
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
  // THE ROLLOVER: the round elapsed — resolve the exchange (CRAWL §5.6)
  if (s.running && s.now >= s.roundEndsAt) rollover(s, deps, sink)
}

/** The rollover exchange — the v3 grammar's heartbeat, resolved atomically (the UI choreographs
 *  the emitted events as the ≤2.5s diegetic beat). Fixed order: ① player swing (LETHAL CANCELS —
 *  the kill-race; symmetric: banked lethal beats incoming death) → ② enemy swing minus Block,
 *  damage suffered computes wounds → ③ leftover Block trickles to charges (1:2) → ④ Maneuver dump
 *  → ⑤ the deal: one wound knits, the queued stance locks → ⑥ the new round + its telegraph. */
function rollover(s: CombatState, deps: Deps, sink: EventSink): void {
  const finished = s.round
  sink.emit({ type: 'roundEnded', round: finished })
  // ① player swing — banked Attack lands; lethal cancels the enemy's swing entirely
  if (s.roundAttack > 0) {
    const dmg = s.roundAttack
    s.roundAttack = 0
    s.enemyHP = Math.max(0, s.enemyHP - dmg)
    sink.emit({ type: 'enemyDamaged', amount: dmg })
    if (s.enemyHP <= 0) {
      onWin(s, sink)
      return
    }
  }
  // ② enemy swing — exactly the telegraphed total; the bite past Block computes wounds
  if (s.incoming != null) {
    const raw = s.incoming
    s.incoming = null
    s.nextStrikeRound = finished + s.foe.strikeEvery
    if (raw > 0) {
      const bite = Math.max(0, raw - s.block)
      hurtPlayer(s, raw, s.foe.name, sink)
      if (!s.running) return // the symmetric kill-race already gave the player their swing in ①
      if (bite > 0) inflictWounds(s, bite, deps.rng, sink)
    } else {
      sink.emit({ type: 'playerBlocked' })
    }
  }
  // ③ leftover Block past the telegraph trickles to charges (1 per 2), then the guard drops
  if (s.block > 0) {
    const trickle = Math.floor(s.block / 2)
    s.block = 0
    if (trickle > 0) addCharges(s, trickle, sink, 'overflow')
  }
  // ④ the Maneuver dump — all charges burn into the tide (Stand Ground banks carry instead)
  rolloverDump(s, deps.rng, sink)
  // ⑤ the deal — one wound knits shut; the queued stance locks as the cards settle
  let knit: number | null = null
  for (const [slot, p] of s.pending) if (p.wound) { knit = knit == null || slot < knit ? slot : knit }
  if (knit != null) {
    reformSlots(s, [knit], undefined, deps.rng)
    sink.emit({ type: 'cardsReformed', slots: [knit] })
  }
  lockQueuedStance(s, sink)
  // ⑥ the new round — fresh accumulators, the next telegraph revealed with the deal
  s.round = finished + 1
  s.roundEndsAt = s.now + ROUND_MS
  s.roundExtendedS = 0
  s.roundAttack = 0
  if (s.foe.damage > 0 && s.round >= s.nextStrikeRound) {
    s.incoming = rollStrike(s.foe, deps.rng)
    sink.emit({ type: 'windup', amount: s.incoming, strikesAt: s.roundEndsAt })
  }
  sink.emit({ type: 'roundStarted', round: s.round, incoming: s.incoming })
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
      if (castAbility(s, action.abilityId, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, sink)
      break
    case 'setTactic':
      setTactic(s, action.tactic, sink)
      break
    case 'setBias':
      setBias(s, action.bias, sink)
      break
    case 'useConsumable':
      if (useConsumable(s, action.slot, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, sink)
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
    stats: { ...s.stats },
    mana: [s.mana[0], s.mana[1], s.mana[2]],
    board: s.board.map((c) => (c ? ([c[0], c[1], c[2], c[3]] as Card) : null)),
    pending: new Map([...s.pending].map(([k, v]) => [k, { ...v }])),
    locked: new Map(s.locked),
    pendingRegenBias: s.pendingRegenBias ? { ...s.pendingRegenBias } : null,
    maneuverBias: s.maneuverBias ? { ...s.maneuverBias } : null,
    queuedBias: s.queuedBias ? { bias: s.queuedBias.bias ? { ...s.queuedBias.bias } : null } : null,
    passives: s.passives.slice(),
    consumables: s.consumables.slice(),
    tickAccum: { ...s.tickAccum },
    foe: s.foe, // immutable per encounter
    gen: s.gen,
  }
}
