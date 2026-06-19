import { test, expect } from 'vitest'
import { skipAction, rollClicks } from './splash'

const RAPID = 3

test('skipAction: a click during the intro starts the first panel', () => {
  expect(skipAction(-1, false, 2, 1, RAPID)).toBe('start')
})

test('skipAction: a click mid-panel completes it (keeps its wait)', () => {
  expect(skipAction(0, false, 2, 1, RAPID)).toBe('complete')
})

test('skipAction: a click while a non-last panel waits advances to the next', () => {
  expect(skipAction(0, true, 2, 1, RAPID)).toBe('advance')
})

test('skipAction: a click while the LAST panel waits releases', () => {
  expect(skipAction(2, true, 2, 1, RAPID)).toBe('finish')
})

test('skipAction: 3 rapid clicks flush from any state', () => {
  expect(skipAction(0, false, 2, 3, RAPID)).toBe('flush')
  expect(skipAction(1, true, 2, 4, RAPID)).toBe('flush')
  expect(skipAction(-1, false, 2, 3, RAPID)).toBe('flush')
})

test('skipAction: two clicks (under the threshold) do NOT flush', () => {
  expect(skipAction(0, false, 2, 2, RAPID)).toBe('complete')
})

test('rollClicks: drops clicks outside the window, keeps recent + the new one', () => {
  expect(rollClicks([0, 100], 1000, 600)).toEqual([1000]) // 0 and 100 are >600ms old
  expect(rollClicks([700, 900], 1000, 600)).toEqual([700, 900, 1000]) // both within 600ms
})

test('rollClicks: three quick clicks reach the flush threshold', () => {
  let buf: number[] = []
  buf = rollClicks(buf, 0, 600)
  buf = rollClicks(buf, 200, 600)
  buf = rollClicks(buf, 400, 600)
  expect(buf.length).toBe(3) // 0, 200, 400 all within 600ms → flush
})
