/* engine/resolve — turn a found set into combat effects. RESOLUTION v3 ("sets steer, stats carry,
   STATS CONTEST" — CRAWL §5.6): foes carry the same Power/Endurance/Speed block as players, and
   every per-card value is an OPPOSED-STAT RATE × the card's QUALITY (① glancing ×0.7 · ② solid
   ×1.0 · ③ heavy ×1.4). One stat pair per lane, each stat used exactly once per direction:
   • Attack card  → rate(your Power,     their Endurance) banked toward the exchange swing
   • Defend card  → rate(your Endurance, their Power)     banked as Block vs the telegraph
   • Move card    → rate(your Speed,     their Speed)     banked as Tactics charge points
   The telegraph itself is the foe's Power expressed (budgeted + packaged in foe.ts — the tempo law).
   Rates are DIFFERENCE-based with clamps (legible + bounded under gear, unlike ratios).
   Deterministic on purpose: a set always delivers exactly what it reads; `weightedRoll` remains
   for ENEMY strikes and ability rolls. All constants are first-cut sim-fodder (TUNING.md). */

import type { Card } from '../core/affine'
import type { Rng } from '../core/rng'
import type { StatBlock } from './state'
import { NO_RIDERS, type Riders } from './items'

/** Magnitude → action quality: glancing / solid / heavy. */
export const QUALITY = [0.7, 1, 1.4] as const

export const SHAPE_ATTACK = 0
export const SHAPE_DEFEND = 1
export const SHAPE_MOVE = 2

// ---- the contested-rate laws (CRAWL §5.6; derivation sheet in TUNING.md) ----
// At stat parity an Attack/Defend card is worth RATE_BASE × q → a magnitude-6 set ≈ 25, the
// 6/6/6 baseline axiom's even-exchange quantum (player HP 100). RE-DENOMINATED 2026-06-12
// (the data rebase): the +3/+2/+1 level arc widens the stat band (parity line 10+2(L−1), endgame
// 40–80), so RATE_K dropped 0.8 → 0.2 (sim-derived — parity is K-independent, so this only
// re-scales OFF-parity contests to the wider band; +1 main-stat level = +7.5% lane throughput).
export const RATE_BASE = 8
export const RATE_K = 0.2 // value per point of stat edge (was 0.8; re-denominated for the level arc)
export const RATE_MIN = 2 // never useless…
export const RATE_MAX = 20 // …never absurd (gear stacking stays bounded)
/** Damage/Block lane rate: your stat vs the opposed stat, difference-based, clamped. */
export function contestRate(yours: number, theirs: number): number {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, RATE_BASE + RATE_K * (yours - theirs)))
}
// The Move lane runs in CHARGE POINTS (the bank shows whole pips; fractions accumulate).
// Parity = 1 point per Move card × quality ≈ 3/set — continuity with the flat v3 income.
export const MOVE_RATE_BASE = 1
export const MOVE_RATE_K = 0.025 // was 0.1; re-denominated with RATE_K
export const MOVE_RATE_MIN = 0.2
export const MOVE_RATE_MAX = 3
export function moveRate(yourSpeed: number, theirSpeed: number): number {
  return Math.min(MOVE_RATE_MAX, Math.max(MOVE_RATE_MIN, MOVE_RATE_BASE + MOVE_RATE_K * (yourSpeed - theirSpeed)))
}

// ---- THE TELEGRAPH LAW (re-anchored on the contest, sim-derived 2026-06-12) ----
// The foe's round damage budget = the Attack-lane contest (its Power vs YOUR Endurance) × a
// baseline set's quality sum × the tier multiplier. At parity → 25 × tier, LEVEL-INVARIANT —
// the raw-Power form (Power × DMG_BUDGET_K) broke axiom A4 over the level arc (foe Power grows
// but your parity Defend set still blocks ~25/round). Computed against the live player E in
// createCombat; the per-swing budget is this packaged by the tempo law's strikeEvery/swings.
export const TELEGRAPH_QSUM = 3.1 // a magnitude-6 set's quality sum (0.7+1.0+1.4), the budget anchor (A4)
export const TIER_BUDGET_MULT = { minion: 1, elite: 1.5, boss: 2 } as const // A5 output multipliers
export function telegraphRoundBudget(foePower: number, playerEndurance: number, tier: 'minion' | 'elite' | 'boss'): number {
  return contestRate(foePower, playerEndurance) * TELEGRAPH_QSUM * TIER_BUDGET_MULT[tier]
}
/** DODGE (CRAWL §5.7): the per-SWING evasion chance — your Speed vs the foe's, difference-based and
 *  clamped, the same shape as the contests. Rolled at the deal; dodged swings vanish from the
 *  telegraph. Constants in state.ts (imported by the caller to keep resolve.ts dep-free of state). */
export function dodgeChance(playerSpeed: number, foeSpeed: number, base: number, k: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, base + k * (playerSpeed - foeSpeed)))
}

/** The per-SWING roll budget: the round budget packaged by the tempo law. 0-Power foes never strike. */
export function telegraphPerSwing(
  foe: { stats: StatBlock; tier: 'minion' | 'elite' | 'boss' | null; strikeEvery: number; swings: number },
  playerEndurance: number,
): number {
  if (foe.stats.power <= 0) return 0
  const round = telegraphRoundBudget(foe.stats.power, playerEndurance, foe.tier ?? 'minion')
  return Math.max(1, Math.round((round * foe.strikeEvery) / foe.swings))
}

/** Triangular-weighted roll: value v in [1,max] drawn with P(v) ∝ v (favours max, weak hits possible). */
export function weightedRoll(max: number, rng: Rng): number {
  max = Math.max(1, Math.round(max))
  const total = (max * (max + 1)) / 2
  let r = Math.floor(rng() * total) + 1
  let v = 0
  let acc = 0
  while (acc < r) {
    v++
    acc += v
  }
  return v
}

/** Per-axis same/diff profile of a match: the all-same value on each axis (or null), plus raw values.
 *  Trigger/passive conditions read this (e.g. sameShape === SHAPE_MOVE). */
export interface MatchDescriptor {
  sameColor: number | null
  sameShape: number | null
  sameNumber: number | null
  colors: [number, number, number]
  shapes: [number, number, number]
  numbers: [number, number, number]
}

export function matchDescriptor(cards: [Card, Card, Card]): MatchDescriptor {
  const col: [number, number, number] = [cards[0][0], cards[1][0], cards[2][0]]
  const sh: [number, number, number] = [cards[0][1], cards[1][1], cards[2][1]]
  const nu: [number, number, number] = [cards[0][3], cards[1][3], cards[2][3]]
  const same = (a: [number, number, number]) => (a[0] === a[1] && a[1] === a[2] ? a[0] : null)
  return { sameColor: same(col), sameShape: same(sh), sameNumber: same(nu), colors: col, shapes: sh, numbers: nu }
}

export interface Resolution {
  damage: number
  dmgLight: number
  dmgMed: number
  dmgHeavy: number
  block: number
  riderDmg: number // the GEAR-rider part of `damage` (weapon bonus) — for the exchange-cutscene breakdown
  riderBlock: number // the gear-rider part of `block` (armor bonus)
  riderMana: number // the gear-rider part of `mana` (caster weapon/armor) — for the gear-contribution readout
  charges: number // Move lane: charge POINTS (fractional; the bank floors into pips)
  mana: [number, number, number]
  allSameColor: boolean
  desc: MatchDescriptor
}

/** Resolve a set (v3 contests): each card banks its lane's contested rate × its quality.
 *  Mana routes by colour signature: all-same → 3 in that pool, all-diff → 1 each.
 *  GEAR RIDERS (§7) add FLAT, AFTER the contest (bounded — they never scale with the rate): the
 *  weapon's damage per Attack card, the armor's Block per Defend card, caster mana per mono-colour set.
 *  Default NO_RIDERS → identical to the pre-gear result (backward-compatible). */
export function resolveSet(cards: [Card, Card, Card], stats: StatBlock, foeStats: StatBlock, _rng: Rng, riders: Riders = NO_RIDERS, penetration = 0, primed: [boolean, boolean, boolean] = [false, false, false]): Resolution {
  // §7 Penetration (Sundering): ignore some foe Endurance in the ATTACK contest only (anti-armour)
  const atkRate = contestRate(stats.power, Math.max(1, foeStats.endurance - penetration))
  const defRate = contestRate(stats.endurance, foeStats.power)
  const mvRate = moveRate(stats.speed, foeStats.speed)
  let dmgLight = 0
  let dmgMed = 0
  let dmgHeavy = 0
  let block = 0
  let charges = 0
  let nAtk = 0
  let nDef = 0
  for (let k = 0; k < cards.length; k++) {
    const c = cards[k]
    const shape = c[1]
    // §7 Primed: a Maneuver-churned card matched in time counts ONE quality tier higher (capped at heavy)
    const tier = primed[k] ? Math.min(2, c[3] + 1) : c[3]
    const q = QUALITY[tier] // card magnitude = the action's quality tier
    if (shape === SHAPE_ATTACK) {
      nAtk++
      const hit = Math.round(atkRate * q)
      if (tier === 0) dmgLight += hit
      else if (tier === 1) dmgMed += hit
      else dmgHeavy += hit
    } else if (shape === SHAPE_DEFEND) {
      nDef++
      block += Math.round(defRate * q)
    } else {
      charges += mvRate * q // fractional on purpose — the Speed contest needs the granularity
    }
  }
  // §7 the TYPE layer: a weapon's base rider fires only when the set's COLOUR matches its match-type.
  // setColorScope: 0/1/2 = mono red/green/blue · 3 = rainbow (all-different). A valid Set's colour is
  // always either all-same or all-different, so !allSameColor ⇒ rainbow.
  const cv: [number, number, number] = [cards[0][0], cards[1][0], cards[2][0]]
  const allSameColor = cv[0] === cv[1] && cv[1] === cv[2]
  const setColorScope = allSameColor ? cv[0] : 3
  const weaponFires = riders.scopedColor != null && riders.scopedColor === setColorScope
  // gear riders: flat per-card additions, post-contest. Damage lumps into the "solid" bucket for FX.
  const atkPerCard = riders.atkDamagePerCard + (weaponFires ? (riders.scopedAtkPerCard ?? 0) : 0)
  const riderDmg = atkPerCard > 0 && nAtk > 0 ? atkPerCard * nAtk : 0
  const riderBlock = riders.blockPerDefendCard > 0 && nDef > 0 ? riders.blockPerDefendCard * nDef : 0
  dmgMed += riderDmg
  block += riderBlock
  const damage = dmgLight + dmgMed + dmgHeavy
  const mana: [number, number, number] = [0, 0, 0]
  if (allSameColor) mana[cv[0]] = 3
  else {
    mana[0] = 1
    mana[1] = 1
    mana[2] = 1
  }
  // caster mana rider: a mono-colour set is the caster's payoff (§7); the caster WEAPON's mana is
  // additionally scoped to its match-type colour, on top of any unscoped (relic/armor) mana.
  const manaUnscoped = riders.manaPerMatch > 0 && allSameColor ? riders.manaPerMatch : 0
  const manaScoped = weaponFires ? (riders.scopedManaPerMatch ?? 0) : 0
  const riderMana = manaUnscoped + manaScoped
  if (riderMana > 0) mana[cv[0]] += riderMana
  return { damage, dmgLight, dmgMed, dmgHeavy, block, riderDmg, riderBlock, riderMana, charges, mana, allSameColor, desc: matchDescriptor(cards) }
}
