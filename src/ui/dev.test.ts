/* The dev-mode flag + the descriptive↔thematic name registry. localStorage I/O is best-effort
   (try/catch), so these run fine in the node test env — the flag works in-memory there. */
import { describe, it, expect, beforeEach } from 'vitest'
import { isDev, setDev, toggleDev, onDevChange, displayName, AFFIX_THEME } from './dev'

describe('dev mode flag', () => {
  beforeEach(() => setDev(false)) // deterministic start regardless of order

  it('toggles and reports state', () => {
    expect(isDev()).toBe(false)
    toggleDev()
    expect(isDev()).toBe(true)
    toggleDev()
    expect(isDev()).toBe(false)
  })

  it('notifies listeners only on a real change, and unsubscribes', () => {
    const seen: boolean[] = []
    const off = onDevChange((on) => seen.push(on))
    setDev(false) // no change → no fire
    setDev(true) // fire
    setDev(true) // no change → no fire
    setDev(false) // fire
    off()
    setDev(true) // not seen (unsubscribed)
    expect(seen).toEqual([true, false])
  })
})

describe('name resolution', () => {
  beforeEach(() => setDev(false))

  it('shows the thematic name in normal play, the system key in dev mode', () => {
    expect(displayName('CritMultiplier')).toBe('Vorpal') // thematic overlay
    setDev(true)
    expect(displayName('CritMultiplier')).toBe('CritMultiplier') // raw system name
  })

  it('falls back to the key itself when no thematic name is registered', () => {
    expect(displayName('SomeUnmappedHook')).toBe('SomeUnmappedHook')
  })

  it('every registered thematic name is a non-empty string distinct from its key', () => {
    for (const [key, theme] of Object.entries(AFFIX_THEME)) {
      expect(theme, key).toBeTruthy()
      expect(theme, key).not.toBe(key)
    }
  })
})
