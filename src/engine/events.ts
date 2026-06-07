/* engine/events — what the engine REPORTS happened during a reduction. The engine is pure: it
   mutates combat state and returns a list of events; the UI (step 5) turns events into renders,
   animations, narration, flashes. No DOM in the engine. This is the engine→UI contract. */

import type { Trigger, FoeRules } from '../data/schema'

export type CombatEvent =
  | { type: 'setResolved'; damage: number; block: number; boot: number; tactics: number; mana: [number, number, number]; slots: number[] }
  | { type: 'enemyDamaged'; amount: number; immune?: boolean } // immune = card damage hit an immune foe
  | { type: 'enemyHealed'; amount: number }
  | { type: 'playerDamaged'; amount: number; absorbed: number; source: string }
  | { type: 'playerBlocked' } // an attack fully absorbed / a 0-damage swing
  | { type: 'blockGained'; amount: number }
  | { type: 'manaGained'; mana: [number, number, number] }
  | { type: 'manaDrained'; color: number; amount: number }
  | { type: 'tacticsGained'; amount: number }
  | { type: 'tacticsDrained'; amount: number }
  | { type: 'tacticsArmed' }
  | { type: 'tacticsReset' }
  | { type: 'clockChanged'; deltaSeconds: number } // + = pushed later (good), − = sooner (bad)
  | { type: 'enemyStrikes' } // an instant attack was pulled to now
  | { type: 'cardsTransmuted'; slots: number[]; gapMs: number }
  | { type: 'cardsReformed'; slots: number[] }
  | { type: 'cardsLocked'; slots: number[]; untilMs: number }
  | { type: 'cardsUnlocked'; slots: number[] }
  | { type: 'cardsShattered'; slots: number[] } // wound regen (enemy hit shatters a rune)
  | { type: 'triggerSprung'; trigger: Trigger; label: string } // a trap/trick fired (kind on the trigger)
  | { type: 'foeChanged'; name: string; rules: FoeRules } // gauntlet advanced to a new foe
  | { type: 'won' }
  | { type: 'lost' }

/** A small mutable sink the engine pushes events into during a reduction. */
export class EventSink {
  readonly events: CombatEvent[] = []
  emit(e: CombatEvent): void {
    this.events.push(e)
  }
}
