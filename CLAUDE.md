# CLAUDE.md — guidance for Claude Code sessions on SET.core

Read `PROJECT.md` first — it is the full design context and the source of truth
for *why* the generation/tuning math is the way it is. This file is the fast
orientation.

**Design-doc map** (read in this order for the *game* on top of the core):
- `PROJECT.md` — the Set core + generation/tuning math (why the levers exist).
- `GAME-DESIGN.md` — the real game: locked f=3 / N=15 **5×3** board, trigger bus,
  transmute verb. Wins over the prototype defaults where they conflict.
- `CRAWL-DESIGN.md` — **set.crawl**, the data-driven dungeon-crawler: run loop,
  YAML entity architecture, combat resolution, Tactics meter, gear taxonomy.
- `TRAPS.md` — the reactive **threat layer**: trap vocabulary, the four board verbs
  (destroy / transmute / lock / + conditions), dungeon·elite·boss attachment, foe
  composition (creature ⊕ variant ⊕ template), enemy-transmute tuning.

## What this is
A skill-component minigame based on the card game **Set**, the reusable
action-resolution layer of a web RPG. Lineage: `set.core` (skill core + tuning
console) → **`set.combat`** (classes, passives, abilities, Tactics, transmute,
the threat layer) → **`set.crawl`** (the dungeon-crawler game, not yet code).
**The live game is now the modular TypeScript client in `src/`** (`core`/`data`/
`engine`/`ui`, entry root `index.html`, run with `pnpm dev`). The original
single-file prototypes (`prototype/set-proto.html`, `prototype/set-combat.html`)
are **archived** under `prototype/` as the behavioral oracle the rebuild was
diffed against — read them for *intent*, but new code lands in `src/`. The
foundation migration is complete (TODO §A); next is **set.crawl on the modules**.

## Mental model (don't lose this)
- Set = finite affine geometry **AG(f,3)**. Cards are points in (ℤ/3)^f; a set is
  a line; three cards are a set iff every coordinate sums to 0 mod 3.
- Two cards uniquely determine the third: `third(a,b)_i = (-(a_i+b_i)) mod 3`.
- **Keep 3 values per feature.** Vary `f` for difficulty, never `v`.
- Density: `E[sets] = C(N,3)/(3^f − 2)`.
- The dials are NOT one difficulty scale. F = difficulty spine (moves findability
  AND availability). N = texture (U-shaped, not monotonic). Timer = pressure
  (maps to character skill). k-bias = pure findability. See PROJECT.md §4.

## Hard rules / invariants (assert in any refactor)
1. No duplicate cards on a board.
2. At least `FLOOR` sets present at all times (never a dead board).
3. Dropped/inactive axes are pinned to a constant → must stay all-same →
   never affect set validity. (Cards are always 4-tuples internally.)
4. Generator is a **pure function of a target spec**. Abilities/encounters are
   **spec→spec transforms**, never direct generator inputs. This is the
   structural fairness guarantee — do not add a difficulty input that bypasses it.
5. Control aggregate stats; randomize specifics (no positional tells).

## Working style notes
- The generation core is heavily validated (100k+ clears/config, zero invariant
  violations). Trust it. Bugs so far have all been in the UI layer.
- Before shipping any change to generation, re-run a headless simulation that
  checks the invariants above across the dial space. (Past sessions extracted the
  `<script>` core with a small Node harness and asserted floor/distinct/pin.)
- Prefer keeping the prototype dependency-free and single-file until there's a
  reason not to. If it graduates to an engine, prior context favored Godot
  (HTML5/WASM export, CLI builds).
- **Lock-layer invariant (when built):** ≥ FLOOR sets must be completable from
  *unlocked* cards (the makeable-set floor, `TRAPS.md` §6). Locked cards still form
  sets on paper but not in reach.

## Repo / workflow
- **Personal repo** — committing and **pushing directly to the default branch
  (`master`) is fine**, including in auto/unattended mode. No PR/branch dance
  required unless a change is genuinely risky. Commit/push when the user asks.

## Immediate open threads
- **DONE: the threat layer** (`TRAPS.md`) — enemy traps/tricks fire on the trigger bus
  (gated by condition/cadence; no enemy resources), the `locked` card set, named geometry
  selectors, dungeon-drift tick. Built in the prototype, then ported to `src/engine`.
- **DONE: the foundation migration** (TODO §A) — the modular `src/` client is the live
  game at full parity (engine + UI + coaching + polish); the prototype is archived.
- **NEXT BUILD: `set.crawl` on the modules** (`CRAWL-DESIGN.md`) — the run loop +
  second screens (town / run-map / inventory) + persisted progression. This is the
  "graduate the prototype" trigger; build it on `src/`, not the archived HTML.
- Still open (see `TRAPS.md` §8 / `CRAWL-DESIGN.md` §6): per-foe transmute *numbers*
  (framework set, tune in play); loss-condition penalty; XP/HP/gold curves; whether
  the enemy ever gets an active resource-spending layer.
