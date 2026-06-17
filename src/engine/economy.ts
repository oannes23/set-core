/* engine/economy — the single ECONOMY CONFIG, loaded from content/economy.yaml (MODDING.md Phase 1).
   One home for every gold knob that used to be scattered across value.ts / smith.ts / ui/bank.ts:
   valuation ladders + markups, the Merchant-House tracks, smith prices, storage caps, the death tithe,
   the starter stash. FIRST-CUT numbers, sim-gated together (the faucet/sink pass once the shop sink +
   GOLD_K settle) — the shape is settled; the values are balance/content, so they live in YAML.

   Pure: just imports the YAML object + the type. value.ts / smith.ts / bank.ts read ECON and re-export
   their existing named constants from it, so no downstream consumer changed. */

import type { Rarity } from './items'
import econData from '../data/content/economy.yaml'

export interface EconomyConfig {
  sellRate: number // sell-back = this × value
  buyMarkup: number // base shop buy = this × value (Merchant House pulls it toward 1.0)
  rareMarkup: number // the rare vendor's premium × value
  gear: { base: Record<Rarity, number>; tierK: number; affixK: number } // valuation: rarity ladder + lifts
  consumable: { potionBase: number; scrollBase: number }
  merchant: { markups: number[]; tierCost: number[] } // standing track: buy markup per tier + gold to reach it
  quality: { tierCost: number[]; lvlPerTier: number } // town-loot-quality track: gold per tier + vendor-level boost
  smith: { upgradeBase: number; enchantBase: number; rerollBase: number; transferBase: number }
  storage: { defaultCap: number; slotStep: number; slotMax: number }
  deathTithe: number // a run-ending death costs this fraction of BANKED gold
  starterStash: string[] // consumable refIds seeded into a fresh account
}
export type EconomyFile = EconomyConfig

export const ECON = econData as EconomyConfig
