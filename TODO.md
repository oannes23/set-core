# TODO — SET.combat / SET.crawl

Working backlog for the active prototype (`prototype/set-combat.html` + `prototype/game-data.js`).
Notes are written to be **implementation-ready later** — each item records intent, where it
lives in the code, and what (if anything) is a genuine engine change vs. pure data authoring.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## A. Foundation migration — dev tooling + modularization
`[ ]` **NEXT / largest structural effort.** The prototype is at the top of what a single ~2,700-line
HTML file should hold. The next move is **not** a server and **not** a Godot rewrite — it's a
same-stack split into modules with real dev tooling. Capturing the decisions + reasoning here so we
can begin.

### Decisions (and *why* — these are settled)
1. **Framework-free at runtime, dev-tooling-rich.** Split "dependency" in two:
   - **No runtime framework** (React/Vue/state libs/game-engine libs). This game does its own DOM
     rendering and owns `state`; a framework would *fight* that, importing a worldview to solve
     problems we don't have. Vanilla is viable in 2026 precisely because the platform absorbed what
     frameworks patched (ES modules, fetch, custom props, grid). This is the *forward* step, not retro.
   - **Yes to build/dev tooling** (ships nothing to the player, all boring + removable): a **bundler
     (Vite)**, a **test runner (Vitest)**, and **TypeScript**. Payoff is exactly our pain points —
     module boundaries, real unit tests (today testing means regex-extracting the `<script>` + driving
     Chrome over DevTools Protocol), and types to encode the implicit contracts (card = 4-tuple
     `[color,shape,pin,number]`, the token vocabulary, the trap-effect schema, spec shapes). CLAUDE.md:
     *every bug so far has been in the UI layer* — that is the exact class TypeScript eliminates.
   - **Guardrail:** a *runtime* dep must earn its place against "could I write this in ~50 lines?"; a
     *dev* dep just needs to be boring + widely used. TS adoption is gradual (`.js`→`.ts`, `strict` later).
2. **Ship via a wrapper, not a port.** Web client *is* the shipping client: PWA on web, **Tauri** for
   desktop/Steam, **Capacitor** for mobile. Godot is deferred indefinitely — it would mean rewriting
   the engine in GDScript/C# and throwing away the hard-won *feel* layer, to buy console publishing we
   don't need yet. Re-evaluate only if a web-unreachable target becomes a real goal.
3. **Defer multiplayer, but build the seam now.** Don't write netcode. Do enforce one discipline (see
   step 6) so we can "turn it on" later: the engine operates on a `state` it does **not** own, mutated
   **only** through actions/events. Then a server can become the authority and the client replays events.

### Recycle vs. rebuild — it's a *per-layer* decision, not one call
The codebase already separates into four layers; each gets a different answer. (Avoid the
"spec-it-all-then-reimplement-from-scratch" trap: code encodes thousands of small correct decisions a
spec never captures — lock-before-transmute ordering, `gap`-delayed regen, the clock-cap fix. Refactor
**under the old prototype as a behavioral oracle**, don't clean-room it.)
- **`core/` — generation math:** **recycle verbatim.** Pure, 100k+ validated clears, zero invariant
  violations. The *last* code to ever rewrite. Conformance-gate it with the existing invariant sim.
- **`data/` — content (`game-data.js`):** **recycle as-is**, already the portable JSON→YAML artifact;
  just add TS types / a schema.
- **`engine/` — resolution, traps, tactics, targeting:** **recycle the design, clean the structure**
  (~⅔ of the logic lifts over). The right abstractions were already discovered through play (effect
  vocabulary, selector grammar, spec→spec transforms, trigger bus) — the "spec" mostly exists in the
  code's shape; write it down to guide a *refactor*.
- **`ui/` — render, CSS, fx, coaching:** **the one layer to intentionally rebuild** (least principled,
  where the bugs live), behind the now-clean engine boundary. Preserve the hard-won *feel* decisions
  (burst format, flash/shake intensities, animation timings, coaching flow) as spec.

Net: ≈100% of math + data reused, ~⅔ of engine logic, UI rebuilt. Staying in JS/TS means "rewrite into
a separate stack" collapses into "refactor into modular TS" — which is why recycle dominates.

### Migration steps (ordered)
- `[x]` **0. Tag the current build** as `proto-reference` — the behavioral oracle we diff against. (Tag
  pushed at `dda6cf0`.)
- `[x]` **1. Scaffold** Vite + Vitest + TypeScript (no framework), pnpm. `src/{core,data,engine,ui}/`
  alongside `prototype/`. Entry is `app.html` (root `index.html` stays the legacy launcher — promote
  app.html→index.html once the app supersedes it). Scripts: `dev`/`build`/`preview`/`test`/`typecheck`.
  Seeded `core/affine.ts` (the `third`/`isSet` primitives) + tests as the proof-of-harness. Verified:
  `pnpm test` 4/4, `typecheck` clean, `build` ok, `dev` serves.
- `[x]` **2. Extract `core/`** — `affine.ts` (third/isSet/keyOf/eq), `sets.ts` (findSets/kOfSet/boardKInfo),
  `generate.ts` (genInitial/patch/patchFavor/boardFindDist), `rng.ts` (injectable + seedable). Cleanups
  over the prototype: `state`/`CFG`/`regenBias` globals → explicit params; `Math.random` → an injected
  `Rng` (deterministic, and the basis for replayable/server generation later); per-axis weight bias
  generalizes `dealShape`/`regenBias`. Conformance gate `generate.invariants.test.ts` ports
  `sim-invariants.mjs` (full dial space, 0 violations) + a focused locked-combat (f3/n15/k1) test.
  `pnpm test` 10/10 in ~2.5s, typecheck clean.
- `[x]` **3. Extract `data/`** — `schema.ts` (token-validated types: axis-correlated conditions/biases,
  effects, traps, creatures, variants, templates, dungeons) + `game-data.ts` (content ported verbatim
  as a typed `GAMEDATA` const). `game-data.test.ts` enforces **parity** with the prototype oracle (deep
  equal → no drift) + referential integrity of every id (foe/trap/drift/template/mirror/extends). Content
  stays pure JSON-shaped (YAML-portable); types are authoring-time only. `pnpm test` 14/14, typecheck clean.
- `[ ]` **4. Extract `engine/`** — resolution, traps (`TRAP_EFFECTS`), tactics, targeting toolkit, the
  trigger bus. Lift + type; refactor opportunistically; verify behavior against `proto-reference`.
- `[ ]` **5. Rebuild `ui/`** intentionally (render, fx, coaching, briefing) behind the engine boundary.
- `[ ]` **6. Multiplayer seam:** make `engine` reduce `(state, action) -> state` / emit events; route
  ALL mutation through it. No netcode — just the shape that lets a server slot in as authority later.
- `[ ]` **7. Wrapper smoke test:** confirm the built client runs as a PWA and under Tauri (and Capacitor
  when mobile matters) — cheap to verify early, avoids surprises.

### Hosting — GitHub Pages CI deploy (done)
`[x]` `.github/workflows/deploy.yml` builds on push to `master` and publishes to Pages. Pages serves
static files only — pnpm/Vite/TS are **build-time**, never on the host; we publish the compiled `dist/`.
The workflow folds in the still-static **prototype** (the playable game during migration) + the launcher,
so the live site is useful *now*. Build uses `base:/set-core/` (project sites live at a subpath); dev
stays at root, `vite preview` mirrors the subpath (`isPreview`). Verified against a Pages-mimicking
static server (app renders + all assets/prototype 200 under `/set-core/`). **Live** — Pages Source is
set to "GitHub Actions"; the built app + prototype both serve from the CI artifact at
`https://oannes23.github.io/set-core/` (play link: `…/prototype/set-combat.html`).

### "Graduate the prototype" triggers (recap)
- **Now-ish → do this migration** when adding the *second screen* (town / run-map / inventory) or the
  *first persisted progression*. Don't add a third major system to the single file.
- **Stand up a server** only when progression must be authoritative/cross-device, or any player↔player
  interaction is wanted. The seam (step 6) is built; the server is implemented then.

---

## 4. Tutorial dummy · gauntlet scaffold · 3 themed teaching foes · trap/wound feel
`[x]` **DONE.** Verified at runtime via Chrome DevTools Protocol (29 assertions, all green).
- **Training Dummy** (`training_dummy`): 0 damage, 30s, no trap — the guided tutorial's foe so nothing
  swings at you mid-lesson. (Fixed `weightedRoll(0)`→1 so 0 truly means 0; `enemyAttack`/`narrateEnemy`
  read "harmless".) The `tutorial` dungeon is now first/default; `training` is the gauntlet.
- **Numeric speed**: `speed` may be a raw cadence (seconds) as well as a named band (`speedSeconds`).
  `cadenceBand` gained `Torpid` (≥22s) and `Glacial` (≥40s) labels.
- **Gauntlet scaffold**: a dungeon `sequence:[foeIds]` fought in a row. `state.sequence`/`seqIdx`,
  `applyFoeToState`, `onWin()` (advance-or-end), `advanceSequence()` (briefing between foes), a
  "▶ Run the gauntlet" picker option (default for sequence dungeons). Each foe = fresh board/HP.
- **Per-foe damage rules** (`state.foeRules`, `foeRule()`): `immune_card_damage` (set damage → 0) and
  `ability_damage:"mana_spent"` (intrinsic spell dmg nullified; each cast drains by mana spent, via
  `castDamageHook`). Briefing now shows a foe `desc` (flavor) + a gauntlet "X of Y" badge.
- **The three teaching foes** (`training` sequence): `limbless_zombie` (30 HP, traps) → `dread_behemoth`
  (50HP / **120s** / 100dmg — all carrot, no stick: `tremor` tick channels useless **Defend** cards →
  **Moves**, `outmaneuvered` rewards each all-Move set with **+5s** (`delay_attack`). No timer reduction
  anywhere — failing to grab Moves simply isn't rewarded, never punished) →
- **Clock-cap fix** (`clockCapSec()` = `max(CLOCK_CAP, cadence)`): the old absolute 20s cap *cratered*
  any foe whose cadence exceeded 20s — the first Move slammed a 120s clock down to 20s. Now Moves push
  *up to* the foe's full interval; fast foes still cap at 20. Applied to every clock-push site.
  `unstable_ethereal_goblin` (15HP, swords immune, `ethereal_cackle` melts Attacks→Moves → spend
  mana on abilities to finish him).
- **Limbless roll = delayed regen**: the trap's transmute now carries `gap:5000` — the knocked-out
  bottom-row cells stay EMPTY for the 5s lock, then "get up" and reform as Moves. (Reused the existing
  `transmute` `gap` param + `TRAP_EFFECTS.transmute` passthrough.)
- **Feel**: trap popovers now include the trap's visceral flavor line (`tbflavor`); a sprung trap gives
  a **yellow** tint flash + small board shake (`boardFlash("trap")`), a **wound** gives a **red** flash +
  bigger, heavier shake (`boardFlash("wound")`).

---

## 1. New foe — "Limbless Zombie" (training dummy) + "Training" dungeon
`[x]` **DONE.** Data in `game-data.js` (`limbless_zombie`, `limbless` trap, `training` dungeon —
default). Engine: compound `when.all` trigger (`trapCondMet`/`condLabel`/`normCond`) + geometry∩value
`selectSlots`. Lock-first/transmute ordering gives the "already-Move cards lock, rest warp" feel.
Speed = `lumbering` (19s, the system floor). Verified by `/tmp/test-limbless.mjs` (6/6 logic asserts).

### Intent
A deliberately gentle, legible first opponent. A zombie with no limbs, chin-crawling toward
the player — almost no clock pressure, trivial chip damage — whose single signature move
teaches the player that *matches have consequences* without ever feeling punishing.

### The creature (data — `game-data.js → creatures`)
```
limbless_zombie: { name:"Limbless Zombie", tier:"minion",
                   hp:100, speed:"lumbering", damage:3,
                   traps:["limbless"], variants:[], xp:?, loot_tier:1 }
```
- **HP 100** — high so a new player gets lots of time-on-board; it's a sandbag, not a threat.
- **Speed = slowest the system allows.** ⚠️ DECISION NEEDED. The current bands top out at
  `lumbering: 19s` (`game-data.js → speed`, and `SPEED_ORDER` index 0 in set-combat.html
  ~L2234). `speed_band` mods can't go below index 0, so **19s is the floor today.** Options:
    1. Accept `lumbering` (19s) as "slowest possible." Simplest; honors "within the bounds."
    2. Add a new slower band (e.g. `comatose: 26`) at the front of `speed` + `SPEED_ORDER`.
       This is a 2-line change but it shifts every `speed_band:-1` mod's meaning — audit first.
  Recommendation: ship with `lumbering` now; only add a band if 19s still feels too fast for
  a true dummy. (At 19s cadence and 3 dmg, it threatens ~9 HP/min — basically harmless.)
- **Damage 3** — the "low damage bite," well under the goblin's 10.
- **`variants:[]`** — a training dummy must NOT roll a random adjective/trap. Verify
  `assembleFoe()` (~L2246) tolerates an empty variant pool and just skips the roll. (It pushes
  authored `base.traps` first, then rolls a variant — empty pool should no-op. CONFIRM.)
- Authoring the signature as a **creature-level `traps:[...]`** (boss-style) rather than a
  variant keeps it pinned to this one creature and out of the random pool.

### The signature trap — "Limbless" (data + ENGINE WORK)
**Trigger:** the player completes a set that is **all Move AND all 1s** (all three cards are
the "Move / magnitude one" card-type on their shape & number axes).
**Fantasy:** the zombie sees you shuffling your feet (all-Move) and lurches — "rolls at you."
**Effect:** transmute the **entire bottom row** with a bias toward **Move**; AND every card in
that bottom row **that was already a Move** is **locked for 5s**.

Proposed data shape (NOT yet expressible — see engine notes):
```
limbless: { name:"Limbless", icon:"🧟", on:"match",
            when:{ all:[ {axis:"shape",  mode:"all_same", value:"move"},
                         {axis:"number", mode:"all_same", value:"one"} ] },
            desc:"all-Move + all-1s match → the zombie lurches: bottom row warps toward Move; cards already Move lock 5s",
            do:[ { effect:"transmute", select:{geometry:"row", which:"bottom"},
                   bias:{axis:"shape", value:"move", intensity:1},
                   lock_pretransmute:{ match:{axis:"shape", value:"move"}, seconds:5 } } ] }
```

**What's already supported (no work):**
- `geometry:"row", which:"bottom"` — `geometrySlots()` / `rowSlots()` handle it (~L1382–1400).
- `bias:{axis:"shape", value:"move"}` — `trapBias()` maps shape biases (~L2084).
- `lock` effect + the makeable-set floor guard — `lockSlots()` (~L1411) already exists.

**What needs ENGINE work (the real cost of this item):**
  1. **Compound trigger condition.** `trapCondMet()` (~L2058) evaluates a SINGLE `when.axis`.
     "All Move AND all 1s" needs an AND of two axis-conditions. Add a `when.all:[...]` form:
     `if (when.all) return when.all.every(c => trapCondMet(c, desc));`. Small, clean, and
     reusable (variants could want it too). Also extend `condLabel()` (~L2153) +
     `normCond()` (~L2215) to walk the `all` array (token-normalize each sub-condition).
  2. **"Lock the cards that were ALREADY Move, then transmute" — order + snapshot + intersect.**
     The current `select` grammar is geometry **OR** value-filter, never their *intersection*,
     and there is no before/after snapshot or data hand-off between effects in a trap's `do[]`.
     Three viable designs, easiest → most faithful:
       - **(a) Lock-first, separate effects.** Emit two `do` entries: first a `lock` whose
         select is the bottom-row ∩ Move, then a `transmute` of the bottom row. Because
         `selectSlots`/`liveSlots` skip locked cards, the locked Moves won't be re-rolled and
         stay Move+locked, while the rest warp toward Move. Requires only the **region∩value
         select** (compose `geometrySlots` ∩ value predicate). No snapshot needed — locking
         first IS the snapshot. **Recommended.** Cleanest, and the feel matches the prose.
       - **(b) Snapshot then sequence.** Run transmute, but capture the pre-transmute Move
         slots in the bottom row and lock that captured set after. Needs effect-to-effect
         state passing — more plumbing, only chosen if we want the locked cards to also re-roll.
       - **(c) Per-effect inline directive** (the `lock_pretransmute` field sketched above) —
         a one-off; avoid, doesn't generalize.
     Pick (a). It adds exactly one general capability — a **compound select** (geometry ∩
     value) — which is independently useful for future traps.

  Net: ~2 small, *general* engine additions (compound `when.all`, compound `select`), both
  worth having in the vocabulary regardless. Everything else is data.

### The dungeon (data — `game-data.js → dungeons`)
```
training: { name:"Training", difficulty:0,
            theme:null, drift:null, boss_mirror:null,
            enemy_table:[ {foe:"limbless_zombie", weight:100} ],
            elite_pool:[], boss:null, template:null }
```
- **No inherent traps**: `drift:null`, `template:null`. The *only* threat in the room is the
  Zombie's own Limbless trap — nothing ambient, nothing on a timer. Clean teaching space.
- `boss:null` / `elite_pool:[]` — `populateFoes()` (~L2324) already guards empty pools.

### Make it the DEFAULT selection
Today `populateDungeons()` defaults the dungeon `<select>` to the first key of
`GDATA.dungeons` (~L2320) and `populateFoes()` forces the foe to `"random"` (~L2334).
To make Limbless-Zombie-in-Training the no-touch default:
  - Put `training` first in the `dungeons` object **or** add an explicit `default_dungeon`
    key the populater reads.
  - Add a `default_foe` to the dungeon (e.g. `default_foe:"limbless_zombie"`) and have
    `populateFoes()` honor it instead of hard-coding `"random"`.
  - Keep "Custom (sliders)" and "Random encounter" in the list — just not selected.

---

## 2. Remove the 0.5s delay before set-mate glow
`[x]` **DONE.** `GLOW_DELAY=0` in `set-combat.html` (glow now fires the instant you select). Kept the
constant + a comment so it can be re-gated per-difficulty for a future hard mode.

### Intent
New players who don't already know *Set* can't see how cards combine, so they bounce. The
set-mate teal glow is the single best teaching aid we have — but right now it's gated behind a
**deliberate `GLOW_DELAY=500`ms "time cost"** so experts don't get free findability. Every
*Set*-literate tester loves the game; every newcomer bounces. The glow should fire **instantly**
on selection so it actively guides the eye.

### Where
`set-combat.html` ~L1123–1150:
- `const GLOW_DELAY=500;` (~L1125) — set to `0` (or remove the `setTimeout` and call
  `paintSelectionGlow()` synchronously in `updateSelectionGlow`, ~L1149).
- Update the explanatory comment block (~L1123) — it currently sells the delay as an
  intentional handicap; that rationale is being reversed.

### Watch-outs
- The hover-spell preview path also `clearTimeout(glowTimer)` (~L1159) to suppress a pending
  glow under the preview. With an instant glow there's no pending timer, but confirm the
  preview still cleanly overrides the selection glow and restores it on mouse-out (~L1174).
- ⚠️ DESIGN TENSION: instant glow is a free findability boost — it makes the game easier for
  everyone, not just newcomers. That's acceptable (probably good) at the current f=3 board,
  but note it interacts with the difficulty levers in PROJECT.md §4 (k-bias / findability).
  If we later want a "hard mode," gating/removing the glow is the natural knob — consider a
  per-difficulty or accessibility toggle rather than a hard global `0` so we keep the lever.

---

## 3. Tutorial mode — guided, freeze-and-explain onboarding
`[~]` **Coaching layer BUILT (3a + 3b + the four shared primitives). Remaining: an event-triggered
"explain mid-normal-play" tutorial variant, and content polish.** The four primitives now exist in
`set-combat.html`: PAUSE (`state.paused`, honored by `tick`), SECTION GATES (`setSectionEnabled` +
`.coach-locked`), SPOTLIGHT (`coachSpotlight` + `#coachscrim`/`.coach-spot`), POPOVER (`#coachpop`).
The guided-intro match (3b) is a DATA script (`GUIDED_STEPS`) over them; `coachNotify(event)` is wired
to match/tactic/ability. Entry: the `tutorial` dungeon (`guided:true`) launches it on Engage.
Still open: (a) a tutorial that fires explain-popovers at trigger points during a *normal* fight
(first trap spring, first lock) rather than only as the staged intro — same primitives, new script +
more `coachNotify` hooks; (b) persist "seen"; (c) per-step copy review.

### Intent
Not really about *which* foe you face (though the tutorial foe should be specific & scripted) —
it's a **general teaching pattern**: at key moments, **freeze gameplay** (the same feel as
springing a trap) and show a **popover** that explains the mechanic the player just triggered
(or is about to), then walks them through *everything on the board* — how to read a card,
how to make a set, what the timer/clock means, what Tactics does, what an ability does, what a
trap/lock/transmute does when it happens to them.

### Building blocks that already exist (reuse, don't reinvent)
- **Freeze**: `hitstop(ms)` (~L2164) + `state.hitstopUntil` (~L1064) already pause the enemy
  clock and lock countdowns. The tutorial wants an *indefinite* freeze until "Next/Got it" —
  generalize hitstop into a held `state.paused` gate (clock, drift tick, lock countdown all
  honor it; the game loop ~L1618 already checks `hitstopUntil`).
- **Burst/popover infographics**: `spawnBurst()` / `trapBurst()` (~L2174) and the pre-combat
  `showBriefing()` modal (~L2290) are the visual grammar to extend for explanatory cards.
- **Element highlight**: `.card.hint` pulse (CSS ~L119) + `hintNow()` (~L1209) already pulse
  specific cards — reuse to point at "these three make a set," "this is the clock," etc.

### What's genuinely NEW (the work)
A **tutorial script/state-machine**: an ordered list of *steps*, each = {trigger, freeze,
spotlight target(s), copy, advance-condition}. Triggers are events on the existing buses —
e.g. "player selected first card," "player completed first set," "first enemy attack lands,"
"first trap springs," "first lock applied." On trigger: pause → dim board except the spotlighted
element(s) → show popover → wait for the player's required action (or "Next") → unfreeze.
  - Steps should hook the SAME event points the engine already emits (`updateSelectionGlow`,
    set-completion, `enemyAttack`, `fireEnemyTraps`, `lockSlots`) rather than a parallel code
    path — instrument those with a `tutorial.notify(event, ctx)` call guarded by a tutorial flag.
  - Needs a **dimming/spotlight overlay** (new CSS layer + a "spotlight these slot indices"
    helper) and a **popover component** with Next/Back/Skip.
  - Needs **gating**: in tutorial mode the clock should not kill the player; some steps require
    a *specific* action before advancing (e.g. "now make any set"). Soft-lock avoidance: always
    offer "Skip step."
  - A **scripted tutorial foe** (data): pair the tutorial with a fixed, fully-deterministic
    encounter (probably the Limbless Zombie from item 1, or a dedicated `tutorial_dummy`) so
    every step's trigger is reproducible — no random variants, fixed/dialable cadence.

### 3a. Reusable "affordance layer" — flashy READY signals (Training-dungeon flavor)
`[x]` **DONE.** `setCoachArrow(el,on)` + `.coach-arrow` (pulsing yellow chevron, grows + glows). Wired
into `updateSpells` (ability affordable) and `updateTacticsUI` (Tactics armed); gated by `state.coach`
(set from the dungeon's `coach:true`). Cleared on combat start/end.

When you're in the Training dungeon (and/or tutorial), the UI should *shout* when something
becomes usable, so a new player learns the cause→effect ("I matched Moves → the meter filled →
now I can press this"). Concretely: a **pulsing yellow arrow** that hovers above an element
and animates on **both size and glow** (grow + pulse) whenever that element crosses into a
usable state.

Targets and their existing "became-ready" hooks:
  - **Abilities with enough mana.** The render loop already computes this every frame:
    `el.classList.toggle("ready", state.running && canAfford(sp))` (~L2445) — `canAfford()`
    is at ~L2378. Attach the arrow when a slot gains `.ready`; remove it when it loses it or
    is cast. (The `.slot.spell.ready` glow at CSS ~L370 already exists; the arrow is the
    louder, newbie-facing layer on top.)
  - **Tactics meter armed.** `tacticsArmed` flips true at `tactics>=TACTICS_GOAL` (~L2505),
    and `renderTactics()` toggles the `#tacbtns .tbtn[disabled]` buttons (~L2527). Drop the
    arrow over the meter / the Strike-Dodge-Flee-Heat-Chill-Wild button row when it arms.

Design notes:
  - Build it as **one reusable element** — `spawnAffordanceArrow(targetEl, opts)` /
    `clearAffordanceArrow(targetEl)` — a single absolutely-positioned arrow that anchors to a
    target's bounding box, with a CSS keyframe doing the grow+glow pulse (yellow/gold —
    reuse `var(--gold)` / `var(--warn)`). NOT per-feature one-offs.
  - **Gate it by mode**, not hard-coded on: only fire arrows when `state.tutorial` or the
    active dungeon is Training (a `dungeon.coach:true` flag is the clean data toggle). Experts
    in normal dungeons never see them. This keeps it an onboarding aid, not permanent clutter.
  - Edge-trigger, don't spam: arrow appears on the *transition* into ready and persists while
    ready (a steady beckon), rather than re-firing every frame. Clear on use.
  - Same widget is reusable by the tutorial step-spotlight (3) — an arrow is just a spotlight
    that points instead of dims.

### 3b. Permanent dimming + the "Gradual Guided Introduction" match
`[x]` **DONE (v1).** `GUIDED_STEPS` script: sets → traps → tactics → abilities, each stage un-dims its
section (`setSectionEnabled`) and either freezes-and-explains (`hold`) or hands control back and waits
for the player to DO it (`await` → `coachNotify`). Launched by the `tutorial` dungeon. Future polish in
§3 above. Sections gated today: `tactics` (.tacticscol), `abilities` (.spellpanel), `traps` (#trapbar);
the board is always live and the clock is frozen during `hold` steps.

The tutorial freeze (3) dims everything but the spotlighted element *momentarily*. We also want
that dimming to be **holdable** — a section can stay dimmed/disabled for a whole stage — so we
can offer a **very gradual guided introduction match** that unlocks the UI one play-element at
a time. The player isn't taught a mechanic then dropped into the full board; instead each
subsystem is *literally inert and dimmed* until its stage.

Proposed stage progression (each stage un-dims + enables the next layer):
  1. **Basic set matching** — only the board is live. Abilities, Tactics, even the enemy clock
     are dimmed/paused. Goal: make N sets. (Instant glow from item 2 carries this.)
  2. **Avoiding traps** — enable the Limbless Zombie's trap (and the trap tags / `trapbar`,
     ~L2339). Teach reading a trap rule and *not* completing the line that springs it; then how
     to react when it does (the transmute + lock land, board recovers).
  3. **Tactics to influence the board** — un-dim the Tactics meter + button row (~L555–560).
     Teach filling it via Move matches and spending it (Strike/Dodge/Heat/etc.) to *reshape*
     the board on purpose. The 3a arrow fires here for the first time.
  4. **Abilities** — un-dim the spell slots + mana. Teach mana accrual, `canAfford`, and
     casting. 3a arrows fire over ready abilities.

Implementation notes:
  - This is the **same dim/spotlight overlay as the tutorial (3), held open per stage** rather
    than per popover. Build the dimming primitive once: a `dimExcept(selector|slotIdxs)` /
    `setSectionEnabled(section, bool)` helper that adds a `.coach-dim` class (non-interactive,
    lowered opacity) to a UI region and clears it when the stage advances. The tutorial uses it
    transiently; the guided match uses it persistently — one mechanism, two cadences.
  - Sections to make independently dimmable/enableable: the **board**, the **enemy clock /
    combat bar**, the **trap bar**, the **Tactics panel**, the **ability/spell panel**. Tag
    each region so the helper can target it. (Several already have stable containers —
    `#tacbtns`, the spell slots, `#trapbar` — confirm/IDs the rest.)
  - Stage advance = a scripted condition met (like tutorial steps): "completed 3 sets,"
    "survived one trap spring," "spent Tactics once," "cast one ability." Reuse the same
    `tutorial.notify(event, ctx)` event bus from item 3.
  - Author the stage list as **portable data** (`game-data.js → guided:[...]`), copy + which
    section to reveal + advance-condition, mirroring the trap data pattern.
  - Likely the same scripted, deterministic foe as the tutorial (Limbless Zombie / a
    `tutorial_dummy`) so each stage's triggers are reproducible.

This (3b) and the freeze-and-explain flow (3) are two faces of one subsystem: a **coaching
layer** = {pause/freeze gate} + {dim/spotlight primitive} + {affordance arrows (3a)} +
{scripted event-driven step/stage list}. Build those four primitives once; the tutorial and the
guided-intro match are just two scripts over them.

### Open design questions (decide before building)
- **Authoring format.** Keep the step list as portable data (`game-data.js → tutorial:[...]`,
  YAML-bound per the portability contract) with copy + trigger tokens + spotlight selectors,
  and the *scripted behavior* in the engine — mirrors how traps are data + engine effects.
- **Scope of v1.** Minimum teaching set: (1) read a card's 3 axes, (2) make your first set
  (instant glow from item 2 helps), (3) the clock / enemy attack, (4) Tactics, (5) one ability,
  (6) get hit by one trap (transmute) and one lock, and how to respond. Abilities/passives/
  mana could be a "part 2."
- **Entry/exit.** Auto-launch on first run? A "Tutorial" entry in the dungeon picker
  (difficulty 0, like Training)? Both — Training dungeon as the post-tutorial sandbox.
- **Replayability / skippable.** Persist "tutorial seen," allow replay from a menu.

### Sequencing note
Items 1 and 2 are prerequisites for a good tutorial: the Limbless Zombie is the natural
tutorial foe, and instant glow is half the "make your first set" lesson. Build 1 → 2 → 3.
