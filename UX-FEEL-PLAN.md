# UX feel — implementation plan

Build plan to close the gaps in `UX-FEEL-PARITY.md`, grounded in a game-design
pass and a technical wiring map. Companion to that file (item numbers `#N` refer
to it). Source analyses: design judgment + `src/` event/render wiring.

---

## 0. Decisions baked in (from the design pass)

These change the scope vs the raw parity list — confirm before building:

| # | Item | Decision | Why |
|---|------|----------|-----|
| **#13** | On-demand Hint button | **CUT** from the real game | Board is intentionally flooded (~18 sets); "find any set" is the trivial case the design abandoned. A real hint would point at *value*, which is a different feature. Tutorial already teaches via Move/color cues. |
| **#6** | Health gems | **FOLD into #5** | 3 HP channels (bar + vignette + gems) over-encodes one variable. Keep the ambient vignette; add a band-tinted glow on the HP bar as the second read. File gems for set.crawl town/map screens. |
| **#12** | Trick-line glow | **GATE behind `V.coach`** | TRAPS §2.5 invariant: never highlight *which* on-board set satisfies a rule in real play — that's the skill being sold. Tutorial/training only. |
| N/A | Spell arming pulse | **Defer** | App auto-targets deterministically; `tgtsure`/`tgtmaybe` hover already covers it. Revive when Fireball click-to-target lands. |

**Two genuine decision points needing your call (flagged ⚑ below):**
- **⚑A — Revive the "enemy hit shatters a card" mechanic?** `cardsShattered`,
  `DMG_REGEN_MS`, and the damage→pending-slot path are **dead code** in the engine
  today; enemy hits only touch HP/block, never the board. The prototype's boom (#2)
  and wound-gap (#8) both *live* on this mechanic. Either (a) revive it (small,
  replay-safe engine change — best feel, makes #2/#8 first-class), or (b) scope boom
  to existing transmute-destroy paths only and drop #8.
- **⚑B — How to tag *hostile* destruction?** To make boom mean "a card was taken
  from you" vs "you churned the board," enrich the `cardsTransmuted`/`cardsShattered`
  *event* with a `cause`/`hostile` field (UI hint only, stays out of replay state).

---

## The core idea: motion = verb, color/direction = wielder

The root cause of most gaps: **one generic crossfade** (`app.ts:316-361`) makes the
four board verbs (TRAPS §5) visually synonymous. The fix is a shared vocabulary:

| Verb | Motion (what happened) | Player-wielded | Enemy-wielded |
|------|------------------------|----------------|---------------|
| **Resolve** | scale-up **pop → fade upward** (cashing in) | green ring, up | — |
| **Destroy** | **boom**: brightness surge → scale → burst **outward** | your action color + forward shove | red + inward recoil, feeds wound channel |
| **Transmute** | **morph-in-place** (card stays, identity cross-dissolves with a color-wash sweep) | toward your bias color, calm | toward dungeon theme color, **directional telegraph** (column-lance vs row-wipe per TRAPS §5.4) |
| **Lock** | **settle-and-hold**: stripes + padlock + live countdown, card stays **legible** | protective/iron-cool seal (banked) | denial framing, countdown as taunt |

Lock keeps the card *readable* on purpose — its whole identity is "read it, can't
take it" (TRAPS §5.2). The geometry telegraph reuses the existing `tgtsure`/`tgtmaybe`
rings; its width/heft scales with tier (minion lance → boss wall-wipe).

## Feedback priority (so simultaneous effects stay legible)

A Pyromancer's all-red match can, in one click, resolve a set + bank mana + spring
a trap + provoke a reactive enemy transmute. Render in salience layers, highest wins
center stage, and **stagger stacked beats ~60–80ms** (pop → trap burst → transmute
settle) using `hitstop()` (120–150ms) to sequence rather than composite:

1. **HP loss** — loudest: red vignette + heavy shake + HP-number flash + hitstop.
2. **Trap/trick sprung** — named burst + medium flash + light shake (the teaching beat).
3. **Your action resolving** — local to cards/slot, no full-screen layer.
4. **Board reshape** (destroy/transmute/lock) — per-card motion only.
5. **Ambient** (HP vignette, timer pulse) — steady-state tints, never transition-animated.

**Color de-overload:** red currently means card-color-0 + wound + enemy-HP + `tgtsure`
targeting (4 jobs). Reserve *saturated full-screen* red for "you took damage"; move
ability-target rings onto **warn/gold** (targeting is intent, not threat); protect
teal for selection only; keep transmute off gold.

---

## Build phases (design-value order)

### Phase 0 — Foundation (keystone; unlocks Phase 1)
- **0a. Slot→verb map.** In `dispatch` (`app.ts:518-526`), build `Map<slot, verb>`
  from the events the engine *already emits but the UI ignores*: `setResolved.slots`
  → resolve, `cardsTransmuted.slots` → transmute, `cardsLocked.slots` → lock,
  `cardsShattered.slots` → destroy. Pass to `renderBoard(verbBySlot)`; pick the
  enter/leave keyframe per slot. Resolve per-slot precedence (one cast can emit
  several). **Pure-UI.** *This single change unlocks #1, #2, #9.*
- **0b. Feedback arbiter.** Centralize full-screen channels (flash/burst/hitstop)
  through one dispatcher that coalesces same-frame events and applies the stagger +
  priority above. Extend `flash()` to clear any new classes it adds (`app.ts:625`).
- **0c. Color rebalance.** Move `tgtsure` off `--red` onto `--warn`/`--gold`
  (`styles.css:197`, `app.ts:790`).

### Phase 1 — Core action juice (verbs get faces)
- **#2 Destruction boom** — `.card.boom` (brightness 2.4× → scale → burst out).
  Hooks the destroy verb. ⚑A/⚑B: with revive, keys off `cardsShattered`+hostile tag;
  without, keys off `cardsTransmuted`. Engine touch only for the hostile tag (event
  payload). *Top priority — fixes the inverted "destruction looks like success" bug.*
- **#9 Transmute morph-in-place** — new keyframe; card holds its slot, cross-dissolves
  with a directional color-wash. Pure-UI via 0a (`cardsTransmuted` already flows).
- **#1 Set-success pop** — `.card.leave.good` green ring + `pop`. Pure-UI via 0a.
- **#3 HP number flash** — re-trigger a `.stat.hit` scale on `phpv`/`ehpv` using the
  `pulsePassive` reflow idiom (`app.ts:669-675`). Hooks `playerDamaged`/`enemyDamaged`.
- **#4 Trap-specific shake** — add translate to `ft`/`fk` (light) vs `fw` (heavy)
  via `flash()` (`app.ts:622-628`). `triggerSprung` already carries `kind`.

### Phase 2 — Teaching the threat layer
- **#14 Strip proc pulse** — add `data-trig` index in `renderStrip` (`app.ts:305-308`),
  pulse the matching chip on `triggerSprung` (pulsePassive idiom). Builds the
  named-rule → flash association. *The condition "verb" lives here.*
- **#7 Lock stripes + live countdown** — stripe overlay on `.card.locked`; `.lockcd`
  span whose text is patched each frame from `s.locked.get(i) - s.now` inside
  `updateBar` (do NOT re-render the board per tick). Freeze-correct: `s.now` holds
  during pause. Keep the card legible under the overlay.

### Phase 3 — Ambient danger (set.crawl tension)
- **#5 Low-HP vignette** — overlay placed **outside `.wrap`** (so the freeze rule
  `styles.css:186` doesn't kill it), opacity/hue driven by HP band in `updateBar`.
  Second read: tint the player HP-bar glow by band (the folded-in #6).

### Phase 4 — Progression & framing
- **#15 End-of-combat summary chart** — add a stats accumulator to `View`
  (`app.ts:71-90`), tally in `interpret` (`app.ts:528`; no totals exist today),
  render `.summary`/`.feat .bar` in `endScreen` (`app.ts:727`). Read totals before
  the rAF is cancelled. Replay-safe (UI-only).

### Phase 5 — Card-state nuance & polish tail
- **#8 Wound-slot gap** — ⚑A only. Engine: emit `cardsShattered` + set `pending`/
  `reformAt` (`DMG_REGEN_MS`) on enemy hit (`triggers.ts:288-314`); include `pending`
  in `boardSignature` (`app.ts:314`). UI: render pending slots as `.card.gap`
  (dashed). *Pairs with #2 — same engine change serves both.*
- **#10 Third glow tier** — add a faint 1-pick class; branch at `app.ts:352-354`
  off `glowSet`'s existing `{set, complete}`.
- **#11 Card exit spin** — add rotation to `cardout` (`styles.css:182`).
- **#16 CTA bob** — `@keyframes bob` on `.cta` (`app.ts:135`).
- **#17 Board idle desaturate** — `.board.idle` toggled at briefing/end (`updateBar`).

### Phase 6 — Discovery (coach-gated)
- **#12 Trick-line glow + chevron** — gated behind `V.coach`. Reuse `paintCardCue`
  (`app.ts:479-505`) + `setCoachArrow` (`app.ts:510-515`); compute matchable trick
  sets via exported engine predicates `findSets` + `matchDescriptor` + `condMet`.

---

## Cross-cutting rules (apply to every effect)
- **Survive the pause.** Effects animating *inside* `.wrap` must self-remove on
  `animationend`, never `setTimeout` (which fires mid-freeze). Ambient effects go
  *outside* `.wrap` or use transitions, not CSS animations. (`styles.css:186`.)
- **Replay stays pure.** Visual data rides *events*, never `CombatState`. The only
  engine touches are enriching event payloads (⚑B) and the optional wound mechanic (⚑A).
- **Reuse infra:** `flash()`, `burst()`, `floatBoard()`, `hitstop()`, `pulsePassive()`,
  `setCoachArrow()`, `paintCardCue()`, `glowSet()`, the `updateBar()` per-frame seam.
- **Match conventions:** terse lowercase keyframes; color vars `--red/--green/--blue/
  --phos/--gold/--trick/--warn/--c0..2`; one-shot animation + reflow re-arm idiom.

## Suggested parallelization
- **Track A (no engine):** Phase 0 → Phase 1 (#9,#1,#3,#4) → Phase 2 → Phase 3.
- **Track B (engine, ⚑A/⚑B):** the shatter/hostile change → unblocks #2 + #8 together.
- Phase 4, 5-tail, and Phase 6 are independent and can slot in any time after Phase 0.

---

## Further enhancements (beyond the gap list)

Curated from the design pass + my own. `S/M/L` = rough cost. ★ = my top picks.

### Teach the invisible rules (highest design leverage)
- **★ Mana-gain spark trail (S).** Fly colored sparks from resolved cards to the
  matching mana pip — makes the "match color → mana" economy visible. Teaches
  color-targeting, the core of ability play.
- **★ Severity-scaled flash radius (S).** Drive the trap-flash vignette radius/
  intensity off the consequence tier — tick-tax barely tints, boss strike whites out
  half the screen. Renders the master rarity↔severity tuning law (TRAPS §1) as *felt*.
  One parameter on the existing flash.
- **Value heat on card border (S).** Subtly brighten a card's own-color border by how
  many sets it currently anchors — teaches "this is a hub card" without highlighting
  any specific set (stays right of the §2.5 line; it reads *cards*, not *sets*).
- **Trap-armed anticipation pulse (M).** When the board *contains* a set that would
  spring an active trap, pulse the **trap's strip chip** (not the cards) — warns
  "danger exists now" while keeping *which* line a reading challenge. The §2.5 sweet spot.
- **Saturation-cap fizzle (M).** When enemy drift hits the f=3 cap and can't flood
  further, the would-be-warped cards visibly *fizzle* — makes the invisible governor
  (why f=3 is locked) legible as "the board fights back."

### Make the enemy feel devious (legibility of coordinated threats)
- **★ Reactive-transmute ripple-from-the-match (M).** When a foe transmutes in
  response to your match, originate the warp *from the cards you just played* — cause→
  effect made spatial ("my greedy match caused this").
- **Herding connector flash (M, coach-gateable).** On the full squeeze (transmute→red
  + lock blues + punish red), draw a one-frame ghost line from locked escape cards to
  the tempting ones — the three-rule squeeze reads as *one* intentional move.
- **Bait shimmer on theme color (M).** As drift floods toward the dungeon value, give
  those cards a faint, slightly-wrong tempting shimmer — renders the "it's baiting you"
  psychology; you *feel* the lure you're meant to resist.

### Reward & tactility
- **★ Clock-shove kickback (S).** When a Move match shoves the attack timer back,
  animate the bar *recoiling* (a chunk pushed right) — makes tempo a tactile reward.
- **"Almost" breath on the third pick (S).** When the completer exists, give it a held
  breath-in glow that releases on click — micro-anticipation on every match.

### set.crawl progression feel (route into the crawl build)
- **★ Cross-room HP carry banner (S).** Between rooms, show HP as the *only* thing that
  persists — one bar sliding into the next room while mana/Tactics evaporate. Teaches
  the §8 attrition model wordlessly.
- **Dread accumulation fog (M).** For tick-dread foes, a faint grain creeps in at the
  board edges each tick and clears on room exit — "delay rots your board," felt.
- **Foe-composition reveal stagger (S).** Animate the briefing's foe in as layers —
  base creature → variant adjective snaps on → dungeon template washes over — priming
  players to read foes as *builds* (base ⊕ variant ⊕ template).
- **"Counters your build" pre-combat sting (M).** When a foe's trap condition matches
  your build's signature match, flag it in the briefing — turns a feel-bad fight into a
  readable challenge.
- **Run-level contribution chart (L).** Extend #15 across a whole run, emphasizing
  build *shape* over rising numbers — makes a deep run feel like a refined engine, not
  a bigger one (supports no-power-creep design).

---

## Build status — combat-feel pass 2

**Bug fixed:** the HUD bars (HP / Tactics / attack timer) were empty — `.fill` spans
were `display:inline`, so width/height were ignored. Now `display:block`.

**Shipped enhancements:** ★ mana-gain spark trail · ★ severity-scaled flash (wound
radius ∝ damage; non-damaging traps stay a nibble) · value heat on card border
(subtle inset, reads cards not sets) · trap/trick-armed chip pulse (§2.5-safe) ·
★ reactive-transmute ripple · bait shimmer on the drift colour · ★ clock-shove
kickback · "almost" breath on the completer · foe-composition reveal stagger
(briefing) · "counters your build" briefing sting.

**Combat-log facelift:** new pure `src/ui/flavor.ts` (varied verbs, foe voice,
tiers, `joinClauses`) on a "flavour clause — data clause" anatomy; data-driven
`voice` on creatures (zombie/behemoth/goblin); bespoke ability cast lines; rule-lines
(immune/fizzle) stay fixed; quiet drift stays hushed; heavy hits get `.big` emphasis.

**Set-mate glow rework:** halos are now **gold** (dim in normal play, bright in the
tutorial via `.board.teachmates`); 1-pick mates → 2-pick completer is tiered; a pair
whose finishing third isn't on the board glows **red** (dead end, nothing else lit);
tutorial text now coaches clicking cards on/off to explore set-mates.

**Deferred (need set.crawl run loop or deep engine work):** cross-room HP-carry
banner · run-level contribution chart (the end chart is already cumulative per
gauntlet) · dread accumulation fog (needs a clear dread-DoT foe + per-room model) ·
saturation-cap fizzle (needs engine "wanted to warp but couldn't" introspection) ·
herding connector flash (niche, coach-only).
