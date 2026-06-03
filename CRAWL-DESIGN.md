# CRAWL-DESIGN.md — SET.crawl

> The first iteration toward the **real game**: a data-driven dungeon crawler on
> the SET skill engine. **Status: design capture, no code yet.** Builds on
> `GAME-DESIGN.md` (trigger bus, transmute verb, locked f=3/N=15) and `PROJECT.md`
> (generation math). This doc owns the crawl-specific run loop, the data
> architecture (YAML entities), and the visual reskin.

**Lineage:** `set.core` (skill core + tuning console) → `set.combat` (combat
sandbox) → **`set.crawl`** (the dungeon-crawler game). set.crawl starts as a copy
of `prototype/set-combat.html`, palette-swapped first, then grown into the loop
below. We keep the validated generation core untouched.

---

## 1. Visual direction — dungeon-crawler reskin

A pure palette/asset swap first (no mechanics change). The board stays the same
f=3/N=15 grid; only the skin changes.

- **Card stock = parchment.** Aged vellum texture, subtle stains/foxing, slightly
  irregular deckled edges, an inked border. Replaces the dark instrument cards.
- **Iconography = inked action glyphs.** The shape axis is **Attack / Defend / Move**
  (§4 axis theming), so the card glyph depicts the *verb*, not the gear object: a
  strike / a guard / a stride (e.g. crossed-blades, shield-guard, footprints), drawn
  woodcut/engraving style — kept visually distinct from the Sword/Shield/Boots *gear*
  nouns. Number renders as pips or repeated glyphs (magnitude 1–3).
  *Icon sourcing:* **set.crawl** draws from **game-icons.net** (CC BY 3.0 — carry an
  attribution credit), which matches the woodcut aesthetic; the **set.combat** sandbox
  uses **Lucide/Tabler** (MIT) placeholders. Working glyph picks: Attack = crossed
  swords, Defend = shield, Move = footprints.
- **Color = aged inks, not neon.** Muted tints (vermilion / verdigris / woad) rather
  than the current bright RGB, themed as elements/mana.
- **UI chrome = stone, torch, wood, iron.** Torch-lit vignette, wood/iron panel
  framing, a blackletter or chiseled-serif display face for headers (vs. Syne),
  readable serif/mono for body. Inventory/town as unrolled parchment scrolls.
- **Feedback juice.** Damage = blood/torch red vignette flash (the §4 timed-hole
  damage mechanic). Timer could become a guttering candle or draining hourglass
  (optional; keep legibility).
- **Health gems + playfield tint.** Gems set into the background art recolor with the
  player's HP band, and at the low bands the whole playfield takes a vignette tint
  that deepens toward death — a glanceable, ambient health read (no need to watch a
  number). Bands: **Blue >90% · Green 70–90% · Yellow 35–70% · Red 1–35%**; the tint
  engages at Yellow and intensifies through Red, and the gems pulse (faster at Red).
  Gem placement: one in each of the four corners of every panel, plus a center-top
  jewel on the card board. *Prototyped in `set-combat.html`* (corner gems on all
  panels + radial tint vignette on the playfield).

> Principle: reskin is cosmetic only. No generation/mechanic change rides along with
> the palette swap — that's a separate, later step.

---

## 2. The run loop

```
  TOWN ──enter──> DUNGEON ──> [ROOM: 1 enemy] ──win──> LOOT ROLL ──> next room
   ^                                  │                                  │
   │                            (lose = run ends)            (boss-chance check each room)
   └────────────── exit / death ──────┴──────── BOSS room ──win──> big LOOT ──> TOWN
```

- **Dungeons** have a difficulty level, a **weighted enemy table**, and a **named
  boss**. Loot quality scales with **enemy level + dungeon level**.
- **Rooms** are fought one enemy at a time (a SET combat encounter). Win → a roll on
  the loot table. Lose → run ends (death/retreat — TBD, see §6).
- **Boss chance per room** is cumulative (the running probability the boss has
  appeared rises each room). Each room *n* adds *n%* to the running total:
  `cumulative(n) = n·(n+1)/2 %` (triangular).

  | Room n | adds | cumulative boss-appeared |
  |---|---|---|
  | 1 | +1% | 1% |
  | 2 | +2% | 3% |
  | 3 | +3% | 6% |
  | 4 | +4% | 10% |
  | 5 | +5% | 15% |
  | 6 | +6% | 21% |
  | 7 | +7% | 28% |
  | 8 | +8% | 36% |
  | 9 | +9% | 45% |
  | 10 | +10% | 55% |
  | … | … | … |
  | 14 | +14% | **100% (capped → guaranteed)** |

  So **median boss ≈ room 10, guaranteed by room 14** — dungeons self-bound in
  length, with a long-run gambler's choice (push deeper for more loot rolls vs. cash
  out before the boss). Open: does the boss *replace* that room's normal enemy or
  *append*? (§6)

- **Town** between dungeons: **sell** gear/spellbooks, **buy** from shop loot-table
  inventory (gear, consumables, spellbooks). Healing/restock happens here.

---

## 3. Progression & economy

- **XP** per enemy → **levels**. Each level grants **+HP** and (periodically) **+1
  ability slot**. (Curve TBD.)
- **Classes** start with **~4 abilities + 1 signature set-passive** (the class
  identity trigger, e.g. Rogue's Move→Attack bias). Ability slots cap how many
  abilities you can equip at once; leveling widens the loadout.
- **Spellbooks** are the cross-class vector: **consume** one to *instantly learn* its
  ability (even outside your class — Firebolt is on Wizard, Sorcerer, *and*
  Pyromancer), or **sell** it in town for gold. This is how a build escapes its class
  starting kit.
- **Gold** sinks: shop purchases, (maybe) respecs/healing. Sources: enemy loot rolls,
  selling unwanted gear/spellbooks.
- **Loot roll per enemy** (weighted): **gold · consumable · gear · spellbook**, with
  quality scaled by enemy level + dungeon level.

**Abilities can be shared across classes.** An ability is a standalone data object;
classes (and spellbooks) merely *reference* it. Firebolt exists once; Wizard,
Sorcerer, Pyromancer all list it.

---

## 4. Data-driven architecture — YAML entities

Everything content-side is **declarative YAML, ingested at load**. One file per
entity type (e.g. `data/abilities.yaml`, `data/foes.yaml`, …) + a loader. This keeps
content authorable without touching engine code and makes the whole game moddable.

### Axis theming (locks the abstract axes to crawler flavor)
| Axis | Values | Theme |
|---|---|---|
| **color** | red / green / blue | element → **mana** (3 colors) |
| **shape** | Attack / Defend / Move | offense / defense / mobility verbs (gear nouns Sword/Shield/Boots stay free) |
| **number** | 1 / 2 / 3 | **magnitude** |

Resource model: **color → mana is the one spendable economy, and it's universal** —
every class uses all three mana types; only the *theming* differs per class. **Color
carries a valence:** red = aggressive abilities, blue = defensive, green = utility.
This runs parallel to the **shape** valence (Attack = offense, Defend = defense, Move =
mobility/utility), giving a 2-D identity lattice (**color-theme × shape-action**) that
build archetypes cut diagonals through (pure aggro = all-red-Attack; hybrids play
off-diagonal). **Shape stays immediate** (per-card → damage / Block / tempo, never a
banked resource); **number stays a scalar** (magnitude 1–3 multiplies output). Weapon
color-affinity (§7) feeds the color half of the lattice.

### The spine: one trigger schema, used everywhere
Abilities' reactive parts, class passives, item affixes, and enemy traps are **all
the same event→condition→effect unit** from `GAME-DESIGN.md` §3. Define it once:

```yaml
# a trigger — the universal reactive unit
on: match            # match | tick | damage | ability | room_clear
when:                # condition (optional)
  axis: color        # color | shape | number
  mode: all_same     # all_same | contains | signature | not_value
  value: red
do:                  # one or more effects
  - effect: grant_resource   # see effect vocabulary below
    resource: red_mana
    amount: 1
```

**Effect vocabulary (open, growing):** `grant_resource`, `damage_enemy`,
`advance_enemy_timer`, `enemy_attack` (immediate or `chance`), `transmute`
(the board verb), `set_bias`, `modify_stat`, `heal`, `learn_ability`, `gain_xp`.

### Entity sketches (illustrative — to iterate, not final)

```yaml
# abilities.yaml — active verbs + (passive abilities are just triggers w/ no cost)
- id: firebolt
  name: Firebolt
  type: active
  target: enemy            # none | enemy | card | area
  cost: { red_mana: 2 }
  cooldown: 0
  do:
    - effect: damage_enemy
      amount: 6
- id: call_flames
  name: Call Flames
  type: active
  target: none
  cost: { blue_mana: 5, green_mana: 5 }
  do:
    - effect: transmute
      select: { axis: color, mode: not_value, value: red }   # destroy non-red
      bias:   { axis: color, value: red, intensity: 1.0 }
      objective: maximize_bias
```

```yaml
# classes.yaml
- id: rogue
  name: Rogue
  base_hp: 30
  ability_slots: 4
  starting_abilities: [quick_strike, backstab, smoke_bomb, dash]
  signature:               # the class set-passive (a trigger)
    on: match
    when: { axis: shape, mode: all_same, value: move }
    do:
      - effect: set_bias
        scope: next_regen
        bias: { axis: shape, value: attack, intensity: 1.0 }
```

```yaml
# foes.yaml + traps.yaml (traps = enemy triggers)
- id: goblin_patrol        # foes.yaml
  name: Goblin Patrol
  level: 2
  hp: 18
  attack_timer: 12         # seconds to next attack
  attack_damage: 4
  traps: [swarm]
  xp: 10
  loot_tier: 2

- id: swarm                # traps.yaml
  name: Swarm
  on: match
  when: { axis: number, mode: contains, value: 1 }   # contains vs all_same = open knob
  do: [ { effect: advance_enemy_timer, seconds: 1 } ]
- id: fire_breathing
  name: Fire Breathing
  on: match
  when: { axis: color, mode: all_same, value: red }
  do: [ { effect: enemy_attack, chance: 0.25 } ]
```

```yaml
# items.yaml + affixes.yaml
- id: ember_dagger         # items.yaml
  name: Ember Dagger
  slot: weapon
  base_type: dagger        # martial weapon → base math-mod = +Attack-card damage (§7)
  rarity: uncommon
  base: { attack_damage: 3 } # flat per-card add to each Attack card in a match
  affix_slots: 2
- id: of_embers            # affixes.yaml (rolled onto items)
  name: of Embers
  tier: 1
  slots: [weapon]
  weight: 10               # generation weight
  trigger:
    on: match
    when: { axis: color, mode: contains, value: red }
    do: [ { effect: grant_resource, resource: red_mana, amount: 1 } ]
```

```yaml
# consumables.yaml + spellbooks.yaml
- id: minor_heal           # consumables.yaml
  name: Minor Healing Draught
  do: [ { effect: heal, amount: 10 } ]
  price: 25
- id: tome_firebolt        # spellbooks.yaml (consume to learn, or sell)
  name: "Tome: Firebolt"
  teaches: firebolt
  sell_price: 40
```

```yaml
# dungeons.yaml + loot_tables.yaml
- id: goblin_warren        # dungeons.yaml
  name: The Goblin Warren
  difficulty: 1
  enemy_table:             # weighted
    - { foe: goblin_patrol, weight: 50 }
    - { foe: cave_bat,      weight: 30 }
    - { foe: goblin_shaman, weight: 20 }
  boss: goblin_king
  loot_modifier: 0         # dungeon-level loot bonus
- id: loot_tier2           # loot_tables.yaml
  rolls: 1
  entries:
    - { type: gold,       weight: 40, min: 5, max: 20 }
    - { type: consumable, weight: 25, table: consum_tier2 }
    - { type: gear,       weight: 25, rarity_table: rarity_tier2 }
    - { type: spellbook,  weight: 10, table: books_tier2 }
```

### How the entities reference each other
```
  dungeon ──enemy_table/boss──> foe ──traps──> trap ─┐
     │                           │                   ├─ all compile to → TRIGGER (on/when/do)
  loot_table <── foe.loot_tier ──┘                   │
  class ──starting_abilities/signature──> ability ──do──┘
  spellbook ──teaches──> ability
  item ──affix_slots──> affix ──trigger──┘
```
The whole content graph bottoms out in two primitives: the **trigger** (reactive)
and the **transmute verb** (active board change) — both already specced in
`GAME-DESIGN.md`, both honoring spec→spec fairness.

---

## 5. Build sequence (when we start coding)

1. Copy `set-combat.html` → `set-crawl.html`; **palette-swap only** (§1). Ship the
   reskin with zero mechanic change.
2. Stand up the **YAML loader** + the entity schemas (§4) with a tiny seed dataset.
3. Implement the **trigger bus** and **transmute verb** against the data.
4. Wrap a single **room/encounter** in the run loop (enemy stats, attack timer,
   loot roll).
5. Add **dungeon flow** (room chain, boss-chance, loot scaling), then **town**
   (buy/sell), then **progression** (XP/levels/slots).
6. Author content; tune.

---

## 5.5 Combat resolution & the Flee retreat — *prototyped in `set-combat.html`*

The per-room combat model. Values below are **prototyped and live in
`prototype/set-combat.html`** (the basis for `set-crawl.html`); treat numbers as
tuning defaults.

**Per-card resolution.** Each card in a found set fires its own shape-action, scaled
by its number (magnitude 1–3), typed by its color:
- **Attack → damage** (rolled — `weightedRoll`, triangular, weighted high toward
  magnitude but the odd weak hit slips through; *not* pure).
- **Defend → Block** (a persistent barrier).
- **Move → tempo** (pushes the enemy's next-attack clock later).
- **Color → mana** by signature: all-same color → 3 of that mana; all-different → 1
  of each. (The speed-vs-value routing tradeoff falls out for free.)

**Resource caps (and the adaptive deal).**
- **Block ≤ max HP.** The barrier can hold up to your HP; excess is lost.
- **Enemy clock ≤ 20s.** Move can't push the next attack more than 20s out; excess
  is wasted.
- **Capped → bias toward Attack.** When a resource is capped its action is wasteful, so
  generation steers the shape axis toward Attack — *targeted*: a full Block cuts
  Defends but keeps Moves (still useful), a maxed clock cuts Moves but keeps Defends,
  both capped → heavy Attack. Distinctness caps the realized skew (~50% one-shape at
  N=18 — the §3-style saturation governor), so the board never goes mono.

**Flee — the retreat mechanic** (resolves the §6 loss-condition retreat path):
- A **Flee** button under the abilities toggles **Fleeing mode**.
- While fleeing: the deal biases **toward Move, away from Attack**; Move cards no longer
  stall the clock — each rolls (triangular, like damage) into a **Flee meter → 10**.
  Attacks/Defends/mana still resolve normally.
- Meter hits 10 → **retreat to town** (in the sandbox: a flee-success end screen).
- **Toggling off doesn't snap to 0** — the meter **decays 3s per level**, and Flee is
  **locked out until empty**. Overshoot and you actually retreat (lose progress).
- **The intended tech:** classes with Move-triggers (e.g. Rogue's Move→Attack passive)
  enter Fleeing to farm Moves, then bail before 10 to reset — the lockout + decay +
  triangular overshoot risk is the price. Build-expressive, self-balancing.
- Prototyped constants: `FLEE_GOAL=10`, `FLEE_DECAY_PER_LEVEL=3s`, fleeing shape
  weights `attack:defend:move = 1:4:16`, `CLOCK_CAP=20s`.

---

## 6. Open questions

- ⭐ **TOP PRIORITY NEXT SESSION — rework Move's core.** Playtest finding: the enemy
  clock is **nearly impossible to push to its cap** (it resets to `now+cadence` on every
  hit; Move adds only 1–3s/card vs. real-time drain — only stacked Frostbolts off a
  fresh reset reach it). Deeper issue: **Defend and Move are both "don't-die" tools and
  Move/tempo is the weak, fiddly one.** Move needs a distinct, usable core before the
  Move affixes (§7 Windstep/Stalker's) can hang on it. Directions under consideration
  (no decision yet): **(a) banked, spendable tempo** — flexible green=utility resource;
  *concern: risks becoming another bolted-on fiddly resource to manage*; **(b)
  evasion/dodge** — Move negates the next hit (distinct from Block's partial absorb),
  liked for being flexible/utility-oriented. Also on the table: offensive-enabler/combo,
  or just rebalance tempo numbers. **Resolve this first next session.**
- **Loss condition** — death = permadeath/run-over? The *retreat* path is now defined
  (the Flee mechanic, §5.5); still open is the **penalty** for fleeing and what death
  itself costs (roguelike vs. roguelite framing).
- **Boss room** — does the boss *replace* the room's normal enemy or *append* a room?
- ~~**Resource mapping** for shape & number axes~~ — **working resolution: single
  spendable economy.** color→mana is the only banked resource (universal, valence-themed
  — §4); shape stays immediate (per-card damage/Block/tempo), number stays a scalar.
  Revisit only if martial builds feel resource-thin in play.
- **Trap condition default** — `contains` vs `all_same` (carried over from
  `GAME-DESIGN.md`; `all_same` proposed so traps are dodgeable).
- **Ability slots vs. known abilities** — do you *learn* a growing library but only
  *equip* slot-many? (Implies a loadout screen in town.)
- **Cooldowns vs. resource-only** gating for actives.
- **Level/XP curve, HP curve, gold economy balance.**
- ~~**Mana persistence**~~ — **resolved: per-room, fresh start every room** (mana
  resets to zero on entering each room; no carry-over). Caster builds must rebuild
  their pool every encounter — bounds caster snowballing and keeps each room a clean
  tactical reset.
- **Inventory limits**, gear comparison UX.

---

## 7. Gear taxonomy

> Resolves the §7-deferred topic. Decisions locked: **flat per-card** payoff scaling;
> **slot-personality framework** — Weapon · Armor · Relic(offhand) · Trinket ×2
> (**Feet dropped**, Boots → Trinket); martial/caster school per slot; **set bonuses
> deferred**. ⚠ The **Move-core rework** (§6, top priority) reshapes the Move affixes.

### Two effect classes (the whole taxonomy)
Every piece of gear touches the game in one or both of exactly two ways — nothing else:

1. **Math-mod (always-on).** A flat, passive bend to either
   - the **deal odds** — a persistent contribution to the setup-bias channel. Still
     governed by the saturation cap + distinctness floor, so deal-bias gear is
     *structurally fair by construction*: even a "+heavy red" item can't make a
     degenerate board (it shifts a distribution, never plants a card). — or
   - the **payoff** — the per-card resolution. **Scaling is flat per-card add:** `+N`
     to each qualifying card's contribution. Magnitude (1–3) still does the
     multiplicative work; gear nudges the floor.
2. **Trigger-granting (affixes).** Adds `event→condition→effect` rules to the same
   trigger bus (§4 / `GAME-DESIGN.md` §3) the enemies and classes use. No new machinery.

**An item = a base math-mod (from its base-type) + N rolled affix slots (mostly
trigger-granting).** Exactly the `ember_dagger` + `of_embers` shape from §4, with the
base layer now named.

### Slot personalities — each slot owns a *kind* of mechanic, not just a stat
The structural decision: a slot isn't "+stat for a verb" — it owns a characteristic
**mechanic-type**, and its base-types are flavors within that (mirrors how the trigger
bus unifies everything). The **martial / caster school** split still runs through each
slot (martial engages the shape/combat side; caster pumps the color→mana economy), but
*how* a slot engages is now slot-specific.

| Slot | Mechanic personality | Martial base-types | Caster base-type |
|---|---|---|---|
| **Weapon** | **Direct payoff** (per-card) | Sword / Axe / Hammer → +Attack damage (+ color-affinity) | Wand / Staff → +mana per matched [color] card |
| **Armor** | **Reactive defense** — triggers on `damage` / signatures | Plate, Aegis (↓) | Runed Robe → Defend match also grants mana |
| **Relic (offhand)** | **Augments / alternate verbs** | Shield, Crossbow, Oil, Dagger (↓) | Focus / Wand / Tome → +mana / spell power / −ability cost / +1 slot |
| **Trinket ×2** | **Flex economy / triggers** | rings · amulets · **Boots** (the Move-flavored trinket) → economy, deal-bias, Move/Flee affixes | same |

**No tie binds a slot to a shape any more** — the rename dissolved it; the one kept
convention is **Weapon↔Attack** (intuitive + the color-affinity hook). The old **Feet
slot is dropped**: with Move a standalone verb a dedicated Move slot was
over-investment, so **Boots became a Trinket base-type** and the Feet mechanics demoted
to affixes (↓ *Move affixes*).

Caster gear is naturally **color-typed** (an Ember Wand pumps *red* mana), so caster
pieces reinforce a color combo-line the same way martial pieces reinforce a shape-line.
*"+1 red mana per red card in the match"* mirrors *"+2 damage per Attack card."*

### Armor — reactive defense (base-types)
- **Plate** — `on:damage`: after a hit lands, gain Block (being hit makes you tankier).
- **Aegis / Spiked** — when Block absorbs a hit, **reflect** a % as damage (thorns —
  defense→offense).
- *(further flavors parked: **Warded** = passive flat % damage reduction beneath Block;
  **Sentinel** = all-same matches → bonus Block.)*

### Relic (offhand / augment) — base-types
The martial-offhand + augment slot (also home to the caster Focus). Each *changes how a
verb behaves* rather than pumping a stat:
- **Shield** — passive defense: Block at room start / first-hit negation / +Block cap.
- **Crossbow / Sling** — **Move matches also deal damage** (reposition-and-shoot:
  tempo→offense).
- **Weapon Oil / Poison** — a **rider on Attacks**: poison DoT (`on:tick`) or
  bonus / off-color damage.
- **Offhand Dagger** — **bonus extra hit** on all-different-shape matches (dual-wield).
- *(caster)* **Focus / Wand / Tome** — +mana / spell power / −ability cost / +1 ability slot.

### Move affixes (on Boots-trinkets, etc.) — ⚠ pending the Move-core rework (§6)
The two liked Feet mechanics survive as affixes, but both currently hinge on the enemy
clock reaching its **cap — a state the playtest showed is nearly unreachable** (clock
resets to `now+cadence` every hit; Move adds only 1–3s/card vs. real-time drain). They
must be re-anchored on reachable conditions once Move's core is settled:
- **Windstep** (overcap→Block) → re-anchor: a *fraction* of every Move's tempo grants
  Block, not just the unreachable overcap.
- **Stalker's** (clock-far-out → +Attack damage) → re-anchor: a combo trigger ("first
  Attack after a Move match") or continuous "+dmg scaled by banked tempo."

### Weapon color-affinity (martial weapons)
Each martial weapon base-type carries a **color affinity** granting a **flat per-card
damage bonus**: `+N damage per [affinity-color] Attack card in any match`. Because only
Attack cards deal damage, this rewards **colored Attacks** specifically — a per-card
conjunction that fits the locked flat-per-card model (fires often & small, not
rare & big), and can stack on a smaller flat-all-Attacks base.

- **Weapons only.** Armor/relic/trinkets get no color bonus — keeps it to *one*
  color-gauge to read under the timer; they carry other mechanics/affixes.
- **Affinity is free, not valence-locked.** Any weapon base-type may key to any color
  (even a defensive-feeling weapon can reward red Attacks). Players gravitate to the
  weapon whose color matches their mana plan, but off-valence picks are the hybrid
  texture, not a mistake.
- **Naming is now clean.** The card shapes are verbs (**Attack / Defend / Move**, §4),
  so the object nouns **Sword / Shield / Boots are free as gear names** — a *Sword*
  weapon, a *Shield* relic (offhand), *Boots* as a Trinket are all unambiguous against
  the Attack / Defend / Move cards they modify.
- **Fairness:** pure category-③ payoff math — reads the match, adds damage, touches no
  generator input. The player feeds it by biasing color→[affinity] and shape→Attack
  through play and deal-bias gear (the existing fair channels).

*Example — **Axe (affinity red)**: red Attack cards deal +2 each. Pairs with red mana
(aggressive abilities) into a coherent red-aggro package, all from one weapon pick.*

### Rarity → affix count, loot-tier → affix power
`common (0 affix) → magic (1) → rare (2) → epic (3) → legendary (named: fixed unique affix)`.
Affix **slot-legality + weight** come from `affixes.yaml` (`slots:` / `weight:`); affix
**tier** (the numbers) scales with loot quality (enemy lvl + dungeon lvl) per §2–§3.

### Data-model refinement
An item carries `slot`, **`base_type`** (→ intrinsic math-mod school + stat), `rarity`
(→ affix count), and `affixes[]`. So `items.yaml` gains a `base_type` dimension; affixes
stay one slot-gated pool in `affixes.yaml`.

### Deferred
- **Set bonuses** — the parallel cross-build vector to spellbooks (themed families with
  2/4/6-pc escalating trigger/math bonuses). Deliberately out of the v1 gear spec;
  revisit once base gear + affixes prove out in play.

## 8. Deferred (next session)

- *(open — pick the next thread from §6's remaining open questions, or start coding
  the §5 build sequence)*
