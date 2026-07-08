/* engine/tactics — TACTICS v3 + the §5.7 LIVE-BURN amendment: the charge bank and the two stances,
   now applied LIVE (the round-lock/queue retired). Charges accumulate in EVERY stance (+1 per Move
   card). The stances differ in how they spend the bank:
   • Stand Ground (banker) — spends LIVE: each hostile board verb fizzles for 1 charge, an incoming
     wound for 3 (ops.tryWard); its remainder CARRIES.
   • Maneuver (dumper → BURNER) — never wards; after a short GATHER it burns ~1 charge/sec LIVE
     (tick → liveBurn): each burn redraws the single deadest card NOT already matching the bias.
   Swapping is asymmetric (§5.7): entering Maneuver pays the gather (damps wheel-drumming); bailing
   to Stand Ground is INSTANT and keeps the remainder (the panic button always works). v2/v3-lock
   history in CRAWL §5.5/§5.6. */

import type { Rng } from '../core/rng'
import type { FavorBias } from '../core/generate'
import type { CombatState, TacticKind, ManeuverBias } from './state'
import { MANEUVER_GATHER_MS } from './state'
import type { EventSink } from './events'
import { transmute } from './triggers'
import { BIAS_W, cardColor, cardShape, cardMag, liveSlots, comboCounts, protectedSlots } from './select'

/** Maneuver's bias → the generator's favour weights. */
export function biasToFavor(b: ManeuverBias): FavorBias {
  if (b.axis === 'color') return { color: b.value, colorW: BIAS_W }
  if (b.axis === 'shape') return { shape: b.value, shapeW: BIAS_W }
  return { mag: b.value, magW: BIAS_W }
}

const axisValue = (b: ManeuverBias) => (b.axis === 'color' ? cardColor : b.axis === 'shape' ? cardShape : cardMag)

/** Set the stance LIVE (§5.7 — no queue). Entering Maneuver starts the GATHER (burns begin after it);
 *  bailing to Stand Ground is instant and keeps the banked charges. A no-op if already in `tactic`. */
export function setTactic(s: CombatState, tactic: TacticKind, sink: EventSink): boolean {
  if (!s.running || tactic === s.tactic) return false
  s.tactic = tactic
  s.burnAccum = 0
  s.maneuverGatherUntil = tactic === 'maneuver' ? s.now + MANEUVER_GATHER_MS : 0 // gather only on ENTERING the tide
  sink.emit({ type: 'tacticChanged', tactic })
  return true
}

/** Set the Maneuver dial LIVE. Changing the bias mid-tide does NOT re-gather (you're already churning). */
export function setBias(s: CombatState, bias: ManeuverBias | null, sink: EventSink): boolean {
  if (!s.running) return false
  s.maneuverBias = bias ? { ...bias } : null
  sink.emit({ type: 'biasChanged', bias: s.maneuverBias })
  return true
}

/** One LIVE Maneuver burn (§5.7, called from tick on the ~1/s cadence): spend 1 charge to redraw the
 *  single deadest live card NOT already matching the bias toward it. Returns false (spending nothing)
 *  when there's no bias or no non-matching card left — the board is already yours, so hold the ammo. */
export function liveBurn(s: CombatState, rng: Rng, sink: EventSink): boolean {
  if (s.tactic !== 'maneuver' || s.charges <= 0) return false
  const bias = s.maneuverBias
  if (!bias) return false
  const get = axisValue(bias)
  // E5: exclude rule-6-shielded slots (a selected card or its set-mate) up front. `transmute` would
  // silently skip them (source:'churn' is shield-filtered) — so without this we'd spend a charge and
  // spuriously mark the card Primed for a churn that never happened. Empty pool ⇒ hold the ammo.
  const shield = protectedSlots(s)
  const pool = liveSlots(s, (c) => get(c) !== bias.value).filter((i) => !shield.has(i))
  if (!pool.length) return false
  const counts = comboCounts(s)
  const cost = (i: number) => counts[i] * 100 + cardMag(s.board[i]!)
  const pick = pool.reduce((best, i) => (cost(i) < cost(best) ? i : best), pool[0]) // the single deadest
  s.charges -= 1
  transmute(s, [pick], { bias: biasToFavor(bias), source: 'churn' }, sink) // calm morph — reforms shortly after
  s.primed[pick] = s.now // §7 Primed: this churned card, if matched within the window, counts a tier higher
  sink.emit({ type: 'tacticsBurned', churned: 1, remaining: s.charges })
  return true
}
