/* engine/tactics — TACTICS v3 (CRAWL §5.6): the charge bank and the two stances, round-locked.
   Charges accumulate in EVERY stance (+1 per Move card; Defend overflow trickles). The stances
   differ in their relationship to the bank AND in resolution timing:
   • Stand Ground (banker) — spends LIVE: each hostile board verb fizzles for 1 charge, an incoming
     wound for 3 (ops.tryWard); its remainder CARRIES across the rollover.
   • Maneuver (dumper) — never wards; at the rollover it burns ALL charges: N charges redraw the N
     deadest cards NOT already matching the bias, then the bank zeroes (overflow past available
     non-matching cards burns unused — the board is already yours).
   The stance LOCKS at the draw phase: setTactic/setBias QUEUE for next round (the wheel's ghost
   spoke). Load-bearing, not flavor — free swapping would allow warding all round then flipping to
   dump at second 19. Supersedes the v2 swap-spin-up rule entirely. v2 history in CRAWL §5.5. */

import type { Rng } from '../core/rng'
import type { FavorBias } from '../core/generate'
import type { CombatState, TacticKind, ManeuverBias } from './state'
import type { EventSink } from './events'
import { transmute } from './triggers'
import { BIAS_W, cardColor, cardShape, cardMag, liveSlots, comboCounts } from './select'

/** Maneuver's bias → the generator's favour weights. */
export function biasToFavor(b: ManeuverBias): FavorBias {
  if (b.axis === 'color') return { color: b.value, colorW: BIAS_W }
  if (b.axis === 'shape') return { shape: b.value, shapeW: BIAS_W }
  return { mag: b.value, magW: BIAS_W }
}

const axisValue = (b: ManeuverBias) => (b.axis === 'color' ? cardColor : b.axis === 'shape' ? cardShape : cardMag)

/** QUEUE a stance pick for the next draw phase (v3: the stance locks at the deal). Picking your
 *  current tactic clears the queue. The change applies at the rollover (combat.ts). */
export function setTactic(s: CombatState, tactic: TacticKind, sink: EventSink): boolean {
  if (!s.running) return false
  s.queuedTactic = tactic === s.tactic ? null : tactic
  sink.emit({ type: 'tacticChanged', tactic: s.queuedTactic ?? s.tactic, queued: true })
  return true
}

/** QUEUE a bias change for the next draw phase. The bias is part of the locked stance (flicking it
 *  just before the dump would dodge the commitment), so it rides the same queue. */
export function setBias(s: CombatState, bias: ManeuverBias | null, sink: EventSink): boolean {
  if (!s.running) return false
  s.queuedBias = { bias: bias ? { ...bias } : null }
  sink.emit({ type: 'biasChanged', bias: s.queuedBias.bias, queued: true })
  return true
}

/** Apply the queued stance at the draw phase (called by the reducer's rollover). */
export function lockQueuedStance(s: CombatState, sink: EventSink): void {
  if (s.queuedTactic && s.queuedTactic !== s.tactic) {
    s.tactic = s.queuedTactic
    sink.emit({ type: 'tacticChanged', tactic: s.tactic })
  }
  s.queuedTactic = null
  if (s.queuedBias) {
    s.maneuverBias = s.queuedBias.bias ? { ...s.queuedBias.bias } : null
    sink.emit({ type: 'biasChanged', bias: s.maneuverBias })
  }
  s.queuedBias = null
}

/** The Maneuver DUMP — fires at the rollover, before the deal. Burns ALL banked charges: the N
 *  deadest live cards not already matching the bias redraw toward it (batch — this is the tide
 *  coming in with the new deal, not the old serial churn). The bank zeroes even if fewer
 *  non-matching cards exist than charges (the board is already yours). */
export function rolloverDump(s: CombatState, rng: Rng, sink: EventSink): void {
  if (s.tactic !== 'maneuver' || s.charges <= 0) return
  const bias = s.maneuverBias
  if (!bias) return // no bias dialed (unreachable from the wheel) — hold the bank, no waste
  const spent = s.charges
  s.charges = 0
  const get = axisValue(bias)
  const pool = liveSlots(s, (c) => get(c) !== bias.value)
  if (!pool.length) {
    sink.emit({ type: 'tacticsDumped', spent, churned: 0 })
    return
  }
  const counts = comboCounts(s)
  const cost = (i: number) => counts[i] * 100 + cardMag(s.board[i]!)
  const take = pool.sort((a, b) => cost(a) - cost(b)).slice(0, Math.min(spent, pool.length))
  transmute(s, take, { bias: biasToFavor(bias), source: 'churn' }, sink) // calm morph — reforms with the deal
  sink.emit({ type: 'tacticsDumped', spent, churned: take.length })
}
