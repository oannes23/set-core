# TODO — SET.core / SET.crawl

Working backlog for the **live modular game** (`src/` — `core`/`data`/`engine`/`ui`, run with
`pnpm dev`). The single-file prototype (`prototype/`) is the archived behavioral oracle. Each
item records intent + where it lives; the detailed completion notes for finished work live in the
git history and the design docs (`PROJECT.md`, `GAME-DESIGN.md`, `TRAPS.md`, `CRAWL-DESIGN.md`).

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Convention — Trap vs Trick (settled)
A reactive trigger is one mechanism (condition → effects); a `kind` field gives its valence:
**Trap** = hostile, avoid (⚠ yellow flash); **Trick** = favorable, aim for (✦ green flash + green
strip + coach arrows on the makeable line, coach-mode only). Default `kind` is `trap`. The data
collection stays named `traps` (parity with the prototype); `Trigger` is the forward umbrella alias.
Traffic-light: green = pursue · yellow = consequence · red = wounded.

---

## ⭐ BUILD ORDER — the active progress tracker (set 2026-06-14; UPDATE on every implementation)
Agreed sequence: **complete the core loop (combat → inventory → leveling → content), then enrich, then the meta.**
Detailed specs live in CRAWL-DESIGN.md + the sections below; this is the master checklist — tick items as they land.

### Phase 1 — Combat core *(engine; self-contained, validated)* ← ACTIVE
- `[x]` **1a. Selection-protected turnover** (hard rule #6) — **BUILT 2026-06-14** (`selected` on `CombatState`,
  UI-synced each dispatch; `protectedSlots` in select.ts; filtered in `transmute()` when `source` is set, so
  AUTOMATIC turnover — churn/drift/trap/trick — skips a selected card or its set-mate, while a deliberate player
  cast is exempt; carried in `cloneState`). User chose the **aggressive scope** (shield all set-mates from the
  1st selected card). 4 new tests (`protection.test.ts`); 138 green; typecheck clean.
- `[x]` **1b. Dread escalation engine** (CRAWL §5.8) — **BUILT 2026-06-14.** Drift curve validated (sim §10).
  `state.ts`: the meter (`dreadLevel` = floor + 0.5·round, OFF for coach) + `dreadFoeMult`/`dreadPlayerMult`/
  `dreadBleed`/`driftRateMult` (sim §7/§10 numbers). Wired: drift tick-rate accel · foe mult into the telegraph
  AT REVEAL + trap/tick damage · player mult on attack (rollover) + heals (ops) · the unguardable per-round
  `dreadBleed` (bypasses Block); depth floor from the delve band, coach-exempt. Functional two-motion dread meter
  in the HUD. 7 dread tests (5 unit + 2 behavioral end-to-end); 145 green; typecheck + production build clean.

### Phase 3 — Progression tangible ← ACTIVE *(re-ordered ahead of Phase 2 — 2026-06-15, user pick: "give the game legs")*
- `[x]` 3a. Level-up modal — **BUILT 2026-06-15.** Free **+6/≤3** allocation (per-stat ± steppers, "N left", confirm at
  exactly 6); was the rigid 3/2/1 picker. Data layer already supported it; UI enforces sum-6/≤3. tsc + build clean.
- `[~]` 3b. Dungeon difficulty ladder — **FIRST RUNG BUILT 2026-06-15: The Emberdeep (D2, L7).** A deeper/hotter
  descent below the warren — 7 new foes on the parity-22 line (HP level-invariant; stats carry the level), reusing
  the ember drift + existing traps/variants. Auto-appears in dungeon-select; data-integrity test green. So the dread
  depth-floor + the outlevel penalty now have a real stage (outgrow the warren → move to the Emberdeep). STILL OPEN:
  D3–D5 rungs (the haunted_warren is labelled D3 but its foes are L3 — re-level or replace) + the procedural/ability↔trap path.

### Phase 2 — Inventory loop *(DEFERRED — pairs with the shop/B4 so consumables aren't finite-without-a-refill)*
- `[ ]` Storage UI (the bag screen) · loadout-from-Storage (`takeFromStorage`, survivors auto-return)
- `[ ]` satchel `string[]` → `Item[]` (delve.ts + app.ts — the heaviest refactor surface)
- `[ ]` bank kept items home on safe exit · retire `SavedChar.consumables` · return triage (keep→Storage / sell→Gold @20%)

### Phase 4 — Run-loop enrichment
- `[ ]` Between-rooms approaches (5 verbs at the fork) + voluntary-activation preview + Speed→round-1

### Phase 5+ — Big systems *(design-gated / deep deps)*
- `[ ]` Ability system (loadout/equip + cooldowns + spellbooks) · `[ ]` Gear B3 (affixes — design gate first)
- `[ ]` Achievement meta-layer → guild halls + bounties → town amenities

---

## Done (summaries — detail in git history + design docs)

- **Foundation migration (§A).** The modular `src/` client is the live game at full combat parity
  with the prototype: a pure, deterministic `reduce(state, action) → {state, events}` engine
  (generation, resolution, the trigger bus, abilities/passives/tactics, foe assembly), the rebuilt
  UI, the multiplayer/replay seam (`session.ts`), and a PWA + GitHub Pages CI deploy. The prototype
  is archived under `prototype/` as the oracle (`game-data.test.ts` enforces data parity).
- **Threat layer (`TRAPS.md`).** Enemy traps/tricks fire on the trigger bus (condition/cadence,
  no enemy resources); the four board verbs (destroy / transmute / lock / conditions), named geometry
  selectors, compound `when.all`, geometry∩value selects, and dungeon drift are built in `src/engine`.
- **Teaching layer.** Tutorial dummy + Training gauntlet (limbless zombie → dread behemoth →
  ethereal goblin); the coaching layer (pause / section-gates / spotlight / popover / affordance
  arrows) + the guided-intro script; instant set-mate glow.
- **UX / feel pass.** Verb-distinct card motion (resolve pop / transmute morph / destroy boom /
  reform / wound gap), the wound-shatter mechanic, severity-scaled flash, mana-gain sparks,
  reactive-transmute ripple, clock-shove kickback, the **moat** card-glow visibility system,
  gimme-scaled teal set-mate hints, the combat-log facelift (`flavor.ts` + data-driven foe voice),
  end-of-combat summary chart, lock stripes + live countdown, trap-armed chip pulse, low-HP vignette.
- **Balance pass.** Slower enemies (≈12s average; bands 8/10/12/15/20), a 3s start-grace clock
  freeze (read the board before the first strike), Tactics renamed to **Attack / Defend / Move**
  (Flee is now a standalone any-time button), Defend overflow → a low-weighted Tactics trickle
  (block stays capped; stacks with the Sentinel attack).

---

## NEXT BATCH — Tactics v2: the stance system (planned 2026-06-09)

Replace the armed meter + one-shot flood buttons with a **stance selector**: the player sets a
standing **field preference**, and Tactics income (Move sets, Defend-overflow trickle, Tactician)
drives **continuous deadest-card turnover** toward the stance — the player-side mirror of dungeon
drift. Rationale + trade-offs discussed 2026-06-09 (the meter was "a good resource, a weak
decision"; a stance makes board-shaping a standing read and makes TRAPS §5.5's reshape-share
directly playable). Pointer note lives in `CRAWL-DESIGN.md` §5.5; the full v2 spec is the first
deliverable of this batch.

**Settled in design discussion (2026-06-09/10):**
- **Verb-then-parameter UI:** you select a TACTIC (the verb); its sub-UI exposes its parameter.
  Launch roster = TWO tactics: **Maneuver** (active: charges churn the deadest card toward your
  chosen bias; sub-UI = axis/value picker incl. shape & magnitude) and **Stand Ground** (passive:
  banked charges intercept hostile board verbs as they fire — dungeon drift, enemy transmutes,
  locks, wound-shatters; never raw damage; sub-UI = charge pips). Stand Ground absorbed and
  simplified the old "Ward/Mend" ideas — prevention only, no active repair. **Swapping tactics
  RESETS your charges and takes a few seconds to begin accumulating again** (supersedes the
  earlier free-with-lull rule) — picking your tactic is a commitment, which is what makes the
  choice real. Shelf: **Scout & Scavenge** = RUN-fork verbs, not combat (notes below).
  **Salvage** (churn→mana) = gear-unlocked later. **Disrupt** (delay enemy ticks) = shelved, it
  undermines dread/anti-stall. Bait = rejected.
- **Income (charges):** **+1 per Move CARD in the matched set** (shape-rainbow = 1, all-Move = 3;
  magnitude stays tempo-only) **+ excess timer** (clock pushed past cap) **+ excess block** (past
  max HP). NO excess-mana or excess-healing income — those are pure loss. **Mana cap 15** (new;
  gear-raisable later) — closes the open mana-cap gap; storing/chaining casts stays viable.
- **Pure flow** (no surge valve) · **serial queue** — charges spend ONE AT A TIME (deadest
  re-evaluated after each morph; never a batch flash), modest queue cap (~5, overflow wasted) ·
  **switching free with a brief lull** (~3-4s churn pause, no loss).
- **Warlord passive → "Adaptive Tactics":** your charges PERSIST through a tactic swap (and the
  spin-up is skipped) — the stance-dancer, rebuilt against the harsher swap-resets baseline.
- **Run-fork verbs (notes for the B2 room-variety pass, not this batch):** **Scout** — spend at
  the fork: telegraphs what the next room holds AND grants extra board-preview seconds before the
  enemy clock starts in the next fight (grace ends instantly on your first match). **Scavenge** —
  its foil: a loot bonus (shape TBD). These live alongside the bigger run-variety thread: StS-style
  non-combat room encounters, dungeon merchants, camp spots — to be designed when the run loop
  deepens; more fork verbs will likely emerge there.
- `[x]` **Set-mate hint rework (prereq, DONE):** teal glow → wind-FLUTTER micro-shake (amplitude
  scales with gimme; completer = hard rattle; tutorial keeps gold glow; reduced-motion falls back
  to static frames) — frees the glow channel for future hint layers.

Build scope:
- `[x]` **Design spec (CRAWL §5.5 v2): WRITTEN** — the charge/income model, Maneuver + Stand
  Ground, swap-commitment, remaps, and the full ability-translation table + Calls tiering
  (Tier-1 generic shape Calls speced; Tier-2 geometric class signatures sketched for B4).
- `[x]` **Engine — BUILT (2026-06-10):** charge queue + Maneuver churn (serial, deadest-first) +
  Stand Ground interception (`ops.tryWard` — drift/transmute/lock/shatter, tricks exempt, never
  damage); income (+1/Move card, excess timer, excess block 1:2; spin-up loses income); mana cap 15;
  `setTactic`/`setBias` actions; Vigilance drains charges (data amounts halved in-engine);
  Invisibility fills the queue; Rally → tactic-aware deadest×3; Tactician → Adaptive Tactics;
  3 Tier-1 shape Calls (callarms/callshields/callhunt) + previews. 8 new v2 tests; fuzz drives
  setTactic/setBias; 85 passing.
- `[x]` **UI — BUILT (2026-06-10):** Maneuver/Stand Ground toggle + 9-chip bias picker (click-again
  clears) + Stand Ground note, charge gauge (re-forming… during spin-up), warded/charge log lines +
  floats, guided-intro Tactics stage rewritten (bank a charge → set a bias; coach arrow on the bias
  row). Churn renders via the existing calm-morph transmute animation.
- `[x]` **Tug-readability pass — BUILT (2026-06-10):** ① LOUD attribution (tune down, not up):
  every non-player transmute carries a `source` (churn/drift/trap/trick); the arriving card is
  edge-lit by who pulled it + a glyph floats off the slot (⚙ you / drift-icon them / ✦ trick).
  ② Drift chip in the strip (ambient violet, not trap-red) with a LIVE "next pull Ns" countdown +
  fire pulse (⏸ under Hourglass). ③ Ward beat: gauge pip-burn + board-edge shield shimmer.
  ④ TUG BAR (player-facing, in the HUD above the board): board COMPOSITION — enemy-theme share vs
  your-bias share over live cards, marker = differential; shown only when both ends exist.
  ⑤ DEV instruments (always-on dim row below the board, not a feature): reshape share vs the
  TRAPS §5.5 65–70% target, trap-spring rate vs ~30%, sets/min, gimme%, wards, churns — off-target
  values turn warn-colored. The §5.5 telemetry is finally measured.
- **Pre-Resolution-v2 readings (2026-06-10, third playtest):** Warlord reshape 72% / spring 40% /
  s.m 18.1 / gimme 87 / wards 1 / churns 9 · Cowardly Archer reshape — / spring 25 / gimme 100 ·
  Butcher reshape 96 / spring 13 / wards 13 / churns 0 · Plagued Oracle reshape 100 / spring 32 /
  wards 14 / churns 0. NOTE: 96–100% readings were an INSTRUMENT ARTIFACT — warded enemy reshapes
  vanished from the count (fixed: a ward now logs the foe's attempt). **Feel verdict: no pressure
  or urge to swap tactics; Stand Ground vs Maneuver lacks felt difference; tactics UI "a little
  off."** Volume-up pass landed (stance auras on the board edge, swap flash, sprite stance badge,
  stronger toggle styling). Root cause is partly structural: pre-v2 the generous board made
  composition low-stakes — re-read AFTER Resolution v2 (shape mix is now the action economy).
  ⚙ Mechanical sharpeners PROPOSED (decide after v2 playtest): **Braced** (Stand Ground charges
  each reduce a telegraphed incoming by 1 — the defensive stance meets the windup system) and
  **Primed** (a Maneuver-churned card matched within ~6s counts one quality tier higher — your
  tide creates value, not just composition).
- **Post-Resolution-v2 readings (2026-06-10, fourth playtest — instrument now honest):** reshape
  75 / 56 / 59% (bracketing the 65–70 target from both sides), spring 24 / 27 / 25%, sets/min
  16.4 / 16.8 / 12.2, wards 7/5/9 AND churns 11/10/5 — stance swapping is live play now. Verdict:
  "these numbers feel pretty good; the slower more deliberate game poking through feels better."
- `[x]` ~~**Attack meter must SHOW the telegraph**~~ — RESOLVED BY ROUNDS v3 (the bar IS the
  round; the telegraph is part of the deal). The build rides the v3 batch below.
- `[x]` ~~⚠ Quick foes still feel too quick~~ — RESOLVED STRUCTURALLY BY ROUNDS v3: every foe
  gives the same 20s of scan; foe speed = exchange cadence/behavior, never scan pressure.

### ⭐ SETTLED (2026-06-11) — ROUNDS v3: the 20-second round grammar (NEXT COMBAT BUILD)
**Full spec: `CRAWL-DESIGN.md` §5.6.** The Move/Defend collision resolved itself by
generalizing the draw-phase idea: ALL three verbs round-batch (accumulate → exchange).
Headline decisions: **20s rounds** = THE pacing constant (every combat time number rebases to
rounds) · telegraph revealed at the deal (Defend = allocation vs a known number, the live-action
Spire turn) · rollover ≤ ~2.5s diegetic, never a modal: player swing first (**lethal cancels —
the kill-race**, symmetric both ways) → enemy swing → Maneuver dump → deal → new telegraph +
queued stance locks · live mid-round: spells/mana (the panic-button lane), traps/tricks, drift,
SG wards, instant **NEUTRAL** refill (BIAS_W only via the dump) · **stance economy**: Stand
Ground = banker (wards live — 1 charge/board verb, 3/wound — and carries over), Maneuver =
dumper (never wards; burns ALL at rollover → N deadest NOT-already-matching cards redraw to
bias; zeroes) · **CHARGE_CAP 15** (exact both ways: 5 wounds × 3 = 15 = the whole board) · the
**Tactics WHEEL** (SG center w/ braced-figure icon; shape arc top, color arc bottom; magnitude
bias CUT deliberately — heavy boards = gear/Hone only) · **wounds computed, never authored**:
floor(dmgSuffered/(maxHP/10)) summed per exchange, cap 5; heals repair ceil(heal/(maxHP/10));
1 reforms/draw phase, all at combat end · Adaptive Tactics → **Combined Arms** (+1 charge on
shape-rainbow sets) · foe speed = round BEHAVIOR (speed bands retire) · distinctness law held:
Move never denominated in HP (the Dodge-stance idea died — Defend owns round-scoped mitigation).
Lands WITH the decimal rebase (HP 100 / stats 10 — the /10 wound laws confirm the package).

Build scope (before B3 gear; doesn't collide with B2's run shell — combat-only):
- `[x]` **Engine — BUILT (2026-06-11):** round state machine (verb accumulators, rollover
  order, kill-race symmetry), telegraph-at-deal, stance lock/queue, SG live wards (wound = 3),
  Maneuver rollover dump (deadest NOT-matching; no-bias holds), neutral mid-round regen, wound
  inflict/repair/recovery laws, CHARGE_CAP 15, clock retired (+ SWAP_SPINUP/DMG_REGEN/excess
  timer). INTERIM rulings (flagged in code, settle in the workshop): stall verbs EXTEND the
  round (cap +10s, uncapped potions bypass); strikeEvery/swings derived from speed bands;
  Invisibility keeps its authored +5 (not a full fill of the new cap). 91 tests passing.
- `[x]` **Resolution v3 — the STAT CONTESTS + the TEMPO LAW (settled & built 2026-06-11,
  same day):** foes carry full P/E/S; every per-card value = `rate(yourStat, theirOpposed) × q`
  (Attack: P vs E · Defend: E vs P · Move: S vs S in charge POINTS — **Speed's job settled:
  agency, contested**); telegraph = foe Power budget; **tempo law** derives attack packaging
  from S−P (3 chip swings ↔ every-3rd-round giants, damage-conserving); 6/6/6 baseline axiom +
  tier-multiplier ladder (×1.0/×1.5/×2.0); decimal rebase landed (HP 100 / stats 10, save
  migration, ×3 player-number sweep, legacy trap-damage scale); **Defend overflow → charges
  REMOVED** (excess block = pure loss; Sentinel = the paid exception). Axioms + first-cut
  constants: `TUNING.md`; spec: CRAWL §5.6. 92 tests passing.
- `[~]` **Numbers workshop — SIM RUN 2026-06-12 (`sim/progression-sim.mjs`; derivations in
  TUNING.md "PLANNED" + the sim-findings block).** DONE: **A6 kill budgets** (2.5/5/10 rounds →
  foe HP 60/110/200, level-invariant) · the **re-denomination** (`RATE_K` 0.2, `MOVE_RATE_K`
  0.025, tempo bands UNCHANGED — role spreads author level-invariant; parity line `10+2(L−1)`;
  **telegraph law re-anchors on the contest**, `DMG_BUDGET_K` retires) · **XP curve** (geometric
  REJECTED → polynomial `55 × L^1.7`, ~29 clears to ★) · **dodge EV** (`DODGE_K` 0.015, dodge ≈
  half a P/E point + agency) · **mitigation vs strikeEvery** (live rule lets slow foes push
  +30–55% extra through; guard-carry levels it) · **FLOOR stress** (`floor-stress.test.ts`) —
  caught + FIXED a real bug: `inflictWounds` is now floor-aware (blind picks broke the makeable
  floor in ~13% of locks-then-wounds exchanges) · trap-severity authoring guideline (∝
  intended-level HP, ≈6%·tier). DONE: the **data rebase (2026-06-12)** — creatures author
  P/E/S directly on the parity line; the foe.ts legacy bridge + `DMG_BUDGET_K` + `LEGACY_*`
  scales retired; telegraph re-anchored on the contest (finalized vs the live player E in
  createCombat); variant/template `stat_mod` → P/E/S/hp deltas; authored `xp` retired (→
  `computeXP`); per-foe `tempo` override added; schema's `speed`-band table removed. 104 tests
  green. ⚠ INTERIM: warren_butcher dialed giant→heavy (the giant every-3 ×3 is an unmitigable
  one-shot until guard-carry); a fresh-from-tutorial player is L1 (10/10/10) vs the parity-14
  warren — under-leveled until the levels build lands (next). STILL OPEN: stall-kit FINAL ruling
  (round extension is the flagged interim) · the live warren re-tune + instrument re-targets
  (re-measure after levels + the amendments land).
- `[ ]` **UI:** the Tactics wheel (7 states; lit = locked, ghost = queued), round bar (the bar
  IS the round), rollover choreography (swing→swing→dump→deal→telegraph), wound-row rendering,
  the **"sated guard" cue** (block badge dims once it meets the telegraph — over-matching must
  be learnable), dev instruments grow a **sets/round** readout (~3 baseline / 4–6 competent).
- **First v3 playtest (2026-06-11, vs Goblin Warlord):** reshape 70% (ON target) · spring 19%
  (low vs ~30) · sets/min 16.0 · gimme 100% (⚠ watch) · wards 7 · **churns 0** (⚠ never
  dumped — likely a queue-discoverability symptom: the old toggle+chips UI hides the
  round-lock flow). Verdict: "the exchange felt pretty good; goblins quick, pretty easy" —
  minion tier reading player-favored as designed. Main feedback: **UI badly needs the v3
  facelift** (→ the UI batch below).
- **Post-facelift playtests (2026-06-11/12):** warren — reshape 56% (⚠ LOW now) · spring 45%
  (⚠ HIGH) · sets/rnd 2.8 · gimme 64 · wards 2 · **churns 3 (the wheel works)** · tutorial —
  reshape 62 / spring 16 / sets/rnd 9.0 (⚠ hot) / churns 30 · dummy — reshape 100 / churns 15.
  Fixed: ethereal goblin's mana-kill cost (drain now spent×10/3 — his HP rebased but mana
  hadn't). Asked + built: even slower, MORE telegraphed exchange w/ BAM/POW impact cards;
  board locked + deselected during the rollover. Watch for the sim: reshape↓/spring↑ in the
  warren post-wheel.
- **Full warren sweep (2026-06-12, per-foe: reshape/spring/sets-per-round/gimme/wards/churns):**
  tutorial 55/6/11.0/76/1/21 · goblin 25/50/3.0/83/2/0 · cave bat 0/29/7.0/100/3/0 · shaman
  20/29/7.0/86/4/0 · archer 33/50/4.0/75/1/0 · sapper 33/0/2.5/40/2/0 · warren rat 33/0/4.0/100/1/0 ·
  warlord 60/33/5.3/90/12/0 · ember shaman 67/8/3.3/77/2/14 · butcher 67/30/2.5/70/2/11 ("hard,
  almost died, good fight") · oracle 31/27/3.8/80/7/0. Patterns: reshape WAY below target vs minions
  (0–33%) but healthy vs elites (60–67%); churns only fire in long fights; spring noisy (0–50);
  sets/rnd spikes vs easy foes (11.0 tutorial). ⚠ Flag: the dev targets were calibrated for the
  continuous-clock game — the budget-conformance sim should re-derive per-tier targets rather than
  hand-chasing these.
- `[ ]` **Coach:** low-match-count player takes ≥4 wounds in one exchange → cooldowned
  "Stand Ground to stabilize" reminder (rides the explain-mid-play variant below).
- `[ ]` **Sim:** assert FLOOR under worst-case wounds(5)+locks; re-read reshape share + spring
  rate post-v3 (the dump changes who moves the board, and when).
- `[~]` **Duelist sprites (PLACEHOLDER art):** 🧙/👹 emoji stand-ins in the foe header that STEP
  toward whoever owns the board (driven by the same tug differential), lunge on their attacks and
  recoil on hits. Seeds the longer-term pixel-art pair; replace art + grow reactions later.
- ⚠ Interaction: Maneuver(green) smooths sustain loops (Photosynthesis/Heal) — the structural
  anti-stall still lands with/before B2. (Chronomancer's excess-timer engine died with the
  clock; its v3 identity rides the stall-kit re-anchor above.)

---

## ⭐ SETTLED (2026-06-12) — THE PROGRESSION PACKAGE (specs: CRAWL §3 + §5.7; numbers: TUNING.md "PLANNED")

One design session settled the whole progression spine + the Speed/guard/tide combat
amendments. Headlines: **cap 21 (★)** · **+5 HP & +3/+2/+1 allocated stats per level**
(→ the re-denomination, sim-gated) · **XP computed from the foe statline** (×2/×4 elite/boss
mults beat grinding) · curve anchored **dummy→2 / gauntlet→3 / warren = fresh level 3** ·
**gear = ~25% of stats** (its identity = per-card riders + slot mechanics) · **loot =
category-first nested tables** (per-tier weights + quality advantage + guaranteed gold +
depth scaling + gear pity sawtooth) · **tithe ~12%** · **dodge rolled at the deal, folded
into the telegraph** (Speed = whether/when; Defend = how much; crits deferred to gear) ·
**guard carries through windups** (capped at the early-revealed telegraph) · **Maneuver
live-burn** (~1/s, gather to enter, instant bail-out) · Speed riders (parting blow ↓, start
grace ↑) · smash-art declarations (Persona/Mörk Borg register) over a paused, dimmed board.

Build order (everything sim-gated where it touches contest constants):
- `[x]` **The sim pass — RUN 2026-06-12** (`sim/progression-sim.mjs`; see the workshop item
  above): re-denomination, A6, XP curve, dodge K all derived; the floor-stress test landed a
  real engine fix (floor-aware wounds).
- `[x]` **The data rebase — DONE 2026-06-12** (see the workshop item): creatures author P/E/S
  directly; the legacy bridge + `DMG_BUDGET_K` + `LEGACY_*` scales + the authored `xp` field are
  retired; telegraph re-anchored on the contest; `computeXP` ready for the levels build.
- `[x]` **Combat amendments batch — SHIPPED 2026-06-12** (engine+UI, 106 tests; CRAWL §5.7,
  constants in TUNING.md): per-swing deal-time **dodge** (💨 telegraph tags + the DODGED! smash
  card + free-round guard cue) · **guard-carry** through windups + **early telegraph reveal** ·
  **Maneuver live-burn** (stances go LIVE — no queue; gather-in / instant Stand-Ground bail; ~1
  charge/s, replaces the rollover dump) · the **start-grace Speed rider**. ⏳ DEFERRED: the
  **parting-blow** Speed rider — waits on the flee parting blow (the B2 exit-ladder item).
  ⚠ Interim: a fresh L1 player (10/10/10) is still under-leveled vs the parity-14 warren until
  the levels build; re-measure the dev instruments + warren tune after levels land.
- `[x]` **Levels & XP — SHIPPED 2026-06-13** (`save.ts` v3 schema + the level-up modal; 110 tests):
  XP from `computeXP` banks per kill (always, even on death) → the character; the level-up flow
  (allocate +3/+2/+1, +5 HP, ★ at 21) runs in town; effective combat stats = BASE + alloc;
  sheet/roster/end-screen show level + XP. Teaching foes carry an `xp` override so the onboarding
  curve lands (dummy→L2, gauntlet→L3). This closes the interim under-level gap (warren = fresh L3).
- `[x]` **Loot tables v1 — SHIPPED 2026-06-13** (`engine/loot.ts` + `ui/bank.ts`; 120 tests):
  category-first per-tier tables (gold/consumable LIVE; gear/spellbook scaffolded-off until B3/B4)
  + per-tier drop counts + guaranteed elite/boss gold WAGE + depth scaling (+7%/room) + consumable
  quality advantage. **Gold is a weightless run counter** (decided: the town plan separates the
  Gold pool from item Storage), derived from the shared `foeValue` (same as XP) via its own
  `GOLD_K`. The **shared account vault** (`bank.ts`, its own key — survives death) banks run-gold
  on any safe exit; **death loses carried gold + a 12% tithe**. ⚠ Full clear ~210g (depth-inflated,
  ~40% over the first cut) — recalibrate `GOLD_K` when the shop sink exists. Replaced the delve's
  placeholder one-consumable roll.

## NEXT COMBAT BUILD — dread escalation + selection-protected turnover (SETTLED + SIM-VALIDATED 2026-06-13)
Both settled this session (CRAWL §5.8 + the hard-rules invariant #6); spec + sim done, engine pending.
Combat-only; builds *with* B2 (the dread depth floor reads the delve's dread band).
- `[x]` **Dread escalation (CRAWL §5.8) — BUILT 2026-06-14** (see the BUILD ORDER tracker, Phase 1b). One `dread` meter
  (1–10) = depth floor `D₀` (from the delve dread band, capped 5) + within-fight rise (~0.5/round,
  resets at fight end). Two lanes: **drift** accelerates past the knee (5), bounded by the TRAPS §6
  ceiling; **damage escalation** off until dread 7 → foe ×2.0 (rides the UNGUARDABLE lane — trap/tick
  **+ the generic `DREAD_BLEED` 6%·maxHP/rnd**) / player ×1.5 (damage + heals), folded into the
  telegraph AT REVEAL. Goal = ACCELERATE to a resolution + the dread swing-moment, not force-kill.
  Sim §7 validated calibration + inert-backstop + the bite. Render the meter's two motions (depth
  floor base + within-fight overlay; mark the knee + the damage onset).
- `[x]` **Selection-protected turnover (hard rule #6) — BUILT 2026-06-14.** See the BUILD ORDER tracker (Phase 1a).
  `selected` on `CombatState` (UI-synced each dispatch) → `protectedSlots` (selected + all set-mates via `findSets`)
  → filtered in `transmute()` for sourced (automatic) turnover only; deliberate player casts exempt. Aggressive
  scope (shield from the 1st selected card). `protection.test.ts`; 138 green.

## Open — combat polish (small, optional)
- `[ ]` **Explain-mid-play tutorial variant** — fire explain-popovers at trigger points during a
  *normal* fight (first trap spring, first lock) rather than only as the staged intro: same coaching
  primitives, new script + more `coachNotify` hooks. Plus persist "tutorial seen" + per-step copy review.
- `[ ]` **Feel-enhancement backlog** (deferred from the UX pass — most want the crawl shell first):
  - cross-room **HP-carry banner** (fits the run loop, Phase B1)
  - **run-level contribution chart** (extend the end-combat summary across a run; fits Phase B2)
  - **dread accumulation fog** (needs a clear dread-DoT foe + the per-room model)
  - **saturation-cap fizzle** (needs an engine "wanted to warp but couldn't" signal)
  - **herding connector flash** (coach-only, niche — the three-rule squeeze as one move)

---

## NEXT BUILD — set.crawl (the dungeon-crawler shell, on the modules)

Source of truth: `CRAWL-DESIGN.md` (§2 run loop · §5 build sequence · §5.5 combat = **done** ·
§6 open questions · §7 gear). The combat core + trigger bus + transmute verb are already built in
`src/engine`; what remains is the **run around the combat**. Build it on the modules, not the
archived HTML.

Dependency chain that sets the order: **equipment & loot need persistence, persistence needs a home
to live in → build the Hub scene + persistence first.** (`CRAWL-DESIGN.md` §2 "Scenes & persistence".)

### Phase B1 — Hub scene + persistence (the between-runs home) — first slice DONE
- `[x]` **Scene router** — `hubScene` (town/menu) ⇄ `begin`/combat; combat returns to the Hub on end.
- `[x]` **Hub v1** — a **character roster** (create with name + class · select · delete · free Rest
  placeholder) + **dungeon select**; the start screen grown into the town. (Loadout / shop come later.)
- `[x]` **Persistence v1** — `src/ui/save.ts`: a `localStorage`-backed `SavedChar` roster; HP carries
  across the hub↔combat boundary (enter at saved HP; final HP written back on combat end). Structured
  to grow (inventory / gear / progression). Pure roster transforms are unit-tested.
- `[x]` **Scene split — DONE:** broke the single-panel `hubScene`
  into two scenes via a small router. **`characterSelectScene`** (two columns): roster list + a pinned
  **"＋ New Character"** entry on the left; the selected hero's **sheet** on the right (name/class/HP,
  Abilities w/ costs, Passive, a **Gear** placeholder, Consumables) — or the **creator** when New
  Character is active. One context button at the bottom: hero selected → "Choose a dungeon ▶"; New
  Character → "＋ Create hero" (creates → auto-selects → flips to "Choose a dungeon ▶"). Delete + Rest
  become per-hero sheet actions. **`dungeonSelectScene(char)`**: dungeon summary (difficulty/theme, the
  persistent dungeon-level trap = `drift` + `boss_mirror`, the **boss**, elite pool, foe/gauntlet picker),
  the consumable loadout picker (moves here), a "◀ Back" + "▶ Enter dungeon". Combat-end → character
  select. Pure UI refactor — reuses `.charcard/.classgrid/.row/.cons-loadout/.panel`; no engine change.
- `[x]` ~~**Rest economy** (gold-cost heal instead of free) once gold exists.~~ **SETTLED
  (2026-06-09): Rest stays free, permanently.** Gold's sinks live elsewhere: town/base-building
  **amenities** (persistent account-level construction), shop **gear** + **consumables**, and
  **learning new abilities**. (See "Exit ladder" plan below.)

### Town economy + inventory — PLAN (settled 2026-06-09; spans B1→B4)
Decisions (locked): **shared town bank** (one Gold pool + one Storage for the whole roster, its own
localStorage key — survives a hero's death) · **unified item bag** (consumables *and* gear share slots) ·
inventory-full during a run → **swap-or-discard prompt** · consumables are **finite**, seeded by a
**starter stash + loot + shop** (the current free "pick any potion" loadout is retired).

- Data model: a new account-level store `{ gold, storage: Item[], storageCap /* 20, gold-expandable */ }`
  separate from the `SavedChar` roster. An `Item` model `{ uid, kind:'consumable'|'gear', refId, … }`;
  both Storage (20) and the run inventory (10) hold `Item[]`. **`SavedChar.consumables` is removed** — the
  3-slot delve loadout (drawn from Storage) is **run-state**, not character-state; gear equip-slots
  (B3) are character-state but pull items from the shared bag.
- `[~]` **B2 — economy core:** DATA LAYER DONE (2026-06-13). `src/engine/items.ts` (the unified `Item`
  instance model — consumables + gear share the shape) + `src/ui/bank.ts` grown from gold-only into the
  full **account store** `{ gold, storage: Item[], storageCap 20, seeded }` (v1→v2 migration, same key;
  pure storage transforms: add/addMany/remove/take/expand + the swap-or-discard `ok:false` signal) +
  **starter-stash seeding once per account** (the `seeded` flag — create/delete can't farm it). 25 new
  tests (`items.test.ts` + grown `bank.test.ts`); 131 green; typecheck clean; the running app is
  untouched (gold call sites kept via aliases). STILL OPEN (the app.ts wiring slice): the **Storage UI**
  (the bag screen + return triage keep/sell) · dungeon-select loadout becomes "**load 3 from Storage**"
  (drawing `Item[]` via `takeFromStorage`, survivors auto-return) · convert the delve **satchel
  `string[]` → `Item[]`** + bank kept items home on a safe exit · retire `SavedChar.consumables`. Keep
  the free-pick loadout live until the loot→storage loop closes (no dead-air gap).
- `[ ]` **B2/B3 — run loop:** run-state (seed + room chain + **10-slot run inventory**); loot on win;
  **swap-or-discard** when full; between-room refill of the 3 active slots from run loot; HP-only
  attrition (replaces `onWin` full-heal); **return triage** (keep → Storage / sell → Gold; *keep* greyed
  when Storage is full; sell-from-Storage to make room; unused brought-in consumables auto-return).
- `[ ]` **B4 — shop + expansion:** spend Gold to buy consumables and expand Storage slots (the buy-side
  to triage's sell-side).
- Sequencing note: keep the current free-pick loadout live as the interim potion source and **flip it off
  only once the loot+shop loop exists** (B3/B4) — same end state, no dead-air gap.

### Between-rooms approaches + the per-level bundle — SETTLED 2026-06-13 (CRAWL §2 + §3; TUNING)
- `[ ]` **Between-rooms approaches** — at the fork, pick ONE (free, resets/room): **Scout** (info:
  tier→+foe→+traps; Scout 1 free for all), **Lurk** (+3/6/9s on round 1), **Scavenge** (loot
  +2/4/6 effective-depth), **Recover** (5/10/15% maxHP, capped), **Prepare** (~20/35/50% mana). The
  5 currencies (info/tempo/loot/HP/mana) — shore up your weakest axis. **Investigate** = deferred 6th
  (biases toward EVENT rooms; lands with the non-combat room system).
- `[ ]` **Voluntary-activation board preview** (baseline every fight) — untimed; the first set you
  complete starts the round. Supersedes the fixed 3s start-grace. (Onboarding + v3-deliberate win.)
- `[ ]` **Speed → round-1 length** — `clamp(20 + (playerS−foeS), 15, 25)`s; every other round flat
  20s. Migrates the §5.7 start-grace Speed rider; Lurk stacks. (Per-round scaling rejected — OP.)
- `[ ]` **The per-level reward bundle** — automatic each level: +5 HP · +3/+2/+1 stats · **+mana cap**
  (15→~35); plus a **horizontal pick** (approach↑ cap 3 · +satchel 10→15 · +consumable loadout 3→5 ·
  +Storage slot · +charge cap). Ability-slot pick layers on at cadence. Every level is juicy.

### Exit ladder / cost triad — PLAN (settled 2026-06-09; full spec in `CRAWL-DESIGN.md` §6)
The four run-exits are strictly ordered (each rung worse than the one above):
**clear the boss > cash out > flee > die.**
- **Cash out:** between rooms only, after a clear — keep everything. **Delving commits you to
  room 1** (no free back-out → the scout-and-reroll loop is dead by structure, not by penalty).
- **Flee (run does NOT end):** parting blow (foe's pending attack lands as you turn; clamped,
  min 1 HP — flee never kills) + forfeit this room's reward → back to the between-rooms fork;
  next encounter **rerolled**, elite sawtooth **reset to base**; press on or go home. Timid
  minion-farming (duck the elite, pay HP) is *intended* play.
- **Death:** lose the run inventory + all gold carried this run + a **tithe (% of banked gold,
  % TBD)**; **XP always banks**; gear + hero survive. Permadeath → future opt-in hardcore flag.
- **Rest: free forever** (gold sinks: amenities / shop / abilities — see B1 note above).
- Corollaries: run gold is **carried, not banked** (banks on any exit except death). **Settled
  follow-ups (2026-06-09):** a fled room **does** advance the boss running-total (boss % keys
  to encounters *entered*); **boss mechanism** = inverse-CDF draw (one seeded `R`, boss at first
  room where `cum(n) = n(n+1)/2 % > R` — exact triangular, median 10, guaranteed 14); **the
  throne room, once found, stays found** (fleeing the boss → fork, but pressing on is always
  the boss — farming's point of no return); the **dread meter** shows the running total as
  **thematic bands** (fiction surface, true curve underneath). Full spec: `CRAWL-DESIGN.md` §2.
  Still open: tithe %. ✅ Companion requirement SETTLED (2026-06-13): free Rest + flee-farming +
  sustain builds = unbounded farming → the **structural anti-stall** is now the **dread escalation**
  (`CRAWL-DESIGN.md` §5.8; constants `TUNING.md` "Dread escalation — PLANNED") — a unified 1–10
  dread meter driving accelerating drift (soft tension) + a two-way damage multiplier past round
  ~12 (the hard resolver). Sim-gated; should build *with* B2. Supersedes the per-foe `dread_drums`
  DoT as the load-bearing anti-stall.

### Phase B2 — run loop + first loot (consumables)
**FIRST CUT SHIPPED (2026-06-12) — the delve flow.** `engine/delve.ts` (pure, tested:
`delve.test.ts`) + the UI run loop in `app.ts`: **🕯 Delve** on dungeon select (boss dungeons; the
foe picker stays as “⚔ Single fight”) → rooms roll boss-law → elite-sawtooth → weighted table →
the **between-rooms fork** (press on / return to town) with the **dread meter** (thematic bands over
the true cumulative), the run **satchel** (loadout + loot, cap 10, consumed-is-gone across rooms),
and **HP carry** room to room. Flee falls back to the fork (no spoils, reroll, sawtooth reset);
death ends the run and drops the satchel; the boss win is the clear. Constants in `TUNING.md`.
- `[~]` **Room = encounter + reward** — encounter rolling DONE; reward is the PLACEHOLDER one-random-
  consumable roll (`rollDelveLoot`). Real loot / gold / XP rolls (`CRAWL-DESIGN.md` §3) still open.
- `[x]` **HP-only intra-run persistence** (§6) — HP carries as the run's attrition clock (each room is
  a fresh combat seeded at carried HP; mana/charges/board reset). The gauntlet's full-heal behavior
  remains for the Training sequence only. (The cross-room **HP-carry banner** feel idea still open.)
- `[~]` **Consumables — system DONE; first drops LIVE via the placeholder room loot.** Built
  (`engine/consumables.ts`): tiered staples, special potions, a scroll for every ability; a 3-slot
  loadout equipped in the Hub. In a delve the loadout becomes the run **satchel** (consumed-is-gone,
  loot accrues, cap 10); satchel loot is run-scoped — banking it home needs the account store (below).
  (Still open: a player heal-over-time — the friendly mirror of the enemy `condition` tick.)
- `[~]` **Run-state model** — room chain + satchel DONE (UI-held `DELVE` + pure `DelveState`); still
  open: fold the delve into the `session.ts` seam (seeded/replayable runs — `bossRoll` is already one
  draw from a seed) + run gold/XP.
- `[~]` **Loss / retreat** — the exit-ladder SKELETON is in: between-rooms cash-out (keep everything),
  flee → fork (reroll + elite reset + boss-room-stays-found; **parting blow still open**), death →
  satchel lost (**tithe + XP-banks open** — no gold/XP yet).

### Phase B3 — equipment / gear (`CRAWL-DESIGN.md` §7 taxonomy)
- `[ ]` Gear slots + affixes (flat per-card scaling), armor/relic base-types, Move affixes re-anchored
  on Tactics; rarity → affix count, loot-tier → affix power. Equip in the Hub; gear drops in the loot roll.

### Phase B4 — deeper progression
- `[ ]` XP / levels → +HP / +ability-slots; boss-gated ability picks; spellbooks (cross-class learn).
- `[ ]` Gold economy + town shop (buy/sell); the **run-level contribution chart** feel idea fits here.
- `[ ]` **Guild halls + bounties + the achievement-unlock web — SETTLED 2026-06-14 (CRAWL §3).** Big
  system, B4/B5. **Hall shop:** on-theme random scrolls/potions/gear + a **daily spellbook rotation**
  (≤3 active + 1 passive); **dual-axis** = class char-level FLOORS loot quality (global, even at 0 gold)
  + gates upgrades · gold BUYS shop slots + higher tier-tables (3–5 gear tiers). **Trainers:** respec +
  guaranteed-ability buy (member discount, unlock-gated). **Bounties:** known-reward contracts (gold /
  consumable / rare gear / XP), daily + repeatable, **first clear mints an achievement** (often a
  content GATE). **Unlock web:** Adventurer hall → other-CLASS unlocks · class halls → related-class
  unlocks · **Tavern** → BACKGROUND unlocks · some bounties → new DUNGEONS (added to your known list).
  **Hall-unique procedural dungeons** w/ NPC-class foes (⚙ needs the **ability↔trap parity
  translation** — both are spec→spec board-verb transforms, so tractable). **Generation seed = per-class
  BIAS METADATA** (themes / loot slant / related-class pointers) → halls/shops/bounties fall out.
  Depends on: the **achievement meta-layer** + the account store (B2) + gear (B3).
- `[ ]` **Achievement meta-layer + base-building — SETTLED 2026-06-14 (CRAWL §3).** The connective
  tissue under every unlock. **BASE TOWN is fully open from day 1** (gold only — Tavern / Bank / Barracks /
  Temple / Weaponsmith / Armorsmith / Trinket / Alchemist): gold sinks before any unlock + broad
  building direction. **Achievements gate the EXPANSION** (classes / backgrounds / dungeons / class
  halls / advanced amenities) via "unlock blueprint → gold fills it." **Two achievement kinds:**
  escalation COUNTERS (1·10·100·1k·10k, from the engine's existing `stats` + dev-instrument + run/meta
  events) = **ONLY unlock-gates + bragging** (no combat/capacity/currency; unlock value ∝ action
  RARITY; per-dungeon 1/10/100 → first usually unlocks, rest bragging) · milestone GATES (bounty-minted).
  **DUAL-SOURCE:** the achievement grind is the guaranteed path; a **rare bounty** unlocks the same early.
  **Backgrounds** ← the big varied cumulative counters (dungeons/char, total battles, items sold…).
  **⭐ GUARDRAIL: HORIZONTAL only** — ACCESS, never flat account-wide combat multipliers (power stays
  per-character). **Build** = account COUNTER store (persist/aggregate, survives death) + an
  achievement-definition table → blueprint-unlocks. Most data already produced by combat/run.

### Phase B5 — content & tuning
- `[ ]` Author foes / variants / templates / dungeons beyond the teaching set; tune XP / HP / gold curves.
- **XP / difficulty retune — DONE 2026-06-14 (sim §8; CRAWL §3; TUNING):** curve base **55→80→110**
  → `need = 110·L^1.7` (**~56 level-matched dungeon clears to ★**, the 50–60 target); teaching `xp`
  overrides re-tuned (dummy 110, gauntlet 95/170/90=355). **LIVE in `foe.ts`:** `foeLevelEquiv` (foes
  self-rate their level from the statline) + the **outlevel XP penalty** `computeXP(foe, playerLevel)`
  = `clamp(1−0.15·max(0, ΔL−2), 0.1, 1)` (full within 2 levels, floors ×0.1 — farming trivial content
  doesn't pay). **STILL OPEN (this phase):** author the **dungeon difficulty 1–5 ladder** (`L=3+4(D−1)`
  → D1 L3 · D5 L19 "18+"); today only the warren (~D1) + teaching exist, so the penalty has nowhere to
  send an over-leveled player yet. Optional: a small **above-level XP bonus** (lever, not taken).
- `[ ]` Optional: crawler reskin/palette (§1); a YAML data loader **only if** external authoring is
  wanted — today's typed `game-data.ts` is the equivalent (and type-safe).

### Balance log — the Bulwark loop (found by the dev instruments, 2026-06-10; FIXED)
First playtest with the dev panel caught the first degenerate line: **Bulwark's magnitude flood**
(shape→Defend AND mag→3) printed value — mag-3 boards give 9-value sets, collapse the number axis
(gimme ~100%), and rainbow-colour sets dodge every all-same trap while repaying [2,2,2] costs.
Reshape share ran 73→100% vs the 65–70 target; the King's Confusion was farmed at 78% spring rate
(−2s vs +9 boot). Fixes landed: ① ALL multi-card shape floods are now shape-only (bulwark, berserk,
thornwall, callarms, callshields) — "heavy" boards come only from deliberate tools (Maneuver ③ bias,
Hone later); ② magnitude TOLLS — new variants `grasping` (all-3s → strikes 2s sooner) and `covetous`
(all-3s → plucks the heaviest rune, via the now actually-fixed `pick: 'highest_mag'`) rolled into
warren pools — constant tax, never a spike: greed is a grind; ③ **Confusion v2** — generalist
severity scales with the springing set's weight (`scale: 'set_mag'`: 1+2+3 → 2s, 3/3/3 → 5s),
threading the severity law. Re-measure reshape share before touching drift rates.
- **Post-fix readings (2026-06-10, second playtest):** Warlord — reshape 85%, spring 7%, sets/min
  10.8, gimme 76%, churns 16 · Scorched Ember Shaman — reshape 81%, spring 0%, gimme 76%. Verdict:
  *"feels a lot better — not degenerate, just effective."* Gimme fell ~100→76, sets/min cooled
  ~13→10.8. Reshape still runs ~15pts hot; spring fell BELOW target (7%/0% — with rainbow value
  normalized, players dodge harder; watch whether trap bait needs sweetening). ⚙ Tuning watch:
  **shape-Call/Bulwark board coverage** — full-board floods may want a haircut (e.g., convert a
  capped count or a region instead of every non-conforming card); revisit after a few more reads.

### ⭐ SETTLED & BUILT (2026-06-10) — pacing & the stat footprint ("sets steer, stats carry")
**Decision: Model B + the full clock rework, landed.** Stats are **Power / Endurance / Speed**
(base 2/2/2 = old-system parity; class `stats` field exists, uniform for now — differentiate via
gear/levels in B3). Per card: `round(stat × quality)`, quality = ①×0.7/②×1.0/③×1.4; set damage is
DETERMINISTIC. The clock is the **telegraphed exchange**: approach → windup (strike pre-rolled +
revealed as ⚔N; clock COMMITTED, Move pushes → charges; default 4s, per-foe authored) → strike
lands exactly as telegraphed. Bands slowed (24/19/15/12/9) + creature damage ~+25%. Spec in
CRAWL §5.5; constants in TUNING.md. B3 gear/affixes now design against the stat block.

*(original thread, for the record:)*
Playtest feel (2026-06-10): the game is frantic — scan-speed-gated twitch — and struggling players
collapse fast; the target feel is a **deliberate strategic grind**. Under consideration: expand the
RPG layer's stat footprint so **sets are DIRECTIONAL rather than the primary number source** (the
character sheet — class/level/gear — carries the magnitudes; a matched set chooses/steers the action
instead of being its damage roll). Would decouple output from scan speed (slow players execute the
same build at lower tempo), make gear/levels load-bearing, and soften the death spiral. **Must be
decided BEFORE Phase B3 (gear)** — affix design depends entirely on where numbers live. Needs a
design session: what each axis directs, what magnitude becomes, and the clock-feel companion
(fewer/heavier telegraphed exchanges vs the current steady cadence).

### Open design decisions (carry from `CRAWL-DESIGN.md` §6 — settle as each phase lands)
- ~~Loss-condition framing + the flee penalty~~ — **SETTLED 2026-06-09: the exit ladder** (above).
- ~~Ability slots vs. a known-ability library (implies a loadout screen in town).~~ **SETTLED
  2026-06-13 (CRAWL §3 loadout + class halls; numbers in TUNING.md):** 6 active + 3 passive slots,
  filled on the **level-up cadence** (slot + pick — supersedes the boss-gated pick); a class = a
  dynamic `{X abilities, Y passives, Z gear}` package (enables prestige classes); **spellbooks**
  replace an equipped ability (cross-class; passive books rarer); **class halls** sell spellbooks
  (unlocked by owning that class, full catalog at ★); a **guaranteed dungeon-clear marquee roll**
  (spellbook/rare+) carries the boss reward. MORE settled 2026-06-13: signature passive **counts**
  toward the 3 (~5 passives/class, 1 fixed start → 2 free); **off-levels grant a capacity bump**
  (satchel etc. — every level progresses); **spellbooks REPLACE, never raise the cap** (twinking =
  better not more; ceiling bumps earned not bought); **lottery-primary** sourcing (shop = pity
  backstop); prices **1000g active / 2500g passive book**, **storage `cost(N)=N²`**, **sell 20%**.
  STILL OPEN: hall-level metric. **SETTLED 2026-06-14 — the full level cadence** (CRAWL §3 table;
  TUNING): active slots L3/6/10/14 · passive L8/16 · satchel +1 ×5→15 (fixed) · consumable loadout
  +1 ×2→5 (fixed) · exploration approach-up ×10→all maxed by ★ (picked; order = identity). Capacity
  fixed, approaches picked; charge cap (15, board invariant) + Storage (gold `N²`) excluded.
- ~~Prestige-class unlock conditions.~~ **SETTLED 2026-06-14 (CRAWL §3 "Character creation"):** the
  WHOLE game is **achievement-gated** — start = **Adventurer** only (generic/balanced starter), tutorial
  unlocks a few classes, more behind varied achievements; **prestige = the deep end of the same gate**
  (no separate system). NEW: **Background** = a 2nd creation facet — 1 permanent NEUTRAL passive in a
  dedicated 4th slot (powerful, broadly useful, never changed; racial/signature-item/size/career
  flavor), also achievement-gated → Background × Class is the long-tail. Needs an account-level
  **achievement-tracking meta-layer** (B4/B5; hooks — class-locked creation + the Background slot —
  designed now). Also: **level-up modal UI** changes (3/2/1 → **+6 freely, ≤3/stat**; data layer
  already supports it — `save.ts applyLevelUp` just adds the delta).
- ~~Cooldowns vs. resource-only gating for actives.~~ **SETTLED 2026-06-13: BOTH** — cooldowns join
  mana as a second gating dimension (variety + balance lever); each ability authors `cost` (mana)
  and/or `cooldown` (rounds), either/both/neither. (CRAWL §3 loadout; TUNING "Ability gating".)
- ~~Level / XP / HP / gold curves; the death-tithe %~~ — **SETTLED 2026-06-12: the progression
  package** (CRAWL §3 + §5.7; first-cut numbers in TUNING.md, sim-gated). Inventory limits:
  run satchel 10 (live) · Storage 20 (B2 economy build).
