# THEORYCRAFT.md — the whole design, from first principles

*A single-file tour of **why** SET.core is built the way it is: the design,
the math, the balance, and the guiding ideas. Written for someone only
vaguely familiar with the project. Every section opens in plain language;
the exact formulas live in the appendices at the bottom.*

> **⚠ Historical theorycraft tour.** This document captures the design *as it was
> reasoned out*; the codebase has since moved past several claims below. For the
> current state read `CLAUDE.md` (orientation) and `TUNING.md` (live constants).
> Superseded claims are annotated in place rather than rewritten — the reasoning
> is still the point of this file.

The deeper source-of-truth docs are `PROJECT.md`, `GAME-DESIGN.md`,
`TRAPS.md`, `CRAWL-DESIGN.md`, and `prototype/TIERS.md`. This file distills and
connects them. Where they conflict, the later/game docs win (the game on top of
the prototype overrides prototype defaults).

**Status tags used throughout:** `[live]` = working in a prototype you can open
today · `[designed]` = fully specified on paper, not yet code · `[open]` = still
an undecided question. *(Superseded — the prototypes are now **archived** under
`prototype/`; the live game is the modular TypeScript client in `src/`. Read
`[live]` as "shipped in `src/`".)*

---

## 1. What this project is

**Set** is a card game that is secretly a piece of finite geometry. SET.core
takes that geometry and turns it into a reusable **skill minigame** — a little
"find the pattern, fast" loop — and then uses that loop as the
**action-resolution layer of a web RPG**. Instead of rolling dice to see if your
attack lands, you find sets on a board; how well you do drives how well your
action resolves.

The project has grown in three layers, each building on the last:

| Layer | What it is | Status |
|---|---|---|
| **`set.core`** | The skill engine + a tuning console for it (`prototype/set-proto.html`) | archived oracle |
| **`set.combat`** | The combat layer — classes, passives, abilities, Tactics, transmute | live in `src/` (`prototype/set-combat.html` is the archived oracle) |
| **`set.crawl`** | A data-driven dungeon crawler built on combat (`CRAWL-DESIGN.md`) | combat + Tactics v2 + Phase B1 (scenes + persistence) shipped in `src/`; run loop is next |

~~The next build is the **threat layer** (`TRAPS.md`) landing inside
`set-combat.html`: the enemy half of the system.~~ *(Superseded — the threat
layer shipped long ago and lives in `src/engine` (`triggers.ts`, `foe.ts`); the
single-file prototypes are archived. See `CLAUDE.md` for the current next build.)*

---

## 2. The guiding philosophy (the North Star)

Almost every decision in this project falls out of one stance:

> **Bias heavily toward player *skill* and *generosity of generation*. The board
> should never be the bottleneck — the player's eyes and speed should be.**

In most Set-like games, the tension comes from scarcity: maybe there's no set on
the board, maybe you got a bad shuffle, maybe you're stuck. SET.core deliberately
**engineers that luck out**. The board is *flooded* with sets on purpose (a
typical game board has ~18 of them). Because cards are *generated to order*
rather than dealt from a finite deck, droughts simply don't happen.

This flips what "skill" means:

- A **novice** can always slowly find *something* — the board never gates them.
- An **expert** ignores "find any set" and hunts *specific* sets: the ones that
  feed a combo, generate the right resource, or dodge an enemy's trap.

So the skill ceiling is **"can you read the board's value landscape, under
pressure, against the enemy's traps and your own combo lines, fast?"** — not
"can you find a set." That single reframing is what lets a simple matching game
carry a whole RPG's worth of decisions.

---

## 3. The load-bearing principles

These are the invariants everything else is built on. If you remember nothing
else, remember these — every later system is a consequence of them.

### 3.1 Set is geometry, not "a card game with attributes"

A card is a point in a tiny grid of coordinates (one coordinate per *feature*
like color or shape, each taking one of 3 values). A "set" is exactly a
**straight line** through that geometry. The rule "all-same or all-different on
every feature" is just the algebraic condition for three points to be colinear.

The single most useful consequence: **any two cards have exactly one card that
completes a set with them.** This one fact is the engine behind counting sets,
giving hints, and — crucially — *generating* boards to a target. (The exact
formula is in Appendix A.)

### 3.2 Keep 3 values per feature, always. Vary the number of features.

There are always **3 values per feature** (`v=3`). This is non-negotiable: 3 is
what makes "two cards determine the third" work. The difficulty knob is the
**number of features** (`f`) — 3 vs 4 vs more — *never* the values-per-feature.
Bumping to 4 values would break the geometry and explode the deck.

### 3.3 The generator is a pure function of a target spec

The board generator takes a **target spec** (how many features, how big, how
hidden the sets should be, what to bias toward) and produces a board that hits
it. It never takes "the player is strong, make it harder" as a direct input.

Instead, **abilities, encounters, gear, and enemy effects are *spec→spec
transforms*.** They edit the *target spec* — "free these slots and refill biased
toward red" — and the generator stays a pure function of whatever spec it's
handed. This is the **structural fairness guarantee**: every board the player
sees is the honest output of one transparent spec. There is no hidden
rubber-band code path that reaches in and rigs an individual board. (See
Appendix C, principle #4.)

### 3.4 Control aggregate statistics, randomize the specifics

Biases shift *distributions* — "more red on the board" — they never plant a
specific card in a specific slot. The counts and odds are held steady; *which*
cards participate is randomized. The payoff: **no positional tells.** A player
can never learn "the winning set is always in the corner," because nothing is
ever placed; only the mix is steered.

### 3.5 The hard board invariants (assert these in any refactor)

1. **No duplicate cards** on a board.
2. **At least `FLOOR` sets present at all times** (currently `FLOOR=1`) — never a
   dead board.
3. **Dropped/inactive features are pinned to a constant** so they're trivially
   "all-same" and never affect set validity. (Cards are always stored as
   4-tuples internally, even when only 3 features are active.)
4. **The makeable-set floor** `[live]` *(enforced in `src/` since the lock layer
   shipped)*: once cards can be *locked*, ≥ `FLOOR`
   sets must be completable from *unlocked* cards. A locked card forms sets on
   paper but not in reach — the floor has to count reach, not just existence.

The generation core is validated to a paranoid degree: **100k+ board clears per
configuration across the whole dial space, zero invariant violations.** The
lesson learned repeatedly: trust the generator; the bugs have all been in the UI.

---

## 4. System: generation & the math of generosity

**The decision:** don't deal from a deck — *construct* boards against the current
state. This converts a sampling problem (hope the shuffle is kind) into a
construction problem (build exactly the board you want). It's the "cheat" that
buys generosity for free.

Three strategies do the work, each for the moment it fits:

| Moment | Strategy | Why |
|---|---|---|
| **Initial board** | **Rejection** — generate and test toward the floor | Simple; hits target densities first try |
| **Replenish after a clear** | **Constructive patch** of the freed 3 slots | Surgical; preserves the live board mid-scan |
| **Shaping a specific mix/hiddenness** | **Best-of-N** — sample many candidates, keep the closest | Rejecting toward a *precise* target is exponentially expensive |

**Why "generosity" is a number, not a vibe:** on the locked game board (3
features, 15 cards) the *average board carries about 18 sets* (the exact count
is in Appendix A). The board is flooded — and that is the point. It means a
novice is never stuck, an expert always has room to be picky, and there's plenty
of board to *destroy and regrow* without ever risking a dead board. Generosity
is what makes the entire RPG layer (abilities that blow up chunks of board, enemy
traps that reshape it) safe to build.

---

## 5. System: the difficulty dials (the tuning model)

This is the most important and least obvious idea in the whole project:

> **The dials are not points on one difficulty slider. They live on three
> independent axes — availability, findability, and pressure — and they behave
> very differently.**

Treat them as one slider and you get nonsense (e.g. "make the board bigger to
make it harder" is sometimes *easier*). Treat them as three axes and tuning
becomes legible.

| Dial | What it actually controls | Behaves how | Narrative home |
|---|---|---|---|
| **F** (features, 3↔4) | findability **and** availability — the **difficulty spine** | strongly monotonic | encounter tier |
| **N** (board size, ~8–16) | availability only | **U-shaped**, not monotonic | encounter *texture* |
| **Timer** | pressure only | clean, monotonic | character skill / composure |
| **Camouflage depth** (target how-hidden the *best* set is) | findability — coarse step | monotonic | encounter subtlety |
| **Escape routes** (how *many* easy sets exist) | findability — fine step | monotonic | fine-tune between camo steps |
| **Drop-axis / k-bias** | findability only, ~zero density effect | qualitative | mastery reward |

A few consequences worth internalizing:

- **F is the spine.** One step of F (3→4) moves *both* how findable sets are and
  how many exist — and it unlocks a whole new tier of "invisible" sets that 3
  features literally cannot produce. No amount of board size closes an F gap;
  they don't pull on the same rope.
- **N is texture, not difficulty.** Bigger board = more sets (easier to find one)
  *and* more cards to scan (harder to find one). Net difficulty vs. N is
  **U-shaped**: small boards are availability-bound, big boards are scan-bound,
  the middle is comfortable. So N is a *wonderful* knob for *feel* — a tense
  small-board "duel" vs. a frantic big-board "melee" at roughly the same
  difficulty — and a *terrible* knob for difficulty. (At 3 features, raising N
  actually makes things *easier*, because the board gets so crowded that easy
  sets appear by accident. See Appendix B.)
- **Difficulty and skill are opposite-sign pressures on the same knobs.** The
  encounter pushes toward "hard"; the character's competence pushes back toward
  "easy." The marquee skill expression is that **high skill effectively drops the
  encounter's F by one** — a big, readable swing *precisely because* F is the
  dominant lever.

All of this is not just theory: the project ships a named **8-tier difficulty
ladder** (Trivial → Brutal) with a transparent **Difficulty Index (DI)** computed
from what the generator actually produces, validated by Monte-Carlo simulation.
The ladder and the DI formula are in Appendix B.

---

## 6. System: perception & why shading was dropped

Classic Set has four features: color, shape, number, and *shading* (solid /
striped / open). SET.core **drops shading** and keeps the other three. The reason
is straight out of vision science.

The eye ranks features by how cheaply it can track them: **color > shape >
texture**, with number "subitized" (read at a glance for small counts). Shading
is a *texture* read — the most expensive — and it gets penalized twice:

- A busy board (lots of color and shape variation) actively *suppresses* texture
  reads, but not vice versa. So under time pressure, shading silently falls out
  of working memory.
- Tellingly, the **official Set game's own beginner ramp removes shading first**
  (it starts you with 27 solid cards). We're following an established on-ramp.

There's a bonus: the three surviving features map cleanly onto RPG meaning —
**color → element, shape → form/verb, number → magnitude.** Dropping the least
useful feature also happens to keep the three most thematically useful ones.

The related idea is **`k`**, the **findability index**: how many features are
"all-different" in a given set. A `k=1` set (mostly-same — a "gimme") pops out
preattentively; a high-`k` set (a "camo" set) shares no visual cue and must be
verified one feature at a time. `k` is the purest measure of *how hard a set is
to see*, independent of how many sets exist. (The combinatorics of `k` are in
Appendix A; it's also why 3 features can't make a *fully* hidden set and 4 can.)

---

## 7. Layer: the game on top — `set.combat` `[live]`

Here the project makes a deliberate architectural inversion.

### 7.1 The board gets locked

In the prototype, F and N were the difficulty dials. In the **game**, both are
**locked**:

| Parameter | Value | Why locked |
|---|---|---|
| **Features** | **3** (color, shape, number) | The three most thematic features; keeps per-card load low; preserves the v=3 "two cards determine the third" magic |
| **Board size** | **15**, laid out as a **5×3 grid** | Deliberately generous (~18 sets), and the grid *shape* is itself a design tool |
| **Values/feature** | **3** | The non-negotiable invariant |

**Why a 5×3 grid and not 4×4?** Once geometric hit-patterns became part of the
feel, the grid's shape became a real choice, and 5×3 wins on three counts:

1. **A row hits 5 cards, a column hits 3.** The two most-used patterns are
   *inherently different severity*, for free. A horizontal **sweep**
   (wall-collapse, earthquake) is naturally a bigger event than a vertical
   **strike** (spear, lightning). Mechanical magnitude matches thematic magnitude
   automatically. A 4×4 grid flattens both to "4 cards."
2. **It has a true center cell** (odd × odd), giving clean epicenters for
   blast / cross / radial patterns.
3. **It fits the screen** — wide and short — without shrinking the cards.

**The inversion:** with the board fixed and generous, **board generation is no
longer the difficulty dial.** All difficulty now lives in the RPG layer — enemy
timers (pressure), enemy traps, and the ability/economy game. The board becomes a
*stable, generous substrate* the rest of the systems play on.

### 7.2 Three systems compose into a "build"

A character is a *build* spread across three systems that all speak the same
language:

1. **Board-altering player abilities** — verbs that transmute the board.
2. **Math-modifying equipment** — gear that bends the deal odds and the payoff.
3. **Trap-trigger enemy effects** — enemies that punish or reward specific matches.

The good part is emergent: **every build has natural counter-foes** whose traps
punish exactly the matches that build most wants to make. Build-vs-counter falls
out of the system instead of being hand-authored matchup tables.

### 7.3 The trigger bus — one system, three sources

All three reactive systems are a single **event → condition → effect** bus. Only
the *source* of the rule differs.

- **Events:** `match` (a set was cleared, carrying a *descriptor* of its per-axis
  same/different pattern and values), `tick` (time passed), `damage` (you got
  hit), `ability` (you cast something).
- **Conditions:** predicates over the event — "an all-red match," "a match that
  *contains* an Attack," "a fully camouflaged match."
- **Effects:** grant resource, advance/reset the enemy's timer, set a regen bias,
  transmute the board, deal damage, etc.

| Source | Valence | Example |
|---|---|---|
| **Character innate** | build identity | Rogue: *match all-Move → bias next refill toward Attack* |
| **Equipment** | stackable buildcraft | *match containing Attack → +1 red mana* |
| **Enemy signature** | the threat | Dragon: *all-red match → chance the enemy attacks immediately* |

A resolved design rule: **all-same conditions are rare and `[punish]` (a price
you sometimes choose to pay); "contains" conditions are common and `[reward]`
(constant by design).** This is the seed of the whole threat layer (§8).

### 7.4 The transmute verb and its free governors

There is essentially **one board-altering primitive**:
`transmute(selector, biasSpec, objective)` —

- **selector**: which cards to remove (by value like "non-red," by **geometric
  region** like a row/column/blast, or random),
- **biasSpec**: what to bias the refill toward,
- **objective**: what the best-of-N refill optimizes for.

Every flashy ability — Call Flames (flood the board red), Berserk (turn Defends
into Attacks), Fireball (blow up a card and its neighbors) — is a wrapper over
this one verb. And the math hands us the **balance for free**:

- **Saturation cap (and *only* at 3 features).** No duplicates means at 3
  features there are only **9 distinct red cards**, so a 15-card board can't go
  more than ~9 red — the rest is forced off-color. "There's still some blue and
  green" is a geometric *law*, not a tuned number. (At 4 features there are 27
  distinct reds → no cap → runaway. This is a core reason the game locks to 3.)
- **Natural decay.** After a transmute spike, every subsequent clear refills at
  the *baseline* bias, so the board relaxes back to neutral over a few clears. A
  power spike is a spent resource with an automatic tail.
- **Floor protection.** The refill never drops the board below `FLOOR` sets.

### 7.5 Economy, Tactics, passives, classes `[live]`

- **Resources by signature.** Matches generate resources keyed to the set's
  signature — most naturally **colored mana** off the color axis. Abilities
  *cost* resources, often off-color ones (Call Flames costs blue + green),
  turning unused colors into the color you want. **Loop discipline:** the
  governors above (saturation cap, decay, floor, cost) keep every combo loop
  *sub-unity* so no infinite engine emerges.
- **Tactics** is the resolved rework of the "Move" verb. *(The armed-meter
  version described in early drafts — `TACTICS_GOAL`/`TACTICS_DRAIN` — is GONE;
  the live system is **Tactics v2**, a charge queue + two stances. See
  `CRAWL-DESIGN.md` §5.5 for the current spec and `TUNING.md` for the constants.)*
- **Passives** are always-on triggers on the bus (Flame Shield: *all-red match →
  +block*; Bloodlust: *all-Attack match → +damage*; etc.).
- **Nine classes** are each a 3-ability loadout + 1 signature passive
  (Pyromancer, Cryomancer, Druid, Berserker, Sentinel, Rogue, Spellblade,
  Chronomancer, Warlord).

---

## 8. Layer: the threat layer — `TRAPS.md` `[live]` *(shipped in `src/engine`)*

~~This is the **next build**.~~ *(Superseded — built and live.)* Its founding
thesis is one sentence:

> **A trap is a *price*, not a *wall*.**

Because the board is so generous, *forbidding* a match means nothing — just play
one of the other ~17 sets. So traps don't forbid; they make a *specific,
desirable* match **expensive**. Every turn becomes a real decision: "take the
juicy all-red set and eat the counter, or take the safe mixed set for less value?"

The **master tuning law** makes this concrete: *a good trap is one you
**sometimes** choose to spring* — roughly 30% of the time, as a calculated risk.
A trap you'd never trigger is a deleted option; a trap you spring ~30% of the
time is a decision engine. And because the punishment lands hardest on the build
that *most wants* the punished match, **a trap is a self-scaling tax on build
narrowness** — the specialist-vs-generalist tension falls out of one mechanic,
with no authored matchup tables.

### 8.1 Severity ∝ rarity

The governing proportionality: **frequent triggers nibble; rare triggers bite.**

| Trigger | Rough rarity | Consequence weight |
|---|---|---|
| **all-different on 1 axis** (rainbow / 1-2-3 / mixed-verb) | common (~69%) | *tiny* — a tick-tax, +1s, 1 damage |
| **all-same on 1 axis** (all-red, all-Attack) | rarer (~31%), dodgeable | *medium* — flat damage, a transmute, a drain |
| **double all-same** (Red Swords, Red Threes) | ~2–3% of sets | *large* — instant attack, wipe Tactics, lockout |
| **tick / dread DoT** | constant ambient | *small but ramping* — the anti-stall |

This also produces a **vice**: all-same traps push you *away* from commitment;
all-different traps push you *toward* it. A foe carrying one of each squeezes from
both sides, and partial/two-color builds thread the needle.

### 8.2 The four board verbs

Every board-state effect — player or enemy — is one of four verbs, all honoring
the spec→spec fairness rule (shift the distribution, never plant a specific card):

| Verb | Effect |
|---|---|
| **destroy** | card gone, leaves a hole, regenerates |
| **transmute** | card replaced with a biased one (value-selector *or* geometric) |
| **lock** | card stays and still forms sets, but is **unselectable** for N seconds |
| **+ conditions** | the triggers that gate *when* each verb fires |

**Lock** is the subtle one: it attacks the board's defining trait (generosity)
*surgically*, removing **access** without removing sets. "The solution is visible
but locked — read it, can't take it." A locked card is also inert (can't be
destroyed or transmuted while locked), which gives the player-side version
(themed as **Ice Block**) a free dual use: it *preserves* favorable board state
through an enemy's transmute window.

The **marquee enemy move is *coupling***: an enemy that punishes all-red should
also **transmute the board toward red** — flooding it with tempting red sets,
then punishing you for taking them. That's *baiting*, and it reads as devious,
coherent behavior emerging from two coupled rules with no AI. Crucially this is
**symmetric and fair**: the enemy uses the exact same spec→spec transform the
player does — it can't plant a specific card, and the saturation cap protects the
board from the *enemy* too (it can never make the board fully mono-red).

The pacing rule keeps the player in charge: **enemy reshape ≤ ~half the player's
clear rate.** A competent player changes ~0.6–0.9 cards/sec; total enemy
transmute (dungeon drift + all foe transmutes, one shared budget) stays ≤
~0.3–0.4 c/sec. Base dungeon drift is a per-dungeon tuning lever within that
budget — the shipped Ember Drift runs **1 card / 7s ≈ 0.14 c/sec** (see
`TUNING.md`) — a current to fight, not a flood to drown in. (Geometry is tier-gated, too: minions may
*strike* a column of 3, but only elites/bosses may *sweep* a row of 5.)

### 8.3 How traps reach the player — three scopes

| Scope | Trap count | Role |
|---|---|---|
| **Dungeon** | one global drift | ambient `on:tick` transmute toward the dungeon's theme — makes the whole dungeon *feel* like its element and **baits** the value its foes punish |
| **Trash foe** | 1 trap | a *price* per fight, rolled as a themed variant |
| **Elite / lieutenant** | 2 traps | a warm-up: one trap **mirrors** a boss trap (a telegraph) + one rolled |
| **Boss** | 3 traps | the full squeeze — ideally one each of specialist-punish / generalist-punish / tick-dread |

The trap ladder is **1 → 2 → 3**. A foe is assembled in layers like a piece of
gear: **base creature ⊕ rolled variant ⊕ dungeon template** (e.g. a *Bloodthirsty*
Goblin under an *Undead* dungeon template). The variant *is* the trap; the
template is a dungeon-global overlay. Three new invariants join the core five:
the **makeable-set floor**, **enemies honor spec→spec**, and **traps are legible**
(every active trap is shown before it fires — spotting *which* on-board set
satisfies it is the skill, so that part is *not* highlighted).

---

## 9. Layer: the crawl — `CRAWL-DESIGN.md` *(in build — Phase B1 shipped)*

*(Status update: no longer paper-only. Combat, Tactics v2, and Phase B1 — the
scene shell + town/run-map screens + persisted progression — are shipped in
`src/`; the run loop proper is the next build. See `CRAWL-DESIGN.md` header.)*

The furthest-out layer: a **data-driven dungeon crawler** on the combat engine.
The reskin is explicitly cosmetic — parchment and ink instead of neon — with no
mechanic change riding along.

- **Run loop:** Town → Dungeon → rooms (one enemy each) → loot roll → deeper, or
  a boss room → big loot → Town. Lose a fight and the run ends.
- **Self-bounding dungeons:** boss chance per room is cumulative and *triangular*
  — median boss around room 10, **guaranteed by room 14** — so there's a real
  gambler's choice: push deeper for loot or cash out before the boss. Elites
  spawn on a sawtooth (`10% × rooms since the last elite`, resetting on spawn),
  giving ~2–3 elites before the boss.
- **One declarative schema for everything.** Abilities, class passives, item
  affixes, and enemy traps all use the same `on / when / do` (event / condition /
  effect) YAML. **Foe = creature ⊕ variant ⊕ template** structurally mirrors
  **item = base type ⊕ rolled affixes** — opponents are built like gear.
- **Axis theming:** color → **mana** (the one universal spendable economy, valence
  themed: red aggressive / blue defensive / green utility), shape → immediate
  per-card verb (damage / block / tempo), number → magnitude multiplier.
- **Gear has *personality*, not just stats:** Weapon = direct payoff, Armor =
  reactive defense (`on:damage`), Relic = augments/alt-verbs, two Trinkets = flex
  economy. Rarity adds affix slots: common (0) → magic (1) → rare (2) → epic (3)
  → legendary (unique). Two effect classes only: always-on **math-mods** (bend
  deal odds or payoff) and **trigger-granting** affixes.
- **Progression:** XP → levels (+HP, periodic +ability slot); each **boss kill**
  lets you pick a new ability from your class's ~10; **spellbooks** are a
  cross-class vector (consume to learn, or sell). Curves (XP/HP/gold) are `[open]`.

---

## 10. Open threads (honest list of what's still in flux)

- ~~**Resource mapping for shape and number**~~ — *resolved: single mana economy
  off the color axis; shape/number pay out per-card verbs and magnitude, not
  separate currencies (`CRAWL-DESIGN.md` §4/§6).*
- ~~**Enemy timer model**~~ — *resolved: per-foe cadence via named speed bands
  (`TRAPS.md` §7.2; live numbers in `TUNING.md`).*
- ~~**Bias persistence**~~ — *resolved: once-only — `pendingRegenBias` steers a
  single refill, then clears (`src/engine/combat.ts`).*
- **Per-foe transmute *numbers*** — the framework is set (§8.2); the exact
  per-foe values want playtest. `[open]`
- **Loss condition** — permadeath vs. roguelite; loss penalty. `[open]`
- **Active enemy layer** — whether enemies ever get to *spend resources* and cast
  on their own clock (a duel-of-builds endgame). **Decided for now: no** — traps
  fire directly, gated by condition or cadence; feel the reactive system first.
  `[open]`
- **Curves** — XP / HP / gold economy. `[open]`
- ~~**Engine/tech** — prototype is dependency-free single-file vanilla JS; prior
  context favored **Godot** if it graduates to an engine.~~ *(Superseded — settled
  by `WRAPPERS.md`: ship as a web client + PWA, with Tauri/Capacitor documented as
  wrapper paths. Godot is rejected. The live game is the modular TS client in
  `src/`.)*

---

# Appendix A — the math, in full

Cards are points in **(ℤ/3)^f** — `f`-tuples of ternary digits, one per active
feature. Three cards form a **set** (a line in the affine geometry **AG(f,3)**)
iff **every coordinate sums to 0 mod 3** — equivalently, on each feature the
three are all-same or all-different.

**Completing third.** Any two cards have exactly one completing third:

```
third(a, b)_i = (−(a_i + b_i)) mod 3
```

(One formula covers both the all-same and all-different cases. This is the engine
behind set-counting, hints, and generation.)

**Density — probability a random triple is a set:**

```
P = 1 / (3^f − 2)          f=3 → 1/25      f=4 → 1/79
```

**Expected sets on a board of N cards:**

```
E[sets] = C(N, 3) / (3^f − 2)
```

For the locked game board: `f=3, N=15 → C(15,3)/25 = 455/25 ≈ 18 sets`.

**Set count by signature (k = number of all-different features):**

```
sets with exactly k different axes = C(f, k) · 3^(f−k) · 6^(k−1)
```

The resulting share of sets at each `k`, and the perceptual character:

| k (different axes) | f=3 share | f=4 share | Findability |
|---|---|---|---|
| 1 (mostly-same, "gimme") | 23% | 10% | jumps out (preattentive) |
| 2 | 46% | 30% | moderate |
| 3 | 31% | 40% | camouflaged |
| 4 (all-different) | — | 20% | invisible until serially verified |

Note that **f=3 cannot produce a fully-hidden set** (its max is k=3, and ≥23% of
its sets are always k=1 gimmes); **f=4 adds the cue-less k=4 tier**. That is the
second, independent reason f=4 is harder than f=3 — on top of the per-card load
of tracking a fourth feature.

**Commensurability of F and N (availability only):** one F-step is worth about
**×3.16 on density ≈ 4.4 cards of N**. They're comparable on *availability* — but
not on findability, which is why no amount of N closes an F gap.

**The saturation cap (why the game locks to f=3):** with no duplicates, the
number of distinct cards sharing one fixed feature value is `3^(f−1)`:

```
f=3 → 3^2 = 9 distinct "all-red" cards   (cap: a 15-card board can't exceed ~9 red)
f=4 → 3^3 = 27 distinct "all-red" cards   (no cap on N=15 → runaway)
```

This is the free governor that keeps color-flood abilities (and enemy transmutes)
from ever mono-coloring the board.

---

# Appendix B — the difficulty index & tier ladder

From `prototype/TIERS.md`. The **Difficulty Index (DI)** is a transparent,
per-board formula computed from what the generator *actually produced* (not from
the requested dials), then averaged over 300 simulated boards per config:

```
DI = 10·(easiestK − 1)        // CAMO: how hidden the BEST set is (dominant term)
   +  9·(F − 3)               // LOAD: per-card cognitive load + the k=4 tier
   +  8 / sqrt(routes)        // ROUTE: fewer easy outs = harder (saturating)
   +  4·max(0, N − 12) / 4    // SCAN: raw scan-load tax above the N=12 base
```

CAMO is the spine, LOAD a strong secondary, ROUTE the fine interpolator between
integer k-steps, SCAN a gentle high-N nudge. Only the *ordering and gaps* matter
— DI is in arbitrary laddering units, not a win-rate.

The named ladder, anchored at the **f=3 / n=12 Standard** tier (every tier is
~100% achievable — the generator actually delivers the listed easiest-k):

| # | Tier | F | N | Camo (easiest-k) | Routes | Timer | DI | Avg sets | Feel |
|---|------|---|---|---|---|---|---|---|------|
| 1 | Trivial / Warmup | 3 | 12 | k1 | 6 | 120s | 3.6 | 10.5 | Gimmes everywhere; you cannot lose |
| 2 | Easy / Stroll | 3 | 12 | k1 | 3 | 90s | 4.6 | 9.1 | A pop-out gimme always waiting |
| 3 | **Standard / BASE** | 3 | 12 | k2 | 3 | 60s | 14.5 | 6.9 | The anchor; comfortable density |
| 4 | Brisk / Pressed | 3 | 12 | k2 | 1 | 60s | 15.5 | 6.2 | One lone moderate set as the best out |
| 5 | Tricky / Texture | 3 | 8 | k2 | 1 | 45s | 18.0 | 1.7 | Small, tense "duel"; misses cost |
| 6 | Hard / Step Up | 4 | 12 | k2 | 3 | 60s | 23.7 | 4.1 | The F-step; the invisible k4 tier now exists |
| 7 | Severe / Camo | 4 | 12 | k3 | 2 | 45s | 34.7 | 2.6 | Best set deeply camouflaged, no cue |
| 8 | Brutal / Mastery | 4 | 14 | k3 | 1 | 30s | 39.0 | 1.9 | A lone camo set on a busy board, 30s clock |

(Optional boss/secret headroom: f4 / N12 / k4 / routes 1 measures **DI 46.8** —
the all-different "invisible" tier, left off the main ladder as pure
serial-verification grind.)

**Achievability — what the core can actually generate** (fraction of boards that
hit the requested easiest-k):

```
F3 depth=k2   N8:100%  N10:100%  N12:100%  N14: 80%  N16: 14%
F3 depth=k3   N8:100%  N10: 74%  N12:  2%  N14:  0%  N16:  0%
F4 depth=k4   N8:100%  N10:100%  N12:100%  N14: 80%  N16: 25%
```

Two big consequences: **at f=3/n=12 the camo knob tops out at k2** (deeper f=3
camo would be a lie — abundance forces incidental easy sets), and **f=3 camo only
exists at low N** (which is why the *Tricky* tier drops to N=8).

**The U-shape is real and flips sign with F.** Holding k2/routes-3 and sweeping N:
at **f=4** DI dips to a minimum at N=12 and rises both ways (scan-load binds —
bigger boards read harder); at **f=3** DI *falls off a cliff* at N=16 (the camo
target can't hold, the board gets *easier* despite more cards). Same knob,
opposite behavior — exactly why N is a texture knob, not a difficulty knob.

**Rule of thumb:** big step → change **F**. Medium step within an F band → change
**camo depth** (if achievable). Fine-tune → **escape routes** or **timer**. Change
**N** only to restyle feel, and re-check DI because its effect depends on F.

---

# Appendix C — architecture principles to preserve

These are the "don't break this in a refactor" rules, stated precisely:

1. **The generator is a pure function of a target spec** — `{F, N, active-axes,
   floor, camo-bias, value-weights}`. A player's loadout/abilities are a
   **spec→spec transform**, never a direct generator input. The fairness
   guarantee is *structural*; there is no rubber-band code path.
2. **Control aggregate statistics; randomize specifics.** Hold counts and
   distributions steady; randomize *which* cards participate. No positional tells.
3. **One source of truth.** Apply all biases at the deal/generation layer, never
   by mutating an abstract deck downstream.
4. **Assert invariants as property tests, not vibes.** (No duplicates; ≥ FLOOR
   sets; dropped axes pinned; empirical value frequencies match the target within
   tolerance; and — once lock exists — the makeable-set floor.)
5. **Setup bias vs. runtime bias.** Setup bias is locked at round start;
   abilities fire mid-round and must pass a *transient* bias into a single refill
   call, never mutate the global setup bias.

---

# Glossary

- **f / F** — number of active features (dimensions). The difficulty spine.
- **N** — board size (card count).
- **v** — values per feature. Always 3.
- **set / line** — three cards all-same-or-all-different on every feature.
- **k** — number of all-different features in a set; the findability index
  (k=1 gimme … k=F camo).
- **signature** — a set's per-feature same/different pattern; the future
  spell-descriptor language (2^F archetypes).
- **gimme / camo** — a low-k (easy, pops out) / high-k (hidden) set.
- **floor (FLOOR)** — the minimum number of sets guaranteed on a board.
- **makeable-set floor** — ≥ FLOOR sets completable from *unlocked* cards.
- **rejection** — generate-and-test board generation.
- **constructive patch** — refilling freed slots after a clear while holding the
  floor.
- **best-of-N** — sample many candidate boards, keep the one nearest a target.
- **camouflage depth** — the target easiest-k (coarse findability step).
- **escape routes** — how many sets sit at the easiest k (fine findability step).
- **encounter** — a value landscape: what scores, plus a soft deal bias.
- **DI** — Difficulty Index; the transparent per-board difficulty number.
- **spec-transform** — an ability/gear/enemy effect that edits the generator's
  target spec, never the generator itself.
- **transmute** — the single board-altering verb: destroy selected cards,
  regenerate with a bias.
- **destroy / lock** — remove a card (it regenerates) / make a card unselectable
  for N seconds while it still forms sets.
- **trigger** — an event→condition→effect rule, owned by a character, item, or
  enemy.
- **match descriptor** — the per-feature same/different + values of a cleared set;
  what trigger conditions read.
- **trap** — an enemy trigger that punishes a specific match; a *price*, not a
  wall.
- **governors** — saturation cap (f=3 only), natural decay, floor protection: the
  geometric facts that balance board abilities for free.
- **setup bias vs runtime bias** — locked-at-round-start deal bias vs. a transient
  bias applied to a single ability-driven refill.
- **Tactics** — the charge-based stance system Move matches feed (v2: a charge
  queue + Stand Ground / Maneuver — see `CRAWL-DESIGN.md` §5.5). Flee is a
  separate any-time button.

---

# Where to read more

| Topic | Source of truth |
|---|---|
| The Set core, generation, dial taxonomy, perception | `PROJECT.md` |
| The locked f=3 / N=15 / 5×3 board, trigger bus, transmute, economy | `GAME-DESIGN.md` |
| The threat layer: traps, the four verbs, foe composition, attachment | `TRAPS.md` |
| The dungeon crawler: run loop, YAML entities, gear, progression | `CRAWL-DESIGN.md` |
| The difficulty ladder, DI formula, achievability data | `prototype/TIERS.md` |
| Live engine constants (code is source of truth) | `TUNING.md` |
| Fast orientation for a coding session | `CLAUDE.md` |
| The archived prototypes (behavioral oracles, not the live game) | `prototype/set-proto.html`, `prototype/set-combat.html` |
