import { test, expect } from 'vitest'
import type { CombatEvent } from '../engine/events'
import {
  offenseRecap, defenseRecap, woundTail, knitLine, guardDropLine, lockLine, churnLine, dreadLine,
} from './combat-log'

type SwingMath = Extract<CombatEvent, { type: 'swingMath' }>
type BlockMath = Extract<CombatEvent, { type: 'blockMath' }>
const sm = (o: Partial<SwingMath>): SwingMath => ({ type: 'swingMath', matches: 0, weapon: 0, attacks: 0, crit: false, mult: 1, total: 0, ...o })
const bm = (o: Partial<BlockMath>): BlockMath => ({ type: 'blockMath', block: 0, blkRider: 0, defends: 0, telegraph: 0, soaked: 0, bite: 0, dodgedAll: false, dodged: 0, ...o })

test('offenseRecap: lone match with no gear/crit adds nothing past the headline', () => {
  expect(offenseRecap(sm({ matches: 18, weapon: 0, crit: false }))).toBe('')
})

test('offenseRecap: gear rider and crit split out', () => {
  expect(offenseRecap(sm({ matches: 15, weapon: 7, crit: true, mult: 1.5 }))).toBe('15 match · +7 gear · ✦crit ×1.5')
})

test('offenseRecap: gear without crit, crit without gear', () => {
  expect(offenseRecap(sm({ matches: 15, weapon: 7 }))).toBe('15 match · +7 gear')
  expect(offenseRecap(sm({ matches: 12, crit: true, mult: 2 }))).toBe('12 match · ✦crit ×2.0')
})

test('offenseRecap: undefined → empty', () => {
  expect(offenseRecap(undefined)).toBe('')
})

test('defenseRecap: full breakdown ordered telegraph→slip→soak→guard', () => {
  expect(defenseRecap(bm({ telegraph: 21, dodged: 1, soaked: 2, block: 6 }))).toBe('telegraph 21 · slip 1 · soak −2 · guard −6')
})

test('defenseRecap: optional terms drop out', () => {
  expect(defenseRecap(bm({ telegraph: 14 }))).toBe('telegraph 14')
  expect(defenseRecap(bm({ telegraph: 14, block: 6 }))).toBe('telegraph 14 · guard −6')
})

test('defenseRecap: undefined (unguardable bleed) → empty', () => {
  expect(defenseRecap(undefined)).toBe('')
})

test('woundTail: pluralization and zero', () => {
  expect(woundTail(0)).toBe('')
  expect(woundTail(1)).toBe('1 wound')
  expect(woundTail(3)).toBe('3 wounds')
})

test('knitLine: one vs many', () => {
  expect(knitLine(1)).toBe('A wound knits — 1 card mends.')
  expect(knitLine(2)).toBe('Wounds knit — 2 cards mend.')
})

test('guardDropLine: names the unspent amount', () => {
  expect(guardDropLine(8)).toBe("Your guard drops — 8 Defend unspent, it doesn't carry.")
})

test('lockLine: singular/plural agreement', () => {
  expect(lockLine(1, 4)).toBe('1 card locks (4s).')
  expect(lockLine(2, 4)).toBe('2 cards lock (4s).')
})

test('churnLine: per-source wording', () => {
  expect(churnLine('drift', 3)).toBe('The board drifts — 3 cards reshape.')
  expect(churnLine('trap', 2)).toBe('A trap twists 2 cards.')
  expect(churnLine('trick', 1)).toBe('A turn of fortune reshapes 1 card.')
})

test('dreadLine: silent below the onset', () => {
  expect(dreadLine(0, { level: 6.5, foeMult: 1, playerMult: 1 }, 7)).toBeNull()
})

test('dreadLine: fires on first crossing of the onset', () => {
  expect(dreadLine(0, { level: 7, foeMult: 1.13, playerMult: 1.07 }, 7)).toBe('Dread rises (7) — their blows ×1.1, yours ×1.1.')
})

test('dreadLine: only re-announces on a new integer step', () => {
  expect(dreadLine(7, { level: 7.5, foeMult: 1.33, playerMult: 1.17 }, 7)).toBeNull()
  expect(dreadLine(7, { level: 8, foeMult: 1.33, playerMult: 1.17 }, 7)).toBe('Dread rises (8) — their blows ×1.3, yours ×1.2.')
})
