/* engine/passives — always-on character-innate triggers on the event→condition→effect bus
   (GAME-DESIGN §3). No clicks, no mana: they fire automatically off matches / ability casts.
   Ported from the prototype PASSIVES. Pure: mutate state + emit events (a `passiveProc` flourish). */

import type { Rng } from '../core/rng'
import type { CombatState } from './state'
import type { EventSink } from './events'
import type { MatchDescriptor } from './resolve'
import { SHAPE_ATTACK, SHAPE_MOVE } from './resolve'
import { COLOR_RED, COLOR_GREEN, COLOR_BLUE, BIAS_W } from './select'
import { gainBlock, healPlayer, dealAbilityDamage, extendRound } from './ops'

export type PassiveEvent = 'match' | 'ability'

export interface Passive {
  id: string
  name: string
  icon: string
  on: PassiveEvent | 'passive' // 'passive' = hooked elsewhere (Overflow lives in ops.gainBlock)
  desc: string
  /** Match condition (reads the match descriptor). Omitted = fires on every event of its kind. */
  test?: (desc: MatchDescriptor) => boolean
  fire(s: CombatState, rng: Rng, sink: EventSink): void
}

function proc(sink: EventSink, id: string, label: string): void {
  sink.emit({ type: 'passiveProc', id, label })
}

export const PASSIVES: Record<string, Passive> = {
  flameshield: {
    id: 'flameshield', name: 'Flame Shield', icon: '🔥', on: 'match', desc: 'all-red match → +9 Block',
    test: (d) => d.sameColor === COLOR_RED,
    fire(s, rng, sink) { gainBlock(s, 9, rng, sink); proc(sink, 'flameshield', '🛡 +9') },
  },
  permafrost: {
    id: 'permafrost', name: 'Permafrost', icon: '❄️', on: 'match', desc: 'all-blue match → +2s round time',
    test: (d) => d.sameColor === COLOR_BLUE,
    fire(s, _rng, sink) { extendRound(s, 2, sink); proc(sink, 'permafrost', '+2s') },
  },
  photosynthesis: {
    id: 'photosynthesis', name: 'Photosynthesis', icon: '🌿', on: 'match', desc: 'all-green match → +9 HP',
    test: (d) => d.sameColor === COLOR_GREEN,
    fire(s, rng, sink) { healPlayer(s, 9, rng, sink); proc(sink, 'photosynthesis', '+9 hp') },
  },
  bloodlust: {
    id: 'bloodlust', name: 'Bloodlust', icon: '⚔️', on: 'match', desc: 'all-Attack match → +12 damage',
    test: (d) => d.sameShape === SHAPE_ATTACK,
    fire(s, _rng, sink) { dealAbilityDamage(s, 12, sink); proc(sink, 'bloodlust', '⚔ +12') },
  },
  // Hooked directly in ops.gainBlock (not via firePassives) — fires on any block gain, not a match.
  overflow: {
    id: 'overflow', name: 'Overflow', icon: '🛡️', on: 'passive', desc: 'Block past the cap spills into a weighted attack',
    fire() {},
  },
  momentum: {
    id: 'momentum', name: 'Momentum', icon: '🗡️', on: 'match', desc: 'all-Move match → next cards favor Attack',
    test: (d) => d.sameShape === SHAPE_MOVE,
    fire(s, _rng, sink) { s.pendingRegenBias = { shape: SHAPE_ATTACK, shapeW: BIAS_W }; proc(sink, 'momentum', '→⚔') },
  },
  quicken: {
    id: 'quicken', name: 'Quicken', icon: '⏳', on: 'match', desc: 'any all-same-number match → +2s round time',
    test: (d) => d.sameNumber != null,
    fire(s, _rng, sink) { extendRound(s, 2, sink); proc(sink, 'quicken', '+2s') },
  },
  // Hooked directly in combat.applyResolution's charge income (not via firePassives) — v3's total
  // rewrite of Adaptive Tactics: the swap-spin-up it negated died with the round-locked stance.
  combined_arms: {
    id: 'combined_arms', name: 'Combined Arms', icon: '🎯', on: 'passive',
    desc: 'a shape-rainbow set (Attack+Defend+Move) banks +1 bonus Tactics charge',
    fire() {},
  },
  spellecho: {
    id: 'spellecho', name: 'Spell Echo', icon: '⚡', on: 'ability', desc: 'every ability cast → +9 bonus damage',
    fire(s, _rng, sink) { dealAbilityDamage(s, 9, sink); proc(sink, 'spellecho', '⚡ +9') },
  },
}

/** Fire all active passives matching this event. `match` checks the descriptor; `ability` fires all. */
export function firePassives(s: CombatState, event: PassiveEvent, desc: MatchDescriptor | null, rng: Rng, sink: EventSink): void {
  for (const id of s.passives) {
    const p = PASSIVES[id]
    if (!p || p.on !== event) continue
    if (event === 'match' && p.test && (!desc || !p.test(desc))) continue
    p.fire(s, rng, sink)
    if (!s.running) return
  }
}
