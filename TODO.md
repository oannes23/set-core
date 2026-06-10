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
- `[ ]` **Rest economy** (gold-cost heal instead of free) once gold exists.

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
- `[ ]` **Loss / retreat** — death ends the run (penalty TBD); the Flee button already retreats.

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
- Loss-condition framing (roguelike permadeath vs roguelite) + the flee penalty.
- Ability slots vs. a known-ability library (implies a loadout screen in town).
- Cooldowns vs. resource-only gating for actives.
- Level / XP / HP / gold curves; inventory limits.
