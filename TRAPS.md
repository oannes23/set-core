# TRAPS.md — enemy triggers & board-state effects

> The reactive **threat layer**: how enemies turn the generous board into a
> reading game. Builds on `GAME-DESIGN.md` §3 (the trigger bus — event→condition→
> effect, three owners) and `CRAWL-DESIGN.md` §4 (the YAML trigger schema). This
> doc owns the **trap vocabulary**, the **board-state effects** enemies (and
> abilities) can apply, and the laws that keep them fair and fun.
> **Status: built in `src/engine`.** The full reactive bus — enemy traps/tricks,
> the four board verbs (destroy / transmute / lock / conditions), named geometry
> selectors, compound conditions, and dungeon drift — is live (`triggers.ts`,
> `foe.ts`, `game-data.ts`). This doc remains the design source of truth for the
> vocabulary and fairness laws; per-foe consequence *numbers* are still tuned in play.

---

## 0. Thesis — a trap is a *price*, not a *wall*

The board is deliberately generous (f=3 / N=15 → ~18 sets present at all times,
`GAME-DESIGN.md` §1). That generosity **breaks walls**: a trap that merely
*forbids* a match costs the player nothing — they play one of the other 17 sets.
A forbidden match on a generous board is a rounding error.

The version that works makes the dangerous match **expensive, not impossible** —
and the dangerous match is also the player's *most valuable* one (it's the match
their build is built to make). Every turn becomes a real weighing:

> **"Take the juicy all-red set and eat the counter, or take the safe mixed set
> for less value?"**

That high-value-but-dangerous vs safe-but-weak tension *is* the core skill from
`GAME-DESIGN.md` §0 — reading the value landscape against the enemy's traps. The
single most important tuning target follows from it:

> ⭐ **A good trap is one you *sometimes* choose to spring.** A trap you'd never
> trigger is just a deleted option. A trap you spring ~30% of the time, as a
> calculated risk, is a decision engine. Tune punishment to sit on that line.

**Why this makes the generous board a feature, not a bug.** The punishment lands
hardest on the build that *most wants* the punished match. A generalist (plays
mixed sets anyway) shrugs off a Fire-Breathing foe; a committed all-red build
**can't dodge without unplugging its own engine.** So a trap is a *self-scaling
tax on build narrowness* — the more you've specialized, the more your counter-foe
hurts. The specialist↔generalist tension (`PROJECT.md` §8) falls out of one
mechanic, with no authored matchup tables. We never need to nerf board density;
we need counter-foes.

---

## 1. The master law — **severity ∝ rarity**

In Set, every axis of a match is *either* all-same *or* all-different — and they
are not equally likely. On an f=3 board a given axis lands roughly **all-same
~31% / all-different ~69%** (≈ 2:1). That asymmetry sets every dial for free:

| Trigger | Rough rarity | Consequence weight |
|---|---|---|
| **all-different, 1 axis** (rainbow / 1-2-3 / mixed-verb) | common — fires a lot | *tiny* — tick-tax, +1s, 1 dmg |
| **all-same, 1 axis** (all-red, all-Three, all-Attack) | rare, dodgeable | *medium* — flat dmg, a transmute, a drain |
| **double all-same value** (Red Swords, Red Threes…) | ~2–3% of sets | *large* — instant attack, wipe Tactics, lockout |
| **tick / dread DoT** | constant ambient | *small but ramping* — the anti-stall |

> **Frequent triggers nibble; rare triggers bite.** This single proportionality
> keeps every trap a "price sometimes worth paying" rather than a non-event or a
> feel-bad. It is also *why* double-matches earn bigger consequences: they are
> ~10× rarer than a single all-same, so they may hit ~10× harder.

---

## 2. The condition space (the "when")

### 2.1 Single-axis, all-same — the specialist's bane (dodgeable)
The strategic, rare, *spottable* core. Default trap-condition mode.

- **color:** all-Red / all-Green / all-Blue
- **magnitude:** all-One / all-Two / all-Three
- **action:** all-Attack / all-Defend / all-Move

### 2.2 Single-axis, all-different — the generalist's bane (and the vice)
all-different is *more common*, so an all-diff trap is *harder to dodge* — which
is exactly right, because it punishes the player who **refuses to commit**. The
two condition families form a vice:

- **all-same traps push you AWAY from commitment** ("don't make the all-red set")
- **all-diff traps push you TOWARD commitment** ("don't make the rainbow set")

A foe carrying one of each squeezes from both sides; a partial / two-color build
threads between them. This is the specialist↔generalist axis rendered as live
pressure. Thematic hooks:

| Condition | Trap | Effect flavor |
|---|---|---|
| diverse **color** | *Chromatic Leech* | rainbow match → enemy heals (feeds on variety) |
| diverse **magnitude** | *Discord* | 1-2-3 match → enemy speeds up (uneven footing) |
| diverse **action** | *Counterstance* | Attack+Defend+Move match → enemy braces, +block |

### 2.3 Double-value conjunctions — signature / boss tier
Two axes pinned to **specific values**: *Red Swords* (all-red + all-Attack),
*Three Swords* (all-Three + all-Attack), *Red Threes* (all-red + all-Three). At
~2–3% of sets these are a genuine **hunt** — you rarely make one by accident, so
the consequence can be brutal and still feel earned. The dragon's signature line.

### 2.4 Tick / dread — the anti-stall
`on: tick`, fires every N seconds regardless of matches. *e.g.* "every 5s,
transmute the highest-magnitude Defend → Red." Structural role beyond flavor:

> The board's generosity + Move/Defend/Tactics lets a player **stall the attack
> clock indefinitely.** A ramping DoT means *delay rots your board* — a second
> clock you cannot pause. **Dread is the antidote to infinite stalling.** Ramping
> intensity (worse each tick; optionally persisting across rooms in the crawl) is
> what makes it *dread* rather than background damage.

### 2.5 Legibility rule — show the rule, hunt the instance
This is a reading game; you cannot read a hidden rule.

- **Traps are visible up front** — the enemy wears them as labeled tags by its HP
  ("🔥 Fire Breathing — all-red → immediate strike"). A hidden trap is a gotcha.
- **But do NOT highlight which on-board sets satisfy it.** Spotting that an
  all-red set exists *is* the skill. Rule legible, instance earned. (Fully
  highlighting the dangerous sets is hand-holding; the sweet spot is between.)

---

## 3. The consequence space (the "what")

Organized by **which player system it attacks** — the best traps aim at the
system the *punished build most relies on*.

| Targets… | Consequences | Hits which build |
|---|---|---|
| **HP** | chance-of-damage → flat damage → instant attack (clock to now) | anyone (severity ladder) |
| **The clock** | speed up / grant the enemy a free swing | stall & tempo builds |
| **Block** | shatter / reduce stored Block | turtles (Sentinel) |
| **Tactics meter** | drain / wipe it | Move/Tactics builds (Warlord, Rogue) |
| **Mana** | burn a color pool | casters (Pyro / Cryo) |
| **The board** | transmute toward enemy value / away from yours; lock cards | engine / combo builds |
| **Your verbs** | lock out one ability or one Tactic (short, specific) | anyone leaning on one button |

> **Lockout guardrail.** Verb-lockouts (freeze an ability, disable a Tactic) are
> the spiciest consequences and the easiest to make *feel* unfair, because they
> remove agency. Keep them **short and specific** (one ability for ~5s, one Tactic
> button — never "you can't act"). Combined with §2.5 legibility, eating a lockout
> is then a *choice the player made*, not a surprise stun.

---

## 4. The counter-foe recipe + coverage

> **Recipe:** *condition = the match the target build wants to make;
> consequence = damage the resource that build runs on.* The trap doesn't just
> tax — it hits where the build lives.

Every archetype gets a named nemesis, all from one bus:

| Target build | Trap | Condition → consequence |
|---|---|---|
| **Pyromancer** (all-red engine) | *Mana Sear* | all-Red → burn 3 red mana + 4 dmg |
| **Berserker** (all-Attack) | *Spiked Hide* | all-Attack → reflect 5 + enemy +Block |
| **Sentinel** (turtle / Defend) | *Corrosion* | tick: every 5s, highest Defend → Red |
| **Warlord / Rogue** (Move / Tactics) | *Vigilance* | all-Move → drain 4 Tactics |
| **Druid** (heal / green attrition) | *Plague* | all-Green → lock out Heal 6s |
| **Generalist** (rainbow) | *Chromatic Leech* | diverse-color → enemy heals 3 |

**Coverage requirement:** for every strong build-line (each color, shape, maybe
magnitude) there must *exist* a counter-trap. A build keyed on a value nothing can
punish is degenerate by construction. The trap-condition space (3 colors × 3
shapes × magnitude) should roughly mirror the build-condition space. **Traps are
the enemy's "build"** — same `all_same` language the player's passives speak.

---

## 5. Board-state effects — the four verbs

A trap's consequence may change the board itself. There are exactly four board
verbs; all honor the `PROJECT.md` §7 spec→spec fairness guarantee (shift a
*distribution*, never plant a specific card in a specific slot):

| Verb | Effect | Card's value |
|---|---|---|
| **destroy** | card gone, hole left, regenerates (prototyped as damage) | erased |
| **transmute** | card replaced with a biased one | changed |
| **lock** | card stays & still forms sets, but unselectable for N seconds | intact, access denied |
| *(conditions)* | the trap-triggers that gate when each fires | — |

### 5.1 Enemy-as-transmuter — the enemy that builds its own trap
Transmute (and lock) are board-verb **consequences**, so they work on *either*
trigger mode — and the two modes feel different:
- **Timed (`on:tick`)** — the slow ambient tide. This is the dungeon-global **drift**
  (§7): a constant nudge toward the theme value that textures every room.
- **Triggered (`on:match`)** — **reactive herding.** A foe trap that transmutes *in
  response to the match you just made* — "you made the all-red match? your blue escape
  cards warp toward red" — springing the §5.3 squeeze the moment you commit. Reactive
  transmute can be bigger than the tick drift (it's gated on a rare condition →
  severity∝rarity, §1), and feeds a tight loop: making the theme match makes the board
  *more* theme-y → more temptation. The saturation cap (≤9 distinct reds) bounds the
  spiral.

The marquee move is a **coupling**, not a single rule:

> **An enemy that punishes all-red should also transmute the board *toward* red.**

It floods the board with red → red sets become abundant and high-value → then it
punishes you for making them. **It is baiting you** — manufacturing the exact
temptation it waits to counter. Your skill becomes: resist the bait, race to clear
the red sets before the trap matters, or push the composition back with your own
Heat-Up / Call-Frost. Devious, coherent behavior emergent from *two coupled
lines*, no AI. (Inverse flavor: transmute *away* from your escape color =
*starvation* rather than *bait*. Bait is the better headliner — your own greed
springs it.)

**Fairness — symmetric by construction.** Enemy transmute is the same spec→spec
transform the player uses (free slots, regen with bias, honoring distinctness +
FLOOR + no positional planting). The enemy **cannot plant a specific card in a
specific slot** — there is no code path for it to cheat, so the enemy playing the
board is *not* rubber-banding. The **saturation cap protects the board from the
enemy too**: at f=3 there are only 9 distinct reds, so even a maximally-flooding
foe can't make the board mono-red — geometry keeps it varied and playable. The
§4 governor that keeps *your* floods honest keeps *its* floods honest.

> **Pacing principle — bias the drift, don't own the board.** If the enemy
> out-transmutes the player (churns faster than they clear), agency drains away.
> Keep enemy transmute small and steady (1–3 cards, tick- or trap-gated) so it
> *tilts* the composition — a current to fight, not a flood that drowns. Whose
> verb dominates the board's composition is the real balance knob; the player
> should usually be winning it.

### 5.2 Lock — subtract *availability* without touching *composition*
Lock is the only verb that attacks the board's defining trait — its generosity —
surgically. It removes *access* to specific sets without removing the sets. The
killer texture:

> **The solution is visible but locked.** You can see the all-blue set that would
> save you; two of its cards are locked for four more seconds. *Read it, can't
> take it.* "Information remains, agency removed" — something destroy and
> transmute cannot produce (they take the information away too).

**Rulings:**
- **A locked card still forms sets** — it stays in `findSets`, still completes
  lines, still counts toward the floor. You simply cannot *select* it. (This is
  also the lazy implementation: a `locked` set guarding selection only, leaving
  `findSets` untouched — the better design is the path of least resistance. The
  alternative, dropping locked cards from set-finding, just makes lock into
  "destroy with a prettier sprite" — rejected.)
- **A locked card is inert** — cannot be selected, transmuted, *or* destroyed
  until it unlocks. This gives emergent dual-use for free: enemy-lock *denies* you
  a card, but a locked card also *survives a flood* — so a player-side lock is
  automatically a "bank this card against the enemy's transmute" tool, no
  special-casing. **Worked player ability — Ice Block** (WoW-style stasis): a big
  defensive cooldown that grants a heavy defense buff + clears wounds + self-heal +
  **locks a large chunk of the board** for a few seconds. You trade tempo (can't act
  during the lock) for survival — and, via the inert ruling, the lock **preserves your
  favorable board state** through an enemy drift/transmute window. Defensive panic
  *and* board preservation from one verb.
- **Implementation note:** a `locked` set parallel to the existing `pending` set
  (destroyed cards reforming). "Locked card" (per-card play state) is distinct
  from "locked board" (the fixed f=3/N=15 parameters) and `state.lock` (input
  freeze during animation). Fallback name if more distinction is ever wanted:
  *seal / sealed*. (We avoid "freeze" — it collides with blue/Frost theming.)

### 5.3 The second squeeze — board-state vice
§2 gave a **condition vice** (all-same vs all-diff). transmute + lock give a
parallel **board-state vice**:

> Enemy punishes all-red → **transmutes toward red** (the abundant high-value sets
> are now the dangerous ones) → **locks your blue cards** (your safe outs are out
> of reach) → your only *available, high-value* plays are the ones it counters.

That's **herding**: transmute makes the bad sets tempting, lock removes the good
sets from reach, the trap punishes what's left. Three rules, one coordinated
squeeze on the board — parallel to the squeeze on the match-conditions. A foe that
does both is reading *you* the way you're meant to read *it*.

### 5.4 Transmute geometry — the spatial selector
Transmute's *selector* (which slots to reshape) can be **value-based** (all non-red,
every Attack) *or* **geometric** (a region of the grid). Geometry is an option on the
same verb, usable by any owner — enemy trap, dungeon drift, or player ability (Fireball
already uses a blast footprint). The real-game board is a **locked 5×3 grid** (N=15, 5
cols × 3 rows; chosen over 4×4 specifically for this geometry — see `GAME-DESIGN.md`
§1), slots positionally stable across reforms, so patterns are well-defined.

**Pattern vocabulary** (open, growing):
- **row** (5) / **column** (3) · **diagonal** (short on a 3-tall grid, still valid)
- **corners** (4) · **border** (perimeter ring, 12 on 5×3) · **inner / center** (the 3
  interior cells, or the 1 true center)
- **blast / fireball** (center + neighbor footprint — the existing `offsetSlots`) ·
  **cross / plus** · **X** · **checkerboard** · **half** (top / bottom / left / right)
- **random N** — scatter

**The row≠column asymmetry is the point** (and why 5×3, not 4×4). A horizontal **row
hits 5**, a vertical **column hits 3**, so the two most-used patterns carry different
weight *and* different feel for free — pattern magnitude doubles as pattern theme:
- **horizontal = the SWEEP** — wall-collapse, earthquake, a line of soldiers, a tidal
  wave. Wide, heavy, 5 cards. The big board event.
- **vertical = the STRIKE** — spear, lightning bolt, ray, pierce, stab. Narrow, sharp,
  3 cards. The surgical hit.
Author traps to this grammar (a Brute *sweeps* rows; a Sniper/Bolt foe *strikes*
columns), and the grid's mechanical weight matches the thematic weight automatically.

**A new SPATIAL reading axis.** Because cards can't be moved, position matters as
**timing, not repositioning**: a telegraphed "the center column warps red in 3s" means
*use those cards now or lose them* — you race the region, you can't rearrange it.
Legibility is mandatory — the pattern's slots must be highlighted before it fires (the
prototype's sure / maybe target rings already do this for Fireball).

**Fairness — geometry is still spec→spec.** The pattern selects which *slots* to
reshape (spatial); the refill still draws from a biased *distribution* with distinctness
+ floor — it **randomizes set-membership**, never planting a specific card in a specific
slot. So geometry gives no positional tell about *where the sets are*; it tells you a
*region's value-distribution* is shifting. Invariant 5 (`CLAUDE.md`) holds — the enemy
reshapes terrain, it does not plant a winning/losing configuration.

**Damage + transmute stack for free.** A trap's `do:` list can carry *both* a damage
consequence and a geometric transmute — "all-red → 4 dmg AND warp the center column
red." No new machinery (multiple effects already compose in `do:`); the richness is the
combination — punish HP *and* reshape the board in one trigger, often with the transmute
feeding the next punish (herding, §5.3).

### 5.5 Tuning enemy transmute — tilt, don't own
**Safety is free; tune for feel.** The saturation cap (≤9 of any value at f=3/N=15) +
floor + makeable-set floor (§6) mean even a maxed, relentless drift *cannot* break the
board — worst case it makes the theme value abundant (~60% one color = the bait,
intended). So we never tune to prevent a dead/degenerate board (impossible); we tune a
**feel band**:
- *too slow* (≤1 card / 10s) → invisible, decorative, ignored
- *right* (~1 card / 5s base) → you notice the lean, feel the bait, can fight or surf it
- *too fast* (chunks every couple sec) → the board stops feeling yours ("owning")

**Governing law — enemy reshape ≤ ~half the player's clear rate.** A competent player
clears ~3 cards / ~4s ≈ **0.6–0.9 c/s** of player-directed churn. Keep **total enemy
transmute (dungeon drift + every active foe transmute) ≤ ~0.3–0.4 c/s** so the player
owns net composition. Base drift 1/5s = 0.2 c/s (~25%) — comfortably tilting.

**Dungeon drift + foe transmute is ONE shared budget.** Spend it on the dungeon *or*
the foes, not both maxed: a fast-drift "raging" dungeon staffs foes that punish via
damage/other; a slow-drift "calm" dungeon leaves room for dedicated transmuter-foes.
Never run a fast drift *and* a transmute-heavy boss.

**Prefer triggered; reserve timed for the dungeon.** Timed transmutes (drift, dread)
are *designer-paced* and the only kind that can "own" the board if mis-set — keep them
to basically one global knob (the dungeon drift) + the rare dread-DoT. Triggered
(`on:match`) transmutes are *player-paced and self-tuning* (gated on a dodgeable
`all_same` condition — poke the trap more, eat more warp), so they balance themselves
and can be bigger per hit. Let foes express transmute identity through triggered traps.

**Per-trap effect budget → solo transmutes buy more geometry.** A trap that *pairs*
transmute with another effect (damage, slow…) spends budget on both, so its transmute
stays small. A **transmute-only** trap spends everything on geometry, so it affords a
bigger pattern at the *same* tier. Crossed with the sweep/strike grammar (§5.4), this
tier-gates the patterns cleanly:

| Tier | Transmute **paired** w/ another effect | Transmute-**only** (solo) |
|---|---|---|
| **Minion** | ≈1 card | up to a **column** (strike, 3) — never a row |
| **Elite** | column (3) | **row** (sweep, 5) ok |
| **Boss** | column / row | row + blast; multiple transmute traps (under the cap) |

> The **row (sweep, 5) is tier-gated to elite/boss** — minions may *strike* (column, 3)
> but only bigger foes *sweep* (row, 5). *Horizontal = big-foe* falls straight out of
> the §5.4 grammar: a minion's quick stab vs the boss's wall-collapse.

**Five dials per foe:** trigger mode (prefer triggered) · cadence (timed only — spends
the shared budget) · count / geometry (solo buys more) · bias intensity (pair with
cadence: slow drift = gentle lean, reactive spike = hard convert) · target (bait /
starve / shape).

**Playtest instrument:** log player-caused vs enemy-caused card-changes per fight; aim
**player ≥ ~65–70%** of all reshapes. Below that (or if the board *feels* like it's
fighting you), back off the *timed* channel first — it's the usual culprit.

---

## 6. Invariants this layer adds

Assert these alongside the four in `CLAUDE.md`:

1. **Makeable-set floor.** Locked cards satisfy FLOOR *on paper* but not *in
   reach*, so a new floor is required: **≥ FLOOR sets must be completable from
   *unlocked* cards.** Enemy lock logic must respect it — never lock the board into
   an unplayable state. (The first invariant about *access* rather than existence.)
2. **Enemy honors spec→spec.** Enemy transmute / lock shift distributions only;
   no positional planting. Same fairness guarantee as player abilities — the enemy
   has no privileged code path.
3. **Traps are legible.** Every active trap is shown to the player before it can
   fire (§2.5). No hidden punishments.

---

## 7. Attachment — how traps reach the player (dungeon · enemy · boss)

Traps and board verbs attach at three scopes, each owning a different layer of the
threat. (Lives alongside `CRAWL-DESIGN.md` §2 run loop / §4 data architecture.)

**Dungeon — the ambient drift** (a board verb, *global* to the dungeon).
- Each dungeon has a theme and applies ONE global **transmute drift**: an `on:tick`
  nudge of the board toward the theme value (e.g. *Emberdeep* → drift Red). **Base rate:
  1 card / 5s.** Active in *every* room, so the dungeon **feels** like its element — the
  board texture is its signature, not a per-fight surprise. (One mechanism shared with
  §2.4 tick-dread; here the payload is a transmute, not damage.)
- This is enemy-as-transmuter (§5.1) elevated to the environment, and where **bait
  coupling** is strongest: the drift makes the theme value abundant and tempting; the
  dungeon's foes punish *around* it → the whole dungeon plays in the enemy's element.
  A build whose engine wants the theme value finds plenty — and plenty of foes built
  to punish it. **Build-vs-dungeon, not just build-vs-foe** (pick your terrain).

**Enemy (trash) — one rolled trap** (a price, per-foe).
- A foe is **HP · Speed · Damage** + ONE trap, but the trap is **rolled as a themed
  variant of the creature**, not pulled from an abstract pool (see *Foe composition*
  below). The same goblin shows up as a different *kind* of goblin run-to-run.

**Elite / lieutenant — two traps, one of them a boss telegraph** (the warm-up).
- The middle rung: **higher HP · Speed · Damage** than trash + **TWO traps** = ONE
  **dungeon-fixed** trap that *mirrors* (a weaker version of) one of the boss's
  signature traps — specifically the boss's **specialist (all-same) theme trap** — +
  ONE rolled minion trap. So the ladder is **1 → 2 → 3 traps**, and the elite's fixed
  trap **foreshadows the boss**: you learn the dungeon's core danger before you face
  it. (Reinforces theme a fourth time: drift baits → elite previews → boss confirms.)
- **Spawn — sawtooth per-room roll**, checked *only if the boss didn't trigger this
  room*: chance = **10% × (rooms since the last elite)**, and the counter **resets to 0
  the moment an elite is encountered**. So it climbs 10% → 20% → 30% … until an elite
  appears, then drops back to 10%. Mean gap ~3–4 rooms → usually **2–3 elites per
  dungeon** before the boss; the counter guarantees one within 10 rooms of the last.
  (Climb-and-reset, not the boss's cumulative *one-time* model — the elite tier
  recurs.)

**Boss — three traps** (the squeeze).
- A boss is the same triple at **higher HP · Speed · Damage** + **THREE traps** —
  enough to manifest the full vice + board squeeze (§2.2, §5.3): a genuine multi-axis
  read, not three overlapping damage taxes.
- *Recommendation:* draw the three from distinct **role buckets** — one specialist
  punish (all-same), one generalist punish (all-diff / diverse), one tick-dread — so a
  boss is always a coherent puzzle. **Named bosses** likely want *authored* signature
  traps (identity — the dragon always breathes fire); **trash** *rolls* theirs.

**Scaling.** Dungeon-level + enemy-level scale a trap's *tier* (the numbers) — same
loot-quality scaling as `CRAWL-DESIGN.md` §2–§3. Severity∝rarity (§1) still governs
which consequences a condition may carry.

### 7.1 Foe composition — base creature · variant · template (built like gear)
*(Revises the earlier "roll one trap from an abstract type-pool" sketch.)* A foe is
**assembled in layers**, the same way an item is `base_type ⊕ rolled affixes` — the
enemy is, structurally, *built like a piece of gear*:

- **Base creature** (Goblin, Skeleton, Wolf) — the stat baseline (**HP · Speed ·
  Damage**) and an **authored variant pool** thematically appropriate to it.
- **Variant = the adjective** (Bloodthirsty / Sneaky / Cowardly) — **rolled** from the
  creature's pool; the adjective *is* the trap (and may tweak stats). The roll picks a
  *whole themed package*, not a detached random effect → **effect is tied to creature**
  (a Bloodthirsty Goblin reads as a goblin, not a random-trap goblin).
- **Template** (Undead, Demonic, Spectral) — a **dungeon-global overlay** applied to
  *every* foe in the dungeon, stacking its trait/trap (+ stat-mods) on top of whatever
  rolled. One knob to make a whole dungeon harder/weirder: an *Undead* Goblin Warren is
  every goblin + undead traits. (Template : foe :: dungeon-affix : encounter.)

A fielded foe = **base creature ⊕ rolled variant ⊕ dungeon template(s)**, each layer
free to add stat-mods and traps. Stat-mods stack additively; trap resolution order
(extends §6) = **dungeon drift → variant trap → template trap**.

> This layered assembly is the on-ramp to **the full opponent** (§8): a foe built from
> stacked trigger-bundles is already a *build*, the same shape as the player's
> class + passive + gear.

### 7.2 Speed vocabulary (foe attack cadence)
Cadence is "seconds to next attack" (lower = more dangerous), so named bands let design
talk *feel* not numbers:

| Band | Cadence | Feel (actions between hits) |
|---|---|---|
| **Lumbering** | ~18–20s | many — a slow siege, big punish-windows |
| **Slow** | ~14–17s | comfortable |
| **Steady** | ~10–13s | the baseline trade |
| **Swift** | ~6–9s | tight — ~1–2 actions per hit |
| **Frenzied** | ~4–5s | frantic — barely a breath between strikes |

Variants/templates may shift a foe by **±1 band** (a *Sneaky* goblin is one band faster;
an *Undead* template might drop a band but add HP).

---

## 8. Resolved decisions & open questions

**Resolved:**
- **Cross-room persistence — HP only.** Tick-DoTs / dread / mana / Tactics all **clear
  between rooms**; HP is the sole carry-over (the run's attrition clock). So dread is
  strictly per-room pressure — no curse follows you. (`CRAWL-DESIGN.md` §6.)
- **Resolution order — dungeon drift first, then foe traps in listed order.** A match
  (or tick) resolves the dungeon-global trap, then each foe trap top-to-bottom as
  authored — so **trap order on a foe is a deliberate lever** (transmute-then-punish
  vs. punish-then-transmute). (`CRAWL-DESIGN.md` §6.)
- **Dungeon-drift coupling — bait.** The global drift leans *toward* the value the
  foes punish, so the dungeon plays in the enemy's element (§7).
- **Boss-trap structure — structured + authored.** One per role bucket (specialist /
  generalist / dread); named bosses author their three for identity, trash rolls (§7).
- **Foe composition — base creature ⊕ variant ⊕ template** (§7.1). Each creature owns
  an authored **variant pool** (adjectives that *are* themed traps + stat tweaks);
  rolling picks a whole variant, not a detached trap. **Templates** are dungeon-global
  overlays stacked on every foe (e.g. Undead) — a one-knob difficulty/variety lever.
  Built like an item (base ⊕ affixes). (Supersedes the earlier abstract-type-pool note.)
- **Base transmute rate — 1 card / 5s** for tick-transmutes (dungeon drift; tick
  traps). Triggered (`on:match`) transmutes may move more per the severity∝rarity law
  (§1). Exact per-foe gating still wants playtest, but the baseline tide is set.
- **Player-side lock — yes**, themed as **Ice Block** (defense buff + wound clear +
  self-heal + big temp board lock); the inert ruling makes it board-preservation too
  (§5.2).
- **Per-foe transmute tuning — framework in §5.5.** Safety is free (geometry), so tune
  a feel-band; cap total reshape ≤ ~½ the player's clear rate; dungeon-drift + foe is
  one shared budget; prefer self-tuning triggered transmutes; solo-transmute traps buy
  bigger geometry; row/sweep tier-gated to elite/boss. Exact numbers want playtest, but
  the dials and bounds are set.

- **Enemy resources — none, for now.** Enemies do **not** track mana/Tactics or pay
  costs; their traps and transmutes **fire directly**, gated only by condition (`match`)
  or cadence (`tick`). The composition stack (§7.1) already makes a foe a *build*
  structurally; we **build and feel the reactive system first** (and author lots of
  data) before considering an active, resource-spending enemy-cast layer.

**Open:**
- **The full opponent (active layer)** — *deferred, not rejected.* Whether the enemy
  eventually gets an **active** layer (spends its own resource to cast transmutes/heals
  on its clock) = the duel-of-two-builds endgame. Revisit only after the reactive
  threat layer is built and played. (§5.1 / §7.1 are the structural groundwork.)

---

## 9. Glossary additions (extends `GAME-DESIGN.md` §8, `CRAWL-DESIGN.md` §4)

- **trap** — an enemy-owned trigger; a *price* on a specific match (§0).
- **severity ∝ rarity** — the master tuning law: frequent conditions get small
  consequences, rare ones big (§1).
- **condition vice** — all-same traps push off commitment, all-diff traps push
  onto it; together they squeeze toward a middle (§2.2).
- **double-value conjunction** — a two-axis, specific-value trap (Red Swords);
  boss-tier rarity + consequence (§2.3).
- **dread / tick-DoT** — an `on:tick` trap; the anti-stall second clock (§2.4).
- **counter-foe recipe** — condition = the build's wanted match, consequence =
  the resource that build runs on (§4).
- **enemy-as-transmuter** — enemy board verb; the *bait coupling* of transmuting
  toward the value it punishes (§5.1).
- **lock (locked card)** — a card left on the board, still forming sets, but
  unselectable for N seconds; denies access without changing composition (§5.2).
- **herding** — transmute (tempt) + lock (deny the safe out) + trap (punish what's
  left): the board-state squeeze (§5.3).
- **makeable-set floor** — ≥ FLOOR sets must be completable from unlocked cards
  (§6.1).
</content>
</invoke>
