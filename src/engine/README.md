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
- `abilities.ts` — the ability roster (pure DOM-free casts) + `castAbility` (afford → spend → cast →
  ability-passives).
- `tactics.ts` — **Tactics v2** (CRAWL-DESIGN.md §5.5): the charge queue + the two tactics
  (Maneuver's serial deadest-card churn, Stand Ground's banked interception) + swap/spin-up.
- `consumables.ts` — one-use potions + scrolls (a free cast of any ability), via the
  replay-deterministic `useConsumable` action.
- `combat.ts` — the per-combat reducer: `createCombat`, `completeSet`, `tick`,
  `castAbility`/`useTactic` actions, `cloneState`.
- `run.ts` — the RUN layer: `RunState`/`runReduce` compose combats into a run (sequence advance,
  the progression that used to live in the UI's `onWin`).
- `session.ts` — the replay seam: a session records actions and replays them **through `runReduce`**
  (seed + actions → identical run), so a server can be the authority later.

Determinism: time is explicit (`now`, advanced by `tick`) and the RNG is injected — same seed + same
actions → identical state (tested in `engine.test.ts`, `seam.test.ts`, `engine.fuzz.test.ts`:
resolution, conditions, selectors, board verbs, foe assembly, the clock, determinism).
