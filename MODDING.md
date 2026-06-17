# MODDING.md — the YAML content-conversion plan

The roadmap for making **all** SET.crawl content data-driven and moddable via
external YAML, while preserving the existing engine architecture. Born from the
2026-06-16 five-agent moddability audit (this doc supersedes that report).

Read `CLAUDE.md` → `PROJECT.md` → the design-doc map first for *why* the content
shapes are what they are. This doc is *how* we externalize them.

---

## 0. Decisions locked (2026-06-16 session)

- **Scope:** full conversion — all phases, up to and including authoring brand-new
  ability / passive / consumable *behavior* in YAML (the effect-DSL).
- **Mod target:** **both, staged.** Build the built-in/authoring path now; architect
  the registry so runtime user-mod loading slots in later with no rework.
- **Validation:** **hand-rolled**, schema-driven. No `zod`/`ajv`/`valibot`.
- **Source of truth:** TS **types stay** (`schema.ts` drives the hand-rolled
  validator); only the **data literals** (`GAMEDATA`, `GEAR`, `AFFIXES`, the
  constant tables, …) move to YAML.

### Dependency strategy (the load-bearing constraint)

The repo has **zero runtime dependencies** and keeps it that way through *every*
phase below:

- **Built-in content** is authored in `.yaml` and compiled to JS **at build time**
  by a Vite YAML-transform plugin that is a **devDependency only**. The shipped
  bundle contains no YAML code and no new runtime dep.
- **Validation** is pure TS (no dep), run in vitest *and* at registry-build time.
- **Runtime user mods** (deferred) are the *only* thing that could ever need a
  runtime parser. Escape hatch: accept user mods as **JSON** (`JSON.parse`, zero
  dep) since the data is JSON-shaped by contract. Taking a real runtime YAML dep
  is a decision deferred to when that sub-phase is actually built.

**Invariant for this whole effort: runtime `dependencies` in `package.json` stays
empty unless/until we consciously choose a runtime YAML parser for user mods.**

---

## 1. The architecture — one fault line

Every content type sits on one side of a single line:

- **Pure data** — string tokens + numbers + nested objects. Interpreted at runtime
  by fixed dispatchers: `runEffect` (`engine/triggers.ts:183`, a `switch` on the
  `EffectName` union), `condMet` (`triggers.ts:43`), `geometrySlots`/`selectSlots`
  (`triggers.ts:67,108`). **Already YAML-ready; a mod authors new traps/foes/
  dungeons with zero code.** This honors the PORTABILITY CONTRACT in
  `data/game-data.ts:1-9` and `data/schema.ts:1-5`.
- **Closure-carrying** — live JS functions: abilities (`engine/abilities.ts:23`
  `cast`), passives (`engine/passives.ts:23` `fire`/`test`), consumables
  (`engine/consumables.ts` `use`), affix minters (`data/affixes.ts:27` `build`).
  YAML can't hold closures. These need an **effect-DSL**: a registry of named
  primitives that YAML references by key. The pattern already exists — traps *are*
  a data-interpreted effect DSL; abilities are just richer traps composing the same
  exported ops (`engine/ops.ts`, `engine/select.ts`, `engine/triggers.ts:transmute`).

The whole plan is: **(a)** build a loader + hand-rolled validator + registry, **(b)**
move the pure-data side to YAML (cheap), **(c)** grow the trap effect-DSL until it
can express abilities/passives/consumables, then move those too.

---

## 2. Phase 0 — Foundation (gate for all else) · ~4–7 days

No content moves until this exists. The engine already takes data by parameter
(`assembleFoe(foeId, dg, GAMEDATA, rng)`), so **no engine refactor** — only the UI's
direct `GAMEDATA.*` reads and the static `import { GAMEDATA }` (`ui/app.ts:15`) change.

- [ ] **Build-time YAML import.** Add a Vite YAML-transform plugin (devDependency) +
      `vite.config.ts` wiring so `import x from './content/foo.yaml'` yields a JS object.
      Mirror the plugin in `vitest` config so tests load the same content.
- [ ] **Hand-rolled validator** (`src/data/validate.ts`). Pure TS, driven by the
      `schema.ts` token unions. Per content collection: shape check + closed-vocabulary
      check (every `axis`/`mode`/`geometry`/`effect`/`value` token is in its union) +
      numeric/range sanity. Reuse the `sanitizeItem`/`isAffix` pattern already in
      `engine/items.ts:121-142`. Rich, located error messages (`creatures.goblin.traps[0]`).
- [ ] **Referential-link step.** Promote the integrity assertions in
      `data/game-data.test.ts` to a runtime link pass: every `traps`/`variants`/`boss`/
      `ability`/`passive` id must resolve; reject (built-in: throw; user-mod: skip+warn).
- [ ] **Registry** (`src/data/registry.ts`). `buildRegistry(sources) → GameData`-shaped
      typed tables. Merge order + id-collision policy designed now (base → mods), even
      though only the base source exists yet. This is the seam runtime user-mods slot into.
- [ ] **Swap the consumer.** Replace `import { GAMEDATA }` (`ui/app.ts:15`) with the
      built registry, handed through the existing `V.deps.data` injection seam.
- [ ] **Round-trip test.** current `GAMEDATA` const → YAML → load+validate → deep-equal.
      This is the migration oracle for Phase 1.

**Decision to make during Phase 0:** YAML file layout. Recommendation: **per-domain
files** under `src/data/content/` (`creatures.yaml`, `traps.yaml`, `dungeons.yaml`,
`gear.yaml`, `affixes.yaml`, `economy.yaml`, `progression.yaml`, `abilities.yaml`, …),
not one mega-file and not one-file-per-entity. Matches the `Record<string,T>` shape and
keeps diffs legible.

---

## 3. Phase 1 — Pure-data move (the free win) · ~2–4 days

Everything here already satisfies the portability contract or is a plain constant
table inlined in code. Behind the Phase-0 loader, this is transcription + a file move.
~80% of the content surface, near-zero risk (all behind tested modules).

- [ ] **Creatures / variants / templates** → `creatures.yaml` (`data/game-data.ts`).
- [ ] **Traps / tricks / drifts** → `traps.yaml` (strongest case — pure interpreted vocab).
- [ ] **Dungeons / enemy tables / elite pools / bosses** → `dungeons.yaml`.
- [ ] **Classes** → `classes.yaml` (`data/classes.ts` — 100% id refs already).
- [ ] **Gear base types** → `gear.yaml` (`data/gear.ts`).
- [ ] **Loot tables / rarity & marquee weights / gold-depth constants** → `loot.yaml`
      (`engine/loot.ts:39-53,104,123`). Tables move; the rollers stay code.
- [ ] **Shop prices / markups / Merchant-House upgrade tracks / smith prices** →
      `economy.yaml` (`engine/value.ts`, `engine/smith.ts:29`). First, **extract the
      `ui/bank.ts` economy constants** (`DEATH_TITHE`, storage caps/costs) into the
      economy module so all gold tuning lives in one place before the YAML move.
- [ ] **Close the `blast`/`cross`/`plus` schema-vs-impl gap** (`schema.ts:16` lists them;
      `triggers.ts:101` has no case → silent no-op). Either wire them or drop from the
      union, so authored YAML can't silently do nothing.

After Phase 1: the game is fully YAML-moddable for everything **except authoring new
ability/passive/consumable *behavior*** (those still reference primitives by id). This
is a legitimate ship/stop point.

---

## 4. Phase 2 — Moderate (declarative magnitude + tunable formulas) · ~3–5 days

- [ ] **Affix magnitude DSL.** Retire the `build:(mag)=>AffixComponent[]` closures
      (`data/affixes.ts:27,32-67`). The output (`AffixComponent` tagged unions,
      `engine/items.ts:65-71`) is already data and the engine folds (`engine/gear.ts`)
      need **zero change**. Only the catalog→instance math is a closure, and the
      observed vocabulary is small & closed: `base*mag` + `round/min(1)`, `min(cap,k*m)`,
      a `k` coefficient. Add a declarative `mag` spec + a `buildAffixComponents(spec,mag)`
      interpreter (~40 LOC), migrate all ~18 affixes. `affixes.test.ts` is the oracle.
- [ ] **Progression coefficients** → `progression.yaml` (`ui/save.ts`). `LEVEL_CAP`,
      `HP_PER_LEVEL`, the slot-unlock ladders are pure data; expose `xpForLevel`'s
      `110·L^1.7` as `{base,exponent}` coefficients. Extract these out of `ui/save.ts`
      into a progression data module first.
- [ ] **Delve tunables** → `delve.yaml` (`engine/delve.ts`). `ELITE_STEP`, `RUN_BAG_CAP`,
      dread-band thresholds/labels are data; the boss triangular law stays code.
- [ ] **Simple passives.** The 6 single-op passives (`engine/passives.ts:31-65`) port
      once the effect-DSL (Phase 3) exists — their `test` is exactly the `Condition`
      vocabulary already in `schema.ts:29-37`. The 2 *woven* passives (`overflow`,
      `combined_arms`, `passives.ts:52-55,68-72`) have empty `fire()` bodies; their logic
      lives in `ops.gainBlock` / `combat.applyResolution`. Either keep them as native
      ids or add explicit hook points — flag, don't force.

---

## 5. Phase 3 — The effect-DSL (the moddability ceiling) · ~2–4 weeks

This is where mods author **new behavior** without code. Build by *extending the
existing trap effect-DSL*, not inventing a new one.

- [ ] **Grow the `EffectName` vocabulary** (`schema.ts:59` + `runEffect` `triggers.ts:183`)
      to cover what ability/consumable closures do: `deal`/`heal`/`block`/`extend` (already
      in `engine/ops.ts` as exported pure fns), flood-by-color/shape, cascade, prismatic.
- [ ] **Add a `scale` / expression facility.** Several abilities compute damage from board
      state (`fireball` footprint·magnitude `abilities.ts:90-100`; `rampage`/`quickstrike`
      reductions; `wildgrowth` ripeness). The traps `scale:'set_mag'` precedent
      (`schema.ts:73-76`) is the seed; extend to a small closed `scale` enum or a tiny
      expression mini-language. Conditional abilities (`rally`'s tactic check
      `abilities.ts:214-225`) need a `when`/branch construct.
- [ ] **Port abilities** → `abilities.yaml` (`engine/abilities.ts:51-241`). Simplest first
      (the color/shape floods `callflames`/`callarms`/`berserk`/`bulwark`), hardest last
      (magnitude-scaled + tactic-branching). `castables.test.ts` is the oracle.
- [ ] **Derive `ABILITY_PREVIEW` from the same data.** Today it's a hand-maintained mirror
      map (`abilities.ts:253-282`) duplicating each ability's targeting. The DSL must
      generate previews from the selector data, not require a second authoring pass.
- [ ] **Port passives** → `passives.yaml` (after the DSL; see Phase 2 note on the 2 woven ones).
- [ ] **Consumable effect-bus** → `consumables.yaml` (`engine/consumables.ts`). Route `use()`
      through the same effect-DSL. Some effects (cascade, prismatic) currently exceed the
      trap vocabulary — they drive the vocabulary-growth list above.
- [ ] **Escape hatch:** keep the closure registries (`ABILITIES`/`PASSIVES`/`CONSUMABLES`)
      as *native primitives* a mod can reference by id, for genuinely bespoke logic that
      the DSL can't express. The DSL is the common case; native ids are the fallback.

---

## 6. Art / assets (forward-looking, ~0 work now)

There is no image pipeline — all "art" is inline emoji string tokens (`icon: '🔥'`),
already YAML-trivial. **Decision to bake in now:** keep `icon` an optional string
everywhere (it already is) and treat it as a *path-or-glyph* field, so when emoji
become real sprite files a mod references `assets/foo.png` resolved against
`import.meta.env.BASE_URL` / a mod asset dir. No manifest needed until real sprites land.

---

## 7. Open design questions to resolve before their phase

- **Phase 0:** confirm the per-domain YAML file split (§2).
- **Phase 0:** the Vite YAML plugin choice (devDep) — pick a maintained, minimal one.
- **Phase 2:** exact shape of the affix `mag` spec (declarative ops vocabulary).
- **Phase 3:** `scale` enum vs. a mini expression language — the single biggest design
  call in the whole effort. Resolve with a dedicated design pass when Phase 3 starts.
- **Phase 3:** the 2 woven passives — native ids vs. new engine hook points.
- **Runtime user-mods (deferred):** YAML-runtime-parser dep vs. JSON-only user mods.
