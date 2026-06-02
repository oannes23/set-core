# CLAUDE.md — guidance for Claude Code sessions on SET.core

Read `PROJECT.md` first — it is the full design context and the source of truth
for *why* things are the way they are. This file is the fast orientation.

## What this is
A skill-component minigame based on the card game **Set**, intended as the
reusable action-resolution layer of a web RPG. Current state: a single
self-contained prototype, `prototype/set-proto.html`, that implements the Set
core + custom generation + scoring + a full tuning-dial console.

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
  checks the four invariants above across the dial space. (Past sessions extracted
  the `<script>` core with a small Node harness and asserted floor/distinct/pin.)
- Prefer keeping the prototype dependency-free and single-file until there's a
  reason not to. If it graduates to an engine, prior context favored Godot
  (HTML5/WASM export, CLI builds).

## Immediate open threads (see PROJECT.md §8)
- Timer-as-character-skill, modeled as opposite pressure to encounter F.
- Signature→effect language (2^f spell archetypes; rarity self-tunes by k).
- Specialist (concentration) vs generalist (diversity) ability archetypes.
- Encounter value-scoring is currently a color-only placeholder; the real version
  maps signatures to effects.
