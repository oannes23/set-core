# engine/

The combat engine: **pure, deterministic, DOM-free**. `reduce(state, action, deps) → {state, events}`
over `core/` (generation) and `data/` (content). The UI dispatches actions and renders events.

- `state.ts` — `CombatState`, `FoeRuntime`, clock-cap, tactics constants.
- `events.ts` — `CombatEvent` union (the engine→UI contract) + `EventSink`.
- `resolve.ts` — `resolveSet` / `matchDescriptor` / `weightedRoll` (set → combat effects).
- `triggers.ts` — the trigger bus: `condMet`, `selectSlots` (geometry ∩ value), the effect vocabulary
  (damage/heal/drain/advance/delay/transmute/lock), `fireTriggers`, `enemyAttack`, `hurtPlayer`.
- `foe.ts` — `assembleFoe` (creature ⊕ variant ⊕ template → runtime) + speed bands.
- `select.ts` — pure board-targeting toolkit (live/wounded slots, deadest-card auto-target, preference
  picks, the Fireball blast footprint). Shared by triggers, abilities, and tactics; Rng-injected.
- `ops.ts` — shared combatant ops (block w/ Overflow spill, tactics, heal, ability damage, the ethereal
  mana-spent hook, clock push) used by the reducer + abilities + passives + tactics.
- `passives.ts` — the 9 always-on passives + `firePassives` (fire on `match` / `ability`).
- `abilities.ts` — the 17-ability roster (pure DOM-free casts) + `castAbility` (afford → spend → cast →
  ability-passives).
- `tactics.ts` — the 6 Tactics buttons (strike/dodge/heat/chill/wild/flee) + `useTactic`.
- `combat.ts` — the reducer: `createCombat`, `completeSet`, `tick`, `castAbility`/`useTactic` actions,
  gauntlet advance, `cloneState`.

Determinism: time is explicit (`now`, advanced by `tick`) and the RNG is injected — same seed + same
actions → identical state (tested). This is the step-6 seam: clients replay actions; a server can be
the authority later. Tested in `engine.test.ts` (resolution, conditions, selectors, board verbs, foe
assembly, the clock, immunity, gauntlet advance, determinism).

**Step 4 is now complete:** the ability roster (17), passives (9), and Tactics buttons (6) are ported
as `castAbility` / `useTactic` actions over the same bus, and the 9 classes live in `data/classes.ts`
(loadouts of these ids, integrity-gated against the registries). The engine is at full combat parity
with the prototype; what remains is the UI (step 5): the ability/passive/class panels + coaching.
