/* The pure Embassy-availability gate (the predicate every request path checks). */
import { describe, it, expect } from 'vitest'
import { isAvailable, type EmbassyConfig } from './config'

const cfg = (over: Partial<EmbassyConfig> = {}): EmbassyConfig => ({ enabled: true, serverUrl: 'https://x', modded: false, ...over })

describe('isAvailable', () => {
  it('is true only when enabled, a server URL is set, and unmodded', () => {
    expect(isAvailable(cfg())).toBe(true)
  })
  it('is false when disabled', () => {
    expect(isAvailable(cfg({ enabled: false }))).toBe(false)
  })
  it('is false with no server URL (or blank)', () => {
    expect(isAvailable(cfg({ serverUrl: '' }))).toBe(false)
    expect(isAvailable(cfg({ serverUrl: '   ' }))).toBe(false)
  })
  it('is false when the game is modded (the mod-gate)', () => {
    expect(isAvailable(cfg({ modded: true }))).toBe(false)
  })
})
