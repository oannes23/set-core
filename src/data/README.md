# data/

Typed, declarative game content — the portable JSON→YAML artifact.

- `schema.ts` — types for the token vocabulary + structures (traps, creatures, dungeons …). Pure
  authoring-time checking; nothing at runtime. Keeps the PORTABILITY CONTRACT (string tokens only).
- `game-data.ts` — the content as a typed `GAMEDATA` const. **The live source of truth**: the
  migration is complete and this has INTENTIONALLY DIVERGED from the archived
  `prototype/game-data.js` (new foes/elites, retuned dungeons).
- `classes.ts` — the 9 class loadouts (ability/passive ids), integrity-gated against the registries.
- `game-data.test.ts` — referential integrity of all ids + schema conformance. (The migration-era
  byte-parity check against the prototype oracle is retired.)
