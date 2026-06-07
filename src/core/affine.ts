/* core/affine — the finite-geometry heart of Set (AG(f,3)).
   A card is a point in (ℤ/3)^4: four features, each value 0|1|2. A "set" is a line —
   three cards whose every coordinate sums to 0 mod 3. Two cards uniquely determine the
   third. This is the proven, pure foundation (ported from the prototype's `third`/`isSet`);
   the board generator (generate.ts) and set-finding (sets.ts) build on it. Internally cards
   are ALWAYS 4-tuples; dropped axes are pinned to a constant so they never affect validity. */

/** Number of features (axes). Cards are always 4-tuples; inactive axes are pinned constant. */
export const DIM = 4

/** A card: four features, each in {0,1,2}. Always length 4. */
export type Card = [number, number, number, number]

/** The unique third card that completes the set with `a` and `b`:
 *  third(a,b)_i = (-(a_i + b_i)) mod 3. */
export function third(a: Card, b: Card): Card {
  return [
    (3 - ((a[0] + b[0]) % 3)) % 3,
    (3 - ((a[1] + b[1]) % 3)) % 3,
    (3 - ((a[2] + b[2]) % 3)) % 3,
    (3 - ((a[3] + b[3]) % 3)) % 3,
  ]
}

/** True iff a, b, c form a set: every coordinate sums to 0 mod 3. */
export function isSet(a: Card, b: Card, c: Card): boolean {
  return (a[0] + b[0] + c[0]) % 3 === 0
    && (a[1] + b[1] + c[1]) % 3 === 0
    && (a[2] + b[2] + c[2]) % 3 === 0
    && (a[3] + b[3] + c[3]) % 3 === 0
}

/** A stable integer identity for a card (base-3 digits) — for dedup / set-membership lookups. */
export const keyOf = (c: Card): number => c[0] * 27 + c[1] * 9 + c[2] * 3 + c[3]

/** Card equality. */
export const eq = (a: Card, b: Card): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
