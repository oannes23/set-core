# ui/

The new client — a clean, functional rebuild over the engine (TODO.md §A, step 5). It dispatches
`completeSet`/`tick` actions to `engine/` and renders the returned events. No game logic here.

- `app.ts` — start screen (dungeon/foe pickers + class picker from `data/`), the play screen (compact
  board + a side rail: HUD, enemy clock, trap/trick strip, the live ability grid, Tactics buttons,
  passive chips, combat log), click-to-select with set-mate glow, the rAF clock loop, event→feedback
  (log lines, board flashes, ability/tactic casts, passive procs, win/lose/flee/gauntlet), and the
  **coaching layer** (four primitives — pause / section gates / spotlight / popover — + affordance
  arrows + the data-driven guided-intro script over `coachNotify`).
- `styles.css` — the visual layer (cards tinted by colour, shape glyph + number pips; the castable
  panels; the coaching scrim/spotlight/popover/arrows).

Playable today (full combat parity with the prototype's mechanics): board matching vs a foe, the full
trap/trick system, the Tactics meter + buttons, the enemy clock, immune foes, gauntlet runs, **and the
class/ability/passive layer** — pick a class, bank mana, cast mana-gated abilities, spend the armed
Tactics meter — all driven by the engine via `castAbility` / `useTactic`.

Coaching today: the **Tutorial · Guided Intro** dungeon (`guided:true`) runs the staged walkthrough
(read board → make a set → traps → Tactics → ability → ready), and `coach:true` dungeons (Training)
arm the affordance arrows. The freeze gate is UI-side (the loop just stops sending `tick`s — the engine
stays pure).

**Deferred (the prototype keeps these until parity):** an "explain mid-normal-play" tutorial variant
(popovers at first trap-spring / first lock, vs only the staged intro), persisting "seen", the
pre-combat briefing modal, and the prototype's animation polish (card SVGs, burst infographics,
hitstop, spell target previews). This is a functional rebuild, not pixel-parity — `prototype/set-combat.html`
remains the more polished live game during migration.
