# FABLE.md — full-repo review (Fable 5, 2026-06-09)

A synthesis of a four-track parallel review of SET.core: engine/core code, UI code,
design-doc coherence, and game-design/product analysis. Baseline at review time:
67/67 tests passing, `tsc --noEmit` clean, ~5,400 lines of TS in `src/`,
~2,800 lines of design docs, uncommitted scene-split work in `src/ui/app.ts`.

The two highest-severity bugs (E1, U1 below) were independently re-verified against
source before publishing. Everything else carries the reviewing agent's confidence
level where it matters.

**Table of contents**
1. [Executive summary](#1-executive-summary)
2. [Bugs — engine & core](#2-bugs--engine--core)
3. [Bugs — UI](#3-bugs--ui)
4. [Invariant risks](#4-invariant-risks)
5. [Architecture](#5-architecture)
6. [Save system & PWA](#6-save-system--pwa)
7. [Design-doc coherence](#7-design-doc-coherence)
8. [Game design review](#8-game-design-review)
9. [set.crawl risks & recommendations](#9-setcrawl-risks--recommendations)
10. [UX & accessibility](#10-ux--accessibility)
11. [Marketing, positioning & the trademark question](#11-marketing-positioning--the-trademark-question)
12. [Test gaps & performance](#12-test-gaps--performance)
13. [Context for future sessions](#13-context-for-future-sessions)
14. [Prioritized action list](#14-prioritized-action-list)

---

## 1. Executive summary

The project is in unusually good shape for a solo hobby build: the math core is
genuinely well-theorized (the "lock the board generous, move difficulty into the
RPG layer, make skill *value-targeting* not set-finding" reframe is the project's
best idea and it's correct), the spec→spec fairness architecture is sound, and the
codebase is clean enough that a four-agent adversarial review found **zero failing
tests and only one high-severity engine bug**.

The big themes:

- **One real engine bug family** — the clock-cap clamp (`Math.min` on the absolute
  value instead of on the *gain*) exists in four copies and produces both a silent
  potion-eating bug and a free-Tactics exploit. One-line fix × 4, plus dedupe.
- **One destructive-action UI hazard** — Enter confirms the "Delete hero" modal
  even though Cancel is focused as the "safe default."
- **The docs have drifted hard.** Nearly every numeric tuning claim in the design
  docs no longer matches code (Tactics drain, speed bands, drift rate, wound regen).
  THEORYCRAFT.md — the onboarding tour — is the most stale and most dangerous.
  A short `TUNING.md` naming code as source of truth would stop the rot.
- **The biggest game-design threat is structural stalling.** Time inside an
  encounter is free; anti-stall (dread) is content, and only the boss has it.
  Chronomancer clock-pinning and Sentinel/Druid turtling make slow-safe play
  *correct*, which guts both the "fast read under pressure" fantasy and set.crawl's
  HP-attrition model. Fix structurally (universal soft-enrage), not per-foe.
- **Three load-bearing decisions must land before Phase B2**: what death costs,
  what flee costs, what Rest costs. Free Rest + free Flee + loot = a riskless
  dungeon-scouting loop the moment loot exists.
- **Colorblind support is the headline accessibility gap** — the color axis is
  literally red/green/blue with no redundant channel, in a game about perceptual
  reads, and red–green is the most common CVD.
- **Rename before going public.** SET is a registered trademark; the mechanic is
  free, the *name* is the exposure. Daily seeded runs (nearly free given the
  deterministic engine + `session.ts` replay seam) are the strongest retention
  lever available.

---

## 2. Bugs — engine & core

### E1 — Clock-cap clamp pulls the clock *backward* and mints free Tactics (HIGH, verified)

`src/engine/ops.ts:93` — `pushClock` does
`s.nextAttackAt = Math.min(ceil, s.nextAttackAt + sec * 1000)`. If `nextAttackAt`
is already past the ceiling — legitimately, via an *uncapped* push from a Speed
Potion (`src/engine/consumables.ts:56`) — `Math.min` **reduces** it to the cap.
Drink a Major Speed Potion (+30s, uncapped), then cast Frostbolt
(`abilities.ts:51`) or proc Permafrost (`passives.ts:39`): the 30s stall silently
craters to 20s. `applied` is negative so no event fires — invisible to the player.

The same pattern is duplicated in three more places, and the copy in
`src/engine/combat.ts:112` (Move-set resolution) is **worse**: `applied` goes
negative, so `overflow = Math.max(0, res.boot - applied)` becomes
`boot + |applied|`, and the Tactics feed gets an instant windfall. Completing a
Move set after a Speed Potion both destroys the stall *and* hands the player a
free (near-)armed Tactics meter. Also duplicated at `triggers.ts:184`
(`delay_attack`) and `abilities.ts:207` (Time Warp pulls an above-cap clock
*earlier*).

**Fix:** clamp the gain, never the absolute value —
`s.nextAttackAt = Math.max(s.nextAttackAt, Math.min(ceil, s.nextAttackAt + sec * 1000))`
— and consolidate all four sites onto `ops.pushClock` (give it an
overflow-seconds return for the Tactics feed). Decide separately whether Time
Warp should be `max(current, cap)`.

### E2 — `hurtPlayer` re-emits `lost` and keeps mutating after death (MEDIUM)

`src/engine/triggers.ts:267-282` — `hurtPlayer` transitions and emits `lost` with
no "was running" guard, and `runTrigger` (`triggers.ts:247-250`) loops a trigger's
`do[]` effects without checking `s.running` between effects. A two-effect trigger
that kills on the first effect runs the second against a dead player: a second
`playerDamaged` plus a **duplicate `lost` event**. `fireTriggers` only checks
between triggers (`triggers.ts:261`), not between effects.
**Fix:** guard the transition on `s.running` and short-circuit the effect loop.

### E3 — `pick: 'highest_mag'` is a no-op (MEDIUM, latent)

`src/engine/triggers.ts:109` sorts slots by magnitude, but both consumers
(transmute at `:220`, lock at `:227`) then apply `count` via `pickRandom`, a
uniform sample that discards the ordering. No shipped data uses `pick` yet, but
`schema.ts:49` advertises it — the first author to use it gets silently random
targeting. **Fix:** `slots.slice(0, count)` when `sel.pick === 'highest_mag'`.

### E4 — Match-fired traps targeting matched cards are silently cancelled (MEDIUM)

`src/engine/combat.ts:174-184` — match triggers fire while the three matched
cards are still on the board; slots are nulled and refilled afterwards. A trap
`transmute` with a `gap` that selects a matched slot sets a pending reform, but
`reformSlots` immediately fills the slot and deletes the pending entry
(`triggers.ts:318`), erasing the trap's hole. A trap `lock` on a matched slot
locks the *slot*, so the brand-new reform card spawns pre-locked (the player
never saw it) — and the makeable-floor check ran against a board that no longer
exists one line later. **Fix:** fire match triggers after clearing the matched
slots, or exclude matched slots from trap selectors for that firing.

### E5 — `completeSet` accepted after combat is over (LOW)

`src/engine/combat.ts:158-185` — no `if (!s.running) return` (unlike
`castAbility`/`useTactic`/`useConsumable`/`tick`). The UI stops dispatching, but
`session.ts` treats the action log as the replay contract; a malformed log
produces nonsense state (including a dead-but-not-won zombie) instead of a no-op.
**Fix:** one guard line.

### E6 — Post-death `tick` keeps processing board timers (LOW)

`src/engine/combat.ts:218-250` — after a tick-trigger kills the player mid-loop,
the unlock sweep and pending reforms still run, emitting `cardsUnlocked` /
`cardsReformed` after `lost`. Harmless to state, noisy on the event contract.
Gate the post-trigger sections on `s.running`.

### E7 — Scrolls bypass the ethereal hook and ability passives (LOW, design question)

`src/engine/consumables.ts:199` — scroll `use` calls `a.cast` directly, skipping
`castDamageHook` and `firePassives(s,'ability',…)` (`abilities.ts:258-260`).
Against the ethereal goblin (`rules.ability_damage:'mana_spent'`) every damage
scroll does exactly **0** with no feedback as to why; Spell Echo never procs off
scrolls. May be intended ("the scroll IS the cost"), but at minimum the foe's
`immune` event should fire so the UI can explain the zero.

### E8 — `patch` crash/hang edges (LOW, latent)

`src/core/generate.ts:177` — the plant fallback `NaN`-indexes (`% 0`) and throws
on empty `slots`; all current callers guarantee non-empty, but
`patch(board, [], …)` is a public-API crash on a below-floor board. And the
distinct-fill `do/while` at `:162-165` has no attempt guard (the main loop has
`g > 200`); a future `n` close to `3^|active|` plus heavy weights hangs the
engine. Both guards are cheap.

---

## 3. Bugs — UI

### U1 — Enter always confirms modals, defeating the "safe default Cancel" (HIGH, verified)

`src/ui/app.ts:790` binds a document-level keydown where `Enter → accept()`,
while `:795` focuses Cancel as the "safe default." The global handler fires and
`cleanup()` removes the modal, so Enter with Cancel focused **confirms** —
including "Delete hero" (irreversible) and "Flee" (forfeits the run).
**Fix:** drop the Enter shortcut on `danger` modals, or only treat Enter as
confirm when the confirm button has focus.

### U2 — Modal stacking leaks the previous modal's keydown listener (latent)

`app.ts:780` removes a prior `#confirmmodal` element but never runs its
`cleanup`, so its `document` keydown listener survives with closures over stale
callbacks. Hard to trigger today (the scrim blocks double-open), but any future
programmatic open trips it.

### U3 — `V.paused` leaks past flee; end screen renders frozen (MEDIUM)

Flee sets `V.paused = true` (`app.ts:801`); `endScreen` never resets it and
`coachFinish` early-returns outside the tutorial (`app.ts:1553`), so the trailing
`updateBar()` re-applies `.wrap.frozen` (`styles.css:380`) on the end screen.
Cosmetic until the end card gains any animation. **Fix:** clear `V.paused` in
`endScreen`.

### U4 — Misread leaves the bad trio selected for 320 ms (MEDIUM)

`app.ts:751-758` — after a wrong third pick, `V.selected` keeps all 3 indices
until the timeout. In that window, any engine-driven re-render repaints them as a
normal selection, and clicking a fourth card re-enters the `length===3` branch on
the same trio → duplicate "misread" log lines and stacked timeouts.
**Fix:** clear `V.selected` immediately; let only the `bad` CSS class linger.

### U5 — Unbounded `V.actions` growth from per-frame ticks (MEDIUM)

`app.ts:1324` dispatches `{type:'tick'}` every rAF and `:904` records every
action — ~60 entries/sec, ~200k objects over a long gauntlet, with a full
`cloneState` deep-clone per frame (`engine/combat.ts:259`). Coalesce ticks before
the seam is used for crawl replay/persistence.

### U6 — Selection survives an in-place transmute of the selected card (LOW)

`app.ts:906` drops selected slots only when they become null/locked; a hostile
transmute rewrites the card under a selection and the pick silently refers to a
different card. Re-validate by `data-key` (or clear) on change.

### U7 — Stray FX timers can paint over the next scene (LOW)

Staggered bursts (`app.ts:1107`) and `manaSparks` timeouts (`:1191-1196`) aren't
guarded by a view check; `burst()` re-creates `#burstlayer` on `document.body`
even after teardown, so a fight ending mid-batch can flash a full-screen burst
over the town. Capture `V` like the guided-intro timer at `:430` already does.

### U8 — Tooltip show-timer not cancelled on mousedown (LOW)

`app.ts:128` hides the tip on mousedown but doesn't `clearTimeout(tipTimer)`; a
pending `showTip` fires ~80 ms after a click.

### U9 — Hero name interpolated raw into innerHTML (LOW, self-XSS only)

`${c.name}` lands unescaped at `app.ts:251`, `:238`, `:292`. `maxlength=18`
makes a payload tight but markup injection is real; matters more once names sync
anywhere beyond localStorage (the MMO direction). One `esc()` helper closes it.

**Verified-clean:** the rAF loop is cancelled on all combat exits; flee sets
`running=false` engine-side so the one extra frame self-terminates; the
uncommitted scene-split (character-select / dungeon-select) is clean —
`selectedCharId` is validated against the reloaded roster (`app.ts:179`), and
stale `classId`s fall back via `classById` rather than crashing (though they
silently morph into class 0 — worth a log line).

---

## 4. Invariant risks

### I1 — The makeable-set floor is enforced only at lock time, never re-asserted

`src/engine/triggers.ts:144-159` checks `makeableSetCount ≥ floor` at the moment
of locking. Afterward, a `shatterCard` or any transmute can remove the card
carrying the only unlocked set, and `reformSlots → patch`
(`generate.ts:156`) guarantees only `countSets ≥ floor` **counting locked
cards** — the patched floor set may run through a locked slot. Net: the board can
sit with zero *playable* sets for a lock's duration. Short durations (~4-5s)
self-heal it, but the documented invariant (CLAUDE.md, TRAPS.md §6) is not
actually maintained and nothing asserts it. **Fix:** make `patch`/`reformSlots`
lock-aware (use `makeableSetCount` as the acceptance predicate when locks exist)
and add it to the invariant test.

### I2 — Plain floor is transiently violated by design, but unbounded by data

Transmute `gap`s and wounds (`DMG_REGEN_MS = 10000`, `state.ts:77`) null cards
with no floor check. A data author can set an arbitrarily long `gap` on a
board-wide selector and create a multi-second dead board. If "floor may dip while
slots visibly reform" is the accepted reading, write it down (engine README) and
add a data-validation cap on `gap` in `game-data.test.ts`.

### I3 — The plant fallback is positional planting (invariant 4/5 tension)

`generate.ts:170-186` — the last-resort path plants `third(a,b)` of the *first*
pair into a quasi-deterministic slot. Documented last resort, but note
`patchFavor`'s heavy weights (`BIAS_W = 8`) make the rejection loop fail far more
often than uniform regen, so abilities like Call Flames hit this path
disproportionately — and the invariant test never exercises the weighted path
(T1 below).

### I4 — Final fallbacks can return below-floor boards silently

`generate.ts:111`, `:205`, `:236` — after attempts exhaust, an unchecked board is
returned with no log/flag. A silent floor break in production would be
indistinguishable from a tuning issue. Add an assert-in-dev or a counter event.

---

## 5. Architecture

### Engine

- **A1 — Presentation is baked into engine events.** `passiveProc` /
  `triggerSprung` / `buffFaded` carry rendered English+emoji strings
  (`ops.ts:32`, `combat.ts:99,166,196`, `triggers.ts:169-229`). The engine→UI
  contract should carry ids + numeric params; the UI owns wording. This bites for
  set.crawl's log voices, i18n, and any future server emitting to multiple clients.
- **A2 — `pushClock` exists in four copies** (see E1). Consolidate.
- **A3 — Castables are code, content is data.** Traps/creatures/dungeons are
  schema-typed data, but abilities/passives/tactics/consumables are TS closures.
  set.crawl's gear + town economy will want prices, rarity, loot tiers, and
  descriptions in data; today adding one potion means editing engine code. The
  trigger-bus `Effect` vocabulary already covers most ability bodies — consider
  migrating castables onto the declarative effect vocabulary before crawl content
  scales.
- **A4 — `CombatState` is not serializable as-is** (Maps in `pending`/`locked`;
  `foe.triggers` are shared object refs into `GAMEDATA`). Mid-run save needs a
  `snapshot/restore` pair next to `cloneState` (`combat.ts:285`) — the test-only
  `snap()` in `seam.test.ts:12` is the start of that shape. `session.ts` replays
  depend on the data registries *by reference*: any data tuning invalidates old
  action logs; persisted runs need a data-version stamp in `SessionSetup`.
- **A5 — Run-level state has leaked into CombatState.** `sequence`/`seqIdx`/
  `dungeonId`/`consumables` live in combat state, and `onWin`
  (`combat.ts:124-156`) performs run progression (next foe, full heal) inside the
  combat reducer. Extract a run reducer that composes combats *before* crawl
  hard-wires more onto `onWin`.
- **A6 — Minor leaks:** `START_GRACE_MS` (`state.ts:78`) is a UI timing constant
  in engine state; `session.ts:41` hardcodes `COMBAT_GEN` — crawl difficulty will
  need the gen spec (or a spec-transform list, per invariant 4) in `SessionSetup`.

### UI

`app.ts` is 1,574 lines with clear section banners — tractable, but at its limit.
The risks aren't size:

- **The mutable module-global `V` + `V!` asserts everywhere.** Non-null asserts
  inside `forEach` callbacks (`app.ts:629-637`, `824-846`) break silently when a
  second screen exists. Pass a context object or hang helpers off a scene instance.
- **Scene lifecycle is ad-hoc** — each scene is "`coachTeardown()` + `V = null` +
  `root.innerHTML = ''`", and combat leaks body-level singletons outside `root`
  (`#ptint`, `#burstlayer`, `#coachscrim`/`#coachpop`, `#tooltip`) that
  `coachTeardown` sweeps as a grab-bag. **Before set.crawl adds
  town/run-map/inventory, cut a tiny scene router with a mount/unmount contract**
  (unmount = cancel rAF + clear timers + remove body artifacts). That one seam
  pays for all three new screens.
- **Natural module cuts** (already cohesive in-file): `scenes/character-select.ts`,
  `scenes/dungeon-select.ts`, `scenes/combat.ts`; `widgets.ts` ($, tooltip,
  confirmModal); `fx.ts` (~250 lines, zero game logic); `coach.ts`; `log.ts`
  (`interpret` — the largest function, a pure event→feedback boundary).
- **Rendering is hybrid:** board = signature-gated full rebuild
  (`renderBoard`, `innerHTML=''` at `app.ts:611`) with ghost crossfade; HUD =
  per-frame patching. The full rebuild runs on **every selection click** and
  restarts CSS animations on untouched cards (bait shimmer phase, breathing,
  in-flight `enter` animations get cut). Keyed per-slot patching is the eventual
  fix; not urgent at 15 cards.
- **Per-frame DOM querying:** `updateBar` → `updateCastables` does 2×
  `querySelectorAll` per frame plus a `querySelector` per locked card
  (`app.ts:824-846`, `:1301`, `:1312`). Cache refs or dirty-flag before the
  run-map adds more per-frame surfaces.

---

## 6. Save system & PWA

### Save (`src/ui/save.ts`)

Fine today, under-built for crawl progression:

- **Versioning is key-suffix only** (`setcore.roster.v1`) with one inline
  normalize. No version field in the payload, no migration chain. **Before the
  first progression field lands**, adopt an envelope `{ v: number, chars: [...] }`
  plus a table of `v→v+1` migrations.
- **No field validation:** `JSON.parse` is cast straight to `SavedChar[]`
  (`save.ts:28`); corrupt entries flow into combat math (`maxHp` is trusted).
  Add a per-char validator/clamp in `loadRoster`.
- **Last-write-wins across tabs** (`upsertChar`, `save.ts:59`) — acceptable
  single-player; add a `storage`-event listener once gold/inventory make
  cross-tab clobbering lossy.
- `DEFAULT_MAX_HP = 30` duplicates `createCombat`'s default — import or assert it.
- The normalization path (the part that will grow into migrations) is untested.

### PWA (`public/sw.js`)

- **Stale-index version skew, including a bricking scenario.** Everything,
  including `index.html`, is cache-first with background revalidate
  (`sw.js:21-28`) — users are always one deploy behind, and two deploys apart a
  cached index references hashed assets that 404 on the current server → broken
  app until a manual reload. **Fix:** network-first (falling back to cache) for
  navigation requests; keep cache-first for hashed assets — or adopt
  vite-plugin-pwa's build-time precache.
- **`CACHE = 'setcore-v1'` never rotates; entries never evicted** — old hashed
  bundles accumulate forever.
- **Fonts won't work offline:** Google Fonts responses are cross-origin (not
  `'basic'`, `sw.js:24`) so they're never cached. Self-host the two fonts or
  cache opaque responses for that origin.
- `main.ts:10-13` registers the SW **in dev too** — gate on
  `import.meta.env.PROD` (classic "stale dev server" confusion source).

---

## 7. Design-doc coherence

### Internal contradictions

1. **Class ability count:** CRAWL-DESIGN §3 says ~4 abilities + signature;
   THEORYCRAFT §7.5 and the shipped code say 3. The §4 YAML sketch
   (`ability_slots: 4`) reinforces the wrong number.
2. **Dread cross-room persistence:** TRAPS §2.4 says it "optionally persists
   across rooms" — TRAPS §8 and CRAWL §6 lock "HP is the only cross-room
   persistence; dread strictly per-room." §2.4's parenthetical was never struck.
3. **Build sequence:** CRAWL-DESIGN lineage + §5 say crawl starts as a copy of
   the archived HTML with a YAML loader; TODO.md (newer, wins) reverses both.
   CRAWL §4 still presents "declarative YAML, ingested at load" as the architecture.
4. **Godot:** WRAPPERS.md settles it (web client ships; PWA done; Tauri/Capacitor
   documented), yet Godot is still the favored direction in PROJECT §8,
   GAME-DESIGN §7, THEORYCRAFT §10, and CLAUDE.md — which also contradicts itself
   ("live game is the modular TS client" vs "prefer keeping the prototype
   single-file").
5. **GAME-DESIGN §7 open questions already resolved elsewhere but not struck:**
   resource mapping (CRAWL §4/§6), enemy timer model (TRAPS §7.2), stacking order
   (CRAWL §6), targeting UX (resolved in code: deadest-card auto-target — never
   recorded). Bias persistence is answered by code (`pendingRegenBias` is
   once-only), unrecorded.
6. **The boss-chance model is internally incoherent** (CRAWL §2). "Each room *n*
   adds *n*%" is presented as the cumulative P(boss), triangular to 100% at room
   14 — but no per-room *hazard* is stated. Naive independent rolls give
   P(boss by 14) ≈ 66%, not 100%. Needs one line: per-room hazard =
   `(cum(n) − cum(n−1)) / (1 − cum(n−1))`, or "roll once per room against the
   running total and latch." This bites in Phase B2.

### Doc-vs-code drift

1. **The Goblin King doesn't have War Cry** — the best concrete find.
   `goblin_warren.boss_mirror = 'war_cry'` and the elite trap `war_cry_lesser`
   ("a foretaste of the King's War Cry") telegraph it, but
   `goblin_king.traps = ['molten_veins','confusion','dread_drums']`. The `war_cry`
   trap is referenced only by the mirror display and never fielded — violating
   TRAPS §7's own rule that the elite mirrors *a weaker version of one of the
   boss's signature traps*. (`src/data/game-data.ts:16-19, 108-115, 180-183, 309`.)
   Fix: give the King `war_cry`, or re-theme the mirror to Molten Veins.
2. **The elite boss-mirror mechanism is effectively dead code** — authored traps
   override it (`foe.ts:58-63`) and all four warren elites have authored traps, so
   the generic mirror never attaches anywhere. The actual rule lives only in a
   code comment.
3. **Speed bands:** TRAPS §7.2 says Lumbering ~18-20 / Slow ~14-17 / Steady
   ~10-13 / Swift ~6-9 / Frenzied ~4-5; code ships 20/15/12/**10**/**8** — Swift
   and Frenzied sit outside their documented bands.
4. **Tactics drain:** docs say 1/s; code (`state.ts:76`) is **0.5/s** (20s spend
   window) — halves the documented use-it-or-lose-it pressure.
5. **Drift rate:** TRAPS declares "base rate 1 card / 5s … set"; shipped ember
   drift is `every: 7`.
6. **Trigger schema vocabulary diverged.** CRAWL §4's effect/event lists
   (`grant_resource`, `on:lethal once:true`, mode `signature`, …) don't match
   `schema.ts` (`On = 'match' | 'tick'` only; mode `all_different`; different
   effect names). The undead template in code is a tick-heal, not cheat-death;
   `on:damage` foes can't currently be expressed. A future authoring session
   following the doc sketches will write invalid data.
7. **Trap resolution order:** docs say drift first, then foe traps; code queues
   foe tick-triggers before the drift (matters only on coincident fires, but it's
   backwards as written).
8. **Enemy-attack numbers:** GAME-DESIGN §4 says a hit destroys 1 card,
   regenerating ~2s; code shatters only when the hit bites HP past Block, and the
   wound reforms after **10s** (`DMG_REGEN_MS`).
9. **Clock cap:** docs say ≤20s; code is `max(CLOCK_CAP, foe.cadence)` — slow
   foes cap at their cadence.
10. **Migration-era notes are now false:** `src/data/README.md` ("parity test
    enforces sync") and TODO.md's Done section — `game-data.test.ts` explicitly
    retired the parity check ("INTENTIONALLY DIVERGED"). `engine/README.md`
    carries similar stale framing.
11. **The shipped board findability is undocumented:** `COMBAT_GEN` = camoDepth 1,
    escapeRoutes 6, floor 1 — Tier-1 "Trivial" per TIERS.md. Deliberate, but no
    doc says so.

### Design gaps (implementation will force these — ranked by how soon B2 hits them)

1. **What death costs.** TODO's settled town-bank plan pre-decides most of the
   permadeath question without saying what IS lost: the hero? equipped gear? run
   inventory? Today 0 HP just means a free Rest. The single most consequential
   unsettled decision for Phase B2.
2. **Flee penalty** — mechanic resolved, penalty explicitly TBD. With loot in B2,
   penalty-free flee is a free dungeon reroll/scout.
3. **The boss-hazard formula** (above) and the **voluntary cash-out** — the §2
   gambler's-choice loop requires a *leave dungeon* action between rooms that is
   never specified (free? at cost? only after a clear?).
4. **All curves:** XP→level, +HP/level, ability-slot cadence, gold values,
   loot-quality scaling ("enemy level + dungeon level", no formula), trap-tier
   scaling. `loot_tables` have no schema type at all.
5. **Reward-trigger (Trick) tuning law:** severity∝rarity governs punishments;
   nothing governs reward magnitude for `contains`-mode triggers — which is
   exactly what gear affixes (Phase B3) are made of. No `contains` trigger ships
   to anchor it.
6. **Ramping dread is unexpressible** — schema has no ramp field; shipped
   `dread_drums` is flat 3 dmg/8s, while TRAPS §2.4 calls the ramp "what makes it
   *dread*."
7. **"~10 abilities per class" boss-pick lists don't exist** — one shared
   17-ability roster; per-class growth lists are an unscoped authoring project.
8. **No mana cap** specified or implemented.
9. **Consumable flow details:** between-room refill of the 3 active slots — auto
   or prompt? Are scrolls of off-class abilities rarity-priced?

### Stale docs (would mislead a future session)

- **THEORYCRAFT.md is the most stale and most dangerous** (it's the onboarding
  tour): "next build is the threat layer inside set-combat.html" (done, in
  `src/`); set.crawl "not yet code" (B1 partially shipped); `[live]` tags point at
  archived prototypes; §10 Godot.
- **CRAWL-DESIGN.md** header ("no code yet"), lineage, §5 build sequence, §1
  health-gem 4-band spec (UI ships low/crit only).
- **GAME-DESIGN.md §7** (4 of 7 open items resolved elsewhere); §4 "~2s" regen.
- **TRAPS.md** §7.2 speed table; §5.5/§8 drift "1/5s — set."
- **CLAUDE.md** working-style notes (single-file preference, Godot).
- **PROJECT.md** §1/§5/§10 present `set-proto.html` as "the current working
  prototype."
- **src/data/README.md, src/engine/README.md, TODO.md Done note** — retired
  parity/migration framing.

### Missing docs

1. **A live tuning-constants reference** (`TUNING.md` or a generated table)
   naming code as source of truth: `COMBAT_GEN`, speed map, `TACTICS_*`,
   `CLOCK_CAP`, `DMG_REGEN_MS`, `START_GRACE_MS`, drift rates. Every numeric
   claim in the docs has drifted; this stops the rot.
2. **The consumables/potions design** — `consumables.ts` ships ~20 items
   including genuinely new mechanics documented nowhere (Invisibility's
   `attackFrozen`, Hourglass tick suppression, Strength's `nextSetDamageMult`,
   the Prismatic/Saboteur cascades). There is no "player buff" concept in any
   design doc. Largest undocumented mechanic surface in the game.
3. **The Trap/Trick valence convention** lives only in a TODO.md preamble;
   TRAPS.md never defines tricks, valence, or reward tuning.
4. **A persistence contract** (save keys, schema versioning, account-level bank
   vs `SavedChar` split) — TODO's paragraph is the only spec; B2 should
   crystallize it.
5. Minor: README's repo tree omits THEORYCRAFT/WRAPPERS; resolved decisions in
   code (auto-target, once-only bias) deserve one-line entries in GAME-DESIGN §7.

---

## 8. Game design review

### The core loop is sound — and the central reframe is the project's best idea

"Lock the board generous (f=3/N=15, ~18 sets), move all difficulty into the RPG
layer, make skill *value-targeting* instead of *set-finding*" correctly solves
Set's two worst properties as a game core: droughts (engineered out) and the
brutal novice floor (~23% of f=3 sets are k=1 gimmes; a beginner can always find
*something*). The trap thesis ("a price, not a wall"; severity ∝ rarity; "a good
trap is one you spring ~30% of the time") is the right decision-engine framing,
and spec→spec fairness means none of it can degenerate into rubber-banding.

**Where the fun is:** (a) the speed-read — spotting the all-red set *and* knowing
whether to take it; (b) the bait loop (drift floods red → red sets get juicy →
War Cry punishes red), which makes a two-rule enemy feel like it's playing you;
(c) engine-building moments — Call Flames into a board of 9 reds into a mana
avalanche, with the saturation-cap governor keeping it honest.

### Threats to the fun, in priority order

1. **No structural per-encounter time cost → defensive stalling is the dominant
   degenerate strategy.** Within one fight, time is free. The anti-stall answer
   (tick-dread) is *content*, not structure — only `dread_drums` exists, and only
   on the Goblin King. Against anything else: **Chronomancer** (Time Warp slams
   clock to cap + Glaciate + Frostbolt + Quicken) pins the clock near
   `CLOCK_CAP=20s` indefinitely; **Sentinel/Druid** (Block to maxHP + Overflow +
   Photosynthesis +3HP per all-green + Heal) out-sustains any foe without
   `enemy_heal` — every fight becomes solvable risk-free, just slowly, which
   murders the "fast read under pressure" fantasy. The crawl's HP-only attrition
   makes slow-safe play *correct*, compounding it (sustain builds exit every room
   at full HP, gutting B2's attrition model). **Fix structurally, not per-foe:**
   a universal soft-enrage — e.g. after 90s every foe drops one speed band, or
   dungeon drift rate doubles per 60s. Severity-∝-rarity already gives the design
   language for it. Alternatives/complements: a per-dungeon coverage rule (every
   tick budget must include damage pressure), per-room time pressure, or
   in-combat healing caps.
2. **Simultaneous-channel overload is the real onboarding cliff** (not
   set-finding, which the moat/glow/coach work largely solved). A mid-game player
   tracks: 15 cards × 3 axes, the set-mate glow, 3 mana pools, Block, the Tactics
   meter + drain, the enemy clock, 1-3 trap conditions, the drift, locks with
   countdowns, and wounds — while the clock runs. The crawl's 1→2→3 trap ladder
   is the right ramp; also ramp *player systems* (first runs without Tactics, or
   with 1 ability) instead of front-loading the full kit in a 6-step tutorial.
3. **Class differentiation is real on the color axis, thin elsewhere.** The three
   elemental casters genuinely differ (flood → match → distinct payoffs:
   damage/tempo/sustain). But Cryomancer ≈ Chronomancer (both stall; share 2 of 3
   abilities), Sentinel ≈ Warlord (shared Bulwark, both turtle), Spellblade is
   "Pyro+Cryo bolts with an echo." Passives are mostly small static riders; only
   **Momentum** (Rogue) actually changes *how you read the board* — which is the
   design's own stated identity mechanic (GAME-DESIGN §6). More passives should
   be board-shaping, not stat dribbles; each base kit needs at least one unique
   ability.
4. **The Tactics meter is a good resource, a weak decision.** The overflow
   capture elegantly fixed the dead Move verb, and use-it-or-lose-it creates
   urgency — but the six armed tactics are six flavors of "flood the board toward
   an axis"; for any given build one button is almost always right. It's a
   charged ult, not a choice. Add 1-2 tactics with different *verbs*: a
   board-lock (preserve your good state through drift — Ice Block logic is
   already specced in TRAPS §5.2), an unlock/cleanse, a peek/scry. Then the armed
   moment becomes a read.
5. **Trap layer: interesting decisions, one authoring note and one legibility
   gap.** Most variant traps are "all-X → drain/damage Y" — they tax but don't
   *herd*; the marquee coupled traps (Press the Swarm, Molten Veins, Limbless)
   are where the system sings — author more of those. And the playtest
   instruments TRAPS itself specifies (player-vs-enemy reshape share ≥65-70%,
   ~30% spring rate) are both **unmeasured** — build the telemetry before
   authoring more content, or you're tuning blind.
6. **Potion economy: currently infinite (known interim), two pricing problems for
   when gold arrives:** Strength Potion (3× next set) + Invisibility (fill
   Tactics + freeze enemy until next set) is a burst combo that trivializes
   elites; and `scroll_<every ability>` means any class can carry Call Flames —
   cross-class scrolls should be rarer/pricier than same-class ones or class
   identity dissolves at the shop (see also §9.3: scrolls vs spellbooks). The
   50%-repeat cascade potions have a long tail (up to 8 procs) — fun jackpot,
   watch the variance.
7. **Two smaller balance flags:** **Tactician** (Warlord: +2 Tactics on *any*
   match) arms a full board-flood every ~5 matches with zero Move investment —
   combined with the halved drain (0.5/s), the meter is far cheaper than
   designed; watch for "Tactics on a timer" rather than "Tactics as Move payoff."
   And per TRAPS §4's own coverage rule, **no trap punishes all-Defend or any
   magnitude value** — Turtle/Sentinel lines and magnitude-keyed gear affixes
   (B3) currently have no nemesis: degenerate-by-construction by the doc's own
   standard.

**Session grain:** a single encounter is ~1-3 minutes — ideal. The crawl math
(median boss room 10, guaranteed 14, ~2-3 elites) implies 20-35 min runs —
Spire-length, with far less per-room variety (next section).

---

## 9. set.crawl risks & recommendations

1. **Room monotony.** The run loop is combat → loot → combat with zero non-combat
   nodes; ten consecutive fights against a 6-creature weight table will expose
   how samey minion fights are. Cheapest fixes, in order: (a) **surface the
   boss-probability as a visible "dread meter"** — the push-your-luck gamble is
   the run's core decision and the player currently can't see the odds, so it
   isn't a decision; (b) one mid-run **rest/shop node** (reuses town UI);
   (c) **choice of next room** (2 doors: "foe + gear loot" vs "elite +
   spellbook") — room choice is the single highest-value roguelite ingredient the
   design lacks.
2. **Dead runs bank nothing → the "one more run" pull is weakest for the players
   who most need it.** A struggling player who dies in rooms 3-6 repeatedly banks
   zero progress. Extend the settled town-bank instinct: mid-run loot should bank
   (at least partially) on death, and XP should persist — otherwise the
   onboarding cliff and the meta-progression gap compound on the same players.
3. **Content volume is the real bottleneck, not systems.** The machinery
   (creature ⊕ variant ⊕ template, dungeon extends, drift) is built for
   combinatorial content, but today there is effectively **one dungeon** (Goblin
   Warren + undead reskin). The build-vs-dungeon "pick your terrain" tension
   can't exist until ≥3 themed dungeons do. Authoring two more (green/blue
   themed, reusing the trap palette) is higher-value than any new system in B3/B4.
   Also: scrolls already cross class streams cheaply (3 slots of off-class
   abilities per delve) — scroll rarity/pricing has to do heavy lifting the docs
   never assign it, or spellbooks and boss-picks lose their prestige.
4. **The flee/death/Rest penalty triad is load-bearing and still open.** As
   built: enter dungeon → see a bad variant roll → flee free → Rest free →
   re-enter (fresh room chain) = a riskless loot-scouting loop the moment loot
   exists. Recommendation: flee keeps run loot but forfeits the room's reward;
   Rest costs gold; death loses unbanked run loot. Settle all three *with* B2,
   not after.
5. **Missing "one more run" furniture:** a run-end scorecard (rooms cleared,
   loot, what killed you), per-dungeon best-depth records, a visible reason runs
   differ (show the next room's foe silhouette for anticipation). The
   deterministic engine + `session.ts` replay seam makes **seeded daily runs with
   a shareable score nearly free** — the strongest retention lever at this scale
   (see §11).

---

## 10. UX & accessibility

- **Colorblind support is the headline gap.** The color trait is encoded *only*
  as hue, and the triad is red/green (#f0565b / #46c46a — the classic
  deutan/protan confusion pair) + blue (`app.ts:35`, `styles.css:6`). Shape and
  number get redundant glyph encodings; color gets nothing — yet color is a match
  axis *and* drives mana economy, drift-bait shimmer, trap conditions, and the
  "counters your build" flag. **Fix:** a redundant channel per color (glyph fill:
  solid/outline/hatched, like physical Set's shading; or a corner pip) and a
  CVD-safer triad. Highest-impact accessibility fix possible in this game.
- **Keyboard: the game is 100% mouse-only.** Cards, tactic buttons, ability
  slots, charcards are click-only `<div>`s — no `tabindex`, no key handlers, no
  ARIA anywhere; the combat log isn't `aria-live`. Minimum: real `<button>`s (or
  role+tabindex+Enter/Space), `aria-pressed` for selection.
- **Touch: the information layer is desktop-only.** Tooltips are
  `mouseover`-driven (`app.ts:118-128`) and ability/consumable/trap
  **descriptions exist only in `data-tip`** — on a phone you cannot read what any
  ability does, in town or combat. Spell target previews are hover-only too
  (`app.ts:1399`). The responsive layout makes the gap deceptive. Add
  tap-to-toggle tooltips (the delegated-listener design makes this small) or
  long-press inline descriptions.
- **No `prefers-reduced-motion`** in a UI built on screen shakes, flashes, and
  ~10 infinite pulse animations.
- **No audio at all.** Even three sounds — set-resolve chime, trap-spring sting,
  enemy-attack thud — would transform feel; the trap sting doubles as a
  *teaching* signal.
- **Selection-aware trap warning:** when 2 selected cards' unique completer would
  spring a trap, pulse that trap chip hard. Respects TRAPS §2.5 ("rule legible,
  instance earned") — the player already found the set; you're only confirming
  the price, killing "I didn't realize that counted" feel-bad without giving away
  the spot.
- **Failure forensics:** the end screen has stat bars; add one line of *cause* —
  "Slain by the Goblin Brute — you sprang **Cruel** 4× for 24 damage." Deaths
  that teach are deaths that retain. Mirror on wins ("traps cost you 14 — worth
  it?") to feed the 30%-spring-rate fantasy back to the player.
- **Difficulty communication:** "Difficulty 1/3" on the dungeon picker is bare —
  show foe speed range, trap-count ladder, boss name + signature (a compressed
  version of the already-excellent briefing card).
- **Explicit pause:** real-time game, interruptible audience. The machinery
  exists (`V.paused`) — expose a button/spacebar; auto-pause on tab blur.
- **Misread feedback never says *which trait* failed** — the classic Set teaching
  aid, cheap given `matchDescriptor` exists.
- **Smaller:** Rest is unreachable from the dungeon picker at 0 HP
  (dead-end "Rest first (◀ Back)", `app.ts:386`) — put a Rest action in that
  footer; no Enter-to-create on the name input; the combat log DOM grows
  unbounded (`app.ts:1128`); 3s start grace is thin for a new player facing a
  Swift (10s) foe — consider Lumbering first rooms or grace scaled by roster age.

---

## 11. Marketing, positioning & the trademark question

**One-liner candidates:**
- "Puzzle Quest, but the match-3 is the hardest pattern game ever printed."
- "A real-time dungeon-crawler where your sword is a perception puzzle."
- For HN/math audiences: "I turned the affine geometry of SET into a roguelite engine."

**The trademark question — flag before any public push.** SET is a registered
trademark (Set Enterprises → PlayMonster), and the card *look*
(squiggle/diamond/oval, purple/red/green, striped shading) is protectable trade
dress. The *mechanic* — lines in AG(n,3), all-same-or-all-different — is not
protectable, and the project already diverges mechanically and visually (3
features, Attack/Defend/Move glyphs, an RPG on top). The exposure is purely the
**public name**: "SET.core" / "set.crawl" / the in-app title. Precedent: Set-likes
survive under distinct names while saying "inspired by the card game SET" in
descriptive copy; look-alikes using the name/trade dress get taken down.
**Recommendation:** before itch/Steam/Reddit promotion, pick a distinct product
name (lean into the existing fiction — lines, runes, glyphs, delving; brainstorm
+ trademark-search), keep "SET-like" only as a comparison phrase. Repo and doc
names are zero-risk; only the public title needs to change.

**Comparables:** *Puzzle Quest / Gems of War* (proved puzzle-as-combat
mainstream; the differentiator here is real-time + perception vs turn-based
matching); *Luck be a Landlord / Backpack Hero / Peglin* (solo-dev roguelite
successes; all broke via streamers + a free web demo funneling to Steam
wishlists); *Wordle / Knotwords / SpellTower* (the daily-puzzle retention model,
directly applicable); *Triple Town / Hexcells* (small-grid pattern games that
found puzzle audiences without marketing budgets).

**Channels, in order of fit for a solo hobbyist:**
1. **Hacker News (Show HN)** — the math framing (AG(f,3), the saturation-cap
   governor, spec→spec fairness; THEORYCRAFT.md practically *is* the blog post)
   is HN catnip. One good Show HN outweighs months of portal traffic.
2. **itch.io** — free web build (the Vite dist + PWA already exist), devlogs,
   active roguelite tag.
3. **Reddit / BGG** — r/WebGames, r/roguelites, r/math (the geometry write-up);
   r/boardgames + BGG forums hold a genuine SET fanbase starved for digital
   SET-likes.
4. **Web portals** (CrazyGames/Poki) — viable later; they favor instant-play, so
   a "quick fight" mode would be needed.
5. **Streamers** — better fit than it looks: set-spotting is
   *spectator-participatory* (chat finds the set before the streamer — the
   GeoGuessr/chess-stream dynamic).

**Virality hooks (cheap, given the architecture):**
- **Daily seeded run** — deterministic engine + replay seam means a global daily
  seed + local score + shareable emoji result card (Wordle-style rooms-cleared
  grid) is mostly UI work. Best effort-to-retention ratio available.
- **Seeded challenge links** ("beat my run": URL carries seed + class) — same
  machinery.
- **Replay ghosts** later (the action log is already captured — after U5's tick
  coalescing).

**Monetization-light, if ever:** keep web free forever (the funnel); Tauri →
Steam at $6-10 once the crawl loop + 3 dungeons exist (WRAPPERS.md documents the
path); itch pay-what-you-want + Ko-fi in the interim. Avoid F2P/cosmetics —
wrong scale, wrong audience. Honest model: free web demo, paid desktop with more
dungeons/classes.

---

## 12. Test gaps & performance

### Test gaps

- **T1 (biggest):** the conformance gate (`generate.invariants.test.ts`) never
  exercises **`patchFavor` / `AxisWeights`** — yet every transmute in the game
  reforms through the weighted path, which stresses the rejection loop and plant
  fallback far harder than uniform `patch`. Add weighted configs to the invariant
  sweep, plus a distribution assertion that bias steers aggregates (invariant 5
  is asserted nowhere).
- **T2:** no engine-loop invariant fuzz — N seeded sessions through `reduce`
  (matches + casts + tactics + traps + locks + wounds), asserting no-duplicates,
  pin, floor-on-settled-boards, and the makeable-set floor each step. Today's
  tests are single-shot scenarios.
- **T3:** clock-cap interactions — nothing tests `pushClock` at/over the cap,
  uncapped-then-capped sequences, or Move-overflow→Tactics. E1 would have been
  caught.
- **T4:** trigger effects `instant_attack`, `advance_timer`, `drain_tactics`,
  `drain_mana`, `enemy_heal`, `chance` gating, multi-effect triggers (death
  mid-trigger, E2). Geometry selectors tested only for `row` — `corners` /
  `border` / `diagonal` / `half` / `inner` / `random` (incl. ragged-board bounds)
  are not.
- **T5:** lock pathway — `lockSlots` refusing a floor-breaking lock; lock expiry
  via `tick`; lock+transmute+match interactions (E4).
- **T6:** gauntlet *loss* and mid-sequence flee; `useConsumable` after death;
  reform-via-tick with bias grouping; cascade-potion repeat determinism.
- **Save:** the normalization path (the part that becomes migrations) is untested.

### Performance

Nothing alarming on hot paths at the locked 15-card board (`findSets` is O(n²) =
105 pairs). Two things to know:

- **P1:** `genInitial` worst case is 140 × 5000 rejection boards
  (`generate.ts:107,116`) — fine at floor=1/n=15 (accepts almost immediately),
  but a visible hitch if crawl ever raises `floor` or shrinks boards.
- **P2:** `patchFavor`'s early-out (`generate.ts:218-235`) requires
  `bestScore >= want && bestDist === 0`, near-impossible under probabilistic
  bias — it effectively always runs all 80 samples. Harmless (<50k ops), but the
  early-out is dead code.
- **UI:** per-frame `querySelectorAll` in `updateBar`/`updateCastables` and the
  per-frame tick clone (U5) are the only watch items.

---

## 13. Context for future sessions

Durable facts surfaced in this review that aren't (yet) in any doc:

- **Live deploy:** https://oannes23.github.io/set-core/ — PWA, CI deploys on push
  to `master`.
- **Actual content volume** vs the large design surface: ~22 abilities, 9
  classes, ~17 traps, 11 variants, 1 template, **1 real dungeon** (Goblin Warren
  + Haunted reskin) + tutorial/training. Treat YAML loaders, gear, spellbooks,
  XP as *unbuilt*; typed TS data stands in for YAML deliberately (loader only if
  external authoring is wanted, per TODO B5). The prototype parity test was
  **intentionally retired** — `src/data/game-data.ts` is the live source of truth.
- **Settled 2026-06 (TODO):** shared town bank (account-level `{gold, storage}`
  surviving hero death), unified item bag, finite consumables, 10-slot run
  inventory with swap-or-discard; `SavedChar.consumables` to be removed (loadout
  becomes run-state). The free-pick potion loadout is interim until B3/B4.
- **Settled decisions easy to miss:** HP is the *only* cross-room persistence
  (mana/Tactics/Block/dread reset per room); trap order = dungeon drift → foe
  traps in authored order (a design lever); Flee is a standalone any-time button;
  enemies have no resources (active enemy layer explicitly deferred); boss
  *replaces* the room's foe; Trap vs Trick = one mechanism with a `kind` valence.
- **Resolved-in-code, recorded nowhere:** hostile-transmute targeting is
  deadest-card auto-target; regen bias (`pendingRegenBias`) is once-only,
  consumed by the next regen.
- **Live tuning constants** (code is source of truth): `CLOCK_CAP=20s`,
  `TACTICS_GOAL=10`, `TACTICS_DRAIN=0.5/s` (20s window), `START_GRACE_MS=3000`,
  wound regen `DMG_REGEN_MS=10s`, speed bands 8-20s, ember drift 1 card/7s,
  `COMBAT_GEN` = camoDepth 1 / escapeRoutes 6 / floor 1 (Tier-1 "Trivial"
  findability — deliberate; difficulty lives in the RPG layer).
- **Known unmeasured targets:** TRAPS §5.5's reshape-share telemetry (≥65-70%
  player) and the ~30% trap-spring rate — both design targets with no
  instrumentation.
- **Candidate degenerate lines to playtest first:** Chronomancer clock-pinning;
  Sentinel/Druid turtling; Strength+Invisibility burst; Tactician meter-cycling.
- **Trademark exposure** is in the public-facing name only; mechanics/visuals
  already diverge from SET's trade dress.

---

## 14. Prioritized action list

**Now (small, high-payoff):** — ✅ ALL LANDED 2026-06-09
1. ~~Fix E1 — clamp the clock *gain* in `pushClock`, dedupe the 4 copies (A2),
   add T3 tests.~~ ✅ (Time Warp = never-pull-backward, per design call)
2. ~~Fix U1 — Enter must not confirm danger modals.~~ ✅ (Enter now only
   activates the focused button; U2 stacking leak fixed alongside)
3. ~~Fix the Goblin King / War Cry mirror and decide the canonical
   elite-telegraph recipe.~~ ✅ (King fields war_cry; boss_mirror →
   war_cry_lesser, always attaches to every elite, deduped; TRAPS.md §7 updated)
4. ~~E2, E5, E6, U3, U4 — each is a few lines.~~ ✅
5. ~~sw.js: network-first navigations + gate SW registration on PROD.~~ ✅

**Before Phase B2 (decisions + foundations):**
6. ~~Settle the death/flee/Rest cost triad — load-bearing for the whole loot loop.~~
   ✅ SETTLED 2026-06-09 as the **exit ladder** (`CRAWL-DESIGN.md` §6 / TODO.md):
   cash-out between rooms only (delving commits); flee = parting blow + room reward,
   falls back to the fork (reroll, elite reset) — run continues; death = carried
   loot + gold + a banked-gold tithe, XP always banks; Rest free forever (gold
   sinks: amenities/shop/abilities). Note: raises §8.1 anti-stall to a B2 companion.
7. ~~Pin the boss-hazard formula (one line of math, doc it in CRAWL §2).~~
   ✅ SETTLED 2026-06-09: inverse-CDF draw (one seeded R against the triangular
   running total); fled rooms count; the throne room, once found, stays found;
   dread meter = thematic bands. Spec in CRAWL §2.
8. Save-system envelope `{v, chars}` + validation + migration table — before the
   first progression field lands.
9. Extract the run reducer from `onWin` (A5) and a scene router with a
   mount/unmount contract in the UI — the two seams all of set.crawl sits on.
10. Close I1 (lock-aware reform floor) + add T1/T2 invariant fuzz.

**Design debt (before/while authoring crawl content):**
11. Structural anti-stall (universal soft-enrage) — the #1 threat to the fun.
12. Colorblind redundant encoding + CVD palette — the #1 accessibility gap.
13. Doc sweep: update THEORYCRAFT/CRAWL headers, strike resolved GAME-DESIGN §7
    items, fix TRAPS numbers, write `TUNING.md`, document the consumables/buff
    system and the Trap/Trick convention.
14. ~~Add 1-2 non-flood Tactics verbs~~ — SUPERSEDED by the Tactics v2 stance
    redesign (TODO.md "NEXT BATCH", planned 2026-06-09), which absorbs this via
    verb stances (Ward). Still live: give each class one unique ability; add an
    all-Defend/magnitude trap (coverage rule).
15. Telemetry for spring-rate and reshape-share before mass content authoring.

**Pre-launch (whenever public):**
16. Rename the public-facing title (trademark); keep "SET-like" as descriptive
    copy only.
17. Daily seeded run + shareable result card (needs U5 tick coalescing first).
18. Audio pass (3 sounds minimum), `prefers-reduced-motion`, tap-to-toggle
    tooltips for mobile, run-end forensics line.
