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

- [x] **5. Low-HP playfield vignette** — DONE. body-level `#ptint` radial overlay,
  warn at ≤70% / red at ≤35% HP, driven by band in `updateBar` (transition-based →
  survives the pause).
- [x] **6. Health gems** — FOLDED into #5: HP-bar glow tints by band (`.fill.php.low/
  .crit`) instead of separate corner gems. (Gems filed for set.crawl town/map.)

## Tier 3 — Card-state nuance
Reads on individual cards beyond the generic crossfade.

- [x] **7. Locked card: stripes + live countdown** — DONE. iron diagonal stripes
  (`.card.locked::before`, card stays legible) + `.lockcd` span patched each frame
  in `updateBar`.
- [x] **8. Empty / "wound" slot during reform** — DONE (rode along with the engine
  wound mechanic). `.card.gap` dashed red pulse while a shattered/transmuting slot
  is on cooldown.
- [x] **9. Transmute its own motion** — DONE. `.card.morph` (calm in-place dissolve)
  for your/trick/drift transmute; enemy-hostile transmute booms instead (⚑B).
- [x] **10. Set-mate glow third tier** — DONE. `.matedim` (dim open mates) added on
  the 2-pick case so the bright completer stands out.
- [x] **11. Card exit spin** — DONE. `cardout` keyframe now rotates ~4° on exit.

## Tier 4 — Coaching / discovery (teaching the trick layer)
Surfacing the threat/trick system so players learn to read the board.

- [x] **12. Trick-line glow + coach chevron** — DONE, **gated behind `V.coach`**
  (real play keeps TRAPS §2.5). `updateTrickLines()` glows makeable trick sets
  (`.card.trickline`) + a `.trickchev` ▼; off while you have a selection.
- [N] **13. On-demand Hint button** — CUT (design call): the flooded board never
  asks "find any set"; tutorial cues teach value-finding instead.

## Tier 5 — Proc flourishes & framing
Smaller polish; cheap wins that add readability.

- [x] **14. Trap/trick strip proc pulse** — DONE. `data-trig` index + `pulseTrig()`
  flashes the named chip on `triggerSprung`; quiet drift stays calm (no flash/burst).
- [x] **15. End-of-combat summary chart** — DONE. `View.stats` tallied in `interpret`,
  rendered as a `.summary` contribution chart in `endScreen` (dealt/taken/blocked/
  healed/sets/traps).
- [x] **16. "Begin combat" CTA bob** — DONE. `.cta.bob` on the begin + engage buttons.
- [x] **17. Board idle desaturate** — DONE. `.board.idle` during a briefing freeze
  (not during coaching, where the board is the lesson).

## Flagged as N/A — confirmed deferred
- **Spell arming pulse** — N/A: the app auto-targets deterministically and shows
  `tgtsure`/`tgtmaybe` hover previews. Revive when Fireball click-to-target lands.

## All parity items resolved.
Built: #1–#12, #14–#17 · folded: #6→#5 · cut: #13 · deferred: arming pulse.
Remaining future work = the 16 enhancement ideas in `UX-FEEL-PLAN.md` (unscheduled).

---

### Already at parity (no action — for reference)
Selection glow, set-mate/complete glow (2-tier), bad-set shake, card enter/leave
crossfade, locked desaturate + 🔒 icon, ability ready/cast/target glows, tactics
meter fill + armed, passive proc, HP/timer bars + warn/crit color & pulse, floating
damage/heal/block/magic numbers, trap/trick/wound full-board flash, trap/trick/wound
bursts, full coaching layer (scrim, spotlight ring, section lock, popover, arrows,
move/color card hints), briefing modal, class picker selection.
