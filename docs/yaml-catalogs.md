# YAML reference — catalogs

The discrete content catalogs: the playable classes, the gear base types, and the affix pool. Files
under `src/data/content/`. Types: `src/data/schema.ts` (classes), `src/data/gear.ts` (gear),
`src/data/affixes.ts` (affixes).

---

## classes.yaml — `ClassDef[]` (a list)

The playable roster. Pure references: each class names ability/passive ids resolved against the
engine registries (`ABILITIES` / `PASSIVES` in `src/engine`). Adding/renaming abilities is *engine*
work; a class just composes existing ids. The link-check rejects unknown ids; an integrity test also
requires every class to spend all three mana colours.

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable key (used by saves + the picker) |
| `name` | string | display name |
| `icon` | string | emoji |
| `blurb` | string | one-line pitch |
| `abilities` | string[] (exactly 3) | active ability ids (→ engine `ABILITIES`) |
| `passives` | string[] (≥1) | passive ids (→ engine `PASSIVES`) |
| `stats?` | `{ power, endurance, speed }` | optional class statline (omitted → base 2/2/2) |

```yaml
- id: pyromancer
  name: Pyromancer
  icon: 🔥
  blurb: Flood the board with fire and burn through anything.
  abilities: [firebolt, fireball, callflames]
  passives: [flameshield]
```

---

## gear.yaml — `Record<id, GearBaseType>`

A base type defines a slot's identity. The per-rarity **rider** + **native stat** apply in combat;
affixes roll on top.

| Field | Type | Notes |
|---|---|---|
| `id` | string | must equal the map key |
| `name` | string | |
| `icon` | string | emoji |
| `slot` | `weapon` · `armor` · `relic` · `trinket1` · `trinket2` | trinkets share both slots |
| `school?` | `martial` · `caster` | weapons/caster-armor have one; relics/trinkets are agnostic |
| `rider?` | `{ atkDamagePerCard?, blockPerDefendCard?, manaPerMatch? }` | per-card combat bonus (× `RARITY.riderMult`) |
| `nativeStat?` | `{ stat, amount }` | small flat P/E/S (`stat`: `power`/`endurance`/`speed`) |
| `matchType?` | `red` · `green` · `blue` · `rainbow` | the Attack-set colour the weapon rider is scoped to |

```yaml
axe:
  id: axe
  name: Axe
  icon: 🪓
  slot: weapon
  school: martial
  rider: { atkDamagePerCard: 1 }
  nativeStat: { stat: power, amount: 1 }
  matchType: red
```

---

## affixes.yaml — `AffixDef[]` (a list)

The themed affix pool the loot roller + the smith's Enchant draw from. Each affix carries a `sys`
key (the dev/label key), a thematic `name`, gating, and a `make` recipe.

| Field | Type | Notes |
|---|---|---|
| `sys` | string | system key (= the instance label; unique) |
| `name` | string | thematic name (normal play); must differ from `sys` |
| `family` | `stat` · `rider` · `proc` · `crit` · `reactive` · `utility` · `unique` | grouping |
| `slots` | EquipSlot[] or `any` | slot-gating |
| `minRarity` | `grey`…`orange` | the lowest rarity it can roll at |
| `weight` | number | roll weight within the eligible pool |
| `live` | boolean | `true` = functions today; `false` = STAGED (catalogued, never rolled) |
| `note` | string | the mechanic in words (tooltip + ledger) |
| `make?` | AffixSpec | **live only** — the declarative recipe (the magnitude DSL below) |

### The magnitude DSL (`make`)

`make` replaced the old build-closures: it says *what component to produce and how its magnitude
scales*. The roller computes a **magnitude unit** `m` from rarity + loot-tier, then the interpreter
(`buildAffixComponents`) realizes the spec at `m`. Two magnitude ops:

- **integer** — `scaled(m, k) = max(1, round(m · k))` (`k` defaults to 1). Used by stat/rider/integer-mod and damage/heal/block/mana procs.
- **fraction** — `min(cap, perUnit · m)`. Used by the fractional mods (dodge/lifesteal/crit).

| `c` (component) | Fields | Produces |
|---|---|---|
| `stat` | `stat` (`power`/`endurance`/`speed`), `k?` | a flat ±stat of `scaled(m,k)` |
| `rider` | `rider` (`atkDamagePerCard`/`blockPerDefendCard`/`manaPerMatch`), `k?` | a per-card rider of `scaled(m,k)` |
| `mod` (integer) | `mod` (`penetration`/`soak`), `k?` | a flat gear mod of `scaled(m,k)` |
| `mod` (fraction) | `mod` (`dodge`/`lifesteal`/`critChance`/`critMult`), `perUnit`, `cap` | a fractional gear mod of `min(cap, perUnit·m)` |
| `proc` | `when?` / `event?`, `effect`, `label` | a proc (on-match via `when`, or reactive via `event`: `wound`/`kill`/`lowHP`) |

A proc's `effect` is a **ProcSpec**:

| `kind` | Fields | Magnitude |
|---|---|---|
| `damage` / `heal` / `block` | `k?` | `scaled(m, k)` |
| `mana` | `k?`, `color?` | `scaled(m, k)`; `color` omitted → the matched mono colour |
| `charges` | `amount` | literal |
| `delay` | `seconds` | literal |

The proc `label`'s `{a}` placeholder is filled with the computed amount.

```yaml
# integer stat, k=2  → amount = max(1, round(2·m))
- { sys: FlatPower, name: Mighty, family: stat, slots: any, minRarity: white, weight: 10, live: true,
    note: '+Power (raw stat)', make: { c: stat, stat: power, k: 2 } }

# fractional mod → amount = min(0.2, 0.03·m)
- { sys: DodgeChance, name: Evasive, family: utility, slots: [armor, trinket1], minRarity: blue,
    weight: 3, live: true, note: '+dodge chance', make: { c: mod, mod: dodge, perUnit: 0.03, cap: 0.2 } }

# on-match proc → damage scaled(m,1), label '⚔+{a}'
- { sys: OnMatchBonusDamage, name: Savage, family: proc, slots: [weapon, relic], minRarity: blue,
    weight: 4, live: true, note: 'all-Attack match → bonus damage',
    make: { c: proc, when: { axis: shape, mode: all_same, value: attack }, effect: { kind: damage }, label: '⚔+{a}' } }

# reactive proc, literal → charges 1 on a wound
- { sys: OnWoundWard, name: "Guardian's", family: reactive, slots: [armor, relic], minRarity: purple,
    weight: 2, live: true, note: 'on a wound → bank a Stand-Ground charge',
    make: { c: proc, event: wound, effect: { kind: charges, amount: 1 }, label: '🛡+1' } }
```

Rarity controls the **inverse budget** (`RARITY` in `src/engine/items.ts`): higher rarity = more
affix slots but a lower per-affix power, and a higher rider multiplier. That table is engine-side
(not YAML) because it's structural, not content.
