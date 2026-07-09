/* ui/card-style — the CARD colour presentation. Colour is a literal MATCH axis (red/green/blue), so in the
   default palette it's the one card trait a colour-blind player can't read (shape + number get glyphs; the
   classic red/green pair is the deutan/protan confusion case). This module provides the redundant channel:
   a CVD-safe (Okabe-Ito) hue triad AND a hue-INDEPENDENT shape PIP per colour, both gated on colour-blind
   mode. Pure — cardSVG reads it, the settings toggle flips the pref; unit-tested without the DOM. */

// default hues — must stay in step with --c0/--c1/--c2 in styles.css (red/green/blue = Power/Endurance/Speed)
export const CARD_HEX = ['#f0565b', '#46c46a', '#5b94f5'] as const
// Okabe-Ito vermillion / bluish-green / blue — a qualitative triad engineered to separate under deutan/protan
export const CARD_HEX_CVD = ['#d55e00', '#009e73', '#0072b2'] as const

/** The card's fill/stroke hue for the active palette. */
export function cardHex(colorIdx: number, colorblind: boolean): string {
  return (colorblind ? CARD_HEX_CVD : CARD_HEX)[colorIdx]
}

/** The redundant, hue-INDEPENDENT colour pip as SVG markup — a distinct SHAPE per colour so colour is
 *  legible without perceiving hue: ● circle = red/Power, ▲ triangle = green/Endurance, ■ square = blue/Speed.
 *  Empty string when colour-blind mode is off (the default look is unchanged). The dark stroke keeps the pip
 *  readable over any card background. */
export function cardPipSVG(colorIdx: number, colorblind: boolean): string {
  if (!colorblind) return ''
  const hex = CARD_HEX_CVD[colorIdx]
  const shape = colorIdx === 0 ? '<circle cx="16" cy="17" r="7"/>'
    : colorIdx === 1 ? '<polygon points="16,9 24,24 8,24"/>'
    : '<rect x="9" y="10" width="15" height="15" rx="2"/>'
  return `<g class="cardpip" fill="${hex}" stroke="#0b0d12" stroke-width="1.5">${shape}</g>`
}
