# YAML reference — content registry

The `GAMEDATA` registry: the foes, the threat layer, and the dungeons. Seven files under
`src/data/content/`, assembled + link-checked by `src/data/registry.ts`. Types: `src/data/schema.ts`.

All cross-references are by **string id**. `?` marks an optional field.

---

## The trigger vocabulary (shared)

Traps, tricks, drifts, and the inline triggers on variants/templates are all built from the same
pieces. Learn these once; they recur everywhere.

### Condition (`when`)

What the matched set must look like for the trigger to fire. Omit `when` → fires on every match
(`on: match`) or every tick (`on: tick`).

```yaml
when: { axis: color, mode: all_same, value: red }   # an all-red set
when: { all: [ { axis: shape, mode: all_same, value: move }, { axis: number, mode: all_same, value: one } ] }  # AND
```

| Field | Values | Notes |
|---|---|---|
| `axis` | `color` · `shape` · `number` | which dimension is tested |
| `mode` | `all_same` · `all_different` · `contains` · `not_value` | the test |
| `value?` | the axis's tokens (color→`red`/`green`/`blue`; shape→`attack`/`defend`/`move`; number→`one`/`two`/`three`) | required by `contains`/`not_value`/value-specific `all_same` |
| `all` | a list of the above | compound AND (use *instead of* axis/mode/value) |

### Effect (`do: [...]`)

A trigger's `do` is a list of effects, run in order. One flat shape; each effect reads the fields it
needs.

| `effect` | Fields used | Meaning |
|---|---|---|
| `damage` | `amount`, `chance?`, `scale?` | direct damage to the player |
| `instant_attack` | `chance?` | the foe strikes at once |
| `advance_timer` | `seconds`, `scale?` | shove the round clock forward |
| `delay_attack` | `seconds` | push the foe's next strike later (favorable) |
| `enemy_heal` | `amount` | the foe heals |
| `drain_tactics` | `amount` | drain the player's charges |
| `drain_mana` | `amount`, `color?` | drain mana (of `color`, or spread) |
| `transmute` | `select`, `bias?`, `count?`, `gap?` | morph targeted card(s) toward `bias` |
| `lock` | `select`, `count?`, `seconds?` | lock targeted card(s) out of reach |

Common modifiers: `chance?` (0–1 probability gate) · `scale?: set_mag` (severity scales with the
springing set's total magnitude: `max(1, total − 4)`).

### Selector (`select`)

Which board cards an effect targets — a spatial region and/or a value filter.

| Field | Values | Notes |
|---|---|---|
| `geometry?` | `row` · `column` · `diagonal` · `corners` · `border` · `center` · `inner` · `half` · `random` | the region |
| `which?` | `top` · `bottom` · `left` · `right` · `center` · `anti` | disambiguates a geometry (e.g. `half: bottom`, `diagonal: anti`) |
| `index?` | number | explicit row/column index |
| `count?` | number | cap how many cards (for `random` / value filters) |
| `axis?`, `mode?`, `value?` | as in a Condition | a value filter (target only cards matching) |
| `pick?` | `highest_mag` | prefer the highest-magnitude candidate |

> Note: `blast` / `cross` / `plus` were **removed** from the geometry vocabulary (they had no
> implementation — they silently selected nothing). Re-add only alongside a real selector + tests.

### Bias

The value a `transmute` steers a card toward.

```yaml
bias: { axis: color, value: red, intensity: 1 }
```

| Field | Values |
|---|---|
| `axis` | `color` · `shape` · `number` |
| `value` | the axis's token |
| `intensity?` | number (strength of the pull) |

---

## creatures.yaml — `Record<id, Creature>`

The base foes. Stats are authored directly (the data rebase); XP is computed from the statline
(except teaching-foe overrides).

| Field | Type | Notes |
|---|---|---|
| `name` | string | display name |
| `tier` | `minion` · `elite` · `boss` | output/budget/XP multiplier |
| `stats` | `{ power, endurance, speed }` | the contest statline (authored on the parity line) |
| `hp` | number | max HP for the encounter (the kill-budget lever; ~60/110/200) |
| `tempo?` | `{ strikeEvery, swings }` | override the Speed−Power packaging (else derived) |
| `desc?` | string | flavor |
| `voice?` | `{ hit?: string[], heal?: string[], zero?: string }` | combat-log verbs (in-character) |
| `traps?` | string[] | signature trap ids (→ `traps.yaml`) |
| `variants?` | string[] | variant ids to roll one from (→ `variants.yaml`) |
| `rules?` | `{ immune_card_damage?, ability_damage?: 'mana_spent' }` | special combat rules |
| `loot_tier` | number | the loot table band |
| `xp?` | number | **teaching foes only** — overrides computed XP (dummy/gauntlet onboarding) |

## variants.yaml / templates.yaml — `Record<id, Variant|Template>`

A roll-on (variant) or dungeon-wide (template) modifier: a stat delta + an inline trap.

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `icon?` | string | emoji |
| `desc?` | string | |
| `stat_mod?` | `{ power?, endurance?, speed?, hp? }` | deltas added to the base statline |
| `trap` | InlineTrap | `{ on, when?, every?, quiet?, do }` (a trigger with no name/icon of its own) |

## traps.yaml / drifts.yaml — `Record<id, Trap>`

Named triggers. `traps.yaml` holds match/condition traps & tricks; `drifts.yaml` holds the ambient
tick drifts. Same shape.

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `icon?` | string | |
| `kind?` | `trap` · `trick` | valence (default `trap`); a trick is favorable |
| `on` | `match` · `tick` | when it's evaluated |
| `when?` | Condition | the gate (see above) |
| `every?` | number | `on: tick` cadence in seconds |
| `quiet?` | boolean | ambient (drift) — fires without a sprung-trap flourish |
| `desc?` | string | |
| `do` | Effect[] | the consequences (see above) |

## dungeons.yaml — `Record<id, Dungeon>`

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `difficulty` | number | |
| `coach?` | boolean | arm the new-player affordance layer |
| `guided?` | boolean | launch the staged guided intro on Engage |
| `theme?` | `{ axis, value }` or `null` | the dungeon's colour/shape lean |
| `drift?` | id or `null` | the ambient drift (→ `drifts.yaml`) |
| `boss_mirror?` | id or `null` | a lesser-echo trap every **elite** carries (→ `traps.yaml`) |
| `default_foe?` | id | creature pre-selected in the picker |
| `sequence?` | string[] | creature ids fought in a row (gauntlet) |
| `enemy_table` | `[{ foe, weight }]` | the weighted minion table (`foe` → `creatures.yaml`) |
| `elite_pool` | string[] | elite creature ids |
| `boss?` | id or `null` | the boss creature id |
| `template?` | id or `null` | dungeon-wide overlay (→ `templates.yaml`) |
| `extends?` | id | authoring note: the dungeon this derives from |

## encounter.yaml — `Encounter`

The "Custom (sliders)" sandbox fallback foe's kit.

| Field | Type | Notes |
|---|---|---|
| `traps` | string[] | trap ids |
| `drift` | id | a drift id |
