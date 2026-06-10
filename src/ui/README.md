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

Playable today: board matching vs a foe, the full trap/trick system, **Tactics v2** (the charge
queue + the Maneuver/Stand Ground toggle with its bias-picker sub-UI — CRAWL §5.5), the enemy
clock, immune foes, gauntlet runs, **and the class/ability/passive layer** — pick a class, bank
mana, cast mana-gated abilities — all driven by the engine via `castAbility` / `setTactic` / `setBias`.

Coaching today: the **Tutorial · Guided Intro** dungeon (`guided:true`) runs the staged walkthrough
(read board → make a set → traps → Tactics → ability → ready), and `coach:true` dungeons (Training)
arm the affordance arrows. The freeze gate is UI-side (the loop just stops sending `tick`s — the engine
stays pure).

Polish in place: **card SVGs** (Lucide glyphs, number = stacked glyph count), the **pre-combat briefing
modal** (before Engage + between gauntlet foes), **floating combat numbers**, an **impact hitstop**, a
**centered burst** for sprung traps/tricks + player hits, and **spell target previews** (hover an ability
→ ring the cards it would hit, via the engine's pure `ABILITY_PREVIEW`).

**At parity — step 5 is complete.** Still optional/future (not parity gaps): an "explain mid-normal-play"
tutorial variant (popovers at first trap-spring / first lock, vs only the staged intro) + persisting
"seen" (tracked in TODO §3). `prototype/set-combat.html` is retained as the migration oracle.
