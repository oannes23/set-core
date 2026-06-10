/* engine/ops — shared combatant operations used by the reducer, abilities, passives, and tactics.
   Pure: mutate CombatState and emit events; no DOM. Pulled out of combat.ts so abilities/passives
   can reuse block/tactics/heal/damage without a dependency cycle (combat → abilities → ops). */

import type { Rng } from '../core/rng'
import type { CombatState } from './state'
import { TACTICS_GOAL, clockCapMs } from './state'
import type { EventSink } from './events'
import { weightedRoll } from './resolve'

/** Add to the persistent block barrier (capped at max HP — block NEVER exceeds the cap). Block past the
 *  cap gets a slight Defend bonus: a low-weighted triangular slice of the overflow **rolls over into the
 *  Tactics meter** (can be 0) — symmetric with Move/clock overflow feeding Tactics. This stacks with the
 *  Overflow passive (Sentinel), which independently spills the FULL overflow into a weighted attack — a
 *  Sentinel gets both the attack and the Tactics rollover. */
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
    // low-weighted triangular rollover (favours 0; range 0..overflow) — wasted Defend trickles into Tactics
    const rollover = overflow + 1 - weightedRoll(overflow + 1, rng)
    if (rollover > 0) addTactics(s, rollover, sink, 'overflow')
    if (s.passives.includes('overflow')) {
      const dmg = weightedRoll(overflow, rng) // Sentinel: the full overflow ALSO becomes a weighted attack
      const dealt = dealAbilityDamage(s, dmg, sink)
      if (dealt > 0) sink.emit({ type: 'passiveProc', id: 'overflow', label: `⚔ +${dealt}` })
    } else if (rollover < overflow) {
      sink.emit({ type: 'blockOverflow', amount: overflow - rollover }) // the unsalvaged remainder is wasted
    }
  }
  return applied
}

/** Fill the Tactics meter; arm it (begin draining) when it tops out. */
export function addTactics(s: CombatState, amt: number, sink: EventSink, source?: 'overflow'): void {
  if (amt <= 0) return
  s.tactics = Math.min(TACTICS_GOAL, s.tactics + amt)
  sink.emit({ type: 'tacticsGained', amount: amt, source })
  if (!s.tacticsArmed && s.tactics >= TACTICS_GOAL) {
    s.tacticsArmed = true
    sink.emit({ type: 'tacticsArmed' })
  }
}

/** Grant the player mana of one colour (no cap). */
export function grantMana(s: CombatState, color: number, amount: number, sink: EventSink): void {
  if (amount <= 0) return
  s.mana[color] += amount
  const m: [number, number, number] = [0, 0, 0]
  m[color] = amount
  sink.emit({ type: 'manaGained', mana: m })
}

/** Heal the player (capped at max HP). */
export function healPlayer(s: CombatState, amt: number, sink: EventSink): number {
  if (amt <= 0) return 0
  const before = s.playerHP
  s.playerHP = Math.min(s.playerMax, s.playerHP + amt)
  const healed = s.playerHP - before
  if (healed > 0) sink.emit({ type: 'playerHealed', amount: healed })
  return healed
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

/** Push the enemy's next attack later, capped at the clock ceiling (Moves). `uncapped` bypasses the
 *  ceiling for premium stalls (e.g. a major Haste potion). The cap clamps the GAIN only — a clock
 *  already past the ceiling (via an uncapped push) is never pulled backward. Returns seconds applied
 *  (0..sec); callers can treat `sec - applied` as overflow (Move sets feed it to Tactics). */
export function pushClock(s: CombatState, sec: number, sink: EventSink, uncapped = false): number {
  const before = s.nextAttackAt
  const ceil = uncapped ? Infinity : s.now + clockCapMs(s)
  s.nextAttackAt = Math.max(before, Math.min(ceil, before + sec * 1000))
  const applied = Math.round((s.nextAttackAt - before) / 1000)
  if (applied > 0) sink.emit({ type: 'clockChanged', deltaSeconds: applied })
  return applied
}
