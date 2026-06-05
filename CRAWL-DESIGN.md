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

- **Dungeons** have a difficulty level, a **theme**, a **weighted enemy table**, and a
  **named boss**. Loot quality scales with **enemy level + dungeon level**. Each
  dungeon also applies one **global transmute drift** (an `on:tick` nudge of the board
  toward the theme value) active in *every* room — this is what makes a dungeon *feel*
  like its element, and it **baits** the theme value the foes are built to punish
  (build-vs-dungeon). Full threat-layer spec in **`TRAPS.md`** (esp. §7 attachment).
- **Foes** are **HP · Speed · Damage** + traps, by tier: **minion** = 1 trap (rolled as
  a themed *variant* of the creature) · **elite/lieutenant** = 2 (one dungeon-fixed,
  mirroring the boss's specialist theme trap — a *telegraph* — plus one rolled) ·
  **boss** = higher stats + 3 authored signature traps (the squeeze). Ladder = **1 → 2 →
  3 traps**. A fielded foe is composed **base creature ⊕ rolled variant ⊕ dungeon
  template** (built like an item; `TRAPS.md` §7.1), with **Speed** named in bands
  (Lumbering → Frenzied, §7.2).
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
  out before the boss). When the boss triggers, **it replaces the enemy that room would
  have generated** (its own fresh encounter), not an appended extra room.

- **Elite chance per room** — checked *only if the boss didn't trigger this room*, and
  **recurring** (the elite tier is met repeatedly). Chance = **10% × (rooms since the
  last elite)**; the counter **resets to 0 when an elite is fought**, so it climbs
  10% → 20% → 30% … then drops back to 10%. Mean gap ~3–4 rooms → usually **2–3 elites
  before the boss** (with rare swingy runs — a room-2 boss is possible). 10% is the
  tuning dial.

- **Town** between dungeons: **sell** gear/spellbooks, **buy** from shop loot-table
  inventory (gear, consumables, spellbooks). Healing/restock happens here.

---

## 3. Progression & economy

- **XP** per enemy → **levels**. Each level grants **+HP** and (periodically) **+1
  ability slot**. (Curve TBD.)
- **Classes** start with **~4 abilities + 1 signature set-passive** (the class
  identity trigger, e.g. Rogue's Move→Attack bias). Ability slots cap how many
  abilities you can equip at once; leveling widens the loadout.
- **Boss-gated ability advancement** (planned). Each **class has ~10 abilities** in its
  list, but starts with only the kit above. **Every boss you kill → pick one new
  ability from your class list** to learn. Bosses become the growth milestone (beating
  one = build progress), and the wide list (10/class) + which picks you take, in what
  order, means **lots of build variety within a single class** — before spellbooks even
  cross the streams. (Boss-kill picks are the *intra-class* growth vector; spellbooks
  below are the *cross-class* one.)
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
# foes.yaml — a base CREATURE = stats + an authored variant pool (TRAPS.md §7.1).
# A fielded foe = base creature ⊕ rolled variant ⊕ dungeon template(s).
- id: goblin               # a MINION creature
  name: Goblin
  tier: minion             # minion | elite | boss (→ trap count + stat scale)
  hp: 20
  speed: swift             # named band (TRAPS.md §7.2); resolves to a seconds range
  damage: 10
  variants: [bloodthirsty, sneaky, cowardly]   # roll ONE at spawn; the variant IS the trap
  xp: 10
  loot_tier: 2
- id: goblin_king          # the BOSS (named → authored signature traps, no variant roll)
  name: The Goblin King
  tier: boss
  hp: 90
  speed: steady
  damage: 14
  traps: [ war_cry, press_the_swarm, dread_drums ]   # 3 authored: specialist + generalist + dread
  xp: 120
  loot_tier: 5

# variants.yaml — adjective = a themed trap (+ optional ±band / stat tweak), tied to the creature
- id: bloodthirsty         # the worked example: on all-red, chance damage + warp a Defend toward red
  name: Bloodthirsty
  trap:
    on: match
    when: { axis: color, mode: all_same, value: red }
    do:                                            # PAIRED (damage+transmute) → transmute stays ≈1 card (§5.5)
      - { effect: damage, chance: 0.5, amount: 6 }
      - { effect: transmute, count: 1,
          select: { axis: shape, mode: all_same, value: defend },
          bias: { axis: color, value: red } }
- id: sneaky
  name: Sneaky
  stat_mod: { speed_band: +1 }                     # one band faster (Swift → Frenzied)
  trap: { on: match, when: { axis: shape, mode: all_same, value: move },
          do: [ { effect: enemy_attack, chance: 0.25 } ] }
- id: cowardly
  name: Cowardly
  stat_mod: { hp: -5, speed_band: +1 }
  trap: { on: damage, do: [ { effect: advance_enemy_timer, seconds: -2 } ] }   # flinches when hit

# templates.yaml — a DUNGEON-GLOBAL overlay stacked on EVERY foe (TRAPS.md §7.1)
- id: undead
  name: Undead
  stat_mod: { hp: +8, speed_band: -1 }             # tankier but slower
  trap: { on: lethal, once: true, do: [ { effect: set_hp, amount: 1 } ] }      # revenant: cheat death once

- id: swarm                # traps.yaml — shared trap palette variants/bosses draw from
  name: Swarm
  on: match
  when: { axis: number, mode: all_same, value: one }   # all_same = a dodgeable price (TRAPS.md §1)
  do: [ { effect: advance_enemy_timer, seconds: 2 } ]
- id: war_cry              # boss specialist trap (the dungeon's theme-punish; elites mirror this)
  name: War Cry
  on: match
  when: { axis: color, mode: all_same, value: red }
  do: [ { effect: enemy_attack, chance: 0.25 } ]
- id: press_the_swarm      # a TRIGGERED transmute trap (reactive herding, TRAPS.md §5.1)
  name: Press the Swarm
  on: match
  when: { axis: color, mode: all_same, value: blue }   # punish your escape color...
  do: [ { effect: transmute, count: 2,                 # ...by warping cards toward the theme
          select: { axis: color, mode: not_value, value: red },
          bias: { axis: color, value: red, intensity: 1.0 } } ]
- id: dread_drums          # boss dread / tick trap (anti-stall)
  name: Dread Drums
  on: tick
  every: 5                 # seconds
  do: [ { effect: transmute, count: 1,                 # slowly rots your board toward red
          select: { axis: shape, mode: all_same, value: defend, pick: highest_mag },
          bias: { axis: color, value: red, intensity: 1.0 } } ]
- id: molten_veins         # DAMAGE + GEOMETRIC transmute stacked in one do: (TRAPS.md §5.4)
  name: Molten Veins
  on: match
  when: { axis: color, mode: all_same, value: red }
  do:
    - { effect: damage, amount: 4 }                    # punish HP...
    - { effect: transmute,                             # ...AND warp a grid region toward red
        select: { geometry: column, which: center },   # geometry selector (5×3 grid)
        bias: { axis: color, value: red, intensity: 1.0 } }
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
  theme: { axis: color, value: red }     # the dungeon's element
  drift:                                 # global on:tick transmute → "feel" + bait (TRAPS.md §7)
    on: tick
    every: 5                             # seconds — base drift rate: 1 card / 5s
    do: [ { effect: transmute, count: 1,
            bias: { axis: color, value: red, intensity: 1.0 } } ]
  template: null           # optional DUNGEON-GLOBAL foe overlay (e.g. undead) → harder variant
  boss_mirror: war_cry     # the boss trap elites telegraph (their "@boss_mirror" slot)
  enemy_table:             # weighted creature roll (each rolls its own variant; tier from the foe)
    - { foe: goblin,      weight: 50 }
    - { foe: cave_bat,    weight: 30 }
    - { foe: goblin_shaman, weight: 20 }
  elite_pool: [goblin_brute, goblin_shaman_elite]   # drawn by the §2 elite roll, not the weight table
  boss: goblin_king
  loot_modifier: 0         # dungeon-level loot bonus
# A harder variant of the same dungeon — one global template makes every foe undead:
- id: goblin_warren_haunted
  name: The Haunted Warren
  difficulty: 3
  extends: goblin_warren   # same theme/drift/tables…
  template: undead         # …but EVERY foe gains the undead overlay (TRAPS.md §7.1)
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
  dungeon ──drift──────────────────────────────> trap (on:tick transmute) ─┐
     │    ──template──> (every foe) ──┐                                     │
     │    ──enemy_table/boss──> creature ──variants──> variant ──trap───────┤
     │    ──boss_mirror────────────> (elite "@boss_mirror" telegraph)       ┤
  loot_table <── foe.loot_tier ──┘   fielded foe = creature ⊕ variant ⊕ template ─→ TRIGGER
  class ──starting_abilities/signature──> ability ──do──────────────────────┤   (on/when/do)
  spellbook ──teaches──> ability                                            │
  item ──base_type/affix_slots──> affix ──trigger──────────────────────────┘
```
The whole content graph bottoms out in two primitives: the **trigger** (reactive)
and the **transmute verb** (active board change) — both honoring spec→spec fairness.
Note the parallel: **foe = creature ⊕ variant ⊕ template** mirrors **item = base_type ⊕
affixes** — the enemy is assembled like a piece of gear (`TRAPS.md` §7.1).

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

## 5.5 Combat resolution, the Tactics meter & the Flee retreat — *prototyped in `set-combat.html`*

The per-room combat model. Values below are **prototyped and live in
`prototype/set-combat.html`** (the basis for `set-crawl.html`); treat numbers as
tuning defaults.

**Per-card resolution.** Each card in a found set fires its own shape-action, scaled
by its number (magnitude 1–3), typed by its color:
- **Attack → damage** (rolled — `weightedRoll`, triangular, weighted high toward
  magnitude but the odd weak hit slips through; *not* pure).
- **Defend → Block** (a persistent barrier).
- **Move → tempo + Tactics** (pushes the enemy's next-attack clock later, *and*
  fuels the Tactics meter — see below; this is the resolution of the old §6
  "rework Move's core" priority).
- **Color → mana** by signature: all-same color → 3 of that mana; all-different → 1
  of each. (The speed-vs-value routing tradeoff falls out for free.)

**Resource caps (and the adaptive deal).**
- **Block ≤ max HP.** The barrier can hold up to your HP; excess is lost → generation
  steers the shape axis away from Defend (only Defend is throttled when Block is full).
- **Enemy clock ≤ 20s.** Move can't push the next attack more than 20s out — but the
  overflow seconds are **no longer wasted**: they dump into the Tactics meter (below),
  so a maxed clock keeps Move a fair, useful draw. Distinctness still caps realized
  skew (the §3-style saturation governor), so the board never goes mono.

**The Tactics meter — Move's banked outlet** (resolves the old §6 "rework Move's
core" TOP PRIORITY). Move was the weak, fiddly verb (Defend and Move were both
"don't-die" tools, and tempo couldn't reach the clock cap). Move is now a
**board-control engine** instead of a second defensive tool:
- Every **Move match** rolls (triangular on its magnitude) into a **Tactics meter →
  10**, *on top of* still pushing the clock. Any clock-overflow seconds (Move into an
  already-maxed clock) dump on top — so feeding Moves into a capped clock builds
  Tactics fast. The once-wasted overcap is now the *point*.
- **Full meter → ARMS** a row of one-shot **Tactic** buttons and then **drains**
  `TACTICS_DRAIN`/sec (use-it-or-lose-it). The armed Tactics are universal board
  transmutes: **Strike** (→ heavy Attacks), **Dodge** (→ heavy Defends), **Heat Up /
  Chill Out / Go Wild** (→ red / blue / green flood), and **Flee** (the retreat —
  see below). Firing any Tactic empties the meter.
- **Tactics' lane — resolved: keep the overlap.** The armed transmutes deliberately
  echo class floods (Strike ≈ Berserk, Heat Up ≈ Call Flames). In play this is a
  *feature*: it lets any class run a control loop — **Call Flames + Strike** ping-pongs
  the board between lots-of-red and lots-of-Attacks; **Glaciate + Chill Out** plays
  extremely control-heavy on Cryomancer. More board-shaping options is good, especially
  now that enemy transmutes create constant back-and-forth over the board. (Generic
  board tools — shuffle/peek/floor-boost/lock — remain available as *additional*
  Tactics later, not a replacement.)
- Prototyped constants: `TACTICS_GOAL=10`, `TACTICS_DRAIN=1`/sec, `CLOCK_CAP=20s`.

**Flee — the retreat mechanic** (resolves the §6 loss-condition retreat path). The
old standalone Flee *meter* (toggle Fleeing mode, farm Moves to 10, decay + lockout)
is **superseded**: Flee is now simply **one of the armed Tactics**. Fill the Tactics
meter, then spend it on **Flee** to retreat to town (sandbox: a flee-success end
screen). Confirm-gated, since it forfeits the encounter. Build-expressiveness is
preserved — Move-trigger classes (Rogue's Move→Attack passive) fill Tactics fast and
choose between offense (Strike) and escape (Flee) with the same resource.

---

## 6. Open questions

- ~~⭐ **rework Move's core**~~ — **RESOLVED: the Tactics meter (§5.5).** Move now
  banks into a use-it-or-lose-it Tactics meter that arms one-shot board transmutes —
  a board-control engine, distinct from Defend's "don't-die" role. (Close to the old
  option (a) banked-tempo, but generalized to a meta-resource rather than a green
  utility pool.) Tactics' overlap with class floods is **kept** (a control-loop
  feature, §5.5). The Move *affixes* (§7 Windstep / Stalker's) now re-anchor on
  **Tactics** ("a fraction of Move tempo → Block", "+dmg scaled by banked Tactics")
  instead of the unreachable clock cap.
- **⭐ NEXT — build the enemy-trap half of the trigger bus** (`TRAPS.md`). Combat is
  still solitaire against a metronome; the design thesis (read the board *against the
  enemy's traps*, `GAME-DESIGN.md` §0) is unbuilt. Minimal first build: generalize the
  passive bus to fire enemy `traps[]`, render traps as visible tags, ship ~3 traps
  spanning the consequence types (reflect, enemy-transmute, heal/armor). Test: *does a
  visible trap change which sets you hunt?*
- **Loss condition** — death = permadeath/run-over? The *retreat* path is now defined
  (the Flee mechanic, §5.5); still open is the **penalty** for fleeing and what death
  itself costs (roguelike vs. roguelite framing).
- ~~**Boss room**~~ — **resolved: the boss *replaces* the enemy that room would have
  generated** (its own fresh encounter), not an appended extra room (§2).
- ~~**Resource mapping** for shape & number axes~~ — **working resolution: single
  spendable economy.** color→mana is the only banked resource (universal, valence-themed
  — §4); shape stays immediate (per-card damage/Block/tempo), number stays a scalar.
  Revisit only if martial builds feel resource-thin in play.
- ~~**Trap condition default**~~ — **resolved in `TRAPS.md` §1–§2:** `all_same` for
  punishing traps (rare, dodgeable, a *price*); `contains` reserved for *reward*
  triggers. Full trap vocabulary, the severity∝rarity law, consequence families, the
  counter-foe recipe, and the four board verbs (destroy / transmute / **lock** / —)
  all live in `TRAPS.md`.
- **Ability slots vs. known abilities** — do you *learn* a growing library but only
  *equip* slot-many? (Implies a loadout screen in town.)
- **Cooldowns vs. resource-only** gating for actives.
- **Level/XP curve, HP curve, gold economy balance.**
- ~~**Mana persistence**~~ — **resolved: HP is the only cross-room persistence
  layer.** On entering each room, **everything except HP resets** — mana, Tactics, and
  any active DoTs/dread all clear to zero; HP carries over (the run's attrition clock).
  Caster builds rebuild their pool every encounter (bounds snowballing), dread is
  strictly per-room pressure, and each room is a clean tactical reset on top of a
  persistent health total. The reset is **archetype-symmetric** — casters lose mana,
  tanks lose Block, Move-builds lose Tactics — so no archetype is singled out by it.
- ~~**Trap resolution order**~~ — **resolved: dungeon drift first, then the foe's
  traps in listed order.** A match (or tick) resolves the dungeon-global trap first,
  then each foe trap top-to-bottom as authored on the foe — so trap order on the foe is
  a deliberate design lever (e.g. transmute-then-punish vs. punish-then-transmute).
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

### Move affixes (on Boots-trinkets, etc.) — re-anchored on Tactics (§5.5)
The two liked Feet mechanics survive as affixes. They originally hinged on the enemy
clock reaching its **cap — which the playtest showed is nearly unreachable** — but the
Move-core rework (Tactics meter, §5.5) gives them a reachable anchor: the overcap
seconds now feed Tactics, and Move banks into the meter. Re-anchored:
- **Windstep** — a *fraction* of every Move's tempo grants Block (not just the
  old unreachable overcap).
- **Stalker's** — a combo trigger ("first Attack after a Move match") or "+dmg scaled
  by banked **Tactics**."

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
