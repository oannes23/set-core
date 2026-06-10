/* engine/tactics — TACTICS v2 (CRAWL §5.5): the charge queue and the two tactics.
   The player selects ONE tactic (the verb); charges earned in play are spent by it:
   • Maneuver — each charge transmutes the DEADEST non-conforming card toward the chosen bias,
     serially (one per CHURN_MS, deadest re-evaluated after every morph — never a batch flash).
   • Stand Ground — charges bank; each hostile board verb that fires is intercepted (see ops.tryWard).
   Swapping tactics resets charges and costs a spin-up (income lost) — commitment is the decision.
   v1 (the armed meter + six one-shot flood buttons) is superseded; history in CRAWL §5.5. */

import type { Rng } from '../core/rng'
import type { FavorBias } from '../core/generate'
import type { CombatState, TacticKind, ManeuverBias } from './state'
import { CHURN_MS, SWAP_SPINUP_MS } from './state'
import type { EventSink } from './events'
import { transmute } from './triggers'
import { BIAS_W, cardColor, cardShape, cardMag, liveSlots, comboCounts, pickAllLowest, randOf } from './select'

/** Maneuver's bias → the generator's favour weights. */
export function biasToFavor(b: ManeuverBias): FavorBias {
  if (b.axis === 'color') return { color: b.value, colorW: BIAS_W }
  if (b.axis === 'shape') return { shape: b.value, shapeW: BIAS_W }
  return { mag: b.value, magW: BIAS_W }
}

const axisValue = (b: ManeuverBias) => (b.axis === 'color' ? cardColor : b.axis === 'shape' ? cardShape : cardMag)

/** Swap the selected tactic. Charges RESET and a spin-up begins — unless the Adaptive Tactics
 *  passive (Warlord) is carried, which keeps the charges and skips the spin-up. */
export function setTactic(s: CombatState, tactic: TacticKind, sink: EventSink): boolean {
  if (!s.running || s.tactic === tactic) return false
  s.tactic = tactic
  if (!s.passives.includes('adaptive')) {
    s.charges = 0
    s.tacticReadyAt = s.now + SWAP_SPINUP_MS
  }
  sink.emit({ type: 'tacticChanged', tactic })
  return true
}

/** Set Maneuver's bias (its sub-UI parameter). Free — the COMMITMENT is the tactic, not the dial. */
export function setBias(s: CombatState, bias: ManeuverBias | null, sink: EventSink): boolean {
  if (!s.running) return false
  s.maneuverBias = bias ? { ...bias } : null
  sink.emit({ type: 'biasChanged', bias: s.maneuverBias })
  return true
}

/** The serial churn — called from the reducer's tick. Spends ONE charge per CHURN_MS: the deadest
 *  live card not already conforming to the bias morphs toward it (standard favour weights, so the
 *  saturation governor applies). Deadest is re-evaluated each spend. */
export function churnTick(s: CombatState, rng: Rng, sink: EventSink): void {
  if (s.tactic !== 'maneuver' || !s.maneuverBias || s.charges <= 0) return
  if (s.now < s.nextChurnAt) return
  const bias = s.maneuverBias
  const get = axisValue(bias)
  const pool = liveSlots(s, (c) => get(c) !== bias.value)
  if (!pool.length) return // board fully conforms (or is saturated) — hold the charge, no waste
  const counts = comboCounts(s)
  const pick = randOf(pickAllLowest(s, pool, (card, i) => counts[i] * 100 + cardMag(card)), rng)
  if (pick == null) return
  s.charges--
  s.nextChurnAt = s.now + CHURN_MS
  transmute(s, [pick], { bias: biasToFavor(bias) }, sink) // calm morph (not hostile) — reforms next tick
}
