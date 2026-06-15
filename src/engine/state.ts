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
  block: number // Defend's round accumulator: mitigates THIS round's telegraph, resets at the exchange
  stats: StatBlock // Resolution v2: sets steer, these carry (Power/Endurance/Speed) — incl. gear stat bonus
  riders: Riders // §7 gear riders: flat per-card damage/block/mana added AFTER the contest (resolveSet)
  procs: AffixProc[] // §7 gear affix ON-MATCH procs (fired like passives — the affix-proc engine)
  mods: GearMods // §7 gear-exclusive scalars: dodge / penetration / soak / lifesteal / crit
  chain: { key: string | null; len: number } // §7 colour+shape combo streak → ramps crit chance (the visceral skill layer)
  mana: [number, number, number] // capped at MANA_CAP per color; gains past it are pure loss
  // Tactics v3 (CRAWL §5.6): a charge bank spent by the selected stance
  tactic: TacticKind
  maneuverBias: ManeuverBias | null // Maneuver's parameter; null = charges bank and wait
  charges: number // banked; ≤ CHARGE_CAP. Stand Ground spends live (wards) + carries over;
  // Maneuver burns LIVE (~1/s after a gather) — §5.7 amendment; no more rollover dump.
  maneuverGatherUntil: number // while now < this, a just-entered Maneuver is still gathering (no burn yet)
  burnAccum: number // ms accumulated toward the next live Maneuver burn (the 1/s churn cadence)
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
  roundExtendedS: number // seconds of stall-spell extension already applied this round (capped)
  roundAttack: number // Attack's round accumulator: lands as the player's exchange swing
  nextStrikeRound: number // the round index of the foe's next exchange swing
  /** the TELEGRAPH: the pending exchange total, revealed at the deal — strikeEvery−1 rounds EARLY
   *  for slow foes (the windup, §5.7), then HELD until the strike round. null = no strike pending.
   *  0 = a strike was fully DODGED (every swing evaded at the deal). */
  incoming: number | null
  incomingDodged: number // swings of the pending telegraph evaded at the deal (💨 tags; 0 = none)
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
export const WOUND_WARD_COST = 3 // Stand Ground's live cost to fizzle ONE incoming wound (board verbs cost 1)
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
// DODGE: per-SWING evasion rolled at the deal, folded into the telegraph (Speed owns whether/when,
// Defend owns how much — strikes only, never traps/drift/ticks). Sim-derived: base 10%, +1.5%/pt
// of Speed edge, clamp [3%, 40%].
export const DODGE_BASE = 0.1
export const DODGE_K = 0.015
export const DODGE_MIN = 0.03
export const DODGE_MAX = 0.4
// CRIT (§7 — the shared exchange-delight channel; player-only, HIGHLY restricted so it never becomes
// reliable DPS): total chance = BASE + gear(Keen) + the chain ramp, capped at CRIT_CAP; mult = base +
// gear(Vorpal). Rolled once on the player's banked swing at the rollover (the set stays exact).
export const BASE_CRIT_CHANCE = 0.05
export const BASE_CRIT_MULT = 1.5
export const CRIT_CAP = 0.2 // total chance ceiling (base+gear+chain) — keeps crit a delight, not a strategy
// CHAINS (§7 — a colour+shape streak ramps crit chance; the visceral skill layer): both axes must match
// consecutively (hard to sustain), and the per-link bump is small.
export const CHAIN_CRIT_STEP = 0.03 // +crit chance per chain link past the first (chain 2 → +0.03, …)
// MANEUVER LIVE-BURN: stances now act LIVE (no round-lock). Entering Maneuver pays a GATHER, then
// burns ~1 charge/sec (each burn churns one deadest-not-matching card toward the bias). Bailing to
// Stand Ground is instant (keeps the remainder). The gather damps wheel-drumming.
export const MANEUVER_GATHER_MS = 1800
export const MANEUVER_BURN_MS = 1000
