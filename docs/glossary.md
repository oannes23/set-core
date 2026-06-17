# Glossary

The vocabulary of SET.crawl, grouped by layer. Mechanical constants live in `TUNING.md`; this is the
*what-does-this-word-mean* reference.

## The Set core (the board)

- **Set** — the card game the minigame is built on. Cards are points in finite affine geometry
  **AG(f, 3)**: each of `f` features takes one of 3 values. Three cards form a *set* iff, on every
  feature, the values are all-same or all-different (equivalently, sum to 0 mod 3).
- **Feature / axis** — a card dimension. The live game uses three active axes: **color**, **shape**,
  **number** (a 4th is pinned to a constant internally so it never affects set validity).
- **f** — the number of *active* features (difficulty spine in the core; the live game locks f=3).
- **third card** — any two cards determine the unique third that completes their set:
  `third(a,b)_i = (-(a_i + b_i)) mod 3`.
- **board** — the live grid of cards (the game locks a **5×3 / N=15** board).
- **FLOOR** — the invariant minimum number of completable sets always present (never a dead board).
- **makeable-set floor** — the same floor, but counting only sets completable from **unlocked**
  cards (locked cards still form sets "on paper" but not in reach).

## Tokens (the YAML vocabulary)

- **axis** — `color` · `shape` · `number`.
- **color** — `red` (Fire) · `green` (Nature) · `blue` (Frost).
- **shape** — `attack` · `defend` · `move`.
- **number** — `one` · `two` · `three`.
- **mode** — how a condition tests an axis across the matched set: `all_same` · `all_different` ·
  `contains` (a value is present) · `not_value` (a value is absent).
- **value token** — a member of the axis's set above (e.g. axis `color` → `red`/`green`/`blue`).

## The threat layer (traps & tricks)

- **trigger** — one reactive mechanism: a *condition* → a list of *effects*. The umbrella term.
- **trap** — a **hostile** trigger (avoid it; ⚠ yellow). The default `kind`.
- **trick** — a **favorable** trigger (aim for it; ✦ green). Same mechanism, opposite valence.
- **drift** — an ambient, `quiet` trigger that fires on a cadence (`on: tick`) without a "sprung"
  flourish — the dungeon's background hazard.
- **condition (`when`)** — an axis-correlated test (`{axis, mode, value?}`) or a compound `{all:[…]}`.
- **effect** — one board/combat consequence: `damage`, `transmute`, `lock`, `instant_attack`,
  `advance_timer`, `delay_attack`, `enemy_heal`, `drain_tactics`, `drain_mana`.
- **selector (`select`)** — which board cards an effect targets: a geometry (row/column/corners/…)
  and/or a value filter.
- **bias** — the value an effect's transmute steers a card toward (`{axis, value, intensity?}`).
- **the board verbs** — destroy, **transmute** (morph a card's values toward a bias), **lock** (a
  card forms sets on paper but is out of reach), and conditions.
- **selection-protected turnover** — no turnover may target a currently-**selected** card or a
  **set-mate** of one (your pattern-finding beats your click speed). Holding a partial selection
  shields those cards.

## Foes

- **creature** — the base foe (a statline + HP + optional signature traps/variants).
- **variant** — a roll-on modifier (one of a creature's `variants`): a stat delta + an inline trap
  (e.g. *Bloodthirsty*).
- **template** — a dungeon-wide overlay applied atop every foe (e.g. *undead*): a stat delta + a trap.
- **foe assembly** — creature ⊕ variant ⊕ (elite mirror) ⊕ template, merged at encounter time.
- **tier** — `minion` · `elite` · `boss`; an output/budget multiplier (×1 / ×1.5 / ×2 stat,
  ×1 / ×2 / ×4 XP).
- **tempo** — how a foe's Speed−Power packages into `strikeEvery` (rounds between strikes) × `swings`.
- **statline (P/E/S)** — Power / Endurance / Speed; both combatants carry it (Resolution v2/v3).

## Combat (Rounds v3)

- **round** — the 20-second pacing unit; verbs accumulate, then exchange at the rollover.
- **Tactics wheel** — **Stand Ground** (bank charges, ward incoming) vs **Maneuver** (live-burn
  charges to churn the board toward a bias).
- **charge** — the Tactics resource (cap 15); a wound haymaker or a board dump.
- **wound** — computed HP-bucket damage that shatters cards; repaired by heals.
- **telegraph** — the previewed incoming strike, revealed early and held until the strike round.
- **dodge** — a per-swing evasion roll (your Speed vs theirs).
- **crit** — the shared "exchange-delight" upward roll on a swing (5% base + gear; player-only).

## Gear & affixes

- **base type** — a gear template for a slot (axe, plate, ring…): a per-rarity **rider**, a small
  **native stat**, a school, and (weapons) a **match-type**.
- **slot** — `weapon` · `armor` · `relic` · `trinket1` · `trinket2` (trinkets share).
- **rider** — a per-card combat bonus: `atkDamagePerCard` · `blockPerDefendCard` · `manaPerMatch`.
- **native stat** — a base type's small flat P/E/S contribution (spreads a full kit across stats).
- **match-type** — the Attack-set colour a weapon's rider is scoped to (`red`/`green`/`blue`/`rainbow`).
- **rarity** — `grey` < `white` < `green` < `blue` < `purple` < `orange`; an **inverse budget**
  (fewer affixes hit harder) + a rider multiplier.
- **affix** — a labelled bundle of components (stat / rider / mod / proc) rolled onto gear.
- **affix component** — the realized mechanic: `{c:'stat'|'rider'|'mod'|'proc'|…}`.
- **make (the magnitude DSL)** — an affix's declarative recipe (what component, scaled how) realized
  at a magnitude unit. See [yaml-catalogs](yaml-catalogs.md#affixes).
- **proc** — an affix effect that fires on a match (`when`) or a player event (`event`: wound / kill
  / lowHP).
- **GearMods** — gear-exclusive scalars: `dodge` · `penetration` · `soak` · `lifesteal` ·
  `critChance` · `critMult`.
- **loot-tier** — the magnitude input to an affix roll (foe level-equivalent + depth).

## Economy & progression

- **gold** — the weightless currency (separate from item Storage slots).
- **GOLD_K** — the single faucet constant: `gold ≈ foeValue × GOLD_K × depth`.
- **value / sell / buy** — an item's gold worth; sell-back = `value × sellRate`; shop buy =
  `value × markup`.
- **the smith** — the crafting bench: upgrade rarity / enchant / reroll / transfer (a gold sink).
- **Merchant House** — gold-bought account tracks: **standing** (lowers buy markup) + **quality**
  (raises town-vendor rarity band).
- **Vault** — the account-level item Storage (gold-expandable cap).
- **death tithe** — the fraction of banked gold a run-ending death costs.
- **XP curve** — `need(L→L+1) = base · L^exponent`, rounded; the climb to the level cap (★).
- **slot unlocks** — the levels at which extra active/passive ability slots open.

## Delve (the run)

- **delve** — one dungeon run: a chain of rooms toward the boss.
- **boss triangular law** — the inverse-CDF boss schedule: `cum(n) = n(n+1)/2 %` vs one draw.
- **elite sawtooth** — elite chance = `eliteStep × rooms-since-last-elite` (resets on an elite/flee).
- **dread meter** — the boss-proximity surfaced as thematic bands (quiet → drums → … → throne).
- **satchel** — the run's consumable inventory (the run bag, capped).
