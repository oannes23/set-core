/* engine/state — the combat state the engine reduces over. Pure data: no DOM, no timers. Time is
   explicit (`now`, advanced by tick actions) so the whole thing is deterministic + replayable.

   ROUNDS v3 (CRAWL §5.6): combat runs in 20-second ROUNDS. Verbs ACCUMULATE during the round
   (Attack → roundAttack, Defend → block, Move → charges) and cash out at the rollover exchange:
   player swing first (lethal cancels — the kill-race), enemy swing minus block, Maneuver dump,
   the deal, next telegraph. Spells/mana, traps/tricks, drift, and Stand Ground wards stay LIVE
   mid-round. The round is THE pacing constant — time numbers denominate in rounds, not seconds. */

import type { Board } from '../core/sets'
import type { GenConfig, FavorBias } from '../core/generate'
import type { Trigger, FoeRules, Tier } from '../data/schema'
import type { Riders, GearMods, AffixProc } from './items'

/** A board slot emptied by a transmute/shatter, reforming at `reformAt` (optionally biased).
 *  `wound: true` = a Wound (exchange damage scar): it never time-reforms — one knits per draw
 *  phase, heals repair them by law (ops.healPlayer), all reform at combat end. */
export interface Pending {
  reformAt: number
  bias?: FavorBias
  wound?: boolean
}

/** Resolution v3 ("sets steer, stats carry, stats CONTEST") — BOTH combatants carry this block.
 *  Every per-card value is an opposed-stat rate (resolve.ts): your Power vs their Endurance is
 *  your damage, their Power vs your Endurance is the telegraph, Speed vs Speed is the charge
 *  economy (Speed's settled job — agency, not tempo). Baseline 10/10/10 (the decimal rebase);
 *  gear/levels/tiers move the differences. */
export interface StatBlock {
  power: number
  endurance: number
  speed: number
}

/** Tactics (v3): the selected stance (the VERB charges are spent on; CRAWL §5.6). */
export type TacticKind = 'maneuver' | 'stand'
/** Maneuver's parameter: at the rollover dump, redraw the deadest non-conforming cards toward this.
 *  v3 cut: magnitude bias is GONE from the player wheel (heavy boards = gear/Hone only). The axis
 *  stays in the type for enemy/gear effects; the UI wheel exposes only color + shape. */
export interface ManeuverBias {
  axis: 'color' | 'shape' | 'mag'
  value: number // 0..2 on that axis
}

/** A fielded foe, resolved from data (creature ⊕ variant ⊕ template) into runtime numbers.
 *  v3: foes carry a full P/E/S StatBlock (the contest's other side), and their attack behavior
 *  DERIVES from it via the TEMPO LAW (foe.ts): Speed−Power difference picks the packaging —
 *  swarm chips / clean hits / every-other-round giants — while the per-round damage budget stays
 *  Power-determined (damage conservation). `damage` = the per-SWING roll budget, post-packaging. */
export interface FoeRuntime {
  id: string
  name: string
  tier: Tier | null
  hp: number // max HP for this encounter (the kill-budget lever — authored, not a contest stat)
  damage: number // per-SWING roll budget; FINALIZED in createCombat = telegraph contest (foe Power
  // vs THIS player's Endurance) × tier, packaged by strikeEvery/swings. assembleFoe seeds it at parity.
  stats: StatBlock // the foe's side of every contest (AUTHORED P/E/S — the data rebase, 2026-06-12)
  strikeEvery: number // rounds between exchanges (1 = strikes every round, 2 = every other…)
  swings: number // hits per exchange (telegraph shows the sum)
  triggers: Trigger[] // resolved traps/tricks (each carries `kind`)
  drift: Trigger | null
  rules: FoeRules
  desc: string | null
  xpOverride?: number // teaching-foe XP override (computeXP returns it verbatim; real foes omit it)
}

export interface CombatState {
  // combatants
  playerHP: number
  playerMax: number
  enemyHP: number
  enemyMax: number
  block: number // Defend's round accumulator: mitigates the hit landing THIS round; resets EVERY rollover (NO carry — BALANCE §2.1)
  stats: StatBlock // Resolution v2: sets steer, these carry (Power/Endurance/Speed) — incl. gear stat bonus
  riders: Riders // §7 gear riders: flat per-card damage/block/mana added AFTER the contest (resolveSet)
  procs: AffixProc[] // §7 gear affix ON-MATCH procs (fired like passives — the affix-proc engine)
  mods: GearMods // §7 gear-exclusive scalars: dodge / penetration / soak / lifesteal / crit
  // §7/§13 the combo streak: tempo (≤3s grace) keeps it alive, identity (colour/shape) escalates it.
  // `level` = the live streak (float); `highest`/`combos` are the THIS-ROUND metrics that feed the crit
  // score at the rollover (reset each round); `fightPeak` is the whole-fight best chain (gating hook,
  // never reset mid-fight); lastColor/lastShape compare the next match for "styled".
  combo: { level: number; highest: number; combos: number; fightPeak: number; lastAt: number; lastColor: number | null; lastShape: number | null }
  primed: Record<number, number> // §7 Primed: slot → churn timestamp; matched within PRIMED_WINDOW_MS → +1 quality tier
  // the EXCHANGE-CUTSCENE breakdown: this round's damage/block decomposed (base contest vs gear rider) +
  // match/primed tallies, so the rollover can narrate the math beat-by-beat. Reset each rollover.
  roundLog: { atkBase: number; atkRider: number; blkBase: number; blkRider: number; attacks: number; defends: number; primed: number }
  mana: [number, number, number] // capped at MANA_CAP per color; gains past it are pure loss
  // Tactics v3 (CRAWL §5.6): a charge bank spent by the selected stance
  tactic: TacticKind
  maneuverBias: ManeuverBias | null // Maneuver's parameter; null = charges bank and wait
  charges: number // banked; ≤ CHARGE_CAP. Stand Ground spends live (wards) + carries over;
  // Maneuver burns LIVE (~1/s after a gather) — §5.7 amendment; no more rollover dump.
  maneuverGatherUntil: number // while now < this, a just-entered Maneuver is still gathering (no burn yet)
  burnAccum: number // ms accumulated toward the next live Maneuver burn (the 1/s churn cadence)
  dodgePool: number // BANKED dodge chance fed by Move sets (BALANCE §2.3) — persists across rounds, capped by
  // the foe's tempo cadence (dodgeCapForFoe), rolled per swing AT THE STRIKE, resets to 0 on a successful dodge.
  // board
  board: Board
  cols: number // grid width (for geometry selectors); rows = ceil(board.length / cols)
  pending: Map<number, Pending> // empty slots reforming
  locked: Map<number, number> // slot -> unlockAt (ms)
  selected: number[] // the player's LIVE selection (UI-synced each dispatch) — shields these + their set-mates from turnover (hard rule #6)
  pendingRegenBias: FavorBias | null // a passive (e.g. Momentum) may steer THIS match's refill
  // character
  passives: string[] // active passive ids (always-on triggers — fire on the bus)
  consumables: string[] // carried one-use items (potions/scrolls); spent via the useConsumable action
  // transient effect flags (set by items/abilities, consumed by the reducer) — reusable buff slots
  attackFrozen: boolean // the ROUND timer paused (e.g. Invisibility) until the player completes a Set
  nextSetDamageMult: number // multiplier on the next attacking Set's damage (e.g. Strength); 1 = none
  tickSuppressedUntil: number // on:tick effects (drift + dread DoTs) are paused while now < this (e.g. Hourglass)
  // foe
  foe: FoeRuntime
  // the round clock (all ms, on the `now` timeline)
  now: number
  round: number // current round index (1-based)
  roundEndsAt: number // when the rollover exchange fires
  roundOvertime: boolean // §13 COMBO OVERTIME: the round elapsed but a live chain is HOLDING the exchange open
  roundExtendedS: number // seconds of stall-spell extension already applied this round (capped)
  roundAttack: number // Attack's round accumulator: lands as the player's exchange swing
  nextStrikeRound: number // the round index of the foe's next exchange swing
  /** the TELEGRAPH: the pending exchange total (RAW, pre-dodge), revealed at the deal — strikeEvery−1
   *  rounds EARLY for slow foes (the windup, §5.7), then HELD until the strike round. null = no strike
   *  pending. Dodge is now rolled AT THE STRIKE from the banked pool (BALANCE §2.3), not pre-rolled here. */
  incoming: number | null
  incomingSwings: number[] // the raw per-swing telegraph values (banked-dodge negates individual swings at the strike)
  incomingDodged: number // swings evaded at the LAST strike (💨 tags; set when the strike resolves, 0 at reveal)
  // dread escalation (§5.8) — the within-fight anti-stall; the live level derives from these + round
  dreadFloor: number // across-run depth floor (from the delve dread band; 1 if not in a delve)
  dreadOn: boolean // is dread active? false for coach/teaching fights (the dummy stays pressure-free)
  tickAccum: Record<string, number> // trigger key -> seconds accumulated toward its `every`
  // run / gauntlet
  running: boolean
  result: 'win' | 'lose' | 'flee' | null
  // board generation config
  gen: GenConfig
}

// ROUNDS v3 (CRAWL §5.6) — the temporal grammar. The round is THE pacing constant.
export const ROUND_MS = 20000 // round length; everything else tunes relative to it
/** INTERIM stall re-anchor (pending the v3 translation pass): clock-push verbs now EXTEND the
 *  current round, capped at this many bonus seconds per round (uncapped potions bypass). */
export const ROUND_EXTEND_CAP_S = 10

export const DEFAULT_PLAYER_MAX = 100 // the decimal rebase: HP 100 so the /10 wound laws read clean
// Tactics v3 (CRAWL §5.6) — tuning defaults
export const CHARGE_CAP = 15 // exact both ways: a max 5-wound haymaker (5×3) or a whole-board (15) dump
export const WOUND_WARD_COST = 3 // Stand Ground's live cost to fizzle ONE incoming wound (the backstop)
export const BOARD_WARD_COST = 2 // …and to ward ONE board verb (a drift/enemy transmute or a lock) — raised 1→2 so the stance can't trivialize a heavy trap kit for free
export const MANA_CAP = 15 // per color; gains past it are pure loss (gear may raise it later)

// DREAD ESCALATION (CRAWL §5.8; sim §7/§10) — one meter drives two lanes: drift (soft) + a two-way
// damage ramp (the resolver). Goal: ACCELERATE every fight + the dread swing-moment, not punish stalls.
export const DREAD_RISE = 0.5 // within-fight climb per round
export const DREAD_DEPTH_CAP = 5 // the depth floor never reaches the damage band alone (always earned by dragging)
export const DREAD_MAX = 10
export const DREAD_ONSET = 7 // the damage multiplier is OFF below this, then ramps to max at DREAD_MAX
export const DREAD_FOE_MAX = 2.0 // foe damage scale at dread 10
export const DREAD_PLAYER_MAX = 1.5 // player damage + healing scale at dread 10
export const DREAD_BLEED_MAX = 0.06 // the generic UNGUARDABLE drain: fraction of maxHP/round at dread 10

/** The live dread level (depth floor + within-fight rise), clamped [1,10]; 0 when dread is OFF (coach). */
export function dreadLevel(s: CombatState): number {
  if (!s.dreadOn) return 0
  return Math.min(DREAD_MAX, Math.max(1, s.dreadFloor + DREAD_RISE * s.round))
}
const dreadBand01 = (d: number): number => Math.max(0, Math.min(1, (d - DREAD_ONSET) / (DREAD_MAX - DREAD_ONSET)))
/** Foe damage multiplier (rides the strike-at-reveal + the unguardable lanes). 1 below the onset. */
export const dreadFoeMult = (s: CombatState): number => 1 + dreadBand01(dreadLevel(s)) * (DREAD_FOE_MAX - 1)
/** Player damage + healing multiplier (the swing-moment side). 1 below the onset. */
export const dreadPlayerMult = (s: CombatState): number => 1 + dreadBand01(dreadLevel(s)) * (DREAD_PLAYER_MAX - 1)
/** The generic per-round UNGUARDABLE dread bleed in HP (∝ maxHP); 0 below the onset. Foe-independent
 *  so the anti-stall never hangs on a foe's trap kit (sim §7's load-bearing correction). */
export const dreadBleed = (s: CombatState): number => dreadBand01(dreadLevel(s)) * DREAD_BLEED_MAX * s.playerMax
/** Drift-rate multiplier (the SOFT lane): ~1 at low dread, steepens past the knee (≈2.5 at dread 10);
 *  bounded so max drift stays under the TRAPS §6 transmute ceiling (sim §10). 1 when dread is off. */
export function driftRateMult(s: CombatState): number {
  const d = dreadLevel(s)
  if (d <= 0) return 1
  return d <= 5 ? 1 + 0.1 * (d - 1) : 1.4 + 0.22 * (d - 5)
}
// Wounds (CRAWL §5.6) — computed, never authored. Both laws share one quantum: a tenth of max HP.
export const WOUND_CAP_PER_EXCHANGE = 5
export const woundQuantum = (s: CombatState): number => s.playerMax / 10
// Resolution v3 — the decimal rebase: stats 10 give the contests room to breathe
export const BASE_STATS: StatBlock = { power: 10, endurance: 10, speed: 10 }
export const START_GRACE_MS = 3000 // UI freezes the round this long after Engage (read the board, no ticks advance)

// --- COMBAT AMENDMENTS (CRAWL §5.7, sim-derived 2026-06-12) ---
// DODGE (BALANCE §2.3): two parts. (1) a Speed-differential FLOOR per swing — base 10%, +1.5%/pt of Speed
// edge, clamp [3%, 40%]. (2) a BANKED pool fed by Move sets (DODGE_PER_CHARGE per charge of Move income),
// persisting across rounds, capped by the foe's tempo CADENCE (dodgeCapForFoe). Effective dodge at a swing
// = min(cadenceCap, floor + pool); rolled per swing AT THE STRIKE (so windup Move investment pays off),
// resetting the pool on a successful dodge. Strikes only — never traps/drift/ticks (the unguardable floor).
export const DODGE_BASE = 0.1
export const DODGE_K = 0.015
export const DODGE_MIN = 0.03
export const DODGE_MAX = 0.4
export const DODGE_PER_CHARGE = 0.04 // banked dodge added per charge-point of Move income (~0.12 per parity Move set)
// The dodge CEILING by the foe's cadence (the §2.3 complementarity): rarer-but-bigger hits → invest all the
// way to certainty; frequent chip can't be fully slipped, so Block carries it. Block ↔ Dodge tile the tempo spectrum.
export const dodgeCapForFoe = (strikeEvery: number, swings: number): number =>
  strikeEvery >= 3 ? 1.0 : strikeEvery === 2 ? 0.9 : swings >= 3 ? 0.6 : swings === 2 ? 0.7 : 0.8
// CRIT (§7/§13 — the shared exchange-delight channel; player-only, rolled once on the banked swing at the
// rollover so the SET stays exact). The chance is a SKILL-EARNED S-curve (sim §13), soft-capped so the
// diminishing curve IS the practical ceiling: crit = CRIT_SOFT_CAP / (1 + e^(−CRIT_A·(score − CRIT_M))),
// score = highestChain + COMBO_W·normalizedCombos + KeenScore. Tuned: competent ≈ 5% · peak ≈ 24% ·
// floor ≈ competent · diminishing up top (even peak + maxed Keen ≤ ~25%). Mult = base + gear(Vorpal).
export const BASE_CRIT_MULT = 1.5
export const CRIT_SOFT_CAP = 0.25
export const CRIT_A = 0.42
export const CRIT_M = 7
export const COMBO_W = 0.5 // the (normalized) combo count's weight in the crit score vs the highest chain
// COMBOS/CHAINS (§7/§13 — the visceral skill layer): a CHAIN is a run of matches each ≤ CRIT_GRACE_MS
// apart (tempo keeps it alive; same colour OR shape escalates it faster — the style chase). highestChain
// (unnormalized = the skill-shine) + combos (in-grace matches, NORMALIZED by round-extension) feed the score.
export const CRIT_GRACE_MS = 3000
export const COMBO_STYLE_STEP = 1.0 // a styled (colour/shape-continued) in-grace match advances the chain by this
export const COMBO_TEMPO_STEP = 0.6 // a tempo-only (in-grace but off-identity) match advances it by this (slower)
// COMBO OVERTIME (§13 — the clutch end-of-round extension): when the round clock elapses while a chain is
// live (level ≥ MIN, last match < CRIT_GRACE_MS ago), the exchange is HELD OPEN — sets keep stacking until
// the chain lapses, then the rollover fires instantly. The 3s grace IS the skill gate (no other limit).
// Deliberately bypasses the stall normalization: overtime damage/combos feed crit FULLY (the CRIT_SOFT_CAP
// is the only backstop) — the reward for the streak. CAP_MS=0 ⇒ uncapped (safety valve for later tuning).
export const COMBO_OVERTIME_MIN_LEVEL = 2 // a chain must reach this to hold the round open (styled 2-chain)
export const COMBO_OVERTIME_CAP_MS = 0 // 0 = uncapped; >0 force-rolls the round this many ms past roundEndsAt
// ⚠ E2 (FABLE §3) — DEFERRED, not fixed (decision 2026-07-08). FABLE flags the uncapped hold as freezing the
// anti-stall: while a chain is held, the round never rolls over, so dread/bleed never ramp and roundAttack
// banks without limit → a boss can die to one exchange. We are NOT capping it yet, on the design read that
// stalling has no real payoff: rewards land only at ENCOUNTER end, so holding a round open just draws out
// your own rewards (you're not farming anything mid-fight), and the coming CAUTIOUS/untimed stance (TODO
// Phase 5, item 22) makes combos/overtime even less load-bearing. Revisit if playtest shows the one-exchange
// boss kill actually degrades feel; the levers are a real CAP_MS here, deriving dread from elapsed time, or
// escalating the grace as overtime stretches. Kept as a documented open design question, not a bug.
// PRIMED (§7/§11 — the Speed/Maneuver OUTPUT payoff): a Maneuver-churned card matched within this window
// counts ONE quality tier higher (① glancing → ② solid → ③ heavy, capped). Converts Speed's board-control
// into measurable output, in-lane (the under-buy fix). Bounded: only churned-then-matched cards, +1 tier.
export const PRIMED_WINDOW_MS = 6000
// MANEUVER LIVE-BURN: stances now act LIVE (no round-lock). Entering Maneuver pays a GATHER, then
// burns ~1 charge/sec (each burn churns one deadest-not-matching card toward the bias). Bailing to
// Stand Ground is instant (keeps the remainder). The gather damps wheel-drumming.
export const MANEUVER_GATHER_MS = 1800
export const MANEUVER_BURN_MS = 1000
