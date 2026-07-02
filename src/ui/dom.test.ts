/* esc() — the HTML-escape used at every server-/user-controlled interpolation site (FABLE §6 U3). */

import { test, expect } from 'vitest'
import { esc } from './dom'

test('esc escapes the five HTML-significant chars in one pass', () => {
  expect(esc(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;')
})

test('esc leaves safe strings untouched (handles, urls, dates, criteria)', () => {
  expect(esc('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000')
  expect(esc('daily 2026-07-01 · Rook')).toBe('daily 2026-07-01 · Rook')
})

test('esc coerces null/undefined/number to a safe string', () => {
  expect(esc(null)).toBe('')
  expect(esc(undefined)).toBe('')
  expect(esc(42)).toBe('42')
})

test('esc neutralizes a script-injection handle (the stored-XSS vector)', () => {
  expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
})

test('esc neutralizes an attribute breakout (the user-set serverUrl vector)', () => {
  expect(esc('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)')
})
