import { test, expect } from 'vitest'
import { type Card } from './affine'
import { type Board, findSets, countSets, kOfSet, boardKInfo } from './sets'

test('findSets finds the line and only the line', () => {
  const A: Card = [0, 0, 0, 0]
  const B: Card = [1, 1, 1, 1]
  const C: Card = [2, 2, 2, 2] // A,B,C: every axis sums to 3 → a set
  const D: Card = [0, 1, 2, 0] // filler that completes nothing here
  const board: Board = [A, B, C, D]
  expect(findSets(board)).toEqual([[0, 1, 2]])
  expect(countSets(board)).toBe(1)
})

test('empty slots are skipped', () => {
  const A: Card = [0, 0, 0, 0]
  const B: Card = [1, 1, 1, 1]
  expect(countSets([A, null, B, null])).toBe(0)
})

test('kOfSet counts all-different active axes', () => {
  const A: Card = [0, 0, 0, 0]
  const B: Card = [1, 1, 1, 1]
  const C: Card = [2, 2, 2, 2]
  expect(kOfSet([A, B, C], [0, 1, 2, 3])).toBe(4) // all four axes differ
  expect(kOfSet([A, B, C], [0, 1, 3])).toBe(3) // axis 2 dropped
  const P: Card = [0, 0, 0, 0]
  const Q: Card = [0, 0, 0, 1]
  const R: Card = [0, 0, 0, 2] // only the number axis differs
  expect(kOfSet([P, Q, R], [0, 1, 2, 3])).toBe(1)
})

test('boardKInfo reports easiest-k and the histogram', () => {
  const A: Card = [0, 0, 0, 0]
  const B: Card = [1, 1, 1, 1]
  const C: Card = [2, 2, 2, 2]
  const info = boardKInfo([A, B, C], [0, 1, 2, 3])
  expect(info).toEqual({ count: 1, minK: 4, hist: { 4: 1 } })
})
