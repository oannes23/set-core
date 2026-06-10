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
- `[ ]` **Engine:** replace armed/drain state with tactic + charge queue (player-owned tick-trigger
  shape); remap meter-anchored systems — Vigilance `drain_tactics` (drains queued charges),
  Invisibility (fills the queue; drain-pause deleted), tutorial Tactics step, §7 Move-affix anchors
  (re-anchor on charge income / queue cap); mana cap 15; Rally → tactic-aware deadest targeter;
  Tactician → Adaptive Tactics; add the 3 Tier-1 shape Calls.
- `[ ]` **UI:** tactic selector + per-tactic sub-UI (Maneuver bias picker / Ward pips) in the old
  6-button real estate; serial churn needs visible per-card feedback (morph animation exists);
  "tug" readability vs drift.
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

### Open design decisions (carry from `CRAWL-DESIGN.md` §6 — settle as each phase lands)
- ~~Loss-condition framing + the flee penalty~~ — **SETTLED 2026-06-09: the exit ladder** (above).
- Ability slots vs. a known-ability library (implies a loadout screen in town).
- Cooldowns vs. resource-only gating for actives.
- Level / XP / HP / gold curves; inventory limits; the death-tithe %.
