# GAME-DESIGN.md — SET.core → the real game

> Forward-looking design notes for the actual RPG built on the SET.core skill
> engine. **Status: the combat layer specced here is built in `src/`** (the locked
> f=3 / N=15 5×3 board, the trigger bus, the transmute verb, classes / abilities /
> tactics); the full RPG / dungeon-crawler shell around it is in progress
> (`CRAWL-DESIGN.md`, `TODO.md`). `PROJECT.md` remains the source of truth for the
> generation/tuning math; this doc is where the *game* on top of it is specified. When something here contradicts
> the prototype's defaults, this doc wins for the real build (and `PROJECT.md`'s
> reasoning explains *why* the lever exists).

---

## 0. The one-paragraph thesis

Three systems compose into emergent play: **board-altering player abilities**
(transmute the board), **math-modifying equipment** (bend the deal odds and the
payoff of a match), and **trap-trigger enemy effects** (punish or reward specific
matches). A character is a *build* across all three — a thematic engine of looping
combos — and every build has natural counter-foes whose triggers punish exactly
the matches that build wants to make. Skill is no longer "can you find a set"
(the board is deliberately generous); it's "can you read the board's value
landscape against the enemy's traps and your own combo lines, fast."

---

## 1. Locked board parameters

| Param | Value | Locked because |
|---|---|---|
| **f (features)** | **3** (color, shape, number; shading dropped) | The three most thematically useful axes (color→element, shape→form, number→magnitude). Keeps per-card load low and preserves the "two cards determine the third" v=3 magic. |
| **N (board size)** | **15** | Deliberately generous **and** a **5×3 grid** — chosen over 4×4 for the geometry (below). |
| **v (values/feature)** | 3 (always) | Non-negotiable invariant. |

**Why generous (f=3 / N=15):** average sets per board ≈ `C(15,3) / (3³−2) = 455/25 ≈ 18`. The board is *flooded* with combos. That is the point:

- A **novice** can always slowly find *something* — the board never gates them.
- An **expert** ignores "find any set" and hunts *specific* sets — the ones that
  feed a trigger, generate the right mana, or set up a combo. The skill ceiling is
  **value-targeting under pressure**, not scarcity.
- It leaves **lots of board room for transmutation** — destroying and regenerating
  chunks of a 15-card board stays lively and never risks a dead board.

**Why a 5×3 grid specifically (N=15 over a 4×4 N=16):** once geometric hit-patterns
became a core feel (`TRAPS.md` §5.4), the grid *shape* turned into a real choice. 5×3
wins it for this game — we consciously trade good diagonals + symmetric quadrants (the
exotic patterns 4×4 would give) for three things that matter more:

- **Row ≠ column is an asset.** A horizontal **row hits 5**, a vertical **column hits
  3** — so the two most-used patterns are *inherently different-severity*, and the
  geometry hands us **free severity-tuning that matches theme**: a horizontal **sweep**
  (wall-collapse, earthquake, a line of soldiers) is naturally a bigger board event
  than a vertical **strike** (spear, lightning bolt, pierce). Mechanical magnitude =
  thematic magnitude, automatically. 4×4 flattens both into "4 cards," throwing that
  semantic axis away.
- **A true center cell** (odd×odd) gives clean epicenters for the signature
  **blast / cross / radial** patterns — the ones used *most*. 4×4 has no single center.
- **It fits the screen** — 3 rows, wide; 4×4 is taller on both counts (a 4th row *and*
  wider→taller cards), which would force shrinking the very cards the patterns play on.

The grid is **5 cols × 3 rows**, slots positionally stable across reforms, so every
pattern in `TRAPS.md` §5.4 is well-defined on it.

**The consequence that reframes everything:** with f and N fixed, **board generation
is no longer the difficulty dial.** In the prototype, F was the difficulty spine.
Here the board is a *stable, generous substrate*, and **all difficulty lives in the
RPG layer** — enemy attack timers (pressure), enemy triggers (traps), and the
ability/economy game. Camouflage-depth as a knob is mostly saturated at N=15 anyway
(see `PROJECT.md` §5), which is fine — we're not using the board for difficulty.

---

## 2. Architecture: three layers, two inherited principles

```
  ┌─────────────────────────────────────────────────────────────┐
  │  TRIGGER BUS   event → condition → effect                    │  ← §3
  │  sources: character innate · equipment · enemy signature     │
  ├─────────────────────────────────────────────────────────────┤
  │  PLAYER VERBS  transmute(select, biasSpec, objective)        │  ← §4
  │  + resource economy (mana by match signature)               │  ← §5
  ├─────────────────────────────────────────────────────────────┤
  │  BOARD SUBSTRATE  f=3 / N=15 generous Set core              │  ← §1
  │  generation invariants hold no matter what the layers do    │
  └─────────────────────────────────────────────────────────────┘
```

Two principles carry up from `PROJECT.md` §7 and **must not be violated**:

1. **Spec → spec transforms, never direct generator inputs.** Abilities/gear/enemy
   effects modify the generator's *target spec* (which slots to free, what bias to
   regen with); the generator stays a pure function of that spec. This keeps
   fairness *structural* — every board is one the player's build produced. There is
   no designer rubber-band, because there is no code path for one.
2. **Control aggregate stats, randomize specifics.** Biases shift *distributions*;
   they never plant a specific card in a specific slot. No positional tells.

Both the verb layer and the trigger layer obey these — they're the same generation
core the prototype already validated (100k+ clears, zero invariant violations).

---

## 3. The trigger bus (the new core system)

All three reactive systems are **one event→condition→effect bus**. Only the *source*
differs. This is the `PROJECT.md` §8 "signature→effect language" generalized and
given three owners.

**Event vocabulary** (things the bus can fire on):
- `match` — a set was cleared. Carries the **match descriptor**: per-axis
  same/different, and for each all-same axis, *which value*. (e.g. "all-same
  color=red, all-different shape, all-same number=1".)
- `tick` — a time unit passed.
- `damage` — the player took a hit (enemy attack resolved).
- `ability` — a player verb fired.

**Condition** = a predicate over the event. For `match`, the useful granularities:
- **all-same of value V on axis A** ("an all-red match", "an all-1-magnitude match")
- **contains value V on axis A** ("the match includes any Attack")
- **signature shape** ("a fully camouflaged k=3 match", "all-same everything")

> ~~Open knob~~ **Resolved (`TRAPS.md` §1–§2):** punishing traps use **all-same**
> (rare, dodgeable, a *price* you sometimes choose to pay); **contains** is reserved
> for *reward* triggers where firing-constantly is the point. The full trap layer —
> condition vocabulary (single / inverse-diverse / double-value / tick-dread), the
> **severity ∝ rarity** tuning law, consequence families, the counter-foe recipe, and
> the board-state verbs (destroy / transmute / **lock**) — now lives in **`TRAPS.md`**.

**Effect** = a state change: grant mana, advance/reset an enemy timer, set a regen
bias, transmute the board, deal damage, gain energy, etc.

### The three sources

| Source | Valence | Example |
|---|---|---|
| **Character innate** | build identity | Rogue: `match all-same Move → set regen bias toward Attack` |
| **Equipment** | stackable buildcraft | `match (contains Attack) → +1 red mana`; math-mod gear that shifts deal odds |
| **Enemy signature** | the threat / "lines you don't cross" | Goblin Patrol "Swarm": `match (contains magnitude-1) → enemy attack timer −1s`. Dragon "Fire Breathing": `match all-same red → 25% chance enemy attacks immediately` |

**The tension this creates:** the enemy's trap conditions turn certain matches
*dangerous*, so the player must read the board's value landscape **against** the
enemy's traps **and** their own combo lines simultaneously. A Pyromancer who wants
all-red matches is strong — until a Fire-Breathing foe punishes exactly that. This
is build-vs-counter falling out of the system, not authored matchup tables.

---

## 4. Board-altering player verbs (transmute)

The full analysis lives in the design conversation; the engine reality:

**One primitive:** `transmute(selector, biasSpec, objective)`
- **selector** — which cards to destroy: a value-filter (`color ≠ red`), a **geometric
  region** (row / column / diagonal / corners / border / center / blast / random — the
  full pattern vocabulary lives in `TRAPS.md` §5.4), or random. Geometry is spatial
  selection only; the refill still randomizes set-membership (no positional tell).
- **biasSpec** — the regen bias (toward a value, or neutral). Reuses the per-feature
  deal-bias channel already built into the prototype.
- **objective** — what the best-of-N regen optimizes: *maximize favored value* (for
  bias abilities) vs *hit camo depth* (normal refill).

The regen half **already exists** — it's the prototype's constructive `patch()`,
which holds distinctness + the floor and reads the bias channel.

**Worked verbs:**
- **Call Flames** (Pyromancer): destroy `color ≠ red`, regen `bias→red`, objective
  maximize-red. Cost: off-color mana dump (e.g. 5 blue + 5 green). Floods red, which
  the player combos into red matches → red mana engine.
- **Berserk** (Warrior): destroy `shape = defend`, regen `bias→attack`.
- **Quick Strike** (Rogue): deal damage, destroy `shape = attack`, regen `bias→move`.
- **Fireball** (upgraded Firebolt): spatial — destroy targeted card + neighbors,
  regen `bias→red`. Needs a click-to-target mode + grid-neighbor function.

**Governors that the math gives for free** (these are the balance, no bookkeeping):
- **Saturation cap — but only at f=3.** No-duplicates means at f=3 there are only
  `3² = 9` distinct all-red cards, so on N=15 you can't exceed ~9 red → the rest is
  forced off-color. The "still some green/blue" behavior is geometric law. **At f=4
  there are 27 distinct reds → no cap → runaway.** ← a reason we locked f=3.
- **Natural decay.** After a transmute spike, each set you clear refills freed slots
  at the *baseline* bias, so the board relaxes to neutral over a few clears. The
  power spike is a spent resource with an automatic tail.
- **Floor protection.** `patch` never yields a board below FLOOR sets; it plants a
  (mildly anti-bias) completer if needed. Never a dead board.

**Two implementation must-knows:**
- **Runtime bias ≠ setup bias.** Setup bias is locked at round start. Abilities fire
  mid-round and need a *transient* bias passed into a single patch call
  (`patch(board, slots, biasOverride)`), not a mutation of the global setup bias.
- **Large-destroy fill.** Destroying *all* non-red frees many slots and bumps the
  9-card ceiling — naive rejection-patch thrashes. Large-destroy verbs want a
  smarter fill (draw favored-value-first from the distinct pool, then top up).
  Small-AoE verbs (Fireball ~5 slots) don't have this problem.

**Damage as a transmute.** Enemy attack → screen flashes red → 1 random card
destroyed, regenerates after ~2s. Empty/pending slots are already supported by the
data model (render and findSets skip falsy cards), so this is a timer + juice. Keep
it to **1 card** (more is too swingy). Caveat: at FLOOR=1 the wrong card can leave a
genuine 2s gap — either pick a non-floor-critical card or accept the gap as the cost.

---

## 5. Resource / economy model

- Matches generate **resources keyed by signature** — most naturally **colored mana**
  off the color axis (red/green/blue), and likely shape- and number-derived resources
  too (energy, etc.). Exact mapping TBD.
- Abilities **cost** resources. Off-color costs (Call Flames = blue+green) make a
  conversion engine: spend the colors you're not using to bias the board toward the
  color you are.
- **Loop discipline:** if an ability's favored-resource output exceeds its cost
  input, it's an infinite engine. The §4 governors (saturation cap, decay, floor,
  cost) are the rate-limiters that should keep every loop sub-unity. Watch this in
  tuning.

---

## 6. Worked example — the Rogue (build × gear × counter)

- **Innate trigger:** `match all-same Move → regen bias toward Attack`.
- **Quick Strike verb:** deal damage, destroy all Attacks, regen `bias→Move`.
- **The loop:** match Move → Attacks get biased in → Attacks appear → Quick Strike
  consumes them (damage) and regens Move → match Move again → … a thematic,
  self-feeding tempo engine.
- **Gear scales it:** "+1 damage per Attack consumed by Quick Strike", "match Move →
  +1 energy", math-mod gear that deepens the attack/move bias.
- **Counter-foe:** an enemy whose trap punishes Move- or Attack-matching breaks the
  loop — e.g. "match (contains Move) → enemy gains armor" forces the Rogue off their
  best line. Build-vs-counter, emergent.

---

## 7. Open questions (resolve before/while building)

- ~~**Condition granularity**~~ — resolved in `TRAPS.md` §1–§2 (all-same punishes,
  contains rewards; severity scales with rarity). Enemy traps, the inverse "diverse"
  conditions, double-value boss conjunctions, tick-dread DoTs, and the **lock** board
  verb all specced there.
- **Resource mapping** for the shape and number axes (color→mana is clear; the others
  aren't).
- **Enemy timer model** — fixed countdown? variable per enemy? how triggers
  accelerate it (−Ns vs immediate vs %chance).
- **Bias persistence** — does a transmute's bias apply once (decays) or set a
  *stance* until changed? (Once-with-decay is the safer default; stance is stronger
  and more degenerate.)
- **Ability targeting UX** — click-to-target mode, neighbor definition over the
  5-column N=15 grid, confirm/cancel.
- **Stacking rules** — how multiple triggers on the same event order and combine.
- **Engine/tech** — prototype is single-file vanilla JS; prior context favored Godot
  if this graduates (HTML5/WASM export, CLI builds).

---

## 8. Glossary additions (extends `PROJECT.md` §9)

- **transmute** — the single board-altering verb: destroy selected cards, regenerate
  with a bias spec. All board abilities are wrappers over it.
- **trigger** — an event→condition→effect rule. Owned by character, equipment, or
  enemy. The generalized signature→effect language.
- **match descriptor** — the per-axis same/diff + all-same values of a cleared set;
  what trigger conditions read.
- **trap (enemy trigger)** — a negative trigger that punishes a specific match; the
  "line you don't want to cross."
- **transmute governors** — saturation cap (f=3 only), natural decay, floor
  protection: the geometric facts that balance board abilities for free.
- **setup bias vs runtime bias** — locked-at-round-start deal bias (encounter/
  character baseline) vs transient bias applied to a single ability-driven patch.
