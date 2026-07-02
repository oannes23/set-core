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
import { type CombatState, type FoeRuntime, type Pending, type TacticKind, type ManeuverBias, type StatBlock, MANA_CAP, DEFAULT_PLAYER_MAX, BASE_STATS, ROUND_MS, DODGE_BASE, DODGE_K, DODGE_MIN, DODGE_MAX, DODGE_PER_CHARGE, dodgeCapForFoe, MANEUVER_BURN_MS, BASE_CRIT_MULT, CRIT_SOFT_CAP, CRIT_A, CRIT_M, COMBO_W, CRIT_GRACE_MS, COMBO_STYLE_STEP, COMBO_TEMPO_STEP, COMBO_OVERTIME_MIN_LEVEL, COMBO_OVERTIME_CAP_MS, PRIMED_WINDOW_MS, dreadFoeMult, dreadPlayerMult, dreadBleed, driftRateMult } from './state'
import { type CombatEvent, EventSink } from './events'
import { type Resolution, type MatchDescriptor, resolveSet, weightedRoll, telegraphPerSwing, dodgeChance } from './resolve'
import { NO_RIDERS, NO_MODS, type Riders, type GearMods, type AffixProc, type ProcEvent } from './items'
import { foeLevelEquiv, gearFactor } from './foe'
import { fireTriggers, runTrigger, inflictWounds, hurtPlayer, reformSlots, condMet, EMPTY_DESC } from './triggers'
import { gainBlock, addCharges, grantMana, healPlayer, dealAbilityDamage, extendRound } from './ops'
import { firePassives } from './passives'
import { castAbility } from './abilities'
import { setTactic, setBias, liveBurn } from './tactics'
import { useConsumable } from './consumables'

export type CombatAction =
  | { type: 'completeSet'; slots: [number, number, number] }
  | { type: 'tick'; dtMs: number }
  | { type: 'castAbility'; abilityId: string }
  | { type: 'setTactic'; tactic: TacticKind } // QUEUE a stance for next round (locks at the draw phase)
  | { type: 'setBias'; bias: ManeuverBias | null } // QUEUE Maneuver's dial (part of the locked stance)
  | { type: 'useConsumable'; slot: number } // spend a carried potion/scroll
  | { type: 'flee' } // forfeit the encounter — available any time (not gated by Tactics)
  | { type: 'setSelection'; slots: number[] } // E7: the live UI selection, so hard-rule-6 shielding is in the log → replay-deterministic

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
  stats?: StatBlock // Resolution v2: Power/Endurance/Speed (default BASE_STATS = old-system parity); incl. gear bonus
  riders?: Riders // §7 gear riders (flat per-card; default none = no gear equipped)
  mods?: GearMods // §7 gear-exclusive scalars (dodge/penetration/soak/lifesteal; default none)
  procs?: AffixProc[] // §7 gear affix on-match procs (fired like passives)
  passives?: string[] // the chosen class's always-on passive ids
  consumables?: string[] // carried potions/scrolls for this run
  dreadFloor?: number // §5.8 dread depth floor (from the delve band; default 1 = not in a delve)
  coach?: boolean // a teaching/coach fight → dread escalation stays OFF (the dummy is pressure-free)
}

/** Roll a foe's RAW telegraph at the reveal: the per-swing damages (no dodge — dodge is rolled at the
 *  STRIKE now, from the banked pool, so windup Move investment can pay off; BALANCE §2.3). Returns the
 *  per-swing array + its sum (the honest ⚔ shown to the player). */
function rollTelegraph(foe: FoeRuntime, rng: Rng): { total: number; swings: number[] } {
  if (foe.damage <= 0) return { total: 0, swings: [] }
  const swings: number[] = []
  for (let i = 0; i < foe.swings; i++) swings.push(weightedRoll(foe.damage, rng))
  return { total: swings.reduce((a, b) => a + b, 0), swings }
}

/** The flee PARTING BLOW (§5.7 / the exit ladder): turning to run gives the foe ONE swing on your way
 *  out. Your Dodge (the same Speed contest + Evasive gear as the deal) can evade it WHOLE; banked Block
 *  + Soak mitigate it like any strike, and damage suffered scars (wounds). A harmless foe (no damage,
 *  e.g. the training dummy) gives a clean getaway. If the blow is lethal, `hurtPlayer` ends the run with
 *  `lost` (a death while fleeing) — the caller checks `s.running` before declaring the flee. Returns the
 *  HP damage dealt (0 = dodged or fully blocked). */
function partingBlow(s: CombatState, rng: Rng, sink: EventSink): number {
  if (s.foe.damage <= 0) return 0
  const pDodge = Math.min(DODGE_MAX, dodgeChance(s.stats.speed, s.foe.stats.speed, DODGE_BASE, DODGE_K, DODGE_MIN, DODGE_MAX) + s.mods.dodge)
  if (rng() < pDodge) { sink.emit({ type: 'strikeDodged' }); return 0 } // read the blow, slip aside — clean escape
  const raw = weightedRoll(s.foe.damage, rng)
  const hit = Math.max(0, raw - s.mods.soak) // §7 Soak (Ironhide): flat pre-Block mitigation
  const bite = Math.max(0, hit - s.block) // HP damage after the standing guard → wounds
  hurtPlayer(s, hit, s.foe.name, sink) // applies Block, emits playerDamaged; emits `lost` if lethal
  if (s.running && bite > 0) inflictWounds(s, bite, rng, sink)
  s.block = 0
  return hit
}

/** Build a fresh combat state: a generated board + full vitals + round 1 primed (the telegraph
 *  for a round-1 striker is rolled here — revealed at the deal, per the v3 grammar). */
export function createCombat(opts: NewCombatOpts, rng: Rng): CombatState {
  const playerMax = opts.playerMax ?? DEFAULT_PLAYER_MAX
  const board: Board = genInitial(opts.gen, rng)
  const stats = { ...(opts.stats ?? BASE_STATS) }
  // FINALIZE the telegraph: the foe's per-swing budget is the contest (its Power vs THIS player's
  // Endurance) × tier, packaged by the tempo law — level-invariant at parity (resolve.ts). The
  // assembled foe carried a parity seed; this binds it to the actual hero (stable for the fight).
  // §7/§11 FOE-DIFFICULTY RAISE: HP + telegraph × gearFactor(foe level-equiv) — foes balanced against
  // the rarity-current GEARED baseline (×1.0 ≤L6, ~×1.6 orange). XP/gold use the BARE statline (foeValue).
  const gf = gearFactor(foeLevelEquiv(opts.foe))
  // TELEGRAPH DECOUPLE (BALANCE.md §2.2): the budget anchors to the foe's LEVEL-PARITY Endurance, NOT the
  // player's chosen E. This keeps it level-invariant (parity foe vs parity player → 25×tier, A4) while
  // removing the passive freebie for stacking E — your Endurance now only scales BLOCK (Defend sets), not
  // the incoming. Zero Defend = full damage. (parityE = the 10 + 2·(L−1) parity line at the foe's level.)
  const parityE = 10 + 2 * (foeLevelEquiv(opts.foe) - 1)
  const foe: FoeRuntime = { ...opts.foe, hp: Math.round(opts.foe.hp * gf), damage: telegraphPerSwing(opts.foe, parityE) * gf }
  const nextStrikeRound = foe.strikeEvery
  // EARLY REVEAL (§5.7): the telegraph shows from round 1 — strikeEvery−1 rounds before it lands. The
  // shown amount is the RAW per-swing roll; dodge resolves at the strike from the banked pool (§2.3).
  const first = rollTelegraph(foe, rng)
  return {
    playerHP: playerMax,
    playerMax,
    enemyHP: foe.hp,
    enemyMax: foe.hp,
    block: 0,
    stats,
    riders: opts.riders ?? NO_RIDERS,
    mods: opts.mods ?? NO_MODS,
    procs: opts.procs ? opts.procs.slice() : [],
    combo: { level: 0, highest: 0, combos: 0, fightPeak: 0, lastAt: -Infinity, lastColor: null, lastShape: null },
    primed: {},
    roundLog: { atkBase: 0, atkRider: 0, blkBase: 0, blkRider: 0, attacks: 0, defends: 0, primed: 0 },
    mana: [0, 0, 0],
    tactic: 'stand', // the defensive default — you OPT INTO Maneuver's greed live (§5.7)
    maneuverBias: null,
    charges: 0,
    maneuverGatherUntil: 0,
    burnAccum: 0,
    dodgePool: 0, // §2.3 — banked dodge, fed by Move sets
    board,
    cols: colsForN(opts.gen.n),
    pending: new Map(),
    locked: new Map(),
    selected: [],
    pendingRegenBias: null,
    passives: opts.passives ? opts.passives.slice() : [],
    consumables: opts.consumables ? opts.consumables.slice() : [],
    attackFrozen: false,
    nextSetDamageMult: 1,
    tickSuppressedUntil: 0,
    foe,
    now: 0,
    round: 1,
    roundEndsAt: ROUND_MS,
    roundOvertime: false,
    roundExtendedS: 0,
    roundAttack: 0,
    nextStrikeRound,
    incoming: foe.damage > 0 ? first.total : null, // revealed from round 1 (held until the strike round)
    incomingSwings: first.swings, // raw per-swing — banked dodge negates individual swings at the strike
    incomingDodged: 0,
    dreadFloor: opts.dreadFloor ?? 1, // §5.8 — depth floor from the delve band (1 = not in a delve)
    dreadOn: !opts.coach, // teaching/coach fights stay pressure-free (no dread escalation)
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
      // exchange-cutscene breakdown: split this set's damage into the base contest vs the gear rider (× the Strength buff)
      s.roundLog.atkBase += (res.damage - res.riderDmg) * mult
      s.roundLog.atkRider += res.riderDmg * mult
      s.roundLog.attacks++
      sink.emit({ type: 'attackBanked', amount: dmg, total: s.roundAttack })
    }
  }
  if (res.block > 0) {
    s.roundLog.blkBase += res.block - res.riderBlock
    s.roundLog.blkRider += res.riderBlock
    s.roundLog.defends++
    gainBlock(s, res.block, rng, sink)
  }
  // Charge income (CRAWL §5.6, contested): the Move lane's rate × quality, in charge POINTS
  // (the Speed contest — a fast foe suppresses your board game). Combined Arms (Warlord) adds
  // +1 on any shape-rainbow set.
  let charges = res.charges
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
  if (charges > 0) {
    addCharges(s, charges, sink)
    // §2.3 — a Move set ALSO banks Dodge: each charge-point of income adds to the pool, capped by the foe's
    // tempo cadence. Move now has a terminal defensive payoff (slip the haymaker), not just Tactics fuel.
    const cap = dodgeCapForFoe(s.foe.strikeEvery, s.foe.swings)
    const before = s.dodgePool
    s.dodgePool = Math.min(cap, s.dodgePool + charges * DODGE_PER_CHARGE)
    if (s.dodgePool > before) sink.emit({ type: 'dodgeGained', pool: s.dodgePool, cap })
  }
}

const LOW_HP_FRAC = 0.3 // §7 reactive: an on-lowHP proc (Cornered) fires while HP is below this fraction

/** §7/§13 update the combo streak on a match. TEMPO (≤ CRIT_GRACE_MS since the last match) keeps it
 *  alive; IDENTITY (this match shares the LAST match's colour or shape) escalates it faster (STYLE_STEP
 *  vs the slower TEMPO_STEP). Tracks the round's highest + combos (the crit-score metrics). */
function updateCombo(s: CombatState, desc: MatchDescriptor, sink: EventSink): void {
  const inGrace = s.now - s.combo.lastAt <= CRIT_GRACE_MS
  const styled = (desc.sameColor != null && desc.sameColor === s.combo.lastColor) || (desc.sameShape != null && desc.sameShape === s.combo.lastShape)
  if (inGrace) {
    s.combo.level += styled ? COMBO_STYLE_STEP : COMBO_TEMPO_STEP
    s.combo.combos += 1
  } else {
    s.combo.level = 1 // a fresh streak (the grace lapsed)
  }
  s.combo.highest = Math.max(s.combo.highest, s.combo.level)
  s.combo.fightPeak = Math.max(s.combo.fightPeak, s.combo.level) // §13 the whole-fight best chain (gating hook)
  s.combo.lastAt = s.now
  s.combo.lastColor = desc.sameColor
  s.combo.lastShape = desc.sameShape
  sink.emit({ type: 'combo', level: s.combo.level, styled, color: desc.sameColor ?? -1, shape: desc.sameShape ?? -1 })
}
/** §13 the crit SCORE this round: highestChain (unnormalized — the skill-shine) + COMBO_W·combos
 *  (NORMALIZED by round-extension so stall-stretch can't farm it) + Keen's gear score. */
function critScore(s: CombatState): number {
  const normCombos = s.combo.combos * (ROUND_MS / (ROUND_MS + s.roundExtendedS * 1000))
  return s.combo.highest + COMBO_W * normCombos + s.mods.critChance
}
/** §13 the soft-capped crit S-curve (play + gear both feed `critScore`, so the cap bounds everything). */
export function playerCritChance(s: CombatState): number {
  return CRIT_SOFT_CAP / (1 + Math.exp(-CRIT_A * (critScore(s) - CRIT_M)))
}
export function playerCritMult(s: CombatState): number {
  return BASE_CRIT_MULT + s.mods.critMult
}
/** The live DODGE readout for the HUD (§2.3): the Speed-differential FLOOR, the banked pool, the foe's
 *  cadence CAP, and the effective per-swing chance = min(cap, floor + pool). */
export function dodgeReadout(s: CombatState): { chance: number; floor: number; cap: number; pool: number } {
  const floor = Math.min(DODGE_MAX, dodgeChance(s.stats.speed, s.foe.stats.speed, DODGE_BASE, DODGE_K, DODGE_MIN, DODGE_MAX) + s.mods.dodge)
  const cap = dodgeCapForFoe(s.foe.strikeEvery, s.foe.swings)
  return { floor, cap, pool: s.dodgePool, chance: Math.min(cap, floor + s.dodgePool) }
}

/** The AFFIX-PROC ENGINE (CRAWL §7): gear affix procs fire like class passives. ON-MATCH procs gate on
 *  the match descriptor (condMet); REACTIVE procs (wound/kill/lowHP) fire on a player-side event (no
 *  descriptor). A player-favourable effect lands via ops. Magnitudes are first-cut (TUNING — §13 gate). */
function fireProcs(s: CombatState, event: ProcEvent, desc: MatchDescriptor | null, rng: Rng, sink: EventSink): void {
  for (const p of s.procs) {
    if ((p.event ?? 'match') !== event) continue
    if (event === 'match' && desc && !condMet(p.when, desc)) continue
    const e = p.effect
    const before = sink.events.length // tag whatever this proc emits with its affix label (UI attribution)
    if (e.kind === 'damage') dealAbilityDamage(s, e.amount, sink)
    else if (e.kind === 'mana') grantMana(s, e.color ?? (desc?.sameColor ?? 0), e.amount, sink)
    else if (e.kind === 'block') gainBlock(s, e.amount, rng, sink)
    else if (e.kind === 'heal') healPlayer(s, e.amount, rng, sink)
    else if (e.kind === 'charges') addCharges(s, e.amount, sink)
    else if (e.kind === 'delay') extendRound(s, e.seconds, sink)
    const label = p.label ?? '✦'
    for (let i = before; i < sink.events.length; i++) (sink.events[i] as { procSource?: string }).procSource = label
    sink.emit({ type: 'passiveProc', id: 'affix', label })
    if (!s.running) return
  }
}

/** End this combat with a win. Run-level progression (the gauntlet's next foe; B2's room chain)
 *  lives in the RUN layer (run.ts), which composes combats — not in the combat reducer. */
function onWin(s: CombatState, rng: Rng, sink: EventSink): void {
  fireProcs(s, 'kill', null, rng, sink) // §7 on-kill procs (Carnage) — the heal carries to the next room
  s.running = false
  s.result = 'win'
  sink.emit({ type: 'won' })
}

function completeSet(s: CombatState, slots: [number, number, number], deps: Deps, sink: EventSink): void {
  if (!s.running) return // a settled fight accepts no more sets (replayed/stray actions are no-ops)
  const [a, b, c] = slots
  if (a === b || b === c || a === c) return // §E4 (FABLE §3): reject non-distinct slots — isSet(c,c,c) is ALWAYS true (3aᵢ ≡ 0 mod 3), so [i,i,i] would bank a full set's value off ONE card. The UI can't emit it, but the reducer is the server-authority / replay anti-cheat seam.
  const ca = s.board[a]
  const cb = s.board[b]
  const cc = s.board[c]
  if (!ca || !cb || !cc) return
  if (s.locked.has(a) || s.locked.has(b) || s.locked.has(c)) return
  if (!isSet(ca, cb, cc)) return // invalid pick — no-op (the UI handles misread feedback)
  if (s.attackFrozen) { s.attackFrozen = false; sink.emit({ type: 'buffFaded', id: 'invisibility', label: 'Invisibility fades — the enemy sees you again' }) }
  const cards: [Card, Card, Card] = [ca, cb, cc]
  // §7 Primed: which of the three were Maneuver-churned within the window → +1 quality tier in resolveSet
  const primedFlags: [boolean, boolean, boolean] = [a, b, c].map((i) => s.primed[i] != null && s.now - s.primed[i] <= PRIMED_WINDOW_MS) as [boolean, boolean, boolean]
  for (const i of slots) delete s.primed[i] // consumed (or refilled fresh) — clear the marks
  const res = resolveSet(cards, s.stats, s.foe.stats, deps.rng, s.riders, s.mods.penetration, primedFlags)
  if (primedFlags.some(Boolean)) { s.roundLog.primed++; sink.emit({ type: 'passiveProc', id: 'primed', label: '✦ primed' }) }
  applyResolution(s, res, deps.rng, sink)
  sink.emit({ type: 'setResolved', damage: res.damage, block: res.block, mana: res.mana, riderMana: res.riderMana, slots })
  updateCombo(s, res.desc, sink) // §7/§13 combo streak (tempo + identity) — feeds the crit score at the exchange
  // character-innate passives react to this match's signature (Momentum may steer the refill below)...
  firePassives(s, 'match', res.desc, deps.rng, sink)
  // ...and the gear AFFIX procs fire on the same match (the affix-proc engine — player-favourable)
  if (s.running) fireProcs(s, 'match', res.desc, deps.rng, sink)
  // ...and the FOE prices this match (traps + tricks fire on the same bus)
  if (s.running && s.enemyHP > 0) fireTriggers(s, 'match', res.desc, deps.rng, sink)
  if (!s.running) return
  if (s.enemyHP <= 0) {
    // a passive/trick (not the banked swing) finished the foe mid-round — the battle ends on the spot
    onWin(s, deps.rng, sink)
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
    // §5.8 soft lane: dread ACCELERATES the dungeon drift (shorter period as the meter climbs); authored
    // tick-traps keep their own cadence. Bounded by the curve so max drift stays under the TRAPS §6 ceiling.
    const period = (trig.every || 5) / (key === 'drift' ? driftRateMult(s) : 1)
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
  // MANEUVER LIVE-BURN (§5.7): after the gather, spend ~1 charge/sec churning the deadest
  // not-already-matching card toward the bias — the tide rolling in live (replaces the rollover dump).
  // Stand Ground never burns (it wards live instead). No target left → idle (hold the charges).
  if (s.running && s.tactic === 'maneuver' && s.maneuverBias && s.charges > 0 && s.now >= s.maneuverGatherUntil) {
    s.burnAccum += dtMs
    let guard = 0
    while (s.burnAccum >= MANEUVER_BURN_MS && guard++ < 8) {
      if (!liveBurn(s, deps.rng, sink)) { s.burnAccum = 0; break }
      s.burnAccum -= MANEUVER_BURN_MS
    }
  }
  // THE ROLLOVER: the round elapsed — resolve the exchange (CRAWL §5.6), UNLESS a live chain holds it open
  // (§13 COMBO OVERTIME). A chain at level ≥ MIN whose last match is still inside the grace window defers the
  // exchange; sets keep stacking (each refreshes lastAt → pushes the deadline out). The instant the chain
  // lapses (no set within grace) the guard fails and the rollover fires this same frame. CAP_MS caps it.
  if (s.running && s.now >= s.roundEndsAt) {
    const chainLive = s.combo.level >= COMBO_OVERTIME_MIN_LEVEL && s.now - s.combo.lastAt < CRIT_GRACE_MS
    const capped = COMBO_OVERTIME_CAP_MS > 0 && s.now - s.roundEndsAt >= COMBO_OVERTIME_CAP_MS
    if (chainLive && !capped) {
      if (!s.roundOvertime) { s.roundOvertime = true; sink.emit({ type: 'roundOvertime', level: s.combo.level }) }
    } else {
      rollover(s, deps, sink)
    }
  }
}

/** The rollover exchange — the v3 grammar's heartbeat, resolved atomically (the UI choreographs
 *  the emitted events as the staged diegetic exchange beat (EXCHANGE_BEATS, app.ts)). Fixed order:
 *  ① player swing (LETHAL CANCELS — the kill-race; symmetric) → ② enemy swing IF this is the strike
 *  round (else the telegraph is still winding up — no strike); bite past Block computes wounds, the
 *  guard then resets EVERY rollover (NO carry — BALANCE.md §2.1) → ⑤ the deal: one wound knits → ⑥ the new
 *  round + the next telegraph revealed at its WINDUP START (strikeEvery−1 rounds early). Stances are
 *  LIVE now (§5.7): no queue to lock, Maneuver burns in tick (no rollover dump). */
function rollover(s: CombatState, deps: Deps, sink: EventSink): void {
  const finished = s.round
  sink.emit({ type: 'roundEnded', round: finished })
  // ① player swing — banked Attack lands; lethal cancels the enemy's swing entirely
  if (s.roundAttack > 0) {
    const dmult = dreadPlayerMult(s) // §5.8 the player-side ramp (the swing-moment)
    const swing = Math.round(s.roundAttack * dmult)
    s.roundAttack = 0
    // §7 CRIT — the exchange-delight roll on the AGGREGATE swing (player-only; the set stayed exact). Chance
    // = base + gear(Keen) + the chain ramp, capped; mult = base + gear(Vorpal). A rare upward surprise.
    const crit = deps.rng() < playerCritChance(s)
    const dmg = crit ? Math.round(swing * playerCritMult(s)) : swing
    // the exchange-cutscene breakdown: narrate the swing math (matches + weapon + crit) at the rollover
    sink.emit({ type: 'swingMath', matches: Math.round(s.roundLog.atkBase * dmult), weapon: Math.round(s.roundLog.atkRider * dmult), attacks: s.roundLog.attacks, crit, mult: crit ? playerCritMult(s) : 1, total: dmg })
    s.enemyHP = Math.max(0, s.enemyHP - dmg)
    sink.emit({ type: 'enemyDamaged', amount: dmg, crit })
    // §7 Lifesteal (Sanguine): heal a fraction of the (possibly crit) damage dealt (deterministic).
    // It's a gear MOD (not a fireProcs proc), so tag its heal with a source label for the same UI attribution.
    if (s.mods.lifesteal > 0 && dmg > 0) {
      const before = sink.events.length
      healPlayer(s, Math.floor(dmg * s.mods.lifesteal), deps.rng, sink)
      const label = `🩸${Math.round(s.mods.lifesteal * 100)}%`
      for (let i = before; i < sink.events.length; i++) (sink.events[i] as { procSource?: string }).procSource = label
    }
    if (s.enemyHP <= 0) {
      onWin(s, deps.rng, sink)
      return
    }
  }
  // ② enemy swing — ONLY on the actual strike round. During the windup (telegraph revealed early but
  // not yet due) there is NO strike. BANKED DODGE rolls HERE (§2.3): each swing vs min(cadenceCap, floor +
  // pool); a dodge negates that swing and resets the pool — so windup Move investment pays off at the strike.
  const strikeLands = s.incoming != null && finished >= s.nextStrikeRound
  if (strikeLands) {
    const floor = Math.min(DODGE_MAX, dodgeChance(s.stats.speed, s.foe.stats.speed, DODGE_BASE, DODGE_K, DODGE_MIN, DODGE_MAX) + s.mods.dodge)
    const cap = dodgeCapForFoe(s.foe.strikeEvery, s.foe.swings)
    let eff = Math.min(cap, floor + s.dodgePool)
    let survived = 0, dodged = 0
    for (const sw of s.incomingSwings) {
      if (deps.rng() < eff) { dodged++; s.dodgePool = 0; eff = Math.min(cap, floor) } // dodged — pool spent, falls back to the floor
      else survived += sw
    }
    const raw0 = survived // the post-dodge telegraph that actually reached you (the honest landed amount)
    const raw = raw0 > 0 ? Math.max(0, raw0 - s.mods.soak) : 0 // §7 Soak (Ironhide): flat, permanent (pre-Block) mitigation
    const dodgedAll = survived === 0 && dodged > 0 // every swing slipped
    const bite = Math.max(0, raw - s.block)
    // the exchange-cutscene block→net beat: narrate dodge → defense math (defends → block → soak → net)
    sink.emit({ type: 'blockMath', block: s.block, blkRider: Math.round(s.roundLog.blkRider), defends: s.roundLog.defends, telegraph: raw0, soaked: raw0 - raw, bite, dodgedAll, dodged })
    s.incoming = null
    s.incomingSwings = []
    s.incomingDodged = dodged
    s.nextStrikeRound = finished + s.foe.strikeEvery
    if (raw > 0) {
      hurtPlayer(s, raw, s.foe.name, sink)
      if (!s.running) return // the symmetric kill-race already gave the player their swing in ①
      if (bite > 0) { inflictWounds(s, bite, deps.rng, sink); fireProcs(s, 'wound', null, deps.rng, sink) } // §7 on-wound (Barbed/Guardian's)
    } else if (dodgedAll) {
      sink.emit({ type: 'strikeDodged' }) // the full whiff — the DODGED! smash card
    } else {
      sink.emit({ type: 'playerBlocked' })
    }
  }
  // §E1 (FABLE §3) — the ZOMBIE-FOE guard: rollover proc damage (Barbed thorns on-wound, §7) can drop the
  // foe to 0 HP with NO win check — every other damage path checks, this one fell through, so a dead foe
  // would roll a fresh telegraph and still kill you at the next exchange (a loss to an empty HP bar). Claim
  // the win the instant its HP hits 0 — BEFORE the dread bleed / next telegraph run below.
  if (s.running && s.enemyHP <= 0) { onWin(s, deps.rng, sink); return }
  // BLOCK NO-CARRY (BALANCE.md §2.1): the guard resets EVERY rollover — Defend mitigates only the round the
  // hit lands; it never banks across windup rounds. (Was: carried through windups. The complement is the
  // banked Dodge pool, which DOES persist — Block is the in-the-moment lever, Dodge the planned one.)
  s.block = 0
  // §5.8 — the generic UNGUARDABLE dread bleed: a per-round drain past the onset (bypasses Block; the
  // foe-INDEPENDENT anti-stall lane the sim proved necessary). Only reached if the player survived ①②.
  const bleed = Math.round(dreadBleed(s))
  if (bleed > 0 && s.running) {
    s.playerHP = Math.max(0, s.playerHP - bleed)
    sink.emit({ type: 'playerDamaged', amount: bleed, absorbed: 0, source: 'the dread' })
    if (s.playerHP <= 0) { s.running = false; s.result = 'lose'; sink.emit({ type: 'lost' }); return }
  }
  // §7 on-lowHP procs (Cornered): a defensive surge while cornered (fires each rollover below the floor)
  if (s.running && s.playerHP < LOW_HP_FRAC * s.playerMax) fireProcs(s, 'lowHP', null, deps.rng, sink)
  // §E1 (FABLE §3) — mirror the zombie-foe guard for the lowHP proc family: Cornered is block-only today,
  // but the affix DSL allows a damage-dealing lowHP proc, which would otherwise re-zombie the foe here.
  if (s.running && s.enemyHP <= 0) { onWin(s, deps.rng, sink); return }
  // ⑤ the deal — one wound knits shut as the cards settle (stances are live; nothing to lock)
  let knit: number | null = null
  for (const [slot, p] of s.pending) if (p.wound) { knit = knit == null || slot < knit ? slot : knit }
  if (knit != null) {
    reformSlots(s, [knit], undefined, deps.rng)
    sink.emit({ type: 'cardsReformed', slots: [knit] })
  }
  // ⑥ the new round — fresh accumulators; reveal the NEXT telegraph at its windup start (early for
  // slow foes), rolling dodge at the deal. Nothing revealed yet → roll once we enter the window.
  s.round = finished + 1
  s.roundEndsAt = s.now + ROUND_MS
  s.roundOvertime = false // §13 a fresh round — the chain may carry via grace, but the hold is released
  s.roundExtendedS = 0
  s.roundAttack = 0
  // round-summary for the cutscene: the offense quality this round (primed sets + combo peak) — read
  // BEFORE the reset wipes the metrics; the UI celebrates it alongside the swing breakdown
  sink.emit({ type: 'roundSummary', primed: s.roundLog.primed, comboPeak: Math.floor(s.combo.highest), combos: s.combo.combos })
  s.combo.highest = 0 // §13 the crit score is per-round — reset the metrics (the live streak/level carries via grace)
  s.roundLog = { atkBase: 0, atkRider: 0, blkBase: 0, blkRider: 0, attacks: 0, defends: 0, primed: 0 } // fresh round breakdown
  s.combo.combos = 0
  if (s.foe.damage > 0 && s.incoming == null && s.round >= s.nextStrikeRound - (s.foe.strikeEvery - 1)) {
    const tel = rollTelegraph(s.foe, deps.rng)
    const fm = dreadFoeMult(s) // §5.8: fold dread-at-reveal into each swing (keeps the shown ⚔ honest)
    s.incomingSwings = tel.swings.map((v) => Math.round(v * fm))
    s.incoming = s.incomingSwings.reduce((a, b) => a + b, 0)
    s.incomingDodged = 0 // dodge resolves at the strike now (§2.3), not at reveal
    sink.emit({ type: 'windup', amount: s.incoming, strikesAt: s.roundEndsAt, dodged: 0, swings: s.foe.swings })
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
      if (castAbility(s, action.abilityId, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, deps.rng, sink)
      break
    case 'setTactic':
      setTactic(s, action.tactic, sink)
      break
    case 'setBias':
      setBias(s, action.bias, sink)
      break
    case 'setSelection':
      s.selected = action.slots.slice() // E7: the reducer owns selection now, so {seed,actions} replays rule-6 shielding
      break
    case 'useConsumable':
      if (useConsumable(s, action.slot, deps.rng, sink) && s.running && s.enemyHP <= 0) onWin(s, deps.rng, sink)
      break
    case 'flee':
      if (s.running) {
        partingBlow(s, deps.rng, sink) // §5.7: the foe lands one (dodge-able) swing on your way out
        if (s.running) { s.running = false; s.result = 'flee'; sink.emit({ type: 'fled' }) } // survived → a clean flee
      }
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
    selected: (s.selected ?? []).slice(),
    pendingRegenBias: s.pendingRegenBias ? { ...s.pendingRegenBias } : null,
    maneuverBias: s.maneuverBias ? { ...s.maneuverBias } : null,
    passives: s.passives.slice(),
    consumables: s.consumables.slice(),
    tickAccum: { ...s.tickAccum },
    combo: { ...s.combo },
    primed: { ...s.primed },
    roundLog: { ...s.roundLog },
    foe: s.foe, // immutable per encounter
    gen: s.gen,
  }
}
