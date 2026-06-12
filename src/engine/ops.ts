/* engine/ops — shared combatant operations used by the reducer, abilities, passives, and tactics.
   Pure: mutate CombatState and emit events; no DOM. Pulled out of combat.ts so abilities/passives
   can reuse block/tactics/heal/damage without a dependency cycle (combat → abilities → ops). */

import type { Rng } from '../core/rng'
import { patch, patchFavor, type FavorBias } from '../core/generate'
import type { CombatState } from './state'
import { CHARGE_CAP, MANA_CAP, ROUND_EXTEND_CAP_S, WOUND_WARD_COST, woundQuantum } from './state'
import type { EventSink } from './events'
import { weightedRoll } from './resolve'

/** Add to the Block accumulator (capped at max HP). Block mitigates THIS round's telegraphed
 *  exchange and resets at the rollover; leftover past the telegraph converts there (1 per 2 —
 *  CRAWL §5.6). Block past the HP cap converts live at the same rate, and the Overflow passive
 *  (Sentinel) independently spills the FULL overcap into a weighted attack — both stack. */
export function gainBlock(s: CombatState, n: number, rng: Rng, sink: EventSink): number {
  if (n <= 0) return 0
  const room = Math.max(0, s.playerMax - s.block)
  const applied = Math.min(n, room)
  if (applied > 0) {
    s.block += applied
    sink.emit({ type: 'blockGained', amount: applied })
  }
  const overflow = n - applied
  if (overflow > 0) {
    const charges = Math.floor(overflow / 2)
    if (charges > 0) addCharges(s, charges, sink, 'overflow')
    if (s.passives.includes('overflow')) {
      const dmg = weightedRoll(overflow, rng) // Sentinel: the full overflow ALSO becomes a weighted attack
      const dealt = dealAbilityDamage(s, dmg, sink)
      if (dealt > 0) sink.emit({ type: 'passiveProc', id: 'overflow', label: `⚔ +${dealt}` })
    } else if (overflow - charges * 2 > 0) {
      sink.emit({ type: 'blockOverflow', amount: overflow - charges * 2 }) // the unconverted remainder is wasted
    }
  }
  return applied
}

/** Bank Tactics charges (capped at CHARGE_CAP; overflow wasted). v3: no spin-up gate — the
 *  draw-phase stance lock IS the commitment (CRAWL §5.6). */
export function addCharges(s: CombatState, amt: number, sink: EventSink, source?: 'overflow'): void {
  if (amt <= 0) return
  const applied = Math.min(CHARGE_CAP - s.charges, amt)
  if (applied <= 0) return
  s.charges += applied
  sink.emit({ type: 'chargesGained', amount: applied, source })
}

/** Stand Ground interception (LIVE, mid-round): a hostile board verb fires → banked charges eat it.
 *  Board verbs (drift / enemy transmute / lock) cost 1; an incoming WOUND costs 3 (CRAWL §5.6 —
 *  Defend allocation is the primary wound prevention; this is the backstop). Never absorbs raw
 *  damage (that's Block's lane). */
export function tryWard(s: CombatState, what: 'transmute' | 'lock' | 'shatter', sink: EventSink): boolean {
  const cost = what === 'shatter' ? WOUND_WARD_COST : 1
  if (s.tactic !== 'stand' || s.charges < cost) return false
  s.charges -= cost
  sink.emit({ type: 'warded', what, cost })
  return true
}

/** Grant the player mana of one colour (capped at MANA_CAP; gains past it are pure loss). */
export function grantMana(s: CombatState, color: number, amount: number, sink: EventSink): void {
  if (amount <= 0) return
  const applied = Math.min(MANA_CAP - s.mana[color], amount)
  if (applied <= 0) return
  s.mana[color] += applied
  const m: [number, number, number] = [0, 0, 0]
  m[color] = applied
  sink.emit({ type: 'manaGained', mana: m })
}

/** Heal the player (capped at max HP) AND repair wounds by the v3 law: any heal also knits
 *  ceil(amount / (maxHP/10)) wound slots shut (CRAWL §5.6 — computed, never authored; keyed to
 *  the heal's SIZE, not the HP applied, so a full-HP heal still repairs the board). */
export function healPlayer(s: CombatState, amt: number, rng: Rng, sink: EventSink): number {
  if (amt <= 0) return 0
  const before = s.playerHP
  s.playerHP = Math.min(s.playerMax, s.playerHP + amt)
  const healed = s.playerHP - before
  if (healed > 0) sink.emit({ type: 'playerHealed', amount: healed })
  repairWounds(s, Math.ceil(amt / woundQuantum(s)), rng, sink)
  return healed
}

/** Knit up to `count` wound slots shut now (lowest slot first — deterministic). */
export function repairWounds(s: CombatState, count: number, rng: Rng, sink: EventSink): number {
  if (count <= 0) return 0
  const wounds: number[] = []
  for (const [slot, p] of s.pending) if (p.wound) wounds.push(slot)
  if (!wounds.length) return 0
  wounds.sort((a, b) => a - b)
  const take = wounds.slice(0, count)
  reformSlots(s, take, undefined, rng)
  sink.emit({ type: 'cardsReformed', slots: take })
  return take.length
}

/** Intrinsic ability damage to the enemy. The ethereal rule (ability_damage:'mana_spent') replaces
 *  intrinsic spell damage entirely — those foes are hurt only by castDamageHook (mana spent). */
export function dealAbilityDamage(s: CombatState, dmg: number, sink: EventSink): number {
  if (s.foe.rules.ability_damage === 'mana_spent') return 0
  if (dmg <= 0) return 0
  s.enemyHP = Math.max(0, s.enemyHP - dmg)
  sink.emit({ type: 'enemyDamaged', amount: dmg })
  return dmg
}

/** Ethereal rule: each ability cast drains the foe by the mana spent on it (the only way to hurt him). */
export function castDamageHook(s: CombatState, cost: [number, number, number], sink: EventSink): void {
  if (s.foe.rules.ability_damage !== 'mana_spent') return
  const spent = cost[0] + cost[1] + cost[2]
  if (spent <= 0) return
  s.enemyHP = Math.max(0, s.enemyHP - spent)
  sink.emit({ type: 'enemyDamaged', amount: spent, magic: true })
}

/** ⚠ INTERIM stall re-anchor (CRAWL §5.6 open item): clock-push verbs now EXTEND the current round
 *  — time magic literally buys time. Capped at ROUND_EXTEND_CAP_S bonus seconds per round
 *  (`uncapped` = premium potions bypass). Returns seconds applied. Settle in the translation pass. */
export function extendRound(s: CombatState, sec: number, sink: EventSink, uncapped = false): number {
  if (sec <= 0 || !s.running) return 0
  const applied = uncapped ? sec : Math.max(0, Math.min(sec, ROUND_EXTEND_CAP_S - s.roundExtendedS))
  if (applied <= 0) return 0
  s.roundExtendedS += applied
  s.roundEndsAt += applied * 1000
  sink.emit({ type: 'clockChanged', deltaSeconds: applied })
  return applied
}

/** Enemy yank (advance_timer): the rollover comes SOONER. Clamped — never fires it instantly. */
export function shortenRound(s: CombatState, sec: number, sink: EventSink): number {
  if (sec <= 0 || !s.running) return 0
  const floor = s.now + 1000 // always leave a beat to react
  const before = s.roundEndsAt
  s.roundEndsAt = Math.max(floor, s.roundEndsAt - sec * 1000)
  const applied = Math.round((before - s.roundEndsAt) / 1000)
  if (applied > 0) sink.emit({ type: 'clockChanged', deltaSeconds: -applied })
  return applied
}

/** Reform empty slots (bias-aware). Locked slots are excluded from the floor count, so the reform
 *  restores a MAKEABLE set — the lock-layer invariant (TRAPS.md §6.1), not just a paper floor
 *  through a locked card. (Lives here so healPlayer's wound repair can use it without a cycle.) */
export function reformSlots(s: CombatState, slots: number[], bias: FavorBias | undefined, rng: Rng): void {
  const fill = slots.filter((i) => s.board[i] == null)
  if (!fill.length) return
  const locked = s.locked.size ? new Set(s.locked.keys()) : undefined
  const next = bias ? patchFavor(s.board, fill, s.gen, rng, bias, locked) : patch(s.board, fill, s.gen, rng, undefined, locked)
  for (const i of fill) {
    s.board[i] = next[i]
    s.pending.delete(i)
  }
}
