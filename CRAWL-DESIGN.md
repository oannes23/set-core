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
- **Iconography = inked dungeon glyphs.** The shape axis reskins to concrete crawler
  objects (see §4 axis theming): **sword / shield / boot**, drawn woodcut/engraving
  style. Number renders as pips or repeated glyphs (magnitude 1–3).
- **Color = aged inks, not neon.** Muted tints (vermilion / verdigris / woad) rather
  than the current bright RGB, themed as elements/mana.
- **UI chrome = stone, torch, wood, iron.** Torch-lit vignette, wood/iron panel
  framing, a blackletter or chiseled-serif display face for headers (vs. Syne),
  readable serif/mono for body. Inventory/town as unrolled parchment scrolls.
- **Feedback juice.** Damage = blood/torch red vignette flash (the §4 timed-hole
  damage mechanic). Timer could become a guttering candle or draining hourglass
  (optional; keep legibility).

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
  identity trigger, e.g. Rogue's boots→sword bias). Ability slots cap how many
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
| **shape** | sword / shield / boot | offense / defense / mobility glyphs |
| **number** | 1 / 2 / 3 | **magnitude** |

Resource model: color matches → colored **mana** (clear). Shape/number → other
resources (energy? combo?) — still open (§6), but now anchored to flavor.

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
    when: { axis: shape, mode: all_same, value: boot }
    do:
      - effect: set_bias
        scope: next_regen
        bias: { axis: shape, value: sword, intensity: 1.0 }
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
  rarity: uncommon
  base: { attack: 3 }
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
- **Sword → damage** (rolled — `weightedRoll`, triangular, weighted high toward
  magnitude but the odd weak hit slips through; *not* pure).
- **Shield → Block** (a persistent barrier).
- **Boot → tempo** (pushes the enemy's next-attack clock later).
- **Color → mana** by signature: all-same color → 3 of that mana; all-different → 1
  of each. (The speed-vs-value routing tradeoff falls out for free.)

**Resource caps (and the adaptive deal).**
- **Block ≤ max HP.** The barrier can hold up to your HP; excess is lost.
- **Enemy clock ≤ 20s.** Boots can't push the next attack more than 20s out; excess
  is wasted.
- **Capped → bias toward Sword.** When a resource is capped its action is wasteful, so
  generation steers the shape axis toward Sword — *targeted*: a full Block cuts
  Shields but keeps Boots (still useful), a maxed clock cuts Boots but keeps Shields,
  both capped → heavy Sword. Distinctness caps the realized skew (~50% one-shape at
  N=18 — the §3-style saturation governor), so the board never goes mono.

**Flee — the retreat mechanic** (resolves the §6 loss-condition retreat path):
- A **Flee** button under the abilities toggles **Fleeing mode**.
- While fleeing: the deal biases **toward Boot, away from Sword**; Boots no longer
  stall the clock — each rolls (triangular, like damage) into a **Flee meter → 10**.
  Swords/Shields/mana still resolve normally.
- Meter hits 10 → **retreat to town** (in the sandbox: a flee-success end screen).
- **Toggling off doesn't snap to 0** — the meter **decays 3s per level**, and Flee is
  **locked out until empty**. Overshoot and you actually retreat (lose progress).
- **The intended tech:** classes with Boot-triggers (e.g. Rogue's boots→sword passive)
  enter Fleeing to farm Boots, then bail before 10 to reset — the lockout + decay +
  triangular overshoot risk is the price. Build-expressive, self-balancing.
- Prototyped constants: `FLEE_GOAL=10`, `FLEE_DECAY_PER_LEVEL=3s`, fleeing shape
  weights `sword:shield:boot = 1:4:16`, `CLOCK_CAP=20s`.

---

## 6. Open questions

- **Loss condition** — death = permadeath/run-over? The *retreat* path is now defined
  (the Flee mechanic, §5.5); still open is the **penalty** for fleeing and what death
  itself costs (roguelike vs. roguelite framing).
- **Boss room** — does the boss *replace* the room's normal enemy or *append* a room?
- **Resource mapping** for shape & number axes (color→mana is settled).
- **Trap condition default** — `contains` vs `all_same` (carried over from
  `GAME-DESIGN.md`; `all_same` proposed so traps are dodgeable).
- **Ability slots vs. known abilities** — do you *learn* a growing library but only
  *equip* slot-many? (Implies a loadout screen in town.)
- **Cooldowns vs. resource-only** gating for actives.
- **Level/XP curve, HP curve, gold economy balance.**
- **Mana persistence** — does mana carry between rooms / reset per encounter / reset
  per dungeon?
- **Inventory limits**, gear comparison UX.

---

## 7. Deferred (next session)

- **Gear taxonomy** — what the different kinds of gear *do* (slots, stat mods, which
  affixes roll where, set bonuses, math-modifying vs. trigger-granting gear). Explicit
  next topic per the design conversation.
