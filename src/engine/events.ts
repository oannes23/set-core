/* engine/events — what the engine REPORTS happened during a reduction. The engine is pure: it
   mutates combat state and returns a list of events; the UI (step 5) turns events into renders,
   animations, narration, flashes. No DOM in the engine. This is the engine→UI contract. */

import type { Trigger, FoeRules } from '../data/schema'
import type { TacticKind, ManeuverBias } from './state'

export type CombatEvent =
  | { type: 'setResolved'; damage: number; block: number; boot: number; mana: [number, number, number]; slots: number[] }
  | { type: 'enemyDamaged'; amount: number; immune?: boolean; magic?: boolean } // immune = card damage hit an immune foe; magic = ethereal mana-spent drain
  | { type: 'enemyHealed'; amount: number }
  | { type: 'playerDamaged'; amount: number; absorbed: number; source: string }
  | { type: 'playerHealed'; amount: number }
  | { type: 'playerBlocked' } // an attack fully absorbed / a 0-damage swing
  | { type: 'blockGained'; amount: number }
  | { type: 'blockOverflow'; amount: number } // block past the cap (wasted unless Overflow converts it)
  | { type: 'manaGained'; mana: [number, number, number] }
  | { type: 'manaDrained'; color: number; amount: number }
  | { type: 'chargesGained'; amount: number; source?: 'overflow' } // Tactics charges queued (source='overflow' = excess block)
  | { type: 'chargesDrained'; amount: number } // an enemy effect drained queued/banked charges
  | { type: 'tacticChanged'; tactic: TacticKind } // the player swapped tactics (charges reset unless Adaptive)
  | { type: 'biasChanged'; bias: ManeuverBias | null } // Maneuver's dial moved (free — no reset)
  | { type: 'warded'; what: 'transmute' | 'lock' | 'shatter' } // Stand Ground ate a hostile board verb (1 charge)
  | { type: 'clockChanged'; deltaSeconds: number } // + = pushed later (good), − = sooner (bad)
  | { type: 'enemyStrikes' } // an instant attack was pulled to now
  | { type: 'cardsTransmuted'; slots: number[]; gapMs: number; hostile?: boolean; source?: 'churn' | 'drift' | 'trap' | 'trick' } // hostile = boomed; source = WHO pulled (undefined = a player cast) — the tug-attribution channel
  | { type: 'cardsReformed'; slots: number[] }
  | { type: 'cardsLocked'; slots: number[]; untilMs: number }
  | { type: 'cardsUnlocked'; slots: number[] }
  | { type: 'cardsShattered'; slots: number[] } // wound regen (enemy hit shatters a rune)
  | { type: 'triggerSprung'; trigger: Trigger; label: string } // a trap/trick fired (kind on the trigger)
  | { type: 'abilityCast'; id: string; mana: [number, number, number] } // an ability fired (mana = cost spent)
  | { type: 'abilityFizzled'; id: string } // ability found nothing to act on
  | { type: 'passiveProc'; id: string; label: string } // an always-on passive fired off a match/cast
  | { type: 'consumableUsed'; id: string; name: string } // a potion/scroll was spent
  | { type: 'buffFaded'; id: string; label: string } // a transient buff (Strength/Invisibility/Hourglass) ended/was spent
  | { type: 'fled' } // the player fled combat (Flee tactic)
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
