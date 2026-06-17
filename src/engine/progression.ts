/* engine/progression — the PROGRESSION CONFIG, loaded from content/progression.yaml (MODDING.md
   Phase 2). The level cap, HP-per-level, the XP-curve coefficients (the 110·L^1.7 polynomial as
   {base, exponent, roundTo}), the ability/passive slot-unlock ladders + caps, and the per-character
   starter consumables. Sim-derived (CRAWL §3 / TUNING.md) — shape settled, values are balance.

   Pure config loader (mirrors engine/economy.ts). ui/save.ts reads PROG and re-exports its existing
   named constants + the xpForLevel formula from it, so no downstream consumer changed. The player's
   base max-HP stays a combat constant (DEFAULT_PLAYER_MAX) — only the per-level growth lives here. */

import progData from '../data/content/progression.yaml'

export interface ProgressionConfig {
  levelCap: number // numeric to cap−1; cap renders as ★
  hpPerLevel: number // +maxHP per level
  xp: { base: number; exponent: number; roundTo: number } // xpForLevel = round(base·L^exp / roundTo)·roundTo
  activeUnlocks: number[] // levels the 3rd…Nth active ability slots open (1st+2nd are class starters)
  passiveUnlocks: number[] // levels the 2nd/3rd passive slots open (1st is the signature)
  activeSlotCap: number
  passiveSlotCap: number
  consumableSlots: number // the delve loadout consumable slots
  starterConsumables: string[] // per-character opener (consumable refIds)
}
export type ProgressionFile = ProgressionConfig

export const PROG = progData as ProgressionConfig
