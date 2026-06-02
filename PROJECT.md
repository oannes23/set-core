# SET.core — Project Seed & Design Context

> A skill-component minigame built on the card game **Set**, intended as the
> reusable "action resolution" layer of a larger web-based RPG. This document
> captures the full design reasoning to date so a fresh session can continue
> without re-deriving it. The working prototype is in `prototype/set-proto.html`.

---

## 1. The core concept

When the player's character does something in the eventual RPG, resolution is a
short, time-boxed round of a **Set**-derived matching game. Each set found is
worth points; total points over the round determine how well the action
resolves. The current prototype is the *abstract skill core only* — classic Set
mechanics + the custom generation logic + scoring + a full dial console for
tuning feel. RPG layers (encounters as content, abilities, equipment) are
designed-for but mostly not yet built.

**Design north star:** bias heavily toward player *skill* and *generosity of
generation*. The board should never be the bottleneck — the player's eyes and
speed should be. Luck (drought variance) is the enemy of a skill signal and is
engineered out.

---

## 2. The mathematical spine (this is load-bearing — internalize it)

Set is not "a card game with four attributes." It is the finite affine geometry
**AG(f, 3)**. Cards are points in **(ℤ/3)^f**; a "set" is a line. Three cards
form a set iff, on **every** feature, the values are all-same or all-different —
equivalently, **every coordinate sums to 0 mod 3**.

Consequences we rely on everywhere:

- **Uniqueness:** any two cards have *exactly one* completing third card.
  `third(a,b)_i = (-(a_i + b_i)) mod 3` returns it (handles both all-same and
  all-different in one formula). This is the engine behind set-counting, hint,
  and generation.
- **Density (exact):** probability a random triple is a set = `1 / (3^f − 2)`.
- **Expected sets on a board of N cards:** `E[sets] = C(N,3) / (3^f − 2)`.
- **Keep values-per-feature = 3.** The "two cards determine the third" magic is
  special to v=3. v=4 needs 4-card sets, breaks uniqueness, explodes the deck.
  **Vary f for difficulty; never touch v.**

### Set count by signature (k = number of all-different axes)
Count of sets with exactly k "different" axes: `C(f,k) · 3^(f−k) · 6^(k−1)`.

| k (diff axes) | f=3 share | f=4 share | Findability |
|---|---|---|---|
| 1 (mostly-same, "gimme") | 23% | 10% | jumps out (Gestalt grouping) |
| 2 | 46% | 30% | moderate |
| 3 | 31% | 40% | camouflaged |
| 4 (all-different) | — | 20% | invisible until serially verified |

**k is the purest findability axis.** A low-k set shares a salient feature →
pops out preattentively. A high-k / all-different set has *no* shared cue → must
be found by serial verification → "how did I not see that." f=3 *cannot* produce
a fully-camouflaged set (max k=3, and 23% are gimmes); f=4 adds an entire k=4
tier with zero grouping cues. **This is a second, independent reason f=4 ≫ f=3
in difficulty, on top of per-card cognitive load.**

---

## 3. Generation model (the "cheat" — chosen deliberately)

**There is no finite deck.** Cards are *generated against board state*. This
converts a sampling problem (draw and pray) into a construction problem (build a
multiset satisfying constraints we specify). We give up the closed-form
guarantees but gain direct authorial control.

Two strategies, used for different moments (this split is settled):

| Moment | Strategy | Why |
|---|---|---|
| Initial board | **Rejection** toward a floor below the natural mean | First-try at our densities; trivial code |
| Replenish after a clear | **Constructive patch** of just the 3 freed slots | Surgical; preserves the live board mid-scan |
| Signature/value shaping | **Best-of-N selection** (sample many, keep best) | Rejection toward a *specific* mix is exponentially expensive |

**Invariants the generator must always hold (assert these in tests):**
- No duplicate cards on the board.
- At least FLOOR sets present at all times (currently FLOOR=1 so density can vary
  faithfully across the dial range; never a dead board).
- Inactive (dropped) axes stay pinned to a constant → trivially all-same →
  cannot affect set validity.
- Empirical value frequencies match the encounter-bias target within tolerance.

**Validation done:** the core has been simulated for 100k+ clears per config
across the entire reachable dial space (all F×N, all drop-axes, all bias×
encounter combos) — **zero floor violations, zero duplicates, zero pin errors**.
The generation logic is trustworthy; UI is where bugs have appeared.

---

## 4. The dial taxonomy (the heart of the tuning model)

The key realization: the dials are **not peers on one difficulty scale.** They
live on three independent axes. F feels like the master dial *because it is the
only control that moves two axes at once.*

| Dial | Controls | Monotonic? | Proposed narrative home |
|---|---|---|---|
| **F** (3↔4, extensible 2–5) | findability **and** availability (the spine) | yes, strongly | **Encounter difficulty / tier** |
| **N** (board size) | availability only; **U-shaped**, not monotonic | **no** | **Encounter texture/personality** |
| **Timer** (30/60/90/120) | pressure only | yes, clean | **Character skill / composure** |
| **drop-axis** (at f=3) | findability only; ~zero density effect | qualitative | **A mastery reward** ("trained eye ignores noise") |
| **Camouflage depth** (target easiest-k, 1↔F) | findability — how hidden the *best* set is | yes | encounter subtlety / perceptual skill |
| **Escape routes** (count of sets at easiest-k) | findability — how *many* easy outs exist | yes | fills the continuum between integer k-steps |
| **Floor K** | low-tail availability (drought) | weak | minor consistency knob |
| **Encounter value-weights** | *what scores*, + soft deal bias | n/a | **encounter identity** (see §6) |

### Critical insights (each confirmed by playtest or sim)
- **One F-step ≈ ×3.16 on density ≈ 4.4 cards of N.** F and N are commensurable
  on *availability* only.
- **Availability and findability are decoupled.** Generation buys generosity for
  free, so F no longer has to gate density — F is now free to be the *findability/
  load* dial at whatever density you choose.
- **N is a bottleneck-location dial, not a difficulty dial.** N↑ gives more sets
  (easier to find one) *and* more cards/pairs to scan (harder). In the generous
  regime these cancel → N feels "mushy" as difficulty. Net difficulty-vs-N is a
  **U**: low N = availability-bound; high N = scan-load-bound; middle = comfortable.
  This makes N a *wonderful texture knob* (tense duel ↔ frantic melee at the same
  difficulty) and a poor difficulty knob.
- **No amount of N closes an F gap** (playtest: f=3/N=9 still trounces f=4/N=16),
  because they don't pull on the same rope. N only reads as difficulty when F is
  high enough that scan-load is the binding constraint.
- **Difficulty and skill are not two dials — they are opposite-sign pressures on
  the same shared knob-set.** Encounter pushes config toward hard; character
  competence pushes it back toward easy; you play the net. (This is the
  spec-transform architecture: encounter hands generator a hard spec, loadout
  transforms it easier, generator resolves.) The marquee skill expression:
  **high skill drops the encounter's effective F by one** — big, readable spike
  precisely *because* F is the dominant lever.

### Perceptual ranking of the four features (why shading was dropped first)
Saliency hierarchy (well-established vision science): **color > shape > texture**,
and number (1–3) is **subitized** (near-instant, automatic). So:

| Feature | Basis | Cost to track |
|---|---|---|
| Color | most salient preattentive dim | lowest |
| Number | subitizing range | low |
| Shape | more salient than texture, but little preattentive *whole-shape* rep | medium |
| **Shading** | texture — bottom of hierarchy | **highest** |

Plus an **asymmetric interference** result: random variation in color/shape
disrupts texture identification, but texture variation does *not* disrupt
color/shape. On a busy board, the very busyness suppresses shading reads while
shading costs the others nothing → shading is penalized twice and silently falls
out of working memory under time pressure. The official game's own beginner ramp
removes shading first (start with the 27 solid cards). **Dropping shading also
preserves the three most thematically useful axes** (color→element,
shape→form, number→magnitude) for the future RPG layer.

---

## 5. Current prototype state (`prototype/set-proto.html`)

Single self-contained HTML file (no build step, no external deps beyond Google
Fonts; all CSS/JS inline). Open it in a browser.

**Implemented:**
- Set over (ℤ/3)^4, cards rendered as SVG (color × shape × shading × number).
- Mode F=3 (default, shading dropped, all-solid) and F=4 (classic).
- Cards stay 4-tuples internally; dropped axis pinned to value 0 → set math
  untouched and provably correct regardless of mode.
- Rejection seed + constructive patch with best-of-N bias selection.
- 60s loop → now defaults to **30s** (felt best as a quick minigame).
- Dial console (controls panel), all locked during a live round:
  - **Features** 3/4
  - **Drop axis** (f=3 only): color/shape/shading/number held constant
  - **Board size** slider N=8–16, grid auto-adjusts columns
  - **Quick compare** presets: `f=3·n=10` vs `f=4·n=15`
  - **Camouflage depth** + **Escape routes**: two findability sliders. Depth =
    target easiest-k (1↔F); Routes = how many sets sit at that easiest k. Best-of-N
    selects the board *nearest* the (depth × routes) target — depth dominates,
    routes is the fine-tune that fills the continuum between integer k-steps.
    (Replaced the old 3-state Gimmes/Mixed/Camo sign-bias.) Both sliders are
    **achievability-aware** — Monte-Carlo probed against the current F,N so they
    can't request a board the generator can't deliver: depth caps at the deepest
    reachable easiest-k (k2 at the f3/n12 base), and routes is bounded *both* ways
    — a ceiling (≈avg sets) and a depth-dependent **floor** (you can't get a sparse
    high-depth board on a busy one; e.g. f3/n12/k2 floors at ~3 outs). Each cap
    shows a note saying why + how to unlock it.
  - **Encounter**: Balanced / Power / Endurance / Speed (value scoring + deal bias)
  - **Round length** 30/60/90/120
- **Board analysis strip** (always visible): live set count, **easiest-k** gauge
  (the honest difficulty number), per-k histogram (k1 gimme → kF camo), and a
  **target vs realized** readout (glows when the board hit the requested depth).
- **Board-odds panel**: avg sets/board + P(easiest set = k) for the current f·n —
  the raw deal odds before the camouflage knobs bend it.
- **Hint** button (highlights a real set; proves availability, teaches the pattern).
- Scoring HUD with floating +N feedback; match log with per-set signature, points,
  and split time; end-of-round report with per-axis same/diff breakdown.

**Known behavioral notes / corner cases:**
- **Camouflage depth saturates at high N** (abundance forces incidental easy sets),
  quantified by `prototype/sim-invariants.mjs`. At **f=3**: depth=k3 (full camo) is
  reachable at N=8 (100%) and N=10 (~77%) but collapses by N=12 (~2%) and is
  unreachable at N≥14. So **at the f=3 / n=12 tuning base, the depth knob effectively
  tops out at k2** — real f=3 camo lives at low N. At f=4 the depth range stays wide
  up to ~N=14 (k4 only saturates at N=16). The "easiest k" gauge shows the *realized*
  depth, so the slider never lies about what it actually delivered.
- If color axis is dropped (f=3, drop=color) AND a non-Balanced encounter is
  chosen, all cards are one color → scoring goes flat. UI warns; encounter
  scoring assumes color is active.

---

## 6. Encounter value-scoring (the most recent direction — partially built)

The move from "encounter = harder" to "encounter = a *value landscape* that
changes what's worth hunting." Repeated rounds feel different instead of just
harder.

**Current toy mapping (placeholder, deliberately simplistic):** color values →
stats. Red=Power, Green=Endurance, Blue=Speed. An encounter weights the stats:

- **Scoring:** a found set scores its color's weight. All-one-color set → that
  stat's full weight (e.g. all-red = 3 in a Power encounter). All-different-color
  set → the average (~2). So the player is incentivized to *seek the valued color*.
- **Board shaping:** a soft deal-bias (50% uniform + 50% weighted) toward the
  valued color, so high-value sets actually exist on the board. Sim confirms:
  Power roughly doubles available all-red sets; Speed starves them. The incentive
  is real on both ends — more valued sets present, and they pay more.

**The intended tension (the good part):** the *easiest* set to grab is often
low-value; a high-value (e.g. red) set may be sitting in plain sight worth 3×.
That's a speed-vs-value decision injected into every glance — what turns "find
sets fast" into "read the board's value landscape." Stack Power + Camo + low N
to make valuable sets *also* the camouflaged ones → a genuine perception test.

**Not yet built / open:** value mapping is only on the color axis and is a
placeholder. The richer version maps *signatures* (same/diff patterns across
axes) to effects, which couples findability-difficulty with spell-semantics
(harder encounters surface more chaotic/diverse "magic") — a coupling we may
*want*. See §8.

---

## 7. Architecture principles to preserve

- **Generator is a pure function of a target spec** `{F, N, active-axes, floor,
  camo-bias, value-weights}`. Player loadout/abilities should be a **spec→spec
  transform**, never a direct generator input. This makes the fairness guarantee
  *structural*: there is no code path for designer rubber-banding, because
  difficulty adjustment is a loadout-only input. Authored outcomes can only ever
  be ones the player *built toward*. (This was an explicit design requirement:
  the only outcome-authoring allowed is player-chosen.)
- **Control aggregate statistics, randomize specifics.** Hold counts/distributions
  steady but randomize *which* cards participate and where, so players can't learn
  a positional tell ("always look top-left").
- **One source of truth.** Apply biases at the deal/generation layer, not by
  mutating an abstract deck.
- **Assert invariants as property tests**, not vibes (see §3).

---

## 8. Roadmap / open threads (not yet built)

- **Timer-as-skill dial** explicitly modeled as character competence (opposite
  pressure to encounter F). A two-slider "encounter spec (F,N) ← character skill
  (time, −F)" panel was proposed to make the opposite-pressure model tangible.
- **Signature→effect language:** the same/diff pattern of a found set is an
  f-bit descriptor (16 archetypes at f=4). "All-same Fire" → focused nuke;
  "all-different element" → utility. Rarity self-tunes: mostly-same (low-k) sets
  are rarest to stumble onto, so assign powerful effects there and drop-rates
  fall out of the combinatorics.
- **Specialist vs generalist abilities:** Concentration (bias one value up →
  more all-same of it, fewer all-different) vs Diversity (flatten → more
  all-different, raises overall availability). Opposing build archetypes that
  fall out of the math.
- **Progression:** leveling could *add an axis* (raise F) — harder, but unlocks
  more of the 2^f signature/spell space.
- **Game engine:** prototype is vanilla HTML/JS. (Prior project context favored
  Godot for text-based/CLI-buildable games with HTML5/WASM export; worth
  considering if this grows beyond a web toy.)

---

## 9. Glossary

- **f / F** — number of *active* features (dimensions of the affine space).
- **N** — board size (cards shown).
- **set / line** — three cards all-same-or-all-different on every active axis.
- **k** — number of axes that are *all-different* in a given set; the findability
  index. k=1 "gimme" (pops out) … k=F "camo" (invisible until verified).
- **signature** — the per-axis same/different pattern of a set; the future
  spell-descriptor (2^F archetypes).
- **gimme / camo** — low-k (easy to spot) / high-k (camouflaged) sets.
- **floor (FLOOR)** — minimum sets guaranteed present on the board.
- **rejection** — generate-and-test board generation (initial board).
- **constructive patch** — refill only freed slots after a clear, holding the floor.
- **best-of-N** — sample many candidate boards/patches, keep the one nearest the
  findability target (camouflage depth × escape routes).
- **camouflage depth** — target easiest-k of the board; the coarse findability step.
- **escape routes** — count of sets at the easiest k; the fine findability step that
  interpolates between integer depths (a lone k=2 plays harder than five k=2 sets).
- **encounter** — a value landscape: what scores + a soft deal bias.
- **spec-transform** — abilities modify the generator's target spec, never the
  generator itself (structural fairness guarantee).

---

## 10. Asset manifest (in this bundle)

- `prototype/set-proto.html` — the current working prototype (open in browser).
- `prototype/sim-invariants.mjs` — headless invariant sim (mirrors the generation
  core; asserts no-dupes/floor/pin across the dial space + depth achievability).
  **Run before shipping any generation change:** `node prototype/sim-invariants.mjs`.
- `prototype/sim-tiers.mjs` — difficulty-space sweep; measures realized signals and
  a documented difficulty index (DI) per config. `node prototype/sim-tiers.mjs`.
- `prototype/TIERS.md` — the data-backed 8-tier difficulty ladder anchored at the
  f=3/n=12 base, with the DI formula, achievability table, and per-lever tuning guide.
- `images/f3-board-n12-highlighted.png` — f=3 all-solid board, N=12, one set
  highlighted. The clean/fast feel.
- `images/f4-board-n15-highlighted.png` — f=4 classic board, N=15, one set
  highlighted. The higher-load feel.
- `images/shading-solid-striped-open.png` — the three shadings side by side
  (why texture is hardest to track; and the legibility fix that made striped
  clearly distinct from solid).
- `images/feature-contact-sheet.png` — diagnostic render of individual cards
  across color/shape/shading/number, used to verify rendering matches data.
