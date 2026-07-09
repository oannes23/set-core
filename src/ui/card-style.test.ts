/* ui/card-style — the colour-blind redundant encoding (CVD-safe hue + a hue-independent shape pip). */
import { describe, it, expect } from 'vitest'
import { cardHex, cardPipSVG, CARD_HEX, CARD_HEX_CVD } from './card-style'

describe('cardHex — palette switch', () => {
  it('uses the default triad off, the CVD-safe triad on', () => {
    expect(cardHex(0, false)).toBe(CARD_HEX[0])
    expect(cardHex(1, false)).toBe(CARD_HEX[1])
    expect(cardHex(2, true)).toBe(CARD_HEX_CVD[2])
  })
  it('the two triads differ on every colour (the fix actually changes the hues)', () => {
    for (let i = 0; i < 3; i++) expect(CARD_HEX[i]).not.toBe(CARD_HEX_CVD[i])
  })
})

describe('cardPipSVG — the redundant hue-independent channel', () => {
  it('is empty in the default look (aesthetic unchanged)', () => {
    for (let i = 0; i < 3; i++) expect(cardPipSVG(i, false)).toBe('')
  })
  it('emits a DISTINCT shape per colour in colour-blind mode', () => {
    expect(cardPipSVG(0, true)).toContain('<circle')
    expect(cardPipSVG(1, true)).toContain('<polygon')
    expect(cardPipSVG(2, true)).toContain('<rect')
  })
  it('paints the pip in the CVD-safe hue', () => {
    expect(cardPipSVG(0, true)).toContain(CARD_HEX_CVD[0])
  })
})
