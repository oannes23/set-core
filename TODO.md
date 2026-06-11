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
- `[ ]` **Attack meter must SHOW the telegraph** — the bar still renders like the old cadence
  meter; it needs a visible commit-zone (the windup fraction of the track) / segmented
  approach→windup structure. PARKED pending the time-system discussion (a rounds-style grammar
  may restructure the bar entirely — don't polish what might be replaced).
- ⚠ Quick foes still feel too quick (swift/frenzied) — "a weird sweet spot we keep missing."
  User sketch (not a commitment): a harder-to-adjust ~fixed 20s timer — but that guts Move.
  Feeds the RPG-numbers workshop (see design discussion 2026-06-10).
- `[~]` **Duelist sprites (PLACEHOLDER art):** 🧙/👹 emoji stand-ins in the foe header that STEP
  toward whoever owns the board (driven by the same tug differential), lunge on their attacks and
  recoil on hits. Seeds the longer-term pixel-art pair; replace art + grow reactions later.
- ⚠ Interaction: Maneuver(green) smooths sustain loops (Photosynthesis/Heal), and Chronomancer's
  pinned clock is the premier excess-timer engine — the structural anti-stall lands with/before this.

---

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
- `[ ]` **B2 — economy core:** the account store + `Item` model + **starter-stash seeding once per
  account** (not per new hero, else create/delete farms it) + Storage UI; dungeon-select loadout becomes
  "load 3 from Storage."
- `[ ]` **B2/B3 — run loop:** run-state (seed + room chain + **10-slot run inventory**); loot on win;
  **swap-or-discard** when full; between-room refill of the 3 active slots from run loot; HP-only
  attrition (replaces `onWin` full-heal); **return triage** (keep → Storage / sell → Gold; *keep* greyed
  when Storage is full; sell-from-Storage to make room; unused brought-in consumables auto-return).
- `[ ]` **B4 — shop + expansion:** spend Gold to buy consumables and expand Storage slots (the buy-side
  to triage's sell-side).
- Sequencing note: keep the current free-pick loadout live as the interim potion source and **flip it off
  only once the loot+shop loop exists** (B3/B4) — same end state, no dead-air gap.

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
  Still open: tithe %. ⚠ Companion requirement: free Rest + flee-farming + sustain builds =
  unbounded farming → the **structural anti-stall** (soft-enrage / per-room pressure,
  `FABLE.md` §8.1) should land *with* B2, not after.

### Phase B2 — run loop + first loot (consumables)
- `[ ]` **Room = encounter + reward** — on win, roll loot / gold / XP (`CRAWL-DESIGN.md` §3).
- `[ ]` **HP-only intra-run persistence** (§6) — everything but HP resets each room; HP carries as the
  run's attrition clock. *Replaces* the full-heal-between-gauntlet-foes behavior (`combat.ts` `onWin`).
  (The cross-room **HP-carry banner** feel idea rides here.)
- `[~]` **Consumables — DONE as a system; loot acquisition pending the run loop** (`CRAWL-DESIGN.md` §4).
  Built (`engine/consumables.ts`): heal potion, 9 colour×shape combo brews, 3 mana potions, haste,
  stoneskin, and a free one-shot **scroll for every ability**; a `useConsumable` action; a 3-slot
  **loadout** equipped in the Hub + used (art chips) in combat. For now the loadout is re-equippable
  (refreshes each delve); a consumed **inventory + common drops** arrives with the run loop. (Still
  open: a player heal-over-time — the friendly mirror of the enemy `condition` tick.)
- `[ ]` **Run-state model** — seed + room chain + run gold/XP/inventory; reuse the `session.ts` shape.
- `[ ]` **Loss / retreat** — build the settled **exit ladder** (plan above / `CRAWL-DESIGN.md` §6):
  between-rooms cash-out, flee → fork (parting blow, reroll, elite reset), death → carried loot
  lost + tithe + XP banks. The Flee button's *engine* side exists; the run-loop side is new.

### Phase B3 — equipment / gear (`CRAWL-DESIGN.md` §7 taxonomy)
- `[ ]` Gear slots + affixes (flat per-card scaling), armor/relic base-types, Move affixes re-anchored
  on Tactics; rarity → affix count, loot-tier → affix power. Equip in the Hub; gear drops in the loot roll.

### Phase B4 — deeper progression
- `[ ]` XP / levels → +HP / +ability-slots; boss-gated ability picks; spellbooks (cross-class learn).
- `[ ]` Gold economy + town shop (buy/sell); the **run-level contribution chart** feel idea fits here.

### Phase B5 — content & tuning
- `[ ]` Author foes / variants / templates / dungeons beyond the teaching set; tune XP / HP / gold curves.
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
- Ability slots vs. a known-ability library (implies a loadout screen in town).
- Cooldowns vs. resource-only gating for actives.
- Level / XP / HP / gold curves; inventory limits; the death-tithe %.
