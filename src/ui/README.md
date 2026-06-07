# ui/

The new client — a clean, functional rebuild over the engine (TODO.md §A, step 5). It dispatches
`completeSet`/`tick` actions to `engine/` and renders the returned events. No game logic here.

- `app.ts` — start screen (dungeon/foe pickers from `data/`), the play screen (board, HUD, enemy
  clock, trap/trick strip), click-to-select with set-mate glow, the rAF clock loop, and event→feedback
  (log lines, board flashes, win/lose/gauntlet).
- `styles.css` — the visual layer (cards tinted by colour, shape glyph + number pips).

Playable today: board matching vs a foe, the full trap/trick system, the Tactics meter, the enemy
clock, immune foes, and gauntlet runs — all driven by the engine.

**Deferred (the prototype keeps these until parity):** abilities/classes/passives UI (waiting on the
engine ability roster), the coaching layer + guided tutorial, the pre-combat briefing, and the
prototype's animation polish (card SVGs, burst infographics, hitstop). This is a functional rebuild,
not pixel-parity — `prototype/set-combat.html` remains the polished live game during migration.
