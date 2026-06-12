# CRAWL-DESIGN.md — SET.crawl

> The first iteration toward the **real game**: a data-driven dungeon crawler on
> the SET skill engine. **Status: in build, on `src/`.** Combat, the threat layer,
> **Tactics v2** (§5.5), and **Phase B1** (scene shell + town/run-map screens +
> persisted progression) are shipped in the modular TS client; the **run loop**
> (§2, exit ladder §6) is the next build — see `TODO.md`. Builds on
> `GAME-DESIGN.md` (trigger bus, transmute verb, locked f=3/N=15) and `PROJECT.md`
> (generation math). This doc owns the crawl-specific run loop, the data
> architecture, and the visual reskin.

**Lineage:** `set.core` (skill core + tuning console) → `set.combat` (combat
sandbox) → **`set.crawl`** (the dungeon-crawler game). ~~set.crawl starts as a copy
of `prototype/set-combat.html`, palette-swapped first, then grown into the loop
below.~~ *(Superseded by `TODO.md` §A: the crawl is built on the modular `src/`
client, not the archived HTML; the typed TS data module (`src/data`) is the
YAML-portable equivalent of the loader sketched below.)* We keep the validated
generation core untouched.

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
  number). *(As shipped in `src/ui`: a simpler two-band version — **low ≤70% ·
  crit ≤35%** — driving the HP-bar glow + playfield vignette; the 4-band
  blue/green/yellow/red gem spec and corner-gem placement remain a future polish
  option, prototyped in the archived `set-combat.html`.)*

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
  the loot table. Lose → the **exit ladder** (settled — §6): flee falls back to the
  between-rooms fork at a price; death ends the run and costs the carried loot + a tithe.
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

  **Mechanism (SETTLED 2026-06-09)** — the table above is the *distribution itself*,
  not a per-room reroll spec (naive readings get it wrong: rolling the +n% increment
  each room yields only ~67% by room 14 with no guarantee; rolling the cumulative each
  room front-loads it to a ~room-6 median). Implement by **inverse-CDF draw**: at run
  start, draw one `R ∈ [0, 100)` from the run seed; the boss appears at the first room
  where `cumulative(n) > R`. Exact (P(boss at room n) = n% for rooms 1–13, the
  remaining 9% at 14; mean ≈ 9.5, median 10, rooms 8–12 hold half the mass),
  deterministic per seed (daily/shareable runs), and one line of code. Corollaries:
  - **Room index n counts encounters *entered*, cleared or fled** — fleeing
    (exit ladder, §6) still advances the boss total, so flee-farming the minion
    tier always walks toward the throne room.
  - **The throne room, once found, stays found.** Fleeing the boss pays the parting
    blow and returns to the fork, but pressing on always faces the boss again — no
    minion rooms remain behind him. The boss's appearance is the run's point of no
    return for farming (finish him or cash out).
  - **The dread meter (between-rooms UI, Phase B2):** the running total is surfaced
    as **thematic bands** (≈4–5 steps: "the warren is quiet" → "drums echo" →
    "the throne stirs" → "he is near"), monotone and honest against the true
    cumulative — fiction on the surface, the exact curve underneath.

- **Elite chance per room** — checked *only if the boss didn't trigger this room*, and
  **recurring** (the elite tier is met repeatedly). Chance = **10% × (rooms since the
  last elite)**; the counter **resets to 0 when an elite is fought**, so it climbs
  10% → 20% → 30% … then drops back to 10%. Mean gap ~3–4 rooms → usually **2–3 elites
  before the boss** (with rare swingy runs — a room-2 boss is possible). 10% is the
  tuning dial.

- **Town** between dungeons: **sell** gear/spellbooks, **buy** from shop loot-table
  inventory (gear, consumables, spellbooks). Healing/restock happens here.

### Scenes & persistence (the hub)
The game is **two top-level scenes**, not one screen: the **Hub** (town/menu) and the
**Combat** playfield. They're separate scenes with a clean transition between them.
- **Hub** = the default place you sit *between* matches: **character create / select**,
  **dungeon select**, **loadout** (equip gear / abilities / consumables), the **shop**
  (buy/sell), and the jump into a run. It is today's start screen *grown up* — the
  class+dungeon picker in `src/ui/app.ts` is the seed of it.
- **Combat** = the SET playfield (one room/encounter). A run is a chain of Combat scenes;
  on run end (win → Town, or flee/death) you return to the Hub.
- **Persistence** is tied to the Hub: a saved **character** (class, level/XP, ability
  loadout, inventory/gear/consumables, gold) plus run state. **Start minimal — the chosen
  character + HP — and grow** into inventory/progression. `localStorage` first; the
  `session.ts` seam keeps a *run* replayable, while the character save is the *meta* layer
  on top. (Equipment, consumables, and loot all depend on this layer existing.)

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

~~Everything content-side is **declarative YAML, ingested at load**.~~ *(As built:
content lives in a **typed TS module** — `src/data/game-data.ts` against
`src/data/schema.ts` — that keeps a **YAML-portable contract**: plain-data
objects, no functions, swappable for a YAML loader later without engine change.
The declarative principle holds; the file format changed.)* This keeps
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

> **⚠ Caution — do not author from these sketches.** They are illustrative
> design-capture only. The **real trigger vocabulary** is `src/data/schema.ts`
> (e.g. `On = 'match' | 'tick'`, different effect names) and the real content is
> `src/data/game-data.ts`. Several event names and effects below
> (`damage_enemy`, `grant_resource`, `on: lethal`, `room_clear`, …) never shipped
> in this form.

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

**Consumables — the low-friction first loot type.** The player carries **~3 consumable
slots**; consumables are **common drops** (gear/spellbooks are the rarer rolls). Two families,
most of which **reuse engine ops we already have** — that's what makes them cheap to ship:
- **Potions** = instant or over-time board/engine effects:
  insta-heal (`healPlayer`), insta-block (`gainBlock`), insta-tempo / "Move" (`pushClock` +
  Tactics), a **regen-bias refill** (`transmute` a slice with a `bias`), and **gradual
  regeneration** (a *player-side heal-over-time*). All map to existing ops **except** the HoT,
  which is the one genuinely-new bit — a small player-side `condition` tick (the conditions
  framework already exists for enemies in `TRAPS.md`; this is the friendly mirror). Other
  board/engine modifiers slot in here later.
- **Scrolls** = any class **ability** baked into a single use — reuse the `ABILITIES` roster
  (a scroll just `castAbility(id)` once, no mana cost). Trivial to author: **every ability is
  already a scroll**, so the scroll pool comes free with the ability list.
A consumable is used via a new **"use consumable"** combat action (one of the slots), dispatched
like any other action so it stays replay-deterministic.

### Consumables & player buffs (shipped — `src/engine/consumables.ts`)

The system above is built. A consumable is a registry entry with a pure
`use(state, rng, sink)` effect, spent via the replay-deterministic
`useConsumable` action. The shipped roster (~30 potions + a scroll per ability):

- **Tiered staples** (Minor / standard / Major): Healing (10/20/30 HP),
  Stoneskin (10/20/30 Block), Speed (stall the enemy 10/20/30s, bypassing the
  Move clock cap), per-color Mana (5/10/15), Rainbow Mana (2/4/6 of each).
- **Special potions:** **Invisibility** (fill the Tactics charges + freeze the
  enemy until your next Set) and **Strength** (triple your next attacking Set's
  damage).
- **Elemental cascade triad** (region-flood + payoff per matching card, 50% to
  repeat): **Fire Breathing** (flood the least-red row, damage), **Regeneration**
  (green the 2 least-green columns, heal), **Mind Reading** (blue the 3 deadest
  cards, Block).
- **Utility potions:** **Hourglass Draught** (reset the enemy clock to a full
  interval + suppress drift/DoT ticks 6s), **Prismatic Vial** (paint the rows
  red/green/blue, +1 mana per card painted), **Saboteur's Phial** (destroy the 3
  lightest cards — they reform fresh).
- **Scrolls:** every ability in the `ABILITIES` roster is automatically a
  one-shot, free-cast scroll (`scroll_<id>`) — the scroll pool comes free.

The transient **buff flags** these set live on `CombatState`
(`src/engine/state.ts`): `attackFrozen` (Invisibility — enemy clock paused until
the next Set), `nextSetDamageMult` (Strength — multiplier on the next attacking
Set), `tickSuppressedUntil` (Hourglass — `on:tick` effects paused until then).

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

## 5. Build sequence *(superseded — see `TODO.md`)*

*(This pre-migration sequence assumed growing the single-file prototype. The
actual build runs on the modular `src/` client: the trigger bus, transmute verb,
and typed data schemas are long shipped; Phase B1 (scenes + persistence) is done;
the live phase plan lives in `TODO.md`. Kept for history:)*

1. ~~Copy `set-combat.html` → `set-crawl.html`; **palette-swap only** (§1).~~
2. ~~Stand up the **YAML loader** + the entity schemas (§4)~~ — shipped as the
   typed TS data module (`src/data`).
3. ~~Implement the **trigger bus** and **transmute verb** against the data.~~ — shipped.
4. Wrap a single **room/encounter** in the run loop (enemy stats, attack timer,
   loot roll). ← *the current frontier*
5. Add **dungeon flow** (room chain, boss-chance, loot scaling), then **town**
   (buy/sell — B1 shell shipped), then **progression** (XP/levels/slots).
6. Author content; tune.

---

## 5.5 Combat resolution, Tactics (v2) & the Flee retreat — *shipped in `src/`*

The per-room combat model. ~~Values below are prototyped and live in
`prototype/set-combat.html`.~~ *(Now shipped in the modular client —
`src/engine/resolve.ts`, `tactics.ts`; live constants in `TUNING.md`.)* Treat
numbers as tuning defaults.

> ⚠ **SUPERSEDED IN PART by ROUNDS v3 (§5.6, settled 2026-06-11, next combat build):**
> the continuous clock (approach→windup→strike), the swap-spin-up rule, excess-timer
> income, Adaptive Tactics, `DMG_REGEN_MS`, and the speed bands all restructure under
> the round grammar. This section remains the SHIPPED baseline until v3 lands.

**Per-card resolution — RESOLUTION v2, "sets steer, stats carry" (SETTLED & BUILT
2026-06-10; Model B from the pacing design session).** The character sheet carries the
numbers; a matched set CHOOSES and AIMS the action. Each card in a found set fires its
shape's STAT, scaled by the card's magnitude read as QUALITY:
- **Stat block: Power / Endurance / Speed** (`StatBlock`; base 2/2/2 = exact parity
  with the old card-magnitude system; gear/levels grow them — the B3 power curve).
- **Quality:** ① glancing ×0.7 · ② solid ×1.0 · ③ heavy ×1.4 — per card:
  `value = round(stat × quality)`. At base stats per-card values are 1/2/3.
- **Attack → round(Power × q) damage** — DETERMINISTIC now (no roll): a set always
  delivers exactly what it reads; the deliberate-grind direction. (`weightedRoll`
  remains for enemy strikes and ability rolls.)
- **Defend → round(Endurance × q) Block** (a persistent barrier).
- **Move → round(Speed × q) clock-push seconds** + 1 Tactics charge per Move card.
- **Color → mana** by signature: all-same color → 3 of that mana; all-different → 1
  of each. Mana stays pure board economy (no stat touches it — caster identity).
- *Why:* decouples output from scan speed (a slow player executes the same build at
  lower tempo — speed buys tempo, not existence), makes gear/levels load-bearing,
  softens the death spiral. Decided WITH the commercial-positioning lens (deliberate
  strategic grind > perception-gated twitch for the Steam roguelite market).

**The telegraphed exchange (the clock rework, same session).** The steady invisible
cadence is replaced by a readable exchange loop: **approach → windup → strike.**
- **Approach:** the clock runs as before; Move pushes work (capped, overflow→charges).
- **Windup** (the last `windup` seconds — default 4, per-foe authored: Behemoth 8,
  King 6, Butcher 6): the strike is **pre-rolled and REVEALED** (`incoming`, the ⚔N
  telegraph in the HUD) and the clock is **COMMITTED** — Move pushes apply 0 and
  convert fully to charges. Counterplay: raise Block to meet the known number, ward
  the shatter, or kill first. Nothing dodges a committed strike.
- **Strike:** lands EXACTLY the telegraphed amount, then the next approach begins.
  Un-telegraphed hits (`instant_attack` trap effects) still roll fresh — traps stay
  surprising; the clock stays honest.
- Speed bands slowed + damage raised across the roster (fewer, weightier, readable
  exchanges — see TUNING.md): lumbering 24 / slow 19 / steady 15 / swift 12 / frenzied 9.

**Resource caps (and the adaptive deal).**
- **Block ≤ max HP.** The barrier can hold up to your HP (block never exceeds the cap) →
  generation steers the shape axis away from Defend when Block is full. The excess isn't
  fully wasted: **overcap block converts to Tactics charges** (see v2 below), and the
  **Sentinel** passive *also* spills the full overflow into a weighted attack — both stack.
- **Enemy clock ≤ 20s.** Move can't push the next attack more than 20s out — but the
  overflow seconds are **no longer wasted**: they convert to Tactics charges (below),
  so a maxed clock keeps Move a fair, useful draw. Distinctness still caps realized
  skew (the §3-style saturation governor), so the board never goes mono.
- **Mana ≤ 15 per color** (NEW with Tactics v2; gear may raise it later). Storing and
  chaining 2–3 big casts stays a valid strategy; gains past the cap are a **pure loss**
  (deliberately: no excess-mana income — see v2 income rules). Excess healing at full
  HP is likewise pure loss.

**TACTICS v2 — charges & the two tactics** (settled 2026-06-09/10; supersedes the v1
armed meter, kept below for history). Tactics is the **board-control discipline**: a
**charge queue** fed by play, spent by whichever **tactic** you've selected. This is
the player-side mirror of dungeon drift — a literal tug-of-war over the board's
composition — and it makes TRAPS §5.5's reshape-share *directly playable*.

- **Income (charges):**
  - **+1 charge per Move CARD in a matched set** — a shape-rainbow set always contains
    exactly one Move (steady trickle for every archetype); an all-Move set pays 3.
    Magnitude stays tempo-only (boots push the clock; charges count cards, flat).
  - **+ excess timer:** clock-push seconds wasted against the 20s cap convert ~1:1.
  - **+ excess block:** block past max HP converts (default 1 charge per 2 excess).
  - **Nothing else.** No excess-mana or excess-healing income (pure loss, see caps).
- **The queue:** charges queue up to a **cap of 5** (overflow wasted) and spend
  **serially, one at a time** (~0.8s between spends, tunable) — never a batch flash;
  the eye can follow every change. Deadest-card evaluation re-runs after each spend.
  Deterministic: spends resolve on reducer ticks (replay-safe).
- **The two tactics** (pick ONE; its sub-UI shows its parameter):
  - **⚔ Maneuver** *(active shaping)* — each charge transmutes the **deadest**
    non-conforming card toward your chosen **bias** (sub-UI: axis/value picker —
    any color, shape, or magnitude; uses the standard `patchFavor` weights, so the
    §3 saturation governor still applies).
  - **🛡 Stand Ground** *(passive integrity)* — charges **bank** (same cap of 5);
    each hostile **board verb** that fires — dungeon drift tick, enemy transmute,
    lock, wound-shatter — consumes one banked charge and **fizzles**. Never absorbs
    raw damage (that's Block's lane); dread ticks still hurt, the board just holds
    its shape. Sub-UI: the banked pips.
  - **Swapping tactics RESETS your charges to 0** and takes a few seconds (~3s
    spin-up, tunable) before accumulation resumes. Picking your tactic is a
    commitment — that's what makes greed-vs-integrity a real decision.
- **Remaps from v1:** Vigilance-style `drain_tactics` effects drain queued/banked
  charges; the Invisibility potion's "fill the meter + pause drain" becomes "fill
  the queue (+5 charges), enemy frozen until your next match"; the Warlord's
  Tactician passive is replaced by **Adaptive Tactics** (your charges PERSIST through
  a tactic swap, no spin-up — the stance-dancer); the tutorial's Tactics stage
  teaches Maneuver. §7's Move affixes re-anchor on charge income / queue cap.
- **Tactics' lane vs class floods — still resolved: keep the overlap, re-shaped.**
  Maneuver is the slow, free, full-board **tide**; Call-type abilities are instant,
  regional, mana-priced **waves** (see the Calls tiering in §3-adjacent ability
  notes / TODO). Drip vs splash, same ocean — running both is the control loop.
- ⚠ Watch in tuning: Maneuver(green) smooths sustain loops, and a pinned clock
  (Chronomancer) is the premier excess-timer engine — the **structural anti-stall**
  (FABLE §8.1) ships with/before this system.

*v1 (superseded, for history):* Move matches rolled into a 0–10 meter that ARMED six
one-shot board-flood buttons (Attack/Defend/Move/Heat Up/Chill Out/Go Wild), draining
0.5/sec once armed (use-it-or-lose-it). Constants were `TACTICS_GOAL=10`,
`TACTICS_DRAIN=0.5`/sec. The meter's overlap-with-floods doctrine carries forward;
the use-it-or-lose-it pressure is replaced by the swap-commitment rule.

**ABILITY TRANSLATION to v2 + the Calls tiering** (the batch's authoring map; names
and costs are placeholders the designer will rename — mechanics are the spec).

Audit result: of the 23 shipped abilities, **only Rally touches the meter** — every
other ability is built on clock-pushes, transmutes, and damage, all of which survive
v2 untouched. So the table is mostly KEEP:

| Disposition | Abilities |
|---|---|
| **KEEP unchanged** | firebolt, frostbolt, heal, block, fireball, glaciate, wildgrowth, callflames, callfrost, callwilds, cleave, berserk, rampage, bulwark, quickstrike, smokebomb, thornwall, venomstrike, thornvines, coldblade, riposte, timewarp |
| **RE-ANCHOR** | **rally** — "bank 4 Tactics" is meaningless in v2. New form (per design direction — a deadest targeter): *Rally — the 3 deadest cards answer the call: under **Maneuver** they churn toward your chosen bias now; under **Stand Ground** they dig in as heavy Defends.* Same cost slot; the tactic-aware dual mode makes it the Warlord's signature bridge into the new system. |
| **RE-ANCHOR (consumable)** | **Invisibility** — "fill the meter + pause drain" → "fill the queue (+5 charges); enemy frozen until your next match". |
| **RE-ANCHOR (passive)** | **Tactician** → **Adaptive Tactics** (charges persist through tactic swaps, no spin-up). |
| **NOTE (tuning watch)** | The stall kit — timewarp / glaciate / frostbolt / smokebomb / thornvines — now *generates income* via excess timer. Intended (Move-flavored classes run charge-rich) but these numbers get a look in the tuning pass. |

**Tier 1 — the generic Calls (shared, board-wide, the teaching versions).** The three
color Calls (shipped) + three NEW shape Calls, costs mirrored at 8 total mana,
weighted toward the shape's kin color (Attack↔red, Defend↔green, Move↔blue):
- **Call to Arms** `[4,2,2]` — every non-Attack card → max-magnitude Attack (the burst enabler).
- **Call the Shields** `[2,4,2]` — every non-Defend card → max-magnitude Defend.
- **Call the Hunt** `[2,2,4]` — every non-Move card → Move. ⚠ The hot one: a Move
  flood feeds the charge queue — watch its cost/queue-cap interaction first.

**Tier 2 — class-signature geometric Calls (the boss-pick / spellbook content, B4).**
Same verb, smaller region, sharper identity, cheaper — the geometry selector
vocabulary (row/column/border/inner/diagonal/corners — already engine-built, today
enemy-only) handed to players. Power ≈ region size ≈ cost; the saturation governor
already polices all of them. One seed sketch per class (names/costs placeholder):
- Pyromancer — **Wall of Flame**: the center *column* → red.
- Cryomancer — **Glacial Front**: the *border* → blue.
- Druid — **Overgrowth**: the *inner* region → green, light magnitudes.
- Spellblade — **Cross-Cut**: a *diagonal* → Attack, small damage per card converted.
- Chronomancer — **Stasis Rank**: the top *row* → blue/Move.
- Berserker — **Hone**: the bottom *row*'s magnitudes → 3s (heavy everything).
- Sentinel — **Shield Wall**: the *border* → Defend.
- Warlord — **Battle Line**: the bottom *row* → Attack.
- Rogue — **Ambush**: the four *corners* → Move.
The relationship to Maneuver is deliberate: Maneuver is the slow free full-board
*tide*; Calls are instant regional mana-priced *waves*. Drip vs splash, same ocean.

**Flee — the retreat mechanic** (resolves the §6 loss-condition retreat path). The
old standalone Flee *meter* (toggle Fleeing mode, farm Moves to 10, decay + lockout)
is **superseded**. **Built:** Flee is a **standalone, any-time button** (top-right of the
foe header) — *not* gated by the Tactics meter, so retreat is always available; confirm-gated
since it forfeits the encounter (sandbox: a flee-success end screen). It was briefly an armed
Tactic during the feel pass, then pulled out so escape never depends on first banking Tactics.
The retreat *penalty* is **settled (2026-06-09)** — see **§6 "Loss condition / the exit
ladder"**: a parting blow + the room's reward forfeited, falling back to the between-rooms
fork (run continues; encounter rerolled, elite counter reset) rather than ending the run.

---

## 5.6 ROUNDS v3 — the 20-second round grammar (SETTLED 2026-06-11; next combat build)

The temporal grammar that supersedes §5.5's continuous clock (approach→windup→strike).
Grew out of the Move/Defend-distinctness thread (TODO, 2026-06-10/11): the draw-phase idea,
generalized — **all three verbs round-batch**. The axiom: **round length is THE pacing
constant** — every other combat time number denominates in rounds, not seconds. Planned
constants staged in `TUNING.md` ("Rounds v3 — PLANNED"); code remains v2 until this builds.

**The round (20s, tunable).** Matches accumulate by shape verb; nothing cashes until the
exchange. Stats still carry (Model B per-card math, §5.5):
- **Attack matches** → the player's exchange swing (per card `round(Power × q)`, summed).
- **Defend matches** → mitigation of THIS round's telegraphed hit (per card
  `round(Endurance × q)`). Overflow past the telegraph trickles to charges (1:2, the
  v2 excess-block rule, re-denominated). The round is one continuous allocation
  question: kill faster vs blunt the known hit.
- **Move matches** → Tactics charges (+1 per Move card; the stance economy below).
- **Round reset:** Attack/Defend accumulators and the Maneuver bank zero at the
  exchange; mana, the Stand Ground bank, and HP carry. Each round is a fresh question.
- ⚠ OPEN (numbers workshop): **Speed's new job.** v2 gave Move `round(Speed × q)`
  clock-push seconds; the clock is gone. Natural rebase: Speed scales charge income
  (Power→damage, Endurance→block, Speed→agency) — but the small-integer charge economy
  (cap 5) must rescale to absorb it. Decide in the derivation-sheet pass.

**Live mid-round** (the real-time half of the grammar):
- **Mana + spells** — instant, outside round ordering; the panic-button slot Move used
  to own. Anything dropping the foe to 0 HP ends the battle on the spot.
- **Traps / tricks** — fire on matches via the trigger bus, as today.
- **Dungeon drift** — ambient pressure, unchanged.
- **Stand Ground wards** — intercept live (the wall stands all round).
- **Board refill** — instant and **NEUTRAL** (mid-round regen drops the player-bias
  tilt; `BIAS_W` expresses ONLY through the Maneuver rollover dump). The round
  *degrades* — you cherry-pick the juice, drift drags, traps scar — the deal *redeems*.

**The rollover** (≤ ~2.5s, diegetic, choreographed — **never a modal, no button, ever**):
1. **Player swing** — the Attack total lands. **Lethal cancels the enemy swing** (the
   kill-race: rushing lethal under a big telegraph is valid play, rewarded via passives/
   gear). Symmetric: a player who would die but banked lethal wins the exchange.
2. **Enemy swing** — telegraph minus the Defend total; damage *suffered* computes wounds.
3. **Maneuver dump** — all charges burn (stance economy below).
4. **The deal** — gaps fill, one wound reforms, churned cards settle.
5. **Next telegraph reveals + the queued stance locks.** The breath; next round's plan forms.

**Foe speed = round BEHAVIOR, not round length.** The speed bands (24…9s) retire. Every
foe gives the same 20s of scan; quickness becomes exchange cadence: a frenzied foe swings
every round, maybe as ⚔4×2; a lumbering one every other round, huge — "— (winding up:
⚔18 next round)". The telegraph is part of the deal, so Defend allocation is a decision,
never a guess. This is the structural fix for the quick-foe sweet spot: scan pressure was
the problem, and it's gone.

**The stance economy — banker vs dumper.** Charges accumulate in EVERY stance (income
above). The stances differ in their relationship to the bank AND in resolution timing:
- **🛡 Stand Ground** (wheel center) — **spends live**: each hostile board verb that
  fires (drift tick, enemy transmute, lock) fizzles for **1 charge**; each incoming
  **wound** fizzles for **3 charges**. **Carries its remainder across the rollover.**
  No rollover effect — stuck with whatever luck draws out and what your own spells and
  consumables trigger.
- **⚔ Maneuver** (the six spokes) — **never wards**; drift runs unopposed. At rollover
  it **burns ALL charges**: N charges redraw the **N deadest cards NOT already matching
  the bias**, each redrawn to the bias value on that axis (other axes random). Biasing
  Blue on a Red-heavy board converts dead Reds/Greens to Blue — undeadening the existing
  Blues fast. The bank zeroes.
- **Charge cap 15** (raised from v2's 5 — settled 2026-06-11). The number is exact on
  both ends: a full bank soaks a maximum 5-wound haymaker (5 × 3 = 15) precisely, and a
  full Maneuver dump rerolls the ENTIRE 15-card board toward your bias precisely. Cap =
  board size = max exchange ward cost — one number, three readings. Filling it is a
  multi-round arc (income runs a few charges per round), so the full-bank play is an
  earned spike, not per-round routine. **Defend allocation remains the PRIMARY wound
  prevention** (wounds key to damage *suffered*, so turtling cuts them at the source);
  SG's wound-ward is the deep reserve you build toward. If the dump holds more charges
  than non-matching cards exist, the excess burns unused (the board is already yours —
  the bank still zeroes, per the rule).
- **The stance locks at the draw phase** (the wheel mid-round queues NEXT round's pick).
  Load-bearing, not flavor: free swapping enables the obvious cheese — Stand Ground all
  round, flip to Maneuver at second 19, dump, collect both benefits. The lock kills it.
  It also enables the legitimate cross-round line: turtle two rounds banking behind
  wards, then flip and dump a full-bank tide. *Supersedes the swap-spin-up rule entirely.*

**The Tactics wheel (the widget).** One control, seven states, one tap:
- **Center: Stand Ground** — a braced stick-figure icon, classic bracing-for-battle.
- **Top arc (shape biases):** Attack · Defend (top-middle) · Move — "steer what I can DO."
- **Bottom arc (color biases):** Red · Blue (bottom-middle) · Green — "steer what I can CAST."
- Selecting a spoke = selecting Maneuver with that bias (the v2 verb-then-parameter
  two-step collapses into one gesture). Lit spoke = the locked current stance; ghost
  spoke = queued for the deal.
- **Magnitude bias is CUT — deliberately**, not by wheel geometry: heavy boards come
  only from gear/Hone (B3). `grasping`/`covetous` now tax drift-luck and gear greed only.

**Wounds — computed, never authored.** Both laws derive from one quantum, `maxHP/10`
(the decimal rebase — HP 100, stats 10 — lands WITH v3 so the laws read clean):
- **Inflict:** `wounds = floor(damageSuffered / (maxHP/10))`, summed **per exchange**
  (a frenzied ⚔4×2 wounds off the 8 total, never two floored swings), **cap 5 per
  exchange**. Chip hits (<10%) never scar; a 50% haymaker = 5 wounds — if you saw the
  telegraph and didn't turtle, that's the lesson.
- **Repair:** any heal also repairs `ceil(heal / (maxHP/10))` wounds. Floor-on-damage /
  ceil-on-heal is deliberately player-generous; both sides are one law, so tightening
  is a constant change, never a data audit.
- **Recovery:** one wound reforms per draw phase; ALL reform at combat end.
  (`DMG_REGEN_MS` retires — another seconds-constant rebased to rounds.)
- ⚠ Invariant: wounds (≤5) + locks combined must still leave ≥ FLOOR makeable sets —
  assert the worst case in the headless sim; a combined concurrent cap may need a number.
- **Coach hook:** a player under a match-count threshold who takes ≥4 wounds in one
  exchange gets a cooldowned reminder (every X occurrences) to Stand Ground / turtle
  when big damage is telegraphed. Rides the explain-mid-play tutorial variant (TODO).

**Ability/passive remaps (the v3 translation):**
- **Adaptive Tactics → "Combined Arms"** (Warlord; total rewrite — swap-spin-up is dead):
  **+1 bonus charge on any shape-rainbow set**. A rainbow carries exactly one Move card,
  so it nets 2 charges vs all-Move's 3 — but delivered Attack+Defend value in the same
  match: the flexible-commander identity, rebuilt on income.
- **Rally / Vigilance / Invisibility** survive re-denominated (they drain/fill the same bank).
- ⚠ OPEN: the **clock-push verbs** (timewarp, glaciate, frostbolt, smokebomb, thornvines —
  the stall kit) lose their target with the clock. Candidates: shave the telegraph
  (⚔N−X — time magic slows the blow), delay/skip a foe's exchange round, or convert to
  charges. Settle in the v3 translation pass. Chronomancer's excess-timer-engine note
  (§5.5 ⚠) dies with the income rule.

**The feel target (user, 2026-06-11 — keep verbatim):** "you play the round in a quick
frantic pace making matches, resisting the drift, using spells. You probably bias toward
the high cards, and they run dry as you match and you hunt for best options as quick as
you can, and it drifts, and by round end the board is a little weak and gross. That's
when your tactics come in, and suddenly draw reset, you go from the held breath
inhalation of the action to the sighing exhaling relief as your tactics trigger and the
board redraws fresh with possibility. Or you resolutely stand your ground the entire
time, reducing the churn in your foe's favor but being stuck with whatever luck draws
out and what you can trigger with your own spells and consumables."

**Numbers sanity (fourth-playtest anchored):** sets/min ran 12–17 → roughly 4–6 sets per
20s round, comfortably over the workshop's ≥3 decisions-per-exchange floor. The dev
instruments grow a **sets/round** readout; re-read reshape share and spring rate after v3
lands (the rollover dump changes who moves the board, and when).

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
- ~~**⭐ NEXT — build the enemy-trap half of the trigger bus**~~ — **DONE** (`src/engine`,
  `TRAPS.md`). Enemy traps/tricks fire on the bus, render as the trap strip (with an
  "armed" pulse when a springing line is on the board), and the four board verbs
  (destroy / transmute / lock / conditions) are live. Combat now reads the board *against*
  the enemy's traps — the design thesis (`GAME-DESIGN.md` §0) is built. The **NEXT** build
  is the crawl shell around combat (run loop / second screens — see `TODO.md`).
- ~~**Loss condition**~~ — **RESOLVED (2026-06-09): the exit ladder.** A run's four
  exits are strictly ordered — each rung clearly worse than the one above, so "one
  room deeper?" is always a live gamble:
  1. **Cash out (between rooms only).** After clearing a room you may leave with
     everything — run inventory and gold carried this run bank, XP banks. **Delving
     commits you to room 1**: there is no free back-out once you enter (this is what
     structurally kills the scout-and-reroll loop, so honest play needs no penalty).
  2. **Flee (mid-fight) — the run does NOT end.** You take a **parting blow** (the
     foe's pending attack resolves as you turn your back; clamped so flee can never
     kill — min 1 HP), you **forfeit the room's reward**, and you fall back to the
     between-rooms fork: the next room's encounter is **rerolled** and the **elite
     sawtooth counter resets to base**. From the fork: press on or cash out home.
     *Intended play:* a timid player can duck an elite and farm minions for early
     gold/XP — paying HP per duck, since the parting blow scales with the foe.
  3. **Death.** The run inventory and all gold carried this run are **lost**, plus a
     **tithe: a % of banked gold** (a recovery fee; % is a tuning number). **XP always
     banks, even on death** — the struggling player still inches forward. Equipped
     gear and the hero survive. True permadeath is deferred to a future *opt-in*
     hardcore flag (the roster already supports it cheaply).
  - Corollaries: **gold found mid-run is carried, not banked** — it banks on any exit
    except death (this rule is most of the dread-meter's teeth). **Town Rest stays
    free, permanently** — gold's sinks live elsewhere (base-building amenities, shop
    gear, consumables, learning abilities; see §6 economy note). **A fled room DOES
    advance the boss running-total** (settled — boss % keys to encounters *entered*,
    §2), and the boss, once appeared, persists through flees (§2). Still open: the
    tithe % (a tuning number).
  - ⚠ Interaction flag: free Rest + flee-farming + in-combat sustain builds
    (Druid/Sentinel healing loops) = unbounded minion farming with no attrition. This
    raises the priority of a **structural anti-stall** (universal soft-enrage /
    per-room time pressure — `FABLE.md` §8.1) from "balance concern" to "B2 companion."
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
