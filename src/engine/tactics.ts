/* engine/tactics — the Tactics buttons. Move matches fill the meter (see ops.addTactics); at full it
   arms a row of one-shot tactics that transmute the whole board toward an axis, then spend the meter.
   Ported from the prototype TACTICS. Flee bails the encounter (the UI confirms before dispatching). */

import type { Rng } from '../core/rng'
import type { CombatState } from './state'
import type { EventSink } from './events'
import { SHAPE_ATTACK, SHAPE_DEFEND } from './resolve'
import { transmute } from './triggers'
import { COLOR_RED, COLOR_GREEN, COLOR_BLUE, BIAS_W, cardColor, cardShape, liveSlots } from './select'

interface Tactic {
  key: string
  name: string
  run(s: CombatState, rng: Rng, sink: EventSink): void
}

export const TACTICS: Record<string, Tactic> = {
  strike: { key: 'strike', name: 'Strike', run(s, _r, sink) { transmute(s, liveSlots(s, (c) => cardShape(c) !== SHAPE_ATTACK), { bias: { shape: SHAPE_ATTACK, shapeW: BIAS_W, mag: 2, magW: BIAS_W } }, sink) } },
  dodge: { key: 'dodge', name: 'Dodge', run(s, _r, sink) { transmute(s, liveSlots(s, (c) => cardShape(c) !== SHAPE_DEFEND), { bias: { shape: SHAPE_DEFEND, shapeW: BIAS_W, mag: 2, magW: BIAS_W } }, sink) } },
  heat: { key: 'heat', name: 'Heat Up', run(s, _r, sink) { transmute(s, liveSlots(s, (c) => cardColor(c) !== COLOR_RED), { bias: { color: COLOR_RED, colorW: BIAS_W } }, sink) } },
  chill: { key: 'chill', name: 'Chill Out', run(s, _r, sink) { transmute(s, liveSlots(s, (c) => cardColor(c) !== COLOR_BLUE), { bias: { color: COLOR_BLUE, colorW: BIAS_W } }, sink) } },
  wild: { key: 'wild', name: 'Go Wild', run(s, _r, sink) { transmute(s, liveSlots(s, (c) => cardColor(c) !== COLOR_GREEN), { bias: { color: COLOR_GREEN, colorW: BIAS_W } }, sink) } },
}

/** Spend the armed Tactics meter on a tactic. Flee ends the encounter (result 'flee'); the others
 *  reshape the board and reset the meter. No-op unless armed. Returns whether it fired. */
export function useTactic(s: CombatState, key: string, rng: Rng, sink: EventSink): boolean {
  if (!s.running || !s.tacticsArmed) return false
  if (key === 'flee') {
    s.running = false
    s.result = 'flee'
    sink.emit({ type: 'tacticUsed', key })
    sink.emit({ type: 'fled' })
    return true
  }
  const t = TACTICS[key]
  if (!t) return false
  sink.emit({ type: 'tacticUsed', key })
  t.run(s, rng, sink)
  s.tactics = 0 // firing any tactic empties the meter
  s.tacticsArmed = false
  sink.emit({ type: 'tacticsReset' })
  return true
}
