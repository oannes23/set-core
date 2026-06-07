# engine/

The combat engine: **pure, deterministic, DOM-free**. `reduce(state, action, deps) → {state, events}`
over `core/` (generation) and `data/` (content). The UI dispatches actions and renders events.

- `state.ts` — `CombatState`, `FoeRuntime`, clock-cap, tactics constants.
- `events.ts` — `CombatEvent` union (the engine→UI contract) + `EventSink`.
- `resolve.ts` — `resolveSet` / `matchDescriptor` / `weightedRoll` (set → combat effects).
- `triggers.ts` — the trigger bus: `condMet`, `selectSlots` (geometry ∩ value), the effect vocabulary
  (damage/heal/drain/advance/delay/transmute/lock), `fireTriggers`, `enemyAttack`, `hurtPlayer`.
- `foe.ts` — `assembleFoe` (creature ⊕ variant ⊕ template → runtime) + speed bands.
- `combat.ts` — the reducer: `createCombat`, `completeSet`, `tick`, tactics, gauntlet advance, `cloneState`.

Determinism: time is explicit (`now`, advanced by `tick`) and the RNG is injected — same seed + same
actions → identical state (tested). This is the step-6 seam: clients replay actions; a server can be
the authority later. Tested in `engine.test.ts` (resolution, conditions, selectors, board verbs, foe
assembly, the clock, immunity, gauntlet advance, determinism).

**Not yet ported (remaining engine surface):** the ability roster + classes + passives, and the
Tactics *buttons* (Strike/Dodge/etc — board transmutes). They reuse these same primitives (transmute,
damage, mana, selectors); adding them is `castAbility` / `useTactic` actions over the existing bus.
