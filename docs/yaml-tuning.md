# YAML reference — tuning

The balance dials: loot, economy, progression, delve. These are **first-cut, sim-gated** numbers
(the shape is settled; the values await the coupled balance sim — `TUNING.md`). Editing them is the
fastest path to retuning the game. Each file is loaded by an engine module that re-exports the named
constants, so nothing downstream changes when you edit the YAML.

---

## loot.yaml — `LootConfig` (loaded by `engine/loot.ts`)

The loot roll: category-first per-tier tables, then sub-rolls. The rollers stay in code; these are
their inputs.

| Field | Type | Meaning |
|---|---|---|
| `goldK` | number | the faucet: `gold ≈ foeValue × goldK × depth` |
| `goldVar` | number | ± fraction per gold roll |
| `depthRate` | number | per-room lift to gold + loot quality |
| `depthTierRate` | number | how much depth lifts a drop's loot-tier: `tier = foeLevelEquiv + round(depth × depthTierRate)` |
| `gearPityStep` | number | gear-less drop adds this to the gear weight; a gear hit resets it |
| `marketPerSlot` | number | town Market: pieces stocked per slot group |
| `rarePerTab` | number | Merchant-House rare vendor: pieces stocked |
| `tables` | `Record<tier, LootTable>` | per-tier drop tables (see below) |
| `rarityBands` | `[{ maxLevel, weights: [rarity, weight][] }]` | gear-rarity drop weights, banded by char/dungeon level (drops climb white→orange as you level; first band whose `maxLevel ≥ level` wins) |
| `rareWeights` | `[rarity, weight][]` | rare vendor (epic/legendary only) |
| `marqueeWeights` | `[rarity, weight][]` | boss-clear guaranteed rare+ piece |
| `marketGroups` | `[{ label, slot }]` | slot groups the Market stocks |

**LootTable** (per tier `minion`/`elite`/`boss`):

| Field | Type | Meaning |
|---|---|---|
| `drops` | `[min, max]` | item/gold drops rolled from the categories |
| `guaranteedGold` | number | a gold wage on top (× one standard roll); 0 = none |
| `qualityAdvantage` | boolean | consumable tier rolled twice, keep the better (elite/boss) |
| `weights` | `{ gold, consumable, gear, spellbook }` | category weights (disabled categories redistribute) |

```yaml
tables:
  minion: { drops: [1, 1], guaranteedGold: 0, qualityAdvantage: false, weights: { gold: 60, consumable: 30, gear: 10, spellbook: 0 } }
rarityBands:
  - { maxLevel: 5, weights: [[white, 65], [green, 28], [blue, 7]] }                # ≤5: mostly white
  - { maxLevel: 99, weights: [[green, 15], [blue, 50], [purple, 28], [orange, 7]] } # 19+: mostly blue+
```

---

## economy.yaml — `EconomyConfig` (loaded by `engine/economy.ts`)

Every gold knob in one place — valuation, markups, the Merchant-House tracks, smith prices, the
vault, the tithe, the starter stash. Consumed by `value.ts` / `smith.ts` / `ui/bank.ts`.

| Field | Type | Meaning |
|---|---|---|
| `sellRate` | number | sell-back = `value × sellRate` |
| `buyMarkup` | number | base shop buy = `value × buyMarkup` |
| `rareMarkup` | number | the rare vendor's premium × value |
| `gear` | `{ base: Record<rarity, number>, tierK, affixK }` | gear valuation: rarity ladder + lifts (`+tierK`/loot-tier, `+affixK`/affix) |
| `consumable` | `{ potionBase, scrollBase }` | consumable base values (× a tier multiplier read off the id suffix) |
| `merchant` | `{ markups: number[], tierCost: number[] }` | standing track: buy markup per tier + gold to reach it |
| `quality` | `{ tierCost: number[], lvlPerTier }` | town-loot-quality track: gold per tier + vendor-level boost |
| `smith` | `{ upgradeBase, enchantBase, rerollBase, transferBase }` | bench prices (× the rarity-index curve in `smithCost`) |
| `storage` | `{ defaultCap, slotStep, slotMax }` | vault size + the `(cap + slotStep)²` expansion curve |
| `deathTithe` | number | fraction of banked gold lost on a run-ending death |
| `starterStash` | string[] | consumable refIds seeded once per account |

```yaml
gear:
  base: { grey: 8, white: 20, green: 50, blue: 120, purple: 300, orange: 700 }
  tierK: 0.03
  affixK: 0.15
merchant:
  markups: [1.5, 1.4, 1.3, 1.2, 1.1, 1.0]
  tierCost: [0, 1500, 3500, 6500, 11000, 18000]
```

---

## progression.yaml — `ProgressionConfig` (loaded by `engine/progression.ts`)

Levels, the XP curve, and ability-slot unlocks. Consumed by `ui/save.ts`.

| Field | Type | Meaning |
|---|---|---|
| `levelCap` | number | the cap (numeric to cap−1; cap renders as ★) |
| `hpPerLevel` | number | +maxHP per level |
| `xp` | `{ base, exponent, roundTo }` | `xpForLevel(L) = round(base · L^exponent / roundTo) · roundTo` |
| `activeUnlocks` | number[] | levels the 3rd…Nth active ability slots open (1st+2nd are starters) |
| `passiveUnlocks` | number[] | levels the 2nd/3rd passive slots open (1st is the signature) |
| `activeSlotCap` | number | max active ability slots |
| `passiveSlotCap` | number | max passive slots |
| `consumableSlots` | number | the delve loadout consumable slots |
| `starterConsumables` | string[] | per-character opener (consumable refIds) |

```yaml
levelCap: 21
hpPerLevel: 5
xp: { base: 110, exponent: 1.7, roundTo: 5 }
activeUnlocks: [3, 6, 10, 14]
passiveUnlocks: [8, 16]
```

> The player's **base** max-HP (`DEFAULT_PLAYER_MAX`, 100) is a combat constant in `engine/state.ts`,
> not here — only the per-level *growth* is configurable.

---

## delve.yaml — `DelveConfig` (loaded by `engine/delve.ts`)

The encounter-schema dials. The boss **triangular law** itself (`cum(n) = n(n+1)/2`, capped 100)
stays in code (`bossCumulative`); these are its surfacing + the elite/satchel dials.

| Field | Type | Meaning |
|---|---|---|
| `eliteStep` | number | elite chance = `eliteStep × rooms-since-last-elite` (resets on elite/flee) |
| `runBagCap` | number | the run's consumable satchel cap |
| `throneLabel` | string | dread label once the boss room is found (step 4) |
| `dreadBands` | `[{ atLeast, step, label }]` | high→low cumulative-boss-% bands surfaced as dread |

```yaml
eliteStep: 0.1
runBagCap: 10
throneLabel: the throne room lies before you
dreadBands:
  - { atLeast: 80, step: 3, label: he is near }
  - { atLeast: 45, step: 2, label: the throne stirs }
  - { atLeast: 15, step: 1, label: drums echo in the deep }
  - { atLeast: 0, step: 0, label: the halls are quiet }
```
