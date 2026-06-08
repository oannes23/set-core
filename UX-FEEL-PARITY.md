# UX feel parity — prototype → `src/` app

Visual feedback elements in `prototype/set-combat.html` that act as **flow / feel
guides** (flashes, glows, tints, pops, telegraphs) and are **missing or weaker**
in the live modular app (`src/ui/app.ts` + `src/ui/styles.css`).

How to use: skim, then mark each. **Legend:** `[ ]` = decide · `[Y]` = build it ·
`[N]` = skip · `[~]` = build a variant (note it). Add inline notes after `—`.

> Two root causes account for most of the list:
> 1. **All card changes share one generic crossfade** (`app.ts:320-356`: ghost-out
>    + fade-in). Resolving a set, destroying a card, and transmuting all look
>    identical — the prototype gave each its own verb-specific motion.
> 2. **The end screen is text-only** (`app.ts:731`) and several **ambient danger
>    cues never made it over** (HP vignette, health gems).

---

## Tier 1 — Core action "juice" (resolving sets & taking hits)
The moment-to-moment feedback that makes an action *land*. Highest impact.

- [x] **1. Set-success green pop** — DONE. `.card.pop` (green ring + scale-up,
  fades upward) via the slot→verb map. `styles.css` cardpop keyframe.
- [x] **2. Card destruction "boom"** — DONE. `.card.boom` (brightness surge +
  burst outward) on the new engine **shatter** verb (a landed standard attack
  shatters a rune). `styles.css` cardboom keyframe.
- [x] **3. HP number flash on damage** — DONE. `flashStat()` punches `#phpv`
  (you hit) / `#ehpv` (you strike). `styles.css` stathit keyframe.
- [x] **4. Trap-specific board shake** — DONE. light shake on `ft`/`fk` (traps/
  tricks) vs heavy `fw` (wounds) — kinetic weight ∝ severity.

## Tier 2 — Ambient danger / pressure (the "I'm in trouble" feel)
Background cues that build dread as HP drops, independent of any single hit.

- [ ] **5. Low-HP playfield vignette** — playfield never tints as you get low.
  *Prototype:* radial gradient overlay fades in — yellow at 35–70% HP, red below
  35%. `.ptint` (~L460), set in JS by HP band.
- [ ] **6. Health gems (pulse + color shift)** — corner gems that recolor by HP
  band (blue→green→yellow→red) and pulse faster as HP drops. Absent entirely.
  `@keyframes gempulse`, `.gem`, `body.hp-danger/.hp-crit` (~L471).
  *(May overlap with #5 + the HP bar — decide if both are wanted.)*

## Tier 3 — Card-state nuance
Reads on individual cards beyond the generic crossfade.

- [ ] **7. Locked card: stripes + live countdown** — new app shows desaturate +
  🔒, but no diagonal-stripe overlay and **no countdown** of remaining lock time.
  *Prototype:* stripe overlay + `.lockcd` countdown span (~L129).
- [ ] **8. Empty / "wound" slot during reform** — when a card is destroyed and
  reforming, new app just refills via crossfade. *Prototype:* dashed faded gap
  shows the hole during the cooldown. `.card.gap` (~L138).
- [ ] **9. Transmute its own motion** — transmute reuses the generic crossfade;
  no verb-specific tell that a card *changed* rather than *left*. (No prototype
  keyframe — flagged as a design opportunity, since transmute is a headline verb.)
- [ ] **10. Set-mate glow third tier** — new app has 2 glow levels (`mate`,
  `complete`); prototype has 3: faint on 1-card pick, dim mates + bright completer
  on 2-card pick (`setGlow` slight/dim/bright, ~L1207). Minor refinement.
- [ ] **11. Card exit spin** — prototype's leaving card rotates ~4°; new exit is
  scale+fade only. Cosmetic.

## Tier 4 — Coaching / discovery (teaching the trick layer)
Surfacing the threat/trick system so players learn to read the board.

- [ ] **12. Trick-line glow + coach chevron** — in coaching mode the prototype
  highlights *makeable sets that would spring a favorable trick* with a green
  pulsing line + bobbing ▼ over the middle card. New app coaching never points at
  tricks on the board. `@keyframes tricklinepulse`/`coachbob`, `.card.trickline`,
  `.coach-arrow` (~L526, L377).
- [ ] **13. On-demand Hint button** — prototype has a Hint button that pulses a
  valid set yellow. New app has no on-demand hint (only scripted tutorial text).
  `@keyframes hintpulse`, `.card.hint` (~L120). *Decide if this belongs in the
  real game or was a prototype-only crutch.*

## Tier 5 — Proc flourishes & framing
Smaller polish; cheap wins that add readability.

- [ ] **14. Trap/trick strip proc pulse** — when a trap fires, its chip in the
  strip should pulse so the player connects the flash to the named trap. New
  strip is static. `@keyframes trapproc/trickproc`, `.trap.proc` (~L352, L524).
- [ ] **15. End-of-combat summary chart** — new end screen is just
  "★ Victory / ✖ Defeat" (`app.ts:731`). Prototype shows a per-feature
  contribution bar chart with swatches. `.summary`, `.feat .bar` (~L540).
- [ ] **16. "Begin combat" CTA bob** — prototype's start CTA bobs to draw the eye.
  `@keyframes bob` (~L158). Cosmetic.
- [ ] **17. Board idle desaturate** — prototype dims/desaturates the board when
  combat isn't running (setup/end). `.board.idle` (~L149). Cosmetic.

## Flagged as likely N/A (confirm)
- **Spell arming pulse** (`.slot.spell.arming`, `armpulse`, ~L145) — the prototype
  had a click-to-target *arm* step. The new app auto-targets abilities
  deterministically (`engine/abilities.ts`) and already shows `tgtsure`/`tgtmaybe`
  hover previews, so the armed-slot pulse is probably moot. **Confirm there's no
  click-to-target path you still want.**

---

### Already at parity (no action — for reference)
Selection glow, set-mate/complete glow (2-tier), bad-set shake, card enter/leave
crossfade, locked desaturate + 🔒 icon, ability ready/cast/target glows, tactics
meter fill + armed, passive proc, HP/timer bars + warn/crit color & pulse, floating
damage/heal/block/magic numbers, trap/trick/wound full-board flash, trap/trick/wound
bursts, full coaching layer (scrim, spotlight ring, section lock, popover, arrows,
move/color card hints), briefing modal, class picker selection.
